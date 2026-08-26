// Admin module (§51): finance drill-down — read-only detail endpoints that expose
// every child record of a money row: order → items/invoices/coupon redemption/quote,
// invoice → items/payments/payment_events, coupon → full redemption list.
package api

import (
	"encoding/json"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Order detail ----

type admOrderInvoiceRef struct {
	ID        uuid.UUID `json:"id"`
	PublicID  string    `json:"public_id"`
	Status    string    `json:"status"`
	Total     float64   `json:"total"`
	AmountDue float64   `json:"amount_due"`
}

type admCouponRedemption struct {
	Code           string  `json:"code"`
	DiscountAmount float64 `json:"discount_amount"`
}

type admQuoteSummary struct {
	ID               uuid.UUID       `json:"id"`
	PriceMode        string          `json:"price_mode"`
	Subtotal         float64         `json:"subtotal"`
	Tax              float64         `json:"tax"`
	Total            float64         `json:"total"`
	ExpiresAt        string          `json:"expires_at"`
	PricingBreakdown json.RawMessage `json:"pricing_breakdown"`
}

type admOrderDetailRow struct {
	ID             uuid.UUID       `json:"id"`
	PublicID       string          `json:"public_id"`
	OrganizationID uuid.UUID       `json:"organization_id"`
	OrgPublicID    string          `json:"org_public_id"`
	OrgSlug        string          `json:"org_slug"`
	CreatedBy      *uuid.UUID      `json:"created_by,omitempty"`
	QuoteID        *uuid.UUID      `json:"quote_id,omitempty"`
	CouponID       *uuid.UUID      `json:"coupon_id,omitempty"`
	Currency       string          `json:"currency"`
	Subtotal       float64         `json:"subtotal"`
	Discount       float64         `json:"discount"`
	Tax            float64         `json:"tax"`
	Total          float64         `json:"total"`
	Status         string          `json:"status"`
	IdempotencyKey *string         `json:"idempotency_key,omitempty"`
	Metadata       json.RawMessage `json:"metadata"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
	CompletedAt    string          `json:"completed_at"`
	CancelledAt    string          `json:"cancelled_at"`

	Items            []orderItemOut       `json:"items"`
	Invoices         []admOrderInvoiceRef `json:"invoices"`
	CouponRedemption *admCouponRedemption `json:"coupon_redemption,omitempty"`
	Quote            *admQuoteSummary     `json:"quote,omitempty"`
}

// handleAdminOrderDetail returns one order with all header columns plus its
// items, invoices, coupon redemption and originating price quote.
// Staff authorization is enforced by route middleware.
func (s *Server) handleAdminOrderDetail(c fiber.Ctx) error {
	orderID, err := admParseUUIDParam(c, "order_id", "order_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()

	var d admOrderDetailRow
	var subtotal, discount, tax, total string
	err = s.db.QueryRow(ctx, `
SELECT o.id, o.public_id, o.organization_id, org.public_id, org.slug::text,
       o.created_by, o.quote_id, o.coupon_id, o.currency::text,
       o.subtotal::text, o.discount::text, o.tax::text, o.total::text, o.status::text,
       o.idempotency_key, o.metadata,
       o.created_at::text, o.updated_at::text,
       COALESCE(o.completed_at::text,''), COALESCE(o.cancelled_at::text,'')
FROM orders o JOIN organizations org ON org.id=o.organization_id
WHERE o.id=$1`, orderID).Scan(&d.ID, &d.PublicID, &d.OrganizationID, &d.OrgPublicID,
		&d.OrgSlug, &d.CreatedBy, &d.QuoteID, &d.CouponID, &d.Currency,
		&subtotal, &discount, &tax, &total, &d.Status,
		&d.IdempotencyKey, &d.Metadata,
		&d.CreatedAt, &d.UpdatedAt, &d.CompletedAt, &d.CancelledAt)
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "order not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	d.Subtotal = admParseFloat(subtotal)
	d.Discount = admParseFloat(discount)
	d.Tax = admParseFloat(tax)
	d.Total = admParseFloat(total)

	itemsByOrder, err := s.orderItemsFor(c, []uuid.UUID{orderID})
	if err != nil {
		return mw.WriteError(c, err)
	}
	d.Items = []orderItemOut{}
	if its, ok := itemsByOrder[orderID]; ok {
		d.Items = its
	}

	d.Invoices = []admOrderInvoiceRef{}
	rows, err := s.db.Query(ctx, `
SELECT id, public_id, status::text, total::text, amount_due::text
FROM invoices WHERE order_id=$1 ORDER BY created_at DESC`, orderID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	for rows.Next() {
		var inv admOrderInvoiceRef
		var totalStr, dueStr string
		if err := rows.Scan(&inv.ID, &inv.PublicID, &inv.Status, &totalStr, &dueStr); err != nil {
			return mw.WriteError(c, err)
		}
		inv.Total = admParseFloat(totalStr)
		inv.AmountDue = admParseFloat(dueStr)
		d.Invoices = append(d.Invoices, inv)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	// coupon_redemptions is UNIQUE(coupon_id, order_id): at most one per order.
	var redemption admCouponRedemption
	err = s.db.QueryRow(ctx, `
SELECT c.code::text, r.discount_amount
FROM coupon_redemptions r JOIN coupons c ON c.id=r.coupon_id
WHERE r.order_id=$1`, orderID).Scan(&redemption.Code, &redemption.DiscountAmount)
	if err == nil {
		d.CouponRedemption = &redemption
	} else if err != pgx.ErrNoRows {
		return mw.WriteError(c, err)
	}

	if d.QuoteID != nil {
		q, qerr := s.admQuoteSummaryFor(c, *d.QuoteID)
		if qerr != nil {
			return mw.WriteError(c, qerr)
		}
		d.Quote = q
	}
	return mw.JSON(c, 200, d, nil)
}

// admQuoteSummaryFor loads the pricing summary of a price quote.
func (s *Server) admQuoteSummaryFor(c fiber.Ctx, quoteID uuid.UUID) (*admQuoteSummary, error) {
	var q admQuoteSummary
	var subtotal, tax, total string
	err := s.db.QueryRow(c.Context(), `
SELECT id, price_mode::text, subtotal::text, tax::text, total::text,
       expires_at::text, pricing_breakdown
FROM price_quotes WHERE id=$1`, quoteID).
		Scan(&q.ID, &q.PriceMode, &subtotal, &tax, &total, &q.ExpiresAt, &q.PricingBreakdown)
	if err == pgx.ErrNoRows {
		return nil, nil // quote was deleted; omit rather than fail the order detail
	}
	if err != nil {
		return nil, err
	}
	q.Subtotal = admParseFloat(subtotal)
	q.Tax = admParseFloat(tax)
	q.Total = admParseFloat(total)
	return &q, nil
}

// ---- Invoice detail ----

type admInvoicePaymentRow struct {
	ID                uuid.UUID `json:"id"`
	PublicID          string    `json:"public_id"`
	Provider          string    `json:"provider"`
	Method            string    `json:"method"`
	ExternalPaymentID *string   `json:"external_payment_id,omitempty"`
	ExternalReference *string   `json:"external_reference,omitempty"`
	Currency          string    `json:"currency"`
	Amount            float64   `json:"amount"`
	Fee               float64   `json:"fee"`
	Status            string    `json:"status"`
	PaidAt            string    `json:"paid_at"`
	ExpiresAt         string    `json:"expires_at"`
	CreatedAt         string    `json:"created_at"`
}

type admPaymentEventRow struct {
	ID              int64           `json:"id"`
	PaymentID       uuid.UUID       `json:"payment_id"`
	Provider        string          `json:"provider"`
	ExternalEventID *string         `json:"external_event_id,omitempty"`
	EventType       string          `json:"event_type"`
	SignatureValid  *bool           `json:"signature_valid,omitempty"`
	Payload         json.RawMessage `json:"payload"`
	ProcessedAt     string          `json:"processed_at"`
	ProcessingError *string         `json:"processing_error,omitempty"`
	ReceivedAt      string          `json:"received_at"`
}

// handleAdminInvoiceDetail returns one invoice with its line items, all payment
// rows and the latest 20 provider webhook events for those payments. Events link
// to payments directly via payment_events.payment_id, so no payload fallback is
// needed. Staff authorization is enforced by route middleware.
func (s *Server) handleAdminInvoiceDetail(c fiber.Ctx) error {
	invoiceID, err := admParseUUIDParam(c, "invoice_id", "invoice_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()

	inv, err := scanAdmInvoice(s.db.QueryRow(ctx, admInvoiceSelect+` WHERE i.id=$1`, invoiceID))
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "invoice not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	items, err := s.invoiceItems(c, invoiceID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	payments := []admInvoicePaymentRow{}
	payRows, err := s.db.Query(ctx, `
SELECT id, public_id, provider, COALESCE(method,''), external_payment_id, external_reference,
       currency::text, amount::text, fee::text, status::text,
       COALESCE(paid_at::text,''), COALESCE(expires_at::text,''), created_at::text
FROM payments WHERE invoice_id=$1 ORDER BY created_at DESC`, invoiceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer payRows.Close()
	for payRows.Next() {
		var p admInvoicePaymentRow
		var amountStr, feeStr string
		if err := payRows.Scan(&p.ID, &p.PublicID, &p.Provider, &p.Method,
			&p.ExternalPaymentID, &p.ExternalReference, &p.Currency,
			&amountStr, &feeStr, &p.Status, &p.PaidAt, &p.ExpiresAt, &p.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		p.Amount = admParseFloat(amountStr)
		p.Fee = admParseFloat(feeStr)
		payments = append(payments, p)
	}
	if err := payRows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	events := []admPaymentEventRow{}
	evRows, err := s.db.Query(ctx, `
SELECT e.id, e.payment_id, e.provider, e.external_event_id, e.event_type,
       e.signature_valid, e.payload, COALESCE(e.processed_at::text,''),
       e.processing_error, e.received_at::text
FROM payment_events e JOIN payments p ON p.id=e.payment_id
WHERE p.invoice_id=$1
ORDER BY e.received_at DESC, e.id DESC
LIMIT 20`, invoiceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer evRows.Close()
	for evRows.Next() {
		var e admPaymentEventRow
		if err := evRows.Scan(&e.ID, &e.PaymentID, &e.Provider, &e.ExternalEventID,
			&e.EventType, &e.SignatureValid, &e.Payload, &e.ProcessedAt,
			&e.ProcessingError, &e.ReceivedAt); err != nil {
			return mw.WriteError(c, err)
		}
		events = append(events, e)
	}
	if err := evRows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	out := struct {
		admInvoiceRow
		Items         []invoiceItemOut       `json:"items"`
		Payments      []admInvoicePaymentRow `json:"payments"`
		PaymentEvents []admPaymentEventRow   `json:"payment_events"`
	}{*inv, items, payments, events}
	return mw.JSON(c, 200, out, nil)
}

// ---- Coupon detail ----

type admCouponRedemptionRow struct {
	ID             uuid.UUID  `json:"id"`
	OrganizationID uuid.UUID  `json:"organization_id"`
	OrgPublicID    string     `json:"organization_public_id"`
	OrgName        string     `json:"organization_name"`
	UserID         *uuid.UUID `json:"user_id,omitempty"`
	UserEmail      *string    `json:"user_email,omitempty"`
	OrderID        uuid.UUID  `json:"order_id"`
	OrderPublicID  *string    `json:"order_public_id,omitempty"`
	DiscountAmount float64    `json:"discount_amount"`
	CreatedAt      string     `json:"created_at"`
}

// handleAdminCouponDetail returns the coupon row (with redeemed_count) and its
// full redemption list. Staff authorization is enforced by route middleware.
func (s *Server) handleAdminCouponDetail(c fiber.Ctx) error {
	couponID, err := admParseUUIDParam(c, "coupon_id", "coupon_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()

	cp, err := scanAdmCoupon(s.db.QueryRow(ctx, admCouponSelect+` WHERE c.id=$1`, couponID))
	if err == pgx.ErrNoRows {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "coupon not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}

	redemptions := []admCouponRedemptionRow{}
	rows, err := s.db.Query(ctx, `
SELECT r.id, r.organization_id, org.public_id, org.name,
       r.user_id, u.email::text, r.order_id, o.public_id,
       r.discount_amount, r.created_at::text
FROM coupon_redemptions r
JOIN organizations org ON org.id=r.organization_id
LEFT JOIN users u ON u.id=r.user_id
LEFT JOIN orders o ON o.id=r.order_id
WHERE r.coupon_id=$1
ORDER BY r.created_at DESC`, couponID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	for rows.Next() {
		var r admCouponRedemptionRow
		var amountStr string
		if err := rows.Scan(&r.ID, &r.OrganizationID, &r.OrgPublicID, &r.OrgName,
			&r.UserID, &r.UserEmail, &r.OrderID, &r.OrderPublicID,
			&amountStr, &r.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		r.DiscountAmount = admParseFloat(amountStr)
		redemptions = append(redemptions, r)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	out := struct {
		admCouponRow
		Redemptions []admCouponRedemptionRow `json:"redemptions"`
	}{*cp, redemptions}
	return mw.JSON(c, 200, out, nil)
}
