package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// CreateRenewalInvoice issues the next renewal invoice for a subscription.
//
// It reuses the orders/invoices shape of CreateOrder/CreateInvoiceFromOrder
// but writes both rows directly inside one transaction so no user-supplied
// item validation is involved: exactly one order_item line ("Subscription
// renewal <plan>") priced at the subscription's recurring_amount plus the
// default tax rate.
//
// Idempotency: the order carries idempotency_key "renew-<subID>-<period_start>",
// guarded by UNIQUE(organization_id, idempotency_key). A repeated call for the
// same period returns the already-issued invoice instead of double-billing.
// The subscription id is stored in orders.metadata so the payment path can
// advance the billing period after settlement.
func (s *Service) CreateRenewalInvoice(ctx context.Context, subID uuid.UUID) (*Invoice, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var (
		orgID       uuid.UUID
		productID   uuid.UUID
		planID      *uuid.UUID
		currency    string
		recurStr    string
		billPeriod  string
		periodStart *time.Time
		kind        string
		label       string
	)
	err = tx.QueryRow(ctx, `
SELECT s.organization_id, s.product_id, s.plan_id, s.currency::text,
       s.recurring_amount::text, s.billing_period::text, s.current_period_start,
       p.service_kind::text, COALESCE(pl.name, p.name)
FROM subscriptions s
JOIN products p ON p.id = s.product_id
LEFT JOIN plans pl ON pl.id = s.plan_id
WHERE s.id=$1
FOR UPDATE OF s`, subID).
		Scan(&orgID, &productID, &planID, &currency, &recurStr, &billPeriod, &periodStart, &kind, &label)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return nil, err
	}

	var recurring float64
	fmt.Sscanf(recurStr, "%f", &recurring)

	periodKey := "none"
	if periodStart != nil {
		periodKey = periodStart.UTC().Format("2006-01-02T15:04:05Z")
	}
	idemKey := "renew-" + subID.String() + "-" + periodKey

	// Already invoiced for this period? Return the existing invoice untouched.
	var existingOrderID uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT id FROM orders WHERE organization_id=$1 AND idempotency_key=$2`,
		orgID, idemKey).Scan(&existingOrderID)
	if err == nil {
		inv, gerr := invoiceForOrder(ctx, tx, existingOrderID)
		if gerr != nil {
			return nil, gerr
		}
		return inv, tx.Rollback(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	subtotal := round2(recurring)
	tax := round2(subtotal * defaultTaxRate)
	total := round2(subtotal + tax)

	metaJSON, _ := json.Marshal(map[string]any{
		"subscription_id":      subID.String(),
		"renewal_period_start": periodKey,
	})

	var ordID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO orders(organization_id, currency, subtotal, discount, tax, total,
                   status, idempotency_key, metadata)
VALUES ($1,$2,$3,0,$4,$5,'processing',$6,$7::jsonb)
ON CONFLICT (organization_id, idempotency_key) DO NOTHING
RETURNING id`,
		orgID, orDefaultCurrency(currency), subtotal, tax, total, idemKey, metaJSON).Scan(&ordID)
	if errors.Is(err, pgx.ErrNoRows) {
		// A concurrent worker created the renewal order between our SELECT and
		// INSERT; serve its invoice instead of duplicating the billing run.
		if serr := tx.QueryRow(ctx, `
SELECT id FROM orders WHERE organization_id=$1 AND idempotency_key=$2`,
			orgID, idemKey).Scan(&existingOrderID); serr != nil {
			return nil, serr
		}
		inv, gerr := invoiceForOrder(ctx, tx, existingOrderID)
		if gerr != nil {
			return nil, gerr
		}
		return inv, tx.Rollback(ctx)
	}
	if err != nil {
		return nil, err
	}

	description := "Subscription renewal " + label
	var itemID uuid.UUID
	if err = tx.QueryRow(ctx, `
INSERT INTO order_items(order_id, product_id, plan_id, service_kind, description,
                        quantity, unit_price, subtotal, billing_period)
VALUES ($1,$2,$3,$4::service_kind,$5,1,$6,$6,NULLIF($7,'')::billing_period)
RETURNING id`,
		ordID, productID, nullUUID(planID), kind, description, subtotal, billPeriod).Scan(&itemID); err != nil {
		return nil, fmt.Errorf("insert renewal order item: %w", err)
	}

	number, err := nextInvoiceNumber(ctx, tx)
	if err != nil {
		return nil, err
	}
	dueDays := 3
	var inv Invoice
	var totalStr string
	err = tx.QueryRow(ctx, `
INSERT INTO invoices(public_id, invoice_number, organization_id, order_id, currency,
                     subtotal, discount, tax, total, amount_due, status, issued_at, due_at)
VALUES (DEFAULT, $1, $2, $3, $4, $5, 0, $6, $7, $7, 'unpaid', now(), now()+($8 || ' days')::interval)
RETURNING id, public_id, invoice_number, total::text, amount_due::text, status::text, due_at::text`,
		number, orgID, ordID, orDefaultCurrency(currency), subtotal, tax, total, fmt.Sprint(dueDays)).
		Scan(&inv.ID, &inv.PublicID, &inv.InvoiceNumber, &totalStr, &inv.AmountDue, &inv.Status, &inv.DueAt)
	if err != nil {
		return nil, fmt.Errorf("insert renewal invoice: %w", err)
	}
	fmt.Sscanf(totalStr, "%f", &inv.Total)

	if _, err = tx.Exec(ctx, `
INSERT INTO invoice_items(invoice_id, order_item_id, description, quantity, unit_price, subtotal, total)
VALUES ($1,$2,$3,1,$4,$4,$4)`,
		inv.ID, itemID, description, subtotal); err != nil {
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &inv, nil
}

// invoiceForOrder returns the newest invoice attached to an order.
func invoiceForOrder(ctx context.Context, tx pgx.Tx, orderID uuid.UUID) (*Invoice, error) {
	var inv Invoice
	var totalStr string
	err := tx.QueryRow(ctx, `
SELECT id, public_id, invoice_number, total::text, amount_due::text, status::text, due_at::text
FROM invoices WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, orderID).
		Scan(&inv.ID, &inv.PublicID, &inv.InvoiceNumber, &totalStr, &inv.AmountDue, &inv.Status, &inv.DueAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.New(apperrors.CodeNotFound, "invoice not found for renewal order")
	}
	if err != nil {
		return nil, err
	}
	fmt.Sscanf(totalStr, "%f", &inv.Total)
	return &inv, nil
}

func orDefaultCurrency(c string) string {
	if c == "" {
		return "IDR"
	}
	return c
}
