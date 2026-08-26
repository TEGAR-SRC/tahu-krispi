package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/wallet"
	apperrors "kilat.cloud/backend/pkg/errors"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// handleWalletBalance returns the organization wallet balance for one currency
// (?currency=IDR by default). A wallet that was never funded reads as zero.
func (s *Server) handleWalletBalance(c fiber.Ctx) error {
	currency := upper(c.Query("currency"))
	if currency == "" {
		currency = "IDR"
	}
	bal, err := wallet.NewService(s.db).GetBalance(c.Context(), mustOrgID(c), currency)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, bal, nil)
}

type walletTransactionOut struct {
	ID            uuid.UUID  `json:"id"`
	Direction     string     `json:"direction"`
	Amount        float64    `json:"amount"`
	BalanceBefore float64    `json:"balance_before"`
	BalanceAfter  float64    `json:"balance_after"`
	ReferenceType string     `json:"reference_type,omitempty"`
	ReferenceID   *uuid.UUID `json:"reference_id,omitempty"`
	Description   string     `json:"description,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// handleWalletTransactions lists the org's ledger entries (wallets JOIN
// wallet_transactions), newest first, paginated.
func (s *Server) handleWalletTransactions(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	page, perPage := httputil.Page(c)

	var total int
	if err := s.db.QueryRow(c.Context(), `
SELECT COUNT(*) FROM wallet_transactions wt
JOIN wallets w ON w.id = wt.wallet_id
WHERE w.organization_id=$1`, orgID).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}

	rows, err := s.db.Query(c.Context(), `
SELECT wt.id, wt.direction::text, wt.amount::text, wt.balance_before::text,
       wt.balance_after::text, wt.reference_type, wt.reference_id,
       wt.description, wt.created_at
FROM wallet_transactions wt
JOIN wallets w ON w.id = wt.wallet_id
WHERE w.organization_id=$1
ORDER BY wt.created_at DESC
LIMIT $2 OFFSET $3`, orgID, perPage, (page-1)*perPage)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	items := []walletTransactionOut{}
	for rows.Next() {
		var it walletTransactionOut
		var amountStr, beforeStr, afterStr string
		var refType, refDesc *string
		if err := rows.Scan(&it.ID, &it.Direction, &amountStr, &beforeStr, &afterStr,
			&refType, &it.ReferenceID, &refDesc, &it.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		fmt.Sscanf(amountStr, "%f", &it.Amount)
		fmt.Sscanf(beforeStr, "%f", &it.BalanceBefore)
		fmt.Sscanf(afterStr, "%f", &it.BalanceAfter)
		if refType != nil {
			it.ReferenceType = *refType
		}
		if refDesc != nil {
			it.Description = *refDesc
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, items, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type topupInput struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Method   string  `json:"method"`
}

// handleWalletTopup creates a pending payment without an invoice
// (invoice_id NULL) flagged in provider_payload with purpose=wallet_topup.
// The webhook worker credits the wallet when the gateway reports it paid.
//
// The checkout URL is a gateway-neutral deep link: no external payment
// provider is wired up yet, so it points at Kilat Cloud's own topup page
// keyed by the payment public_id. When a hosted-checkout gateway is
// configured this URL becomes the provider redirect target; the ciphertext
// column keeps it encrypted at rest either way.
func (s *Server) handleWalletTopup(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	var in topupInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.Amount <= 0 {
		return mw.WriteError(c, vErrField("amount", "must be > 0"))
	}
	currency := upper(in.Currency)
	if currency == "" {
		currency = "IDR"
	}

	publicID, err := randomPaymentPublicID()
	if err != nil {
		return mw.WriteError(c, err)
	}
	// Gateway-neutral deep link; see comment on the handler.
	checkoutURL := fmt.Sprintf("https://payment.kilat-cloud.com/topup/%s", publicID)
	key := sha256.Sum256([]byte("checkout:" + s.cfg.SecretEncryptionKey))
	urlCipher, err := crypto.Encrypt(key[:], []byte(checkoutURL))
	if err != nil {
		return mw.WriteError(c, fmt.Errorf("encrypt checkout url: %w", err))
	}
	payload, err := json.Marshal(map[string]any{
		"purpose":         "wallet_topup",
		"organization_id": orgID,
		"amount":          in.Amount,
		"currency":        currency,
	})
	if err != nil {
		return mw.WriteError(c, fmt.Errorf("marshal provider payload: %w", err))
	}

	var (
		id        uuid.UUID
		status    string
		expiresAt *time.Time
	)
	err = s.db.QueryRow(c.Context(), `
INSERT INTO payments(public_id, organization_id, invoice_id, provider, method, currency,
                     amount, status, expires_at, checkout_url_ciphertext, provider_payload)
VALUES ($1,$2,NULL,$3,NULLIF($4,''),$5,$6,'pending', now()+interval '24 hours', $7, $8::jsonb)
RETURNING id, status::text, expires_at`,
		publicID, orgID, s.cfg.PaymentProvider, in.Method, currency, in.Amount, urlCipher, payload).
		Scan(&id, &status, &expiresAt)
	if err != nil {
		return mw.WriteError(c, fmt.Errorf("insert topup payment: %w", err))
	}

	s.auditSvc.Log(c.Context(), auditEntry(c, orgID, &userID, "wallet.topup_request",
		"payment", id, map[string]any{"amount": in.Amount, "currency": currency, "method": in.Method}))

	return mw.JSON(c, 201, fiber.Map{
		"id":           id,
		"public_id":    publicID,
		"status":       status,
		"amount":       in.Amount,
		"currency":     currency,
		"method":       in.Method,
		"checkout_url": checkoutURL,
		"expires_at":   expiresAt,
	}, nil)
}

// auditEntry builds an audit.Entry carrying the request actor, source IP and
// request id so every audited billing action is attributable.
func auditEntry(c fiber.Ctx, orgID uuid.UUID, userID *uuid.UUID,
	action, resourceType string, resourceID uuid.UUID, meta map[string]any) audit.Entry {
	reqID, _ := c.Locals(mw.RequestIDKey).(string)
	return audit.Entry{
		OrganizationID: &orgID,
		ActorUserID:    userID,
		Action:         action,
		ResourceType:   resourceType,
		ResourceID:     &resourceID,
		IP:             c.IP(),
		UserAgent:      c.Get("User-Agent"),
		RequestID:      reqID,
		Metadata:       meta,
	}
}

// randomPaymentPublicID mints a public_id matching the DB default format
// ('pay_' || hex(gen_random_bytes(10))) so the deep link is stable from insert.
func randomPaymentPublicID() (string, error) {
	tok, err := crypto.RandomToken(10)
	if err != nil {
		return "", apperrors.New(apperrors.CodeInternal, "generate payment public id")
	}
	return "pay_" + tok, nil
}
