// Package payment implements payment provider integration (Midtrans-style) and webhooks.
package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/affiliate"
	"kilat.cloud/backend/internal/subscription"
	"kilat.cloud/backend/internal/wallet"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct {
	db            *pgxpool.Pool
	webhookSecret string
	provider      string
}

func NewService(db *pgxpool.Pool, provider, webhookSecret string) *Service {
	return &Service{db: db, provider: provider, webhookSecret: webhookSecret}
}

type CreatePaymentInput struct {
	InvoiceID      uuid.UUID
	OrganizationID uuid.UUID
	Currency       string
	Amount         float64
	Method         string
}

type Payment struct {
	ID          uuid.UUID `json:"id"`
	PublicID    string    `json:"public_id"`
	Status      string    `json:"status"`
	CheckoutURL string    `json:"checkout_url"`
}

// CreatePayment creates a pending payment and returns a signed checkout URL.
func (s *Service) CreatePayment(ctx context.Context, in CreatePaymentInput) (*Payment, error) {
	if in.Amount <= 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "amount must be > 0")
	}
	if in.Currency == "" {
		in.Currency = "IDR"
	}
	checkoutURL := s.buildCheckoutURL(in)
	urlCipher, err := encryptString(s.webhookSecret+":checkout", checkoutURL)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO payments(organization_id, invoice_id, provider, method, currency, amount,
                     checkout_url_ciphertext, status, expires_at)
VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,'pending', now()+interval '24 hours')
RETURNING id, public_id, status::text`,
		in.OrganizationID, in.InvoiceID, s.provider, in.Method, in.Currency, in.Amount, urlCipher)
	var p Payment
	if err := row.Scan(&p.ID, &p.PublicID, &p.Status); err != nil {
		return nil, fmt.Errorf("insert payment: %w", err)
	}
	p.CheckoutURL = checkoutURL
	return &p, nil
}

// GetInvoiceAmountDue resolves the outstanding amount and currency of an invoice.
func (s *Service) GetInvoiceAmountDue(ctx context.Context, invoiceID uuid.UUID) (float64, string, error) {
	row := s.db.QueryRow(ctx, `
SELECT organization_id, currency::text, amount_due::text FROM invoices
WHERE id=$1 AND status IN ('unpaid','overdue')`, invoiceID)
	var orgID uuid.UUID
	var currency, dueStr string
	err := row.Scan(&orgID, &currency, &dueStr)
	if err != nil {
		return 0, "", apperrors.New(apperrors.CodeNotFound, "invoice not found or not payable")
	}
	var amount float64
	fmt.Sscanf(dueStr, "%f", &amount)
	return amount, currency, nil
}

func (s *Service) buildCheckoutURL(in CreatePaymentInput) string {
	token := signPayload(fmt.Sprintf("%s:%.2f:%d", in.InvoiceID, in.Amount, timeNowUnix()), s.webhookSecret)
	return fmt.Sprintf("/v1/payments/checkout/%s?sig=%s&amount=%.2f&currency=%s",
		in.InvoiceID, token, in.Amount, in.Currency)
}

// VerifyWebhook validates the HMAC signature on a raw payload.
func (s *Service) VerifyWebhook(rawPayload []byte, signature string) bool {
	expected := signPayload(string(rawPayload), s.webhookSecret)
	return hmac.Equal([]byte(expected), []byte(signature))
}

type WebhookEvent struct {
	EventID   uuid.UUID       `json:"event_id"`
	PaymentID uuid.UUID       `json:"payment_id"`
	EventType string          `json:"event_type"`
	Status    string          `json:"status"` // paid | failed | expired | cancelled | refunded
	Fee       float64         `json:"fee"`
	Raw       json.RawMessage `json:"-"`
}

// ProcessWebhook is idempotent: same event_id processed twice does not double-credit.
func (s *Service) ProcessWebhook(ctx context.Context, ev WebhookEvent) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
INSERT INTO payment_events(payment_id, provider, external_event_id, event_type, signature_valid, payload, processed_at)
VALUES ($1,$2,$3,$4,true,$5::jsonb,now())
ON CONFLICT (provider, external_event_id) DO NOTHING`,
		ev.PaymentID, s.provider, ev.EventID.String(), ev.EventType, ev.Raw)
	if err != nil {
		return fmt.Errorf("record event: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil // already processed; idempotent
	}
	var followups paidFollowups
	switch ev.Status {
	case "paid":
		fu, perr := s.applyPaid(ctx, tx, ev)
		if perr != nil {
			return perr
		}
		followups = fu
	case "failed", "expired", "cancelled":
		if _, err = tx.Exec(ctx, `
UPDATE payments SET status=$2::payment_status WHERE id=$1 AND status='pending'`, ev.PaymentID, ev.Status); err != nil {
			return err
		}
	case "refunded":
		if _, err = tx.Exec(ctx, `
UPDATE payments SET status='refunded' WHERE id=$1`, ev.PaymentID); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}

	// Post-commit side effects (own transactions inside the services).
	if followups.advanceSubscription != nil {
		// The renewal invoice settled: shift the billing window forward. This
		// runs on its own transaction; a failure here does not roll back the
		// recorded payment and is retried by the next reconciliation pass
		// (ProcessTransitions re-flags the subscription as past_due).
		subSvc := subscription.NewService(s.db, 0)
		_ = subSvc.AdvancePeriodAfterPayment(ctx, *followups.advanceSubscription)
	}
	if followups.affiliateInvoice != nil {
		// Referral commission accrual for the settled invoice; idempotent per
		// invoice, best-effort like every other post-commit side effect here.
		_ = affiliate.RecordCommissionForInvoice(ctx, s.db, nil, *followups.affiliateInvoice)
	}
	return nil
}

// paidFollowups collects actions that must run after the webhook transaction commits.
type paidFollowups struct {
	advanceSubscription *uuid.UUID // set when a renewal invoice was settled
	affiliateInvoice    *uuid.UUID // set when an invoice settled and referral commission may be due
}

// applyPaid settles a "paid" webhook. Two shapes are supported:
//
//   - wallet topup: payments.invoice_id IS NULL with
//     provider_payload->>'purpose'='wallet_topup' — the amount is credited to
//     the organization wallet (ledger entry idempotent via
//     "topup-<payment_id>") and domain_events/notifications/jobs rows are
//     emitted in the same transaction as an outbox (Master Prompt §57).
//   - invoice payment: the invoice/order are marked paid; when the order
//     carries metadata.subscription_id (renewal invoices created by
//     billing.CreateRenewalInvoice) the caller advances that subscription
//     after commit.
func (s *Service) applyPaid(ctx context.Context, tx pgx.Tx, ev WebhookEvent) (paidFollowups, error) {
	var fu paidFollowups

	var (
		invoiceID *uuid.UUID
		orgID     uuid.UUID
		currency  string
		amountStr string
		publicID  string
		purpose   *string
	)
	err := tx.QueryRow(ctx, `
SELECT invoice_id, organization_id, currency::text, amount::text, public_id,
       provider_payload->>'purpose'
FROM payments WHERE id=$1 FOR UPDATE`, ev.PaymentID).
		Scan(&invoiceID, &orgID, &currency, &amountStr, &publicID, &purpose)
	if err != nil {
		return fu, fmt.Errorf("load payment: %w", err)
	}
	fee := ev.Fee

	if _, err := tx.Exec(ctx, `
UPDATE payments SET status='paid', paid_at=now() WHERE id=$1`, ev.PaymentID); err != nil {
		return fu, err
	}

	if invoiceID == nil {
		// ---- Wallet topup ----
		if purpose == nil || *purpose != "wallet_topup" {
			return fu, fmt.Errorf("payment %s has neither invoice nor wallet_topup purpose", publicID)
		}
		var amount float64
		fmt.Sscanf(amountStr, "%f", &amount)

		walletSvc := wallet.NewService(s.db)
		var walletID uuid.UUID
		err = tx.QueryRow(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1,$2)
ON CONFLICT (organization_id, currency) DO UPDATE SET updated_at=now()
RETURNING id`, orgID, currency).Scan(&walletID)
		if err != nil {
			return fu, fmt.Errorf("ensure wallet: %w", err)
		}
		refID := ev.PaymentID
		if aerr := walletSvc.ApplyTransaction(ctx, tx, walletID, "credit", amount,
			"topup", &refID, "topup-"+ev.PaymentID.String(),
			"wallet topup "+publicID); aerr != nil {
			var appErr *apperrors.AppError
			if errors.As(aerr, &appErr) && appErr.Code == apperrors.CodeIdempotencyConflict {
				return fu, nil // duplicate credit attempt; already settled
			}
			return fu, aerr
		}
		data := map[string]any{
			"amount": amount, "currency": currency,
			"payment_public_id": publicID,
		}
		if err = s.emitEventTx(ctx, tx, orgID, "wallet.topup", "payment", &ev.PaymentID, data); err != nil {
			return fu, err
		}
		if err = s.notifyUserTx(ctx, tx, s.orgOwnerTx(ctx, tx, orgID), orgID,
			"wallet.topup",
			"Wallet topup received",
			fmt.Sprintf("Your %s wallet has been credited with %.2f.", currency, amount),
			data); err != nil {
			return fu, err
		}
		return fu, nil
	}

	// ---- Invoice settlement ----
	var alreadyPaid bool
	err = tx.QueryRow(ctx, `
SELECT status='paid' FROM invoices WHERE id=$1 FOR UPDATE`, *invoiceID).Scan(&alreadyPaid)
	if err != nil {
		return fu, err
	}
	if alreadyPaid {
		return fu, nil // another webhook event already settled this invoice
	}
	if _, err := tx.Exec(ctx, `
UPDATE invoices SET status='paid', paid_at=now(), amount_paid=total, amount_due=0 WHERE id=$1`, *invoiceID); err != nil {
		return fu, err
	}
	if _, err := tx.Exec(ctx, `
UPDATE orders SET status='completed', completed_at=now()
WHERE id=(SELECT order_id FROM invoices WHERE id=$1)`, *invoiceID); err != nil {
		return fu, err
	}

	// Renewal invoices carry their subscription in orders.metadata so the
	// billing period can advance once the money arrived.
	var subID *uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT NULLIF(o.metadata->>'subscription_id','')::uuid
FROM orders o JOIN invoices i ON i.order_id=o.id WHERE i.id=$1`, *invoiceID).Scan(&subID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fu, err
	}
	fu.advanceSubscription = subID
	fu.affiliateInvoice = invoiceID // settled now; commission accrues post-commit

	var number string
	var invCurrency, totalDue string
	err = tx.QueryRow(ctx, `
SELECT invoice_number, currency::text, total::text FROM invoices WHERE id=$1`, *invoiceID).
		Scan(&number, &invCurrency, &totalDue)
	if err == nil {
		var total float64
		fmt.Sscanf(totalDue, "%f", &total)
		data := map[string]any{
			"amount": total, "currency": invCurrency, "invoice_number": number,
		}
		if eerr := s.emitEventTx(ctx, tx, orgID, "invoice.paid", "invoice", invoiceID, data); eerr != nil {
			return fu, eerr
		}
		if eerr := s.notifyUserTx(ctx, tx, s.orgOwnerTx(ctx, tx, orgID), orgID,
			"invoice.paid",
			"Payment received for invoice "+number,
			fmt.Sprintf("Your payment of %.2f %s for invoice %s has been received.", total, invCurrency, number),
			data); eerr != nil {
			return fu, eerr
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fu, err
	}
	_ = fee
	return fu, nil
}

// emitEventTx records a domain_event and fans it out to every enabled webhook
// of the organization — one webhook_deliveries row plus one deliver_webhook
// job per matching endpoint — all inside the caller's transaction (outbox).
func (s *Service) emitEventTx(ctx context.Context, tx pgx.Tx, orgID uuid.UUID,
	eventType, resType string, resID *uuid.UUID, payload map[string]any) error {

	payloadJSON, _ := json.Marshal(payload)
	var eventID uuid.UUID
	if err := tx.QueryRow(ctx, `
INSERT INTO domain_events(organization_id, event_type, resource_type, resource_id, payload)
VALUES ($1,$2,NULLIF($3,''),$4,$5::jsonb)
RETURNING id`,
		orgID, eventType, resType, nullUUIDAny(resID), payloadJSON).Scan(&eventID); err != nil {
		return fmt.Errorf("insert domain event: %w", err)
	}

	rows, err := tx.Query(ctx, `
SELECT id FROM webhooks
WHERE organization_id=$1 AND enabled AND ($2::text = ANY(events) OR '*'::text = ANY(events))`,
		orgID, eventType)
	if err != nil {
		return err
	}
	defer rows.Close()
	var hookIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		hookIDs = append(hookIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	envelope, _ := json.Marshal(map[string]any{
		"id": eventID, "event_type": eventType,
		"resource_type": resType, "resource_id": resID, "data": payload,
	})
	for _, hookID := range hookIDs {
		var deliveryID uuid.UUID
		if err := tx.QueryRow(ctx, `
INSERT INTO webhook_deliveries(webhook_id, event_id, request_payload)
VALUES ($1,$2,$3::jsonb)
ON CONFLICT (webhook_id, event_id) DO UPDATE SET request_payload=EXCLUDED.request_payload
RETURNING id`, hookID, eventID, envelope).Scan(&deliveryID); err != nil {
			return fmt.Errorf("insert webhook delivery: %w", err)
		}
		deliveryJSON, _ := json.Marshal(map[string]any{"webhook_delivery_id": deliveryID})
		if _, err := tx.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('webhook','deliver_webhook','webhook_delivery',$1,$2::jsonb)`,
			deliveryID, deliveryJSON); err != nil {
			return err
		}
	}
	return nil
}

// notifyUserTx queues one email notification plus its send_email job inside the
// caller's transaction. A nil recipient skips silently.
func (s *Service) notifyUserTx(ctx context.Context, tx pgx.Tx, userID *uuid.UUID, orgID uuid.UUID,
	eventType, subject, body string, data map[string]any) error {

	if userID == nil || *userID == uuid.Nil {
		return nil
	}
	dataJSON, _ := json.Marshal(data)
	var notifID uuid.UUID
	if err := tx.QueryRow(ctx, `
INSERT INTO notifications(user_id, organization_id, channel, event_type, subject, body, data, status)
VALUES ($1,$2,'email',$3,NULLIF($4,''),NULLIF($5,''),$6::jsonb,'queued')
RETURNING id`, *userID, orgID, eventType, subject, body, dataJSON).Scan(&notifID); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	notifJSON, _ := json.Marshal(map[string]any{"notification_id": notifID})
	if _, err := tx.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('email','send_email','notification',$1,$2::jsonb)`, notifID, notifJSON); err != nil {
		return err
	}
	return nil
}

// orgOwnerTx resolves a recipient for organization-scoped mail: the creator if
// known, otherwise any owner member.
func (s *Service) orgOwnerTx(ctx context.Context, tx pgx.Tx, orgID uuid.UUID) *uuid.UUID {
	var uid *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT created_by FROM organizations WHERE id=$1`, orgID).Scan(&uid); err == nil && uid != nil {
		return uid
	}
	_ = tx.QueryRow(ctx, `
SELECT user_id FROM organization_members
WHERE organization_id=$1 AND role='owner'
ORDER BY joined_at LIMIT 1`, orgID).Scan(&uid)
	return uid
}

func nullUUIDAny(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func encryptString(keyContext, plaintext string) ([]byte, error) {
	key := deriveKey(keyContext)
	block, err := aesNewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := randRead(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func timeNowUnix() int64 { return unixNow() }

func signPayload(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
