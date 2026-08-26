// Admin module (§51): billing management — coupons, orders, invoices, payments, wallet adjustments.
package api

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/wallet"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Coupons ----

type admCouponRow struct {
	ID             uuid.UUID `json:"id"`
	Code           string    `json:"code"`
	Description    string    `json:"description"`
	DiscountType   string    `json:"discount_type"`
	DiscountValue  float64   `json:"discount_value"`
	Currency       string    `json:"currency"`
	MaxDiscount    *float64  `json:"max_discount"`
	MinOrderAmount float64   `json:"min_order_amount"`
	MaxRedemptions *int      `json:"max_redemptions"`
	PerUserLimit   *int      `json:"per_user_limit"`
	StartsAt       string    `json:"starts_at"`
	EndsAt         string    `json:"ends_at"`
	DurationValue  *int      `json:"duration_value"`
	DurationUnit   string    `json:"duration_unit,omitempty"`
	RedeemedCount  int       `json:"redeemed_count"`
	Enabled        bool      `json:"enabled"`
	CreatedAt      string    `json:"created_at"`
}

const admCouponSelect = `
SELECT c.id, c.code::text, COALESCE(c.description,''), c.discount_type, c.discount_value::text,
       COALESCE(c.currency::text,''), c.max_discount::text, c.min_order_amount::text,
       c.max_redemptions, c.per_user_limit, COALESCE(c.starts_at::text,''), COALESCE(c.ends_at::text,''),
       c.duration_value, COALESCE(c.duration_unit,''),
       (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id),
       c.enabled, c.created_at::text
FROM coupons c`

func scanAdmCoupon(row admRowScanner) (*admCouponRow, error) {
	var c admCouponRow
	var discountValue string
	var maxDiscount, minOrder *string
	if err := row.Scan(&c.ID, &c.Code, &c.Description, &c.DiscountType, &discountValue,
		&c.Currency, &maxDiscount, &minOrder, &c.MaxRedemptions, &c.PerUserLimit,
		&c.StartsAt, &c.EndsAt, &c.DurationValue, &c.DurationUnit, &c.RedeemedCount,
		&c.Enabled, &c.CreatedAt); err != nil {
		return nil, err
	}
	c.DiscountValue = admParseFloat(discountValue)
	if minOrder != nil {
		c.MinOrderAmount = admParseFloat(*minOrder)
	}
	if maxDiscount != nil {
		v := admParseFloat(*maxDiscount)
		c.MaxDiscount = &v
	}
	return &c, nil
}

func (s *Server) adminListCoupons(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM coupons`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, admCouponSelect+`
ORDER BY created_at DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	coupons := []admCouponRow{}
	for rows.Next() {
		cp, err := scanAdmCoupon(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		coupons = append(coupons, *cp)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, coupons, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertCouponInput struct {
	Code           string   `json:"code"`
	Description    string   `json:"description"`
	DiscountType   string   `json:"discount_type"`
	DiscountValue  float64  `json:"discount_value"`
	Currency       string   `json:"currency"`
	MaxDiscount    *float64 `json:"max_discount"`
	MinOrderAmount *float64 `json:"min_order_amount"`
	MaxRedemptions *int     `json:"max_redemptions"`
	PerUserLimit   *int     `json:"per_user_limit"`
	StartsAt       string   `json:"starts_at"`
	EndsAt         string   `json:"ends_at"`
	DurationValue  *int     `json:"duration_value"`
	DurationUnit   string   `json:"duration_unit"`
	Enabled        *bool    `json:"enabled"`
}

func (s *Server) adminUpsertCoupon(c fiber.Ctx) error {
	var in admUpsertCouponInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Code) == "" {
		return mw.WriteError(c, errValidation("code is required"))
	}
	discountType := lower(strings.TrimSpace(in.DiscountType))
	if discountType != "fixed" && discountType != "percent" {
		return mw.WriteError(c, vErrField("discount_type", "must be fixed or percent"))
	}
	if in.DiscountValue <= 0 {
		return mw.WriteError(c, vErrField("discount_value", "must be > 0"))
	}
	if in.MaxDiscount != nil && *in.MaxDiscount < 0 {
		return mw.WriteError(c, vErrField("max_discount", "must be >= 0"))
	}
	minOrder := 0.0
	if in.MinOrderAmount != nil {
		minOrder = *in.MinOrderAmount
		if minOrder < 0 {
			return mw.WriteError(c, vErrField("min_order_amount", "must be >= 0"))
		}
	}
	if in.Currency != "" && len(strings.TrimSpace(in.Currency)) != 3 {
		return mw.WriteError(c, vErrField("currency", "must be a 3-letter ISO code"))
	}
	if in.DiscountType == "percent" && in.DiscountValue > 100 {
		return mw.WriteError(c, vErrField("discount_value", "percent cannot exceed 100 (100 = free)"))
	}
	validUnits := map[string]bool{"days": true, "weeks": true, "months": true, "years": true}
	durUnit := lower(strings.TrimSpace(in.DurationUnit))
	if in.DurationValue != nil {
		if *in.DurationValue <= 0 {
			return mw.WriteError(c, vErrField("duration_value", "must be > 0"))
		}
		if !validUnits[durUnit] {
			return mw.WriteError(c, vErrField("duration_unit", "must be days, weeks, months or years"))
		}
	} else if durUnit != "" {
		return mw.WriteError(c, vErrField("duration_unit", "requires duration_value"))
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	ctx := c.Context()
	var durVal any
	if in.DurationValue != nil {
		durVal = *in.DurationValue
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO coupons(code, description, discount_type, discount_value, currency, max_discount,
                    min_order_amount, max_redemptions, per_user_limit, starts_at, ends_at,
                    duration_value, duration_unit, enabled)
VALUES (lower($1),NULLIF($2,''),$3,$4,NULLIF($5,''),$6,$7,$8,$9,
        NULLIF($10,'')::timestamptz,
        COALESCE(NULLIF($11,'')::timestamptz,
                 CASE WHEN $12 IS NOT NULL THEN now() + ($12::text || ' ' || $13) END),
        $12, NULLIF($13,''), $14)
ON CONFLICT (code) DO UPDATE SET
    description=EXCLUDED.description,
    discount_type=EXCLUDED.discount_type,
    discount_value=EXCLUDED.discount_value,
    currency=EXCLUDED.currency,
    max_discount=EXCLUDED.max_discount,
    min_order_amount=EXCLUDED.min_order_amount,
    max_redemptions=EXCLUDED.max_redemptions,
    per_user_limit=EXCLUDED.per_user_limit,
    starts_at=EXCLUDED.starts_at,
    ends_at=COALESCE(NULLIF($11,'')::timestamptz,
                 CASE WHEN $12 IS NOT NULL THEN now() + ($12::text || ' ' || $13) END),
    duration_value=$12,
    duration_unit=NULLIF($13,''),
    enabled=EXCLUDED.enabled`+
		` RETURNING id, lower(code::text), COALESCE(description,''), discount_type, discount_value::text,
          COALESCE(currency::text,''), max_discount::text, min_order_amount::text,
          max_redemptions, per_user_limit, COALESCE(starts_at::text,''), COALESCE(ends_at::text,''),
          duration_value, COALESCE(duration_unit,''),
          (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id=coupons.id),
          enabled, created_at::text`,
		in.Code, in.Description, discountType, in.DiscountValue, upper(in.Currency),
		in.MaxDiscount, minOrder, in.MaxRedemptions, in.PerUserLimit,
		in.StartsAt, in.EndsAt, durVal, durUnit, enabled)

	cp, err := scanAdmCoupon(row)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.coupon.upsert", "coupon", &cp.ID, map[string]any{
		"code": cp.Code, "discount_type": cp.DiscountType, "enabled": cp.Enabled,
	})
	return mw.JSON(c, 200, cp, nil)
}

func (s *Server) adminDeleteCoupon(c fiber.Ctx) error {
	couponID, err := admParseUUIDParam(c, "coupon_id", "coupon_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	tag, err := s.db.Exec(c.Context(), `DELETE FROM coupons WHERE id=$1`, couponID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "coupon not found"))
	}
	s.admAudit(c, "admin.coupon.delete", "coupon", &couponID)
	return c.SendStatus(204)
}

// ---- Orders / invoices / payments list helpers ----

// admOrgFilter builds a WHERE fragment matching an organization by uuid, public_id or slug.
func admOrgFilter(column string, raw string, args []any) (string, []any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", args, nil
	}
	if id, err := uuid.Parse(raw); err == nil {
		args = append(args, id)
		return " AND " + column + "=" + admPlaceholder(len(args)), args, nil
	}
	args = append(args, lower(raw))
	n := len(args)
	return " AND (" + column + " IN (SELECT id FROM organizations WHERE public_id=$" +
		strconv.Itoa(n) + " OR slug=$" + strconv.Itoa(n) + "))", args, nil
}

func admPlaceholder(n int) string { return "$" + strconv.Itoa(n) }

// ---- Orders ----

type admOrderRow struct {
	ID             uuid.UUID `json:"id"`
	PublicID       string    `json:"public_id"`
	OrganizationID uuid.UUID `json:"organization_id"`
	OrgPublicID    string    `json:"org_public_id"`
	OrgSlug        string    `json:"org_slug"`
	Currency       string    `json:"currency"`
	Subtotal       float64   `json:"subtotal"`
	Discount       float64   `json:"discount"`
	Tax            float64   `json:"tax"`
	Total          float64   `json:"total"`
	Status         string    `json:"status"`
	CreatedAt      string    `json:"created_at"`
	CompletedAt    string    `json:"completed_at"`
	CancelledAt    string    `json:"cancelled_at"`
}

const admOrderSelect = `
SELECT o.id, o.public_id, o.organization_id, org.public_id, org.slug::text, o.currency::text,
       o.subtotal::text, o.discount::text, o.tax::text, o.total::text, o.status::text,
       o.created_at::text, COALESCE(o.completed_at::text,''), COALESCE(o.cancelled_at::text,'')
FROM orders o JOIN organizations org ON org.id=o.organization_id`

func scanAdmOrder(row admRowScanner) (*admOrderRow, error) {
	var o admOrderRow
	var subtotal, discount, tax, total string
	if err := row.Scan(&o.ID, &o.PublicID, &o.OrganizationID, &o.OrgPublicID, &o.OrgSlug,
		&o.Currency, &subtotal, &discount, &tax, &total, &o.Status,
		&o.CreatedAt, &o.CompletedAt, &o.CancelledAt); err != nil {
		return nil, err
	}
	o.Subtotal = admParseFloat(subtotal)
	o.Discount = admParseFloat(discount)
	o.Tax = admParseFloat(tax)
	o.Total = admParseFloat(total)
	return &o, nil
}

func (s *Server) adminListOrders(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admOrderStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid order status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND o.status=$" + strconv.Itoa(len(args))
	}
	orgFilter, args, err := admOrgFilter("o.organization_id", c.Query("organization_id"), args)
	if err != nil {
		return mw.WriteError(c, err)
	}
	where += orgFilter

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM orders o WHERE TRUE`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, admOrderSelect+` WHERE TRUE`+where+
		` ORDER BY o.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	orders := []admOrderRow{}
	for rows.Next() {
		o, err := scanAdmOrder(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		orders = append(orders, *o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, orders, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminVoidOrder(c fiber.Ctx) error {
	orderID, err := admParseUUIDParam(c, "order_id", "order_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT status::text FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "order not found"))
	}
	if status == "cancelled" || status == "refunded" || status == "failed" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "order is already "+status))
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE orders SET status='cancelled', cancelled_at=now() WHERE id=$1`, orderID); err != nil {
		return mw.WriteError(c, err)
	}
	if _, err := tx.Exec(ctx, `
UPDATE invoices SET status='void', voided_at=now()
WHERE order_id=$1 AND status IN ('draft','unpaid','overdue')`, orderID); err != nil {
		return mw.WriteError(c, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.order.void", "order", &orderID, map[string]any{"previous_status": status})
	return mw.JSON(c, 200, fiber.Map{"id": orderID, "status": "cancelled"}, nil)
}

// ---- Invoices ----

type admInvoiceRow struct {
	ID             uuid.UUID `json:"id"`
	PublicID       string    `json:"public_id"`
	InvoiceNumber  string    `json:"invoice_number"`
	OrganizationID uuid.UUID `json:"organization_id"`
	OrgPublicID    string    `json:"org_public_id"`
	OrgSlug        string    `json:"org_slug"`
	Currency       string    `json:"currency"`
	Subtotal       float64   `json:"subtotal"`
	Discount       float64   `json:"discount"`
	Tax            float64   `json:"tax"`
	Total          float64   `json:"total"`
	AmountPaid     float64   `json:"amount_paid"`
	AmountDue      float64   `json:"amount_due"`
	Status         string    `json:"status"`
	IssuedAt       string    `json:"issued_at"`
	DueAt          string    `json:"due_at"`
	PaidAt         string    `json:"paid_at"`
	VoidedAt       string    `json:"voided_at"`
	CreatedAt      string    `json:"created_at"`
}

const admInvoiceSelect = `
SELECT i.id, i.public_id, i.invoice_number, i.organization_id, org.public_id, org.slug::text,
       i.currency::text, i.subtotal::text, i.discount::text, i.tax::text, i.total::text,
       i.amount_paid::text, i.amount_due::text, i.status::text,
       COALESCE(i.issued_at::text,''), COALESCE(i.due_at::text,''),
       COALESCE(i.paid_at::text,''), COALESCE(i.voided_at::text,''), i.created_at::text
FROM invoices i JOIN organizations org ON org.id=i.organization_id`

func scanAdmInvoice(row admRowScanner) (*admInvoiceRow, error) {
	var inv admInvoiceRow
	var subtotal, discount, tax, total, amountPaid, amountDue string
	if err := row.Scan(&inv.ID, &inv.PublicID, &inv.InvoiceNumber, &inv.OrganizationID,
		&inv.OrgPublicID, &inv.OrgSlug, &inv.Currency, &subtotal, &discount, &tax, &total,
		&amountPaid, &amountDue, &inv.Status, &inv.IssuedAt, &inv.DueAt, &inv.PaidAt,
		&inv.VoidedAt, &inv.CreatedAt); err != nil {
		return nil, err
	}
	inv.Subtotal = admParseFloat(subtotal)
	inv.Discount = admParseFloat(discount)
	inv.Tax = admParseFloat(tax)
	inv.Total = admParseFloat(total)
	inv.AmountPaid = admParseFloat(amountPaid)
	inv.AmountDue = admParseFloat(amountDue)
	return &inv, nil
}

func (s *Server) adminListInvoices(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admInvoiceStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid invoice status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND i.status=$" + strconv.Itoa(len(args))
	}
	orgFilter, args, err := admOrgFilter("i.organization_id", c.Query("organization_id"), args)
	if err != nil {
		return mw.WriteError(c, err)
	}
	where += orgFilter

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM invoices i WHERE TRUE`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, admInvoiceSelect+` WHERE TRUE`+where+
		` ORDER BY i.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	invoices := []admInvoiceRow{}
	for rows.Next() {
		inv, err := scanAdmInvoice(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		invoices = append(invoices, *inv)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, invoices, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminVoidInvoice(c fiber.Ctx) error {
	invoiceID, err := admParseUUIDParam(c, "invoice_id", "invoice_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT status::text FROM invoices WHERE id=$1`, invoiceID).Scan(&status); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "invoice not found"))
	}
	if status == "paid" || status == "partially_refunded" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvoiceAlreadyPaid, "a paid invoice cannot be voided"))
	}
	if status == "void" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "invoice is already void"))
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE invoices SET status='void', voided_at=now() WHERE id=$1`, invoiceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "invoice not found"))
	}
	s.admAuditMeta(c, "admin.invoice.void", "invoice", &invoiceID, map[string]any{"previous_status": status})
	return mw.JSON(c, 200, fiber.Map{"id": invoiceID, "status": "void"}, nil)
}

// ---- Payments ----

type admPaymentRow struct {
	ID                uuid.UUID  `json:"id"`
	PublicID          string     `json:"public_id"`
	OrganizationID    uuid.UUID  `json:"organization_id"`
	OrgPublicID       string     `json:"org_public_id"`
	OrgSlug           string     `json:"org_slug"`
	InvoiceID         *uuid.UUID `json:"invoice_id"`
	Provider          string     `json:"provider"`
	Method            string     `json:"method"`
	ExternalReference string     `json:"external_reference"`
	Currency          string     `json:"currency"`
	Amount            float64    `json:"amount"`
	Fee               float64    `json:"fee"`
	Status            string     `json:"status"`
	PaidAt            string     `json:"paid_at"`
	CreatedAt         string     `json:"created_at"`
}

func (s *Server) adminListPayments(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admPaymentStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid payment status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND p.status=$" + strconv.Itoa(len(args))
	}
	orgFilter, args, err := admOrgFilter("p.organization_id", c.Query("organization_id"), args)
	if err != nil {
		return mw.WriteError(c, err)
	}
	where += orgFilter

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM payments p WHERE TRUE`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT p.id, p.public_id, p.organization_id, org.public_id, org.slug::text,
       p.invoice_id, p.provider, COALESCE(p.method,''), COALESCE(p.external_reference,''),
       p.currency::text, p.amount::text, p.fee::text, p.status::text,
       COALESCE(p.paid_at::text,''), p.created_at::text
FROM payments p JOIN organizations org ON org.id=p.organization_id WHERE TRUE`+where+
		` ORDER BY p.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	payments := []admPaymentRow{}
	for rows.Next() {
		var pay admPaymentRow
		var amount, fee string
		if err := rows.Scan(&pay.ID, &pay.PublicID, &pay.OrganizationID, &pay.OrgPublicID,
			&pay.OrgSlug, &pay.InvoiceID, &pay.Provider, &pay.Method, &pay.ExternalReference,
			&pay.Currency, &amount, &fee, &pay.Status, &pay.PaidAt, &pay.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		pay.Amount = admParseFloat(amount)
		pay.Fee = admParseFloat(fee)
		payments = append(payments, pay)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, payments, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// ---- Wallet adjustment ----

type admAdjustWalletInput struct {
	Currency    string  `json:"currency"`
	Direction   string  `json:"direction"`
	Amount      float64 `json:"amount"`
	Description string  `json:"description"`
}

func (s *Server) adminAdjustWallet(c fiber.Ctx) error {
	orgID, err := admParseUUIDParam(c, "org_id", "org_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admAdjustWalletInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	direction := lower(strings.TrimSpace(in.Direction))
	if direction != "credit" && direction != "debit" {
		return mw.WriteError(c, vErrField("direction", "must be credit or debit"))
	}
	if in.Amount <= 0 {
		return mw.WriteError(c, vErrField("amount", "must be > 0"))
	}
	description := strings.TrimSpace(in.Description)
	if description == "" {
		return mw.WriteError(c, vErrField("description", "is required"))
	}
	currency := upper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "IDR"
	}
	if len(currency) != 3 {
		return mw.WriteError(c, vErrField("currency", "must be a 3-letter ISO code"))
	}

	ctx := c.Context()
	var orgExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM organizations WHERE id=$1 AND deleted_at IS NULL)`, orgID).Scan(&orgExists); err != nil {
		return mw.WriteError(c, err)
	}
	if !orgExists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "organization not found"))
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1,$2)
ON CONFLICT (organization_id, currency) DO NOTHING`, orgID, currency); err != nil {
		return mw.WriteError(c, err)
	}
	var walletID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM wallets WHERE organization_id=$1 AND currency=$2`, orgID, currency).Scan(&walletID); err != nil {
		return mw.WriteError(c, err)
	}
	walletSvc := wallet.NewService(s.db)
	if err := walletSvc.ApplyTransaction(ctx, tx, walletID, direction, in.Amount,
		wallet.TypeAdjustment, nil, "", "[admin] "+description); err != nil {
		return mw.WriteError(c, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return mw.WriteError(c, err)
	}

	var balance float64
	var balanceText string
	if err := s.db.QueryRow(ctx,
		`SELECT balance::text FROM wallets WHERE id=$1`, walletID).Scan(&balanceText); err == nil {
	fmt.Sscanf(balanceText, "%f", &balance)
	} // on read-back failure keep zero rather than failing an applied ledger entry
	s.admAuditMeta(c, "admin.wallet.adjust", "organization", &orgID, map[string]any{
		"wallet_id": walletID, "direction": direction, "amount": in.Amount,
		"currency": currency, "description": description,
	})
	return mw.JSON(c, 200, fiber.Map{
		"wallet_id": walletID, "organization_id": orgID, "currency": currency,
		"direction": direction, "amount": in.Amount, "balance": balance,
	}, nil)
}
