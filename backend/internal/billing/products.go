// Paid-product subscriptions: object-storage services and reserved IPs carry
// their own monthly subscription so the existing renewal machinery bills them
// exactly like VM renewals — the sweep (subscription.Service.
// ProcessTransitions, called hourly by the worker's generate_invoice job) has
// no product-kind filter: every active subscription whose next_invoice_at is
// due is invoiced from its stored recurring_amount via
// billing.CreateRenewalInvoice, and settlement advances the period through
// payment.Service. These helpers only create/cancel the subscription rows;
// they deliberately do not duplicate any renewal SQL.
package billing

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// Product codes seeded by migration 000007_paid_products.sql.
const (
	ProductCodeObjectStorage = "kilat-object-storage"
	ProductCodeReservedIP    = "kilat-reserved-ip"
)

// DBTX is the subset of database handles used here. *pgxpool.Pool, pgx.Tx and
// *pgxpool.Tx all satisfy it, so callers run these helpers inside their own
// transaction — keeping the resource row and its subscription atomic.
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// EffectiveMonthlyCharge resolves the monthly price for a newly created
// resource: the provider-reported amount when positive, otherwise the
// product's default_monthly_amount. A disabled product yields 0 (not
// billable); an unknown product code is a configuration error and errors out.
func EffectiveMonthlyCharge(ctx context.Context, db DBTX, productCode string, providerAmount float64) (float64, error) {
	if providerAmount > 0 {
		return providerAmount, nil // short-circuit: no product lookup needed
	}
	var enabled bool
	var defStr string
	err := db.QueryRow(ctx,
		`SELECT enabled, default_monthly_amount::text FROM products WHERE code=$1`, productCode).
		Scan(&enabled, &defStr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, apperrors.Newf(apperrors.CodeNotFound,
				"product %q is not seeded; apply migration 000007_paid_products.sql", productCode)
		}
		return 0, fmt.Errorf("load product %s default price: %w", productCode, err)
	}
	if !enabled {
		return 0, nil
	}
	var def float64
	fmt.Sscanf(defStr, "%f", &def)
	return effectiveCharge(providerAmount, def), nil
}

// AttachProductSubscription inserts an ACTIVE monthly subscription for orgID
// billed at amount (provider-reported) or, when that is not positive, at the
// product's default_monthly_amount. The period starts now and runs one month;
// next_invoice_at equals the period end so the first renewal invoice falls due
// exactly one month after creation (same shape as VM provisioning). Returns
// (nil, nil) when the effective charge is zero — free resources get no
// subscription. Mirrors subscription.Service.Activate without duplicating it,
// because callers here hold their own transaction handle.
func AttachProductSubscription(ctx context.Context, db DBTX, orgID uuid.UUID,
	productCode string, amount float64, currency string) (*uuid.UUID, error) {

	charge, err := EffectiveMonthlyCharge(ctx, db, productCode, amount)
	if err != nil {
		return nil, err
	}
	if charge <= 0 {
		return nil, nil
	}

	var productID uuid.UUID
	if err := db.QueryRow(ctx,
		`SELECT id FROM products WHERE code=$1 AND enabled`, productCode).Scan(&productID); err != nil {
		return nil, fmt.Errorf("attach subscription: product %s not found or disabled: %w", productCode, err)
	}

	// now() is transaction-stable in PostgreSQL, so start/end/next_invoice_at
	// share one timestamp; interval '1 month' clamps month-end dates the same
	// way subscription.addMonthsClamped does for VM subscriptions.
	var subID uuid.UUID
	err = db.QueryRow(ctx, `
INSERT INTO subscriptions(organization_id, product_id, status, billing_period, currency,
                          recurring_amount, current_period_start, current_period_end, next_invoice_at)
VALUES ($1,$2,'active','monthly',$3,$4, now(), now() + interval '1 month', now() + interval '1 month')
RETURNING id`,
		orgID, productID, normalizeCurrency(currency), charge).Scan(&subID)
	if err != nil {
		return nil, fmt.Errorf("insert %s subscription: %w", productCode, err)
	}
	return &subID, nil
}

// DetachProductSubscription cancels the subscription of a deleted resource
// immediately (status='cancelled', cancelled_at=now()), mirroring
// subscription.Service.Cancel's immediate path. Idempotent: already
// cancelled/expired rows simply don't match the WHERE clause.
func DetachProductSubscription(ctx context.Context, db DBTX, subscriptionID uuid.UUID) error {
	_, err := db.Exec(ctx, `
UPDATE subscriptions SET status='cancelled', cancelled_at=now(),
                         cancel_at_period_end=false, grace_until=NULL
WHERE id=$1 AND status IN ('active','past_due','suspended')`, subscriptionID)
	if err != nil {
		return fmt.Errorf("cancel product subscription %s: %w", subscriptionID, err)
	}
	return nil
}

// effectiveCharge picks the billable price: provider-reported when positive,
// else the product default; anything else means "not billable".
func effectiveCharge(providerAmount, productDefault float64) float64 {
	switch {
	case providerAmount > 0:
		return providerAmount
	case productDefault > 0:
		return productDefault
	default:
		return 0
	}
}

// normalizeCurrency keeps currencies char(3)-safe: trimmed uppercase ISO code
// when plausible, otherwise the platform default IDR.
func normalizeCurrency(c string) string {
	c = strings.ToUpper(strings.TrimSpace(c))
	if len(c) == 3 {
		return c
	}
	return "IDR"
}
