package api

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/payment"
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

// handleWalletTopup creates a pending wallet top-up via the payment service.
// It always goes through the configured payment provider (SumoPod in prod)
// so the checkout_url is a real https://pay.sumopod.com/pay/... link, not the
// old hard-coded https://payment.* deep link that caused 1014/NXDOMAIN.
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
	p, err := s.paymentSvc.CreatePayment(c.Context(), payment.CreatePaymentInput{
		OrganizationID: orgID,
		InvoiceID:      uuid.Nil,
		Currency:       currency,
		Amount:         in.Amount,
		Method:         in.Method,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), auditEntry(c, orgID, &userID, "wallet.topup_request",
		"payment", p.ID, map[string]any{"amount": in.Amount, "currency": currency, "method": in.Method}))
	return mw.JSON(c, 201, fiber.Map{
		"id":           p.ID,
		"public_id":    p.PublicID,
		"status":       p.Status,
		"amount":       in.Amount,
		"currency":     currency,
		"method":       in.Method,
		"checkout_url": p.CheckoutURL,
		"expires_at":   nil,
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
