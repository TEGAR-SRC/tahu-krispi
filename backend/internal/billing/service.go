// Package billing implements orders, invoices, coupons, and subscriptions.
package billing

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/affiliate"
	"kilat.cloud/backend/internal/wallet"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct {
	db        *pgxpool.Pool
	walletSvc *wallet.Service
}

func NewService(db *pgxpool.Pool, walletSvc *wallet.Service) *Service {
	return &Service{db: db, walletSvc: walletSvc}
}

// ---- Orders ----

type OrderItemInput struct {
	ProductID             *uuid.UUID
	PlanID                *uuid.UUID
	RegionID              *uuid.UUID
	ServiceKind           string // vm, object_storage, ...
	Description           string
	Quantity              float64
	UnitPrice             float64
	BillingPeriod         string
	ResourceConfig        map[string]any
	ProviderEstimatedCost float64
}

type CreateOrderInput struct {
	OrganizationID uuid.UUID
	CreatedBy      uuid.UUID
	QuoteID        *uuid.UUID
	CouponCode     string
	Currency       string
	IdempotencyKey string
	Items          []OrderItemInput
}

type Order struct {
	ID       uuid.UUID `json:"id"`
	PublicID string    `json:"public_id"`
	Status   string    `json:"status"`
	Subtotal float64   `json:"subtotal"`
	Discount float64   `json:"discount"`
	Tax      float64   `json:"tax"`
	Total    float64   `json:"total"`
	Currency string    `json:"currency"`
}

const defaultTaxRate = 0.11

func (s *Service) CreateOrder(ctx context.Context, in CreateOrderInput) (*Order, error) {
	if len(in.Items) == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "at least one item required")
	}
	if in.Currency == "" {
		in.Currency = "IDR"
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var subtotal, discount float64
	for _, it := range in.Items {
		subtotal += it.Quantity * it.UnitPrice
	}
	var couponID *uuid.UUID
	if in.CouponCode != "" {
		cid, cdisc, cerr := s.lookupCoupon(ctx, tx, in.CouponCode, subtotal, in.Currency, in.OrganizationID)
		if cerr != nil {
			return nil, cerr
		}
		couponID = cid
		discount = cdisc
	}
	taxableBase := subtotal - discount
	tax := round2(taxableBase * defaultTaxRate)
	total := round2(subtotal - discount + tax)

	var ord Order
	row := tx.QueryRow(ctx, `
INSERT INTO orders(organization_id, created_by, quote_id, coupon_id, currency,
                   subtotal, discount, tax, total, status, idempotency_key)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_payment',NULLIF($10,''))
RETURNING id, public_id, status::text, subtotal::text, discount::text, tax::text, total::text, currency::text`,
		in.OrganizationID, in.CreatedBy, nullUUID(in.QuoteID), couponID, in.Currency,
		subtotal, discount, tax, total, in.IdempotencyKey)
	var subStr, discStr, taxStr, totStr string
	if err := row.Scan(&ord.ID, &ord.PublicID, &ord.Status, &subStr, &discStr, &taxStr, &totStr, &ord.Currency); err != nil {
		if isUnique(err) {
			return nil, apperrors.New(apperrors.CodeIdempotencyConflict, "idempotency key already used")
		}
		return nil, err
	}
	fmt.Sscanf(subStr, "%f", &ord.Subtotal)
	fmt.Sscanf(discStr, "%f", &ord.Discount)
	fmt.Sscanf(taxStr, "%f", &ord.Tax)
	fmt.Sscanf(totStr, "%f", &ord.Total)

	for _, it := range in.Items {
		cfgJSON, _ := json.Marshal(it.ResourceConfig)
		if _, err := tx.Exec(ctx, `
INSERT INTO order_items(order_id, product_id, plan_id, region_id, service_kind,
                        description, quantity, unit_price, subtotal, billing_period, resource_config,
                        provider_estimated_cost)
VALUES ($1,$2,$3,$4,$5::service_kind,$6,$7,$8,$9,NULLIF($10,'')::billing_period,$11::jsonb,
        NULLIF($12,0))`,
			ord.ID, nullUUID(it.ProductID), nullUUID(it.PlanID), nullUUID(it.RegionID), it.ServiceKind,
			it.Description, it.Quantity, it.UnitPrice, round2(it.Quantity*it.UnitPrice),
			it.BillingPeriod, cfgJSON, it.ProviderEstimatedCost); err != nil {
			return nil, fmt.Errorf("insert order item: %w", err)
		}
	}
	if couponID != nil && discount > 0 {
		if _, err := tx.Exec(ctx, `
INSERT INTO coupon_redemptions(coupon_id, organization_id, user_id, order_id, discount_amount)
VALUES ($1,$2,$3,$4,$5)`, couponID, in.OrganizationID, in.CreatedBy, ord.ID, discount); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &ord, nil
}

type Invoice struct {
	ID            uuid.UUID `json:"id"`
	PublicID      string    `json:"public_id"`
	InvoiceNumber string    `json:"invoice_number"`
	Subtotal      float64   `json:"subtotal"`
	Total         float64   `json:"total"`
	AmountDue     float64   `json:"amount_due"`
	Status        string    `json:"status"`
	DueAt         string    `json:"due_at"`
}

// CreateInvoiceFromOrder creates an unpaid invoice for a pending_payment order.
func (s *Service) CreateInvoiceFromOrder(ctx context.Context, orderID uuid.UUID) (*Invoice, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var orgID uuid.UUID
	var currency string
	var subStr, discStr, taxStr, totStr string
	err = tx.QueryRow(ctx, `
SELECT organization_id, currency::text, subtotal::text, discount::text, tax::text, total::text
FROM orders WHERE id=$1 AND status='pending_payment' FOR UPDATE`,
		orderID).Scan(&orgID, &currency, &subStr, &discStr, &taxStr, &totStr)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "order not found or not payable")
	}
	if err != nil {
		return nil, err
	}
	var inv Invoice
	fmt.Sscanf(subStr, "%f", &inv.Subtotal)
	var discF, taxF float64
	fmt.Sscanf(discStr, "%f", &discF)
	fmt.Sscanf(taxStr, "%f", &taxF)
	fmt.Sscanf(totStr, "%f", &inv.Total)

	items, err := s.orderItems(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	number, err := nextInvoiceNumber(ctx, tx)
	if err != nil {
		return nil, err
	}
	dueDays := 3
	var amtStr string
	err = tx.QueryRow(ctx, `
INSERT INTO invoices(public_id, invoice_number, organization_id, order_id, currency,
                     subtotal, discount, tax, total, amount_due, status, issued_at, due_at)
VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, $8, 'unpaid', now(), now()+ ($9 || ' days')::interval)
RETURNING id, public_id, invoice_number, total::text, amount_due::text, status::text, due_at::text`,
		number, orgID, orderID, currency, inv.Subtotal, discF, taxF, inv.Total, fmt.Sprint(dueDays)).
		Scan(&inv.ID, &inv.PublicID, &inv.InvoiceNumber, &totStr, &amtStr, &inv.Status, &inv.DueAt)
	if err != nil {
		return nil, err
	}
	fmt.Sscanf(amtStr, "%f", &inv.AmountDue)

	for _, it := range items {
		if _, err := tx.Exec(ctx, `
INSERT INTO invoice_items(invoice_id, order_item_id, description, quantity, unit_price, subtotal, total)
VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			inv.ID, it.ID, it.Description, it.Quantity, it.UnitPrice, it.Subtotal, it.Subtotal); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `
UPDATE orders SET status='processing' WHERE id=$1`, orderID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &inv, nil
}

type orderItemRow struct {
	ID          uuid.UUID
	Description string
	Quantity    float64
	UnitPrice   float64
	Subtotal    float64
}

func (s *Service) orderItems(ctx context.Context, tx pgx.Tx, orderID uuid.UUID) ([]orderItemRow, error) {
	rows, err := tx.Query(ctx, `
SELECT id, description, quantity::text, unit_price::text, subtotal::text
FROM order_items WHERE order_id=$1`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []orderItemRow
	for rows.Next() {
		var r orderItemRow
		var qs, us, ss string
		if err := rows.Scan(&r.ID, &r.Description, &qs, &us, &ss); err != nil {
			return nil, err
		}
		fmt.Sscanf(qs, "%f", &r.Quantity)
		fmt.Sscanf(us, "%f", &r.UnitPrice)
		fmt.Sscanf(ss, "%f", &r.Subtotal)
		out = append(out, r)
	}
	return out, rows.Err()
}

// PayInvoiceWithWallet settles an invoice using the organization's wallet.
func (s *Service) PayInvoiceWithWallet(ctx context.Context, invoiceID, userID uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var orgID uuid.UUID
	var currency string
	var amountDueStr string
	var status string
	err = tx.QueryRow(ctx, `
SELECT organization_id, currency::text, amount_due::text, status::text
FROM invoices WHERE id=$1 AND status IN ('unpaid','overdue') FOR UPDATE`,
		invoiceID).Scan(&orgID, &currency, &amountDueStr, &status)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "invoice not found")
	}
	if err != nil {
		return err
	}
	var amountDue float64
	fmt.Sscanf(amountDueStr, "%f", &amountDue)
	if status != "unpaid" && status != "overdue" {
		return apperrors.New(apperrors.CodeInvoiceAlreadyPaid, "invoice is not payable in state "+status)
	}
	wb, err := s.walletSvc.GetBalance(ctx, orgID, currency)
	if err != nil {
		return err
	}
	if wb.Balance < amountDue {
		return apperrors.New(apperrors.CodeInsufficientBalance, "insufficient wallet balance to settle invoice")
	}
	if err = s.walletSvc.ApplyTransaction(ctx, tx, wb.WalletID, "debit", amountDue,
		"invoice", &invoiceID, "pay-invoice-"+invoiceID.String(), "wallet payment for invoice "+invoiceID.String()); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
UPDATE invoices SET status='paid', paid_at=now(), amount_paid=$2, amount_due=0 WHERE id=$1`,
		invoiceID, amountDue); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	// Post-commit affiliate accrual: a failure here must not roll back or
	// fail the settled payment; RecordCommissionForInvoice is idempotent and
	// retried by the payment-webhook path when reconciliation re-processes.
	_ = affiliate.RecordCommissionForInvoice(ctx, s.db, nil, invoiceID)
	return nil
}

func (s *Service) lookupCoupon(ctx context.Context, tx pgx.Tx, code string, subtotal float64, currency string, orgID uuid.UUID) (*uuid.UUID, float64, error) {
	var couponID uuid.UUID
	var dtype string
	var dvalue, maxDiscount *string
	var minAmount string
	var enabled bool
	var couponCurrency *string
	var maxRedemptions, perUserLimit *int
	err := tx.QueryRow(ctx, `
SELECT id, discount_type::text, discount_value::text, max_discount::text,
       min_order_amount::text, enabled, currency,
       max_redemptions, per_user_limit
FROM coupons WHERE lower(code::text)=lower($1)
AND (starts_at IS NULL OR starts_at <= now())
AND (ends_at IS NULL OR ends_at > now())`, code).
		Scan(&couponID, &dtype, &dvalue, &maxDiscount, &minAmount, &enabled, &couponCurrency, &maxRedemptions, &perUserLimit)
	if err == pgx.ErrNoRows {
		return nil, 0, apperrors.New(apperrors.CodeValidation, "coupon invalid or expired")
	}
	if err != nil {
		return nil, 0, err
	}
	if !enabled {
		return nil, 0, apperrors.New(apperrors.CodeValidation, "coupon is disabled")
	}
	if couponCurrency != nil && *couponCurrency != "" && *couponCurrency != currency {
		return nil, 0, apperrors.New(apperrors.CodeValidation, "coupon currency mismatch")
	}
	if maxRedemptions != nil {
		var used int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM coupon_redemptions WHERE coupon_id=$1`, couponID).Scan(&used); err != nil {
			return nil, 0, err
		}
		if used >= *maxRedemptions {
			return nil, 0, apperrors.New(apperrors.CodeValidation, "coupon redemption limit reached")
		}
	}
	if perUserLimit != nil {
		var used int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM coupon_redemptions WHERE coupon_id=$1 AND organization_id=$2`,
			couponID, orgID).Scan(&used); err != nil {
			return nil, 0, err
		}
		if used >= *perUserLimit {
			return nil, 0, apperrors.New(apperrors.CodeValidation, "coupon already used the maximum times for this account")
		}
	}
	var minAmt float64
	fmt.Sscanf(minAmount, "%f", &minAmt)
	if subtotal < minAmt {
		return nil, 0, apperrors.New(apperrors.CodeValidation, "subtotal below coupon minimum")
	}
	var dv float64
	if dvalue != nil {
		fmt.Sscanf(*dvalue, "%f", &dv)
	}
	disc := dv
	if dtype == "percent" {
		disc = subtotal * dv / 100
	}
	if maxDiscount != nil {
		var md float64
		fmt.Sscanf(*maxDiscount, "%f", &md)
		if md > 0 && disc > md {
			disc = md
		}
	}
	return &couponID, round2(disc), nil
}

func nextInvoiceNumber(ctx context.Context, tx pgx.Tx) (string, error) {
	var seq int64
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(MAX(CAST(split_part(invoice_number,'-',2) AS bigint)),0)+1 FROM invoices`).Scan(&seq); err != nil {
		return "", err
	}
	return fmt.Sprintf("INV-%06d", seq), nil
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func round2(v float64) float64 { return float64(int64(v*100+0.5)) / 100 }

func isUnique(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	target := "orders_organization_id_key"
	n := len(target)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == target {
			return true
		}
	}
	return false
}
