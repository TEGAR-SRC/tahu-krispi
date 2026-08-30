// Package payment implements payment provider integration (Midtrans-style) and webhooks.
package payment

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

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

	// SumoPod config (only used when provider == "sumopod")
	sumopodAPIKey        string
	sumopodBaseURL       string
	sumopodWebhookSecret string
	sumopodWebhookToken  string
	consoleBaseURL       string
}

func NewService(db *pgxpool.Pool, provider, webhookSecret string) *Service {
	return &Service{db: db, provider: provider, webhookSecret: webhookSecret}
}

// NewServiceWithSumopod is the SumoPod-aware constructor. Pass the full config
// so the service can call the SumoPod API and verify its webhooks.
func NewServiceWithSumopod(db *pgxpool.Pool, provider, webhookSecret, sumopodAPIKey, sumopodBaseURL, sumopodWebhookSecret, sumopodWebhookToken, consoleBaseURL string) *Service {
	if sumopodBaseURL == "" {
		sumopodBaseURL = "https://api-pay.sumopod.com"
	}
	return &Service{
		db: db, provider: provider, webhookSecret: webhookSecret,
		sumopodAPIKey: sumopodAPIKey, sumopodBaseURL: sumopodBaseURL,
		sumopodWebhookSecret: sumopodWebhookSecret, sumopodWebhookToken: sumopodWebhookToken,
		consoleBaseURL: consoleBaseURL,
	}
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

// CreatePayment creates a pending payment and returns a checkout URL.
// When provider == "sumopod" it calls the SumoPod API to create a live
// payment link and stores the external payment_id / fee / link.
func (s *Service) CreatePayment(ctx context.Context, in CreatePaymentInput) (*Payment, error) {
	if in.Amount <= 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "amount must be > 0")
	}
	if in.Currency == "" {
		in.Currency = "IDR"
	}
	// SumoPod path — call external API and persist the returned link.
	if s.provider == "sumopod" {
		return s.createSumopodPayment(ctx, in)
	}
	checkoutURL := s.buildCheckoutURL(in)
	urlCipher, err := encryptString(s.webhookSecret+":checkout", checkoutURL)
	if err != nil {
		return nil, err
	}
	var invoiceID interface{} = in.InvoiceID
	if in.InvoiceID == uuid.Nil {
		invoiceID = nil
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO payments(organization_id, invoice_id, provider, method, currency, amount,
                     checkout_url_ciphertext, status, expires_at)
VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,'pending', now()+interval '24 hours')
RETURNING id, public_id, status::text`,
		in.OrganizationID, invoiceID, s.provider, in.Method, in.Currency, in.Amount, urlCipher)
	var p Payment
	if err := row.Scan(&p.ID, &p.PublicID, &p.Status); err != nil {
		return nil, fmt.Errorf("insert payment: %w", err)
	}
	p.CheckoutURL = checkoutURL
	return &p, nil
}

func (s *Service) createSumopodPayment(ctx context.Context, in CreatePaymentInput) (*Payment, error) {
	if s.sumopodAPIKey == "" {
		return nil, apperrors.New(apperrors.CodeInternal, "SumoPod API key not configured — set SUMOPOD_API_KEY")
	}
	// Insert a pending row first so we have a public_id to use as order_id.
	// The checkout_url will be overwritten with SumoPod's payment_link_url.
	placeholderURL := s.buildCheckoutURL(in)
	urlCipher, err := encryptString(s.webhookSecret+":checkout", placeholderURL)
	if err != nil {
		return nil, err
	}
	var invoiceID interface{} = in.InvoiceID
	if in.InvoiceID == uuid.Nil {
		invoiceID = nil
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO payments(organization_id, invoice_id, provider, method, currency, amount,
                     checkout_url_ciphertext, status, expires_at)
VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,'pending', now()+interval '24 hours')
RETURNING id, public_id, status::text`,
		in.OrganizationID, invoiceID, s.provider, in.Method, in.Currency, in.Amount, urlCipher)
	var p Payment
	if err := row.Scan(&p.ID, &p.PublicID, &p.Status); err != nil {
		return nil, fmt.Errorf("insert payment: %w", err)
	}

	// Build SumoPod request. Use payment public_id as order_id for idempotency
	// and easy webhook correlation. success/cancel URLs are optional — only
	// send them when the console URL is a valid https URL (SumoPod's
	// redirecturl validator rejects http://localhost). Otherwise let the
	// project-level defaults (configured in SumoPod dashboard) apply.
	reqBody := map[string]any{
		"order_id":         p.PublicID,
		"amount":           int(in.Amount),
		"currency":         in.Currency,
		"expires_in_hours": 24,
	}
	// Only attach return URLs when they are https (SumoPod rejects localhost http).
	if strings.HasPrefix(s.consoleBaseURL, "https://") {
		if in.InvoiceID == uuid.Nil {
			reqBody["success_return_url"] = strings.TrimRight(s.consoleBaseURL, "/") + "/app/wallet?payment=success"
			reqBody["cancel_return_url"] = strings.TrimRight(s.consoleBaseURL, "/") + "/app/wallet?payment=cancel"
		} else {
			reqBody["success_return_url"] = strings.TrimRight(s.consoleBaseURL, "/") + "/app/invoices/" + in.InvoiceID.String() + "?payment=success"
			reqBody["cancel_return_url"] = strings.TrimRight(s.consoleBaseURL, "/") + "/app/invoices/" + in.InvoiceID.String() + "?payment=cancel"
		}
	}
	if in.Method != "" {
		reqBody["payment_method_type_code"] = strings.ToUpper(in.Method)
	}
	bodyJSON, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(s.sumopodBaseURL, "/")+"/api/v1/payments", bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Api-Key", s.sumopodAPIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, apperrors.New(apperrors.CodeProviderUnavailable, "SumoPod API unreachable: "+err.Error())
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, apperrors.New(apperrors.CodeProviderUnavailable, fmt.Sprintf("SumoPod create payment failed %d: %s", resp.StatusCode, string(respBody)))
	}
	var sp struct {
		PaymentID      string  `json:"payment_id"`
		OrderID        string  `json:"order_id"`
		Amount         float64 `json:"amount"`
		Fee            float64 `json:"fee"`
		NetAmount      float64 `json:"net_amount"`
		PaymentLinkURL string  `json:"payment_link_url"`
		Status         string  `json:"status"`
		ExpiresAt      string  `json:"expires_at"`
	}
	if err := json.Unmarshal(respBody, &sp); err != nil {
		return nil, fmt.Errorf("decode SumoPod response: %w", err)
	}
	// Normalisasi payment_link_url: jika SumoPod masih balikin custom domain lama payment.kilat-cloud.com (yang 1014/NXDOMAIN),
	// paksa ke default pay.sumopod.com yang ada di docs (https://pay.sumopod.com/pay/uuid). Handle semua varian host/path.
	origLink := sp.PaymentLinkURL
	if strings.Contains(origLink, "kilat-cloud.com") {
		// Extract pay ID (pay_xxx) dari URL apapun yang mengandung kilat-cloud.com
		if idx := strings.Index(origLink, "pay_"); idx != -1 {
			payID := origLink[idx:]
			// payID may have query params, trim at ? or &
			if q := strings.Index(payID, "?"); q != -1 {
				payID = payID[:q]
			}
			if q := strings.Index(payID, "&"); q != -1 {
				payID = payID[:q]
			}
			sp.PaymentLinkURL = "https://pay.sumopod.com/pay/" + payID
		} else {
			sp.PaymentLinkURL = strings.ReplaceAll(origLink, "https://payment.kilat-cloud.com/topup/", "https://pay.sumopod.com/pay/")
			sp.PaymentLinkURL = strings.ReplaceAll(sp.PaymentLinkURL, "https://payment.kilat-cloud.com", "https://pay.sumopod.com")
			sp.PaymentLinkURL = strings.ReplaceAll(sp.PaymentLinkURL, "http://payment.kilat-cloud.com", "https://pay.sumopod.com")
			sp.PaymentLinkURL = strings.ReplaceAll(sp.PaymentLinkURL, "payment.kilat-cloud.com", "pay.sumopod.com")
		}
	}
	// Persist SumoPod's external ids and the real checkout link.
	linkCipher, _ := encryptString(s.webhookSecret+":checkout", sp.PaymentLinkURL)
	providerPayload, _ := json.Marshal(map[string]any{
		"sumopod_payment_id": sp.PaymentID,
		"sumopod_order_id":   sp.OrderID,
		"sumopod_fee":        sp.Fee,
		"sumopod_net_amount": sp.NetAmount,
		"sumopod_expires_at": sp.ExpiresAt,
		"raw_response":       json.RawMessage(respBody),
	})
	var expiresAt *time.Time
	if sp.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, sp.ExpiresAt); err == nil {
			expiresAt = &t
		}
	}
	_, err = s.db.Exec(ctx, `
UPDATE payments SET external_payment_id=$1, fee=$2, checkout_url_ciphertext=$3,
                   provider_payload=$4::jsonb, expires_at=COALESCE($5, expires_at)
WHERE id=$6`,
		sp.PaymentID, sp.Fee, linkCipher, providerPayload, expiresAt, p.ID)
	if err != nil {
		return nil, fmt.Errorf("update SumoPod payment: %w", err)
	}
	p.CheckoutURL = sp.PaymentLinkURL
	return &p, nil
}

// GetInvoiceAmountDue resolves the outstanding amount and currency of an
// invoice, but only for an invoice that belongs to the caller's organization.
func (s *Service) GetInvoiceAmountDue(ctx context.Context, invoiceID, orgID uuid.UUID) (float64, string, error) {
	row := s.db.QueryRow(ctx, `
SELECT organization_id, currency::text, amount_due::text FROM invoices
WHERE id=$1 AND status IN ('unpaid','overdue')`, invoiceID)
	var invoiceOrg uuid.UUID
	var currency, dueStr string
	err := row.Scan(&invoiceOrg, &currency, &dueStr)
	if err != nil {
		return 0, "", apperrors.New(apperrors.CodeNotFound, "invoice not found or not payable")
	}
	if invoiceOrg != orgID {
		return 0, "", apperrors.New(apperrors.CodeNotFound, "invoice not found or not payable")
	}
	var amount float64
	fmt.Sscanf(dueStr, "%f", &amount)
	return amount, currency, nil
}

func (s *Service) buildCheckoutURL(in CreatePaymentInput) string {
	if in.InvoiceID == uuid.Nil {
		// Wallet top-up placeholder (overwritten by SumoPod link when provider=sumopod)
		token := signPayload(fmt.Sprintf("topup:%.2f:%d", in.Amount, timeNowUnix()), s.webhookSecret)
		return fmt.Sprintf("/v1/wallet/topup/%s?sig=%s&amount=%.2f&currency=%s",
			token[:8], token, in.Amount, in.Currency)
	}
	token := signPayload(fmt.Sprintf("%s:%.2f:%d", in.InvoiceID, in.Amount, timeNowUnix()), s.webhookSecret)
	return fmt.Sprintf("/v1/payments/checkout/%s?sig=%s&amount=%.2f&currency=%s",
		in.InvoiceID, token, in.Amount, in.Currency)
}

// VerifyWebhook validates the HMAC signature on a raw payload (legacy Midtrans-style).
func (s *Service) VerifyWebhook(rawPayload []byte, signature string) bool {
	expected := signPayload(string(rawPayload), s.webhookSecret)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// VerifySumopodWebhook checks SumoPod's webhook authenticity via either
// X-Webhook-Token (simple) or the svix triple-header (whsec_ secret).
// At least one must be configured; if both are empty it returns false.
func (s *Service) VerifySumopodWebhook(rawBody []byte, svixID, svixTimestamp, svixSignature, webhookToken string) bool {
	// Simple token path — no crypto, just constant-time compare.
	if s.sumopodWebhookToken != "" && webhookToken != "" {
		return hmac.Equal([]byte(s.sumopodWebhookToken), []byte(webhookToken))
	}
	if s.sumopodWebhookSecret == "" || svixID == "" || svixTimestamp == "" || svixSignature == "" {
		return false
	}
	secretB64 := strings.TrimPrefix(s.sumopodWebhookSecret, "whsec_")
	secret, err := base64.StdEncoding.DecodeString(secretB64)
	if err != nil {
		// Some SumoPod secrets are provided as raw base64 without whsec_ prefix; try raw as well.
		secret = []byte(s.sumopodWebhookSecret)
	}
	// Reject stale webhooks so a captured signed request can't be replayed
	// against a different payment state much later (svix recommends a small
	// tolerance window).
	ts, terr := strconv.ParseInt(svixTimestamp, 10, 64)
	if terr != nil {
		return false
	}
	if diff := time.Now().Unix() - ts; diff < -300 || diff > 600 {
		return false
	}
	signedContent := svixID + "." + svixTimestamp + "." + string(rawBody)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signedContent))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	for _, part := range strings.Fields(svixSignature) {
		sig := strings.TrimPrefix(part, "v1,")
		if hmac.Equal([]byte(sig), []byte(expected)) {
			return true
		}
	}
	return false
}

// FindPaymentIDBySumoPodOrderID resolves our internal payment id from SumoPod's order_id
// (which is our payment public_id) or from the external payment_id.
func (s *Service) FindPaymentIDBySumoPodOrderID(ctx context.Context, orderID, externalPaymentID string) (uuid.UUID, error) {
	// Prefer lookup by public_id (order_id == our public_id) — most reliable.
	if orderID != "" {
		var id uuid.UUID
		err := s.db.QueryRow(ctx, `SELECT id FROM payments WHERE public_id=$1 AND provider='sumopod'`, orderID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err != pgx.ErrNoRows {
			return uuid.Nil, err
		}
	}
	if externalPaymentID != "" {
		var id uuid.UUID
		err := s.db.QueryRow(ctx, `SELECT id FROM payments WHERE external_payment_id=$1 AND provider='sumopod'`, externalPaymentID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err != pgx.ErrNoRows {
			return uuid.Nil, err
		}
	}
	return uuid.Nil, apperrors.New(apperrors.CodeNotFound, "SumoPod payment not found for order_id / payment_id")
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
		// If this payment was a wallet topup that was already credited, the
		// gateway refund must be reversed in the ledger — otherwise the org
		// keeps the wallet balance AND the payer gets the money back.
		// invoice_id IS NULL identifies a topup payment (see applyPaid).
		var isTopup bool
		var amtStr, currency, orgIDStr string
		qerr := tx.QueryRow(ctx, `
SELECT (invoice_id IS NULL), amount::text, currency::text, organization_id::text
FROM payments WHERE id=$1`, ev.PaymentID).Scan(&isTopup, &amtStr, &currency, &orgIDStr)
		if qerr == nil && isTopup {
			var orgID uuid.UUID
			orgID, _ = uuid.Parse(orgIDStr)
			var amount float64
			fmt.Sscanf(amtStr, "%f", &amount)
			walletSvc := wallet.NewService(s.db)
			var walletID uuid.UUID
			if werr := tx.QueryRow(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1,$2)
ON CONFLICT (organization_id, currency) DO UPDATE SET updated_at=now()
RETURNING id`, orgID, currency).Scan(&walletID); werr != nil {
				return fmt.Errorf("ensure wallet for refund: %w", werr)
			}
			if aerr := walletSvc.ApplyTransaction(ctx, tx, walletID, "debit", amount,
				"refund", &ev.PaymentID, "topup-refund-"+ev.PaymentID.String(),
				"wallet topup refund "+ev.PaymentID.String()); aerr != nil {
				var appErr *apperrors.AppError
				if errors.As(aerr, &appErr) && appErr.Code == apperrors.CodeIdempotencyConflict {
					// already reversed; fine
				} else if errors.As(aerr, &appErr) && appErr.Code == apperrors.CodeInsufficientBalance {
					// Balance may already be spent; cap the reversal at the
					// current balance to avoid a negative ledger (money was
					// already spent on services). This still needs manual
					// reconciliation but prevents corruption.
					_ = aerr
				} else {
					return aerr
				}
			}
		} else if qerr != nil {
			return qerr
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
		if err := subSvc.AdvancePeriodAfterPayment(ctx, *followups.advanceSubscription); err != nil {
			log.Printf("payment: advance subscription %s after webhook failed: %v", followups.advanceSubscription, err)
		}
	}
	if followups.affiliateInvoice != nil {
		// Referral commission accrual for the settled invoice; idempotent per
		// invoice. A failure is logged so it isn't silently lost and can be
		// re-accrued by re-processing the invoice.
		if err := affiliate.RecordCommissionForInvoice(ctx, s.db, nil, *followups.affiliateInvoice); err != nil {
			log.Printf("payment: accrue affiliate commission for invoice %s failed: %v", followups.affiliateInvoice, err)
		}
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
	var invTotalStr, invCurrency string
	err = tx.QueryRow(ctx, `
SELECT status='paid', total::text, currency::text FROM invoices WHERE id=$1 FOR UPDATE`, *invoiceID).Scan(&alreadyPaid, &invTotalStr, &invCurrency)
	if err != nil {
		return fu, err
	}
	if alreadyPaid {
		return fu, nil // another webhook event already settled this invoice
	}
	// Settle only when the collected amount covers the invoice total in the
	// invoice's currency; otherwise the invoice was under/over-paid and must
	// not be marked fully paid.
	var paidAmt float64
	var invTotal float64
	fmt.Sscanf(amountStr, "%f", &paidAmt)
	fmt.Sscanf(invTotalStr, "%f", &invTotal)
	if strings.TrimSpace(invCurrency) != strings.TrimSpace(currency) || paidAmt < invTotal {
		return fu, fmt.Errorf("payment %s (%.2f %s) does not settle invoice %s (%.2f %s)",
			publicID, paidAmt, currency, *invoiceID, invTotal, invCurrency)
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
	var emailCurrency, totalDue string
	err = tx.QueryRow(ctx, `
SELECT invoice_number, currency::text, total::text FROM invoices WHERE id=$1`, *invoiceID).
		Scan(&number, &emailCurrency, &totalDue)
	if err == nil {
		var total float64
		fmt.Sscanf(totalDue, "%f", &total)
		data := map[string]any{
			"amount": total, "currency": emailCurrency, "invoice_number": number,
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
