// Package subscription implements the subscription lifecycle state machine
// (Master Prompt §50) on top of the subscriptions table (schema v2).
package subscription

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct {
	db        *pgxpool.Pool
	graceDays int
}

func NewService(db *pgxpool.Pool, graceDays int) *Service {
	return &Service{db: db, graceDays: graceDays}
}

const subscriptionColumns = `id, public_id, organization_id, product_id, plan_id, order_item_id,
	status::text, billing_period::text, currency::text, recurring_amount::text,
	current_period_start, current_period_end, next_invoice_at, grace_until,
	cancel_at_period_end, cancelled_at, created_at`

type Subscription struct {
	ID                 uuid.UUID  `json:"id"`
	PublicID           string     `json:"public_id"`
	OrganizationID     uuid.UUID  `json:"organization_id"`
	ProductID          uuid.UUID  `json:"product_id"`
	PlanID             *uuid.UUID `json:"plan_id,omitempty"`
	OrderItemID        *uuid.UUID `json:"order_item_id,omitempty"`
	Status             string     `json:"status"`
	BillingPeriod      string     `json:"billing_period"`
	Currency           string     `json:"currency"`
	RecurringAmount    float64    `json:"recurring_amount"`
	CurrentPeriodStart *time.Time `json:"current_period_start"`
	CurrentPeriodEnd   *time.Time `json:"current_period_end"`
	NextInvoiceAt      *time.Time `json:"next_invoice_at"`
	GraceUntil         *time.Time `json:"grace_until"`
	CancelAtPeriodEnd  bool       `json:"cancel_at_period_end"`
	CancelledAt        *time.Time `json:"cancelled_at"`
	CreatedAt          time.Time  `json:"created_at"`
}

type ActivateInput struct {
	OrganizationID  *uuid.UUID
	ProductID       *uuid.UUID
	PlanID          *uuid.UUID
	OrderItemID     *uuid.UUID
	BillingPeriod   string
	Currency        string
	RecurringAmount float64
	PeriodStart     time.Time
}

// Activate inserts a new active subscription starting at PeriodStart. The
// period length follows BillingPeriod (hourly/daily -> 24h, monthly -> 1
// month, quarterly -> 3, semiannual -> 6, annual -> 12, one_time -> no
// period end); next_invoice_at equals the period end so the first renewal
// invoice falls due exactly when the paid period runs out.
func (s *Service) Activate(ctx context.Context, in ActivateInput) (*Subscription, error) {
	fields := map[string]string{}
	if in.OrganizationID == nil {
		fields["organization_id"] = "required"
	}
	if in.ProductID == nil {
		fields["product_id"] = "required"
	}
	if len(fields) > 0 {
		return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, "organization and product are required"), fields)
	}
	if in.RecurringAmount < 0 {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "recurring amount must not be negative"),
			map[string]string{"recurring_amount": "must be >= 0"})
	}
	currency := in.Currency
	if currency == "" {
		currency = "IDR"
	}
	start := in.PeriodStart
	if start.IsZero() {
		start = time.Now().UTC()
	}
	end, err := computePeriodEnd(start, in.BillingPeriod)
	if err != nil {
		return nil, err
	}

	sub, err := scanSubscription(s.db.QueryRow(ctx, `
INSERT INTO subscriptions(organization_id, product_id, plan_id, order_item_id, status,
                          billing_period, currency, recurring_amount,
                          current_period_start, current_period_end, next_invoice_at)
VALUES ($1,$2,$3,$4,'active',$5::billing_period,$6,$7,$8,$9,$9)
RETURNING `+subscriptionColumns,
		*in.OrganizationID, *in.ProductID, nullUUID(in.PlanID), nullUUID(in.OrderItemID),
		in.BillingPeriod, currency, in.RecurringAmount, start, end))
	if err != nil {
		return nil, fmt.Errorf("insert subscription: %w", err)
	}
	return sub, nil
}

// Get returns a subscription by its primary key.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (*Subscription, error) {
	sub, err := scanSubscription(s.db.QueryRow(ctx,
		`SELECT `+subscriptionColumns+` FROM subscriptions WHERE id=$1`, id))
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return nil, err
	}
	return sub, nil
}

// ListByOrg returns every subscription of an organization, newest first.
func (s *Service) ListByOrg(ctx context.Context, orgID uuid.UUID) ([]Subscription, error) {
	rows, err := s.db.Query(ctx, `
SELECT `+subscriptionColumns+` FROM subscriptions WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Subscription{}
	for rows.Next() {
		sub, serr := scanSubscription(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *sub)
	}
	return out, rows.Err()
}

// Cancel cancels a subscription. With atPeriodEnd the flag is recorded and the
// subscription stays active until ProcessTransitions closes the period;
// otherwise it is cancelled immediately. Already cancelled/expired
// subscriptions cannot be cancelled again.
func (s *Service) Cancel(ctx context.Context, id uuid.UUID, atPeriodEnd bool) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status::text FROM subscriptions WHERE id=$1 FOR UPDATE`, id).Scan(&status)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return err
	}
	switch status {
	case "cancelled", "expired":
		return apperrors.Newf(apperrors.CodeInvalidState, "subscription is already %s", status)
	}

	if atPeriodEnd {
		if status != "active" && status != "past_due" {
			return apperrors.Newf(apperrors.CodeInvalidState,
				"cancel_at_period_end requires an active subscription, got %s", status)
		}
		_, err = tx.Exec(ctx,
			`UPDATE subscriptions SET cancel_at_period_end=true WHERE id=$1`, id)
	} else {
		_, err = tx.Exec(ctx, `
UPDATE subscriptions SET status='cancelled', cancelled_at=now(),
                         cancel_at_period_end=false, grace_until=NULL
WHERE id=$1`, id)
	}
	if err != nil {
		return fmt.Errorf("cancel subscription: %w", err)
	}
	return tx.Commit(ctx)
}

// ProcessTransitions runs one lifecycle pass at time `now` and returns the IDs
// of subscriptions whose renewal invoice is now due (the worker creates those
// invoices via billing and calls AdvancePeriodAfterPayment once paid):
//
//   - past_due whose grace window ended            -> suspended
//   - suspended for more than 30 days              -> expired
//   - active flagged cancel_at_period_end, over    -> cancelled
//   - active with next_invoice_at <= now           -> past_due + grace_until, ID returned
//
// The subscriptions table has no suspended_at column; a suspension starts when
// its grace window ends, so grace_until doubles as the suspension-start
// reference for the 30-day expiry rule. Rows due for invoicing are locked with
// FOR UPDATE SKIP LOCKED so concurrent workers cannot double-invoice.
func (s *Service) ProcessTransitions(ctx context.Context, now time.Time) ([]uuid.UUID, error) {
	graceDays := s.graceDays
	if graceDays < 0 {
		graceDays = 0
	}
	suspendCutoff := now.Add(-30 * 24 * time.Hour)

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx, `
UPDATE subscriptions SET status='suspended'
WHERE status='past_due' AND grace_until IS NOT NULL AND grace_until < $1`, now); err != nil {
		return nil, fmt.Errorf("suspend overdue subscriptions: %w", err)
	}

	if _, err = tx.Exec(ctx, `
UPDATE subscriptions SET status='expired'
WHERE status='suspended' AND grace_until IS NOT NULL AND grace_until < $1`, suspendCutoff); err != nil {
		return nil, fmt.Errorf("expire stale suspensions: %w", err)
	}

	if _, err = tx.Exec(ctx, `
UPDATE subscriptions
SET status='cancelled', cancelled_at=$1, cancel_at_period_end=false, grace_until=NULL
WHERE status='active' AND cancel_at_period_end
  AND current_period_end IS NOT NULL AND current_period_end <= $1`, now); err != nil {
		return nil, fmt.Errorf("apply cancel-at-period-end: %w", err)
	}

	rows, err := tx.Query(ctx, `
SELECT id FROM subscriptions
WHERE status='active' AND next_invoice_at IS NOT NULL AND next_invoice_at <= $1
FOR UPDATE SKIP LOCKED`, now)
	if err != nil {
		return nil, fmt.Errorf("select due subscriptions: %w", err)
	}
	var due []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		due = append(due, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return nil, err
	}

	if len(due) > 0 {
		if _, err = tx.Exec(ctx, `
UPDATE subscriptions SET status='past_due', grace_until=$2
WHERE id = ANY($1)`, due, now.Add(time.Duration(graceDays)*24*time.Hour)); err != nil {
			return nil, fmt.Errorf("mark subscriptions past due: %w", err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return due, nil
}

// AdvancePeriodAfterPayment shifts the billing window forward after a renewal
// invoice was paid: the old period end becomes the new start, the new end is
// one billing period later, next_invoice_at moves to the new end, and the
// subscription returns to active with grace and cancel flags cleared.
func (s *Service) AdvancePeriodAfterPayment(ctx context.Context, subID uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status, billingPeriod string
	var periodEnd *time.Time
	err = tx.QueryRow(ctx, `
SELECT status::text, billing_period::text, current_period_end
FROM subscriptions WHERE id=$1 FOR UPDATE`, subID).
		Scan(&status, &billingPeriod, &periodEnd)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return err
	}
	switch status {
	case "active", "past_due", "suspended":
	default:
		return apperrors.Newf(apperrors.CodeInvalidState, "cannot advance period of a %s subscription", status)
	}
	if billingPeriod == "one_time" {
		return apperrors.New(apperrors.CodeInvalidState, "one-time subscription has no renewal period")
	}
	if periodEnd == nil {
		return apperrors.New(apperrors.CodeInvalidState, "subscription has no current period")
	}

	newStart := *periodEnd
	newEnd, err := computePeriodEnd(newStart, billingPeriod)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
UPDATE subscriptions
SET current_period_start=$2, current_period_end=$3, next_invoice_at=$3,
    status='active', grace_until=NULL, cancel_at_period_end=false
WHERE id=$1`, subID, newStart, *newEnd); err != nil {
		return fmt.Errorf("advance period: %w", err)
	}
	return tx.Commit(ctx)
}

// Suspend puts an active/past_due subscription on hold and records the reason
// in the audit log (Master Prompt §51: sensitive admin actions are audited).
// Suspending an already suspended subscription is a no-op.
func (s *Service) Suspend(ctx context.Context, id uuid.UUID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "reason is required"),
			map[string]string{"reason": "required"})
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var orgID uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT status::text, organization_id FROM subscriptions WHERE id=$1 FOR UPDATE`, id).
		Scan(&status, &orgID)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return err
	}
	switch status {
	case "active", "past_due", "suspended":
	default:
		return apperrors.Newf(apperrors.CodeInvalidState, "cannot suspend a %s subscription", status)
	}
	if _, err = tx.Exec(ctx,
		`UPDATE subscriptions SET status='suspended' WHERE id=$1`, id); err != nil {
		return fmt.Errorf("suspend subscription: %w", err)
	}
	_, _ = tx.Exec(ctx, `
INSERT INTO audit_logs(organization_id, action, resource_type, resource_id, metadata)
VALUES ($1,'subscription.suspend','subscription',$2,jsonb_build_object('reason',$3))`,
		orgID, id, reason)
	return tx.Commit(ctx)
}

// Unsuspend restores a suspended subscription to active and clears the grace
// deadline; the customer's cancel_at_period_end choice is preserved.
func (s *Service) Unsuspend(ctx context.Context, id uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var orgID uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT status::text, organization_id FROM subscriptions WHERE id=$1 FOR UPDATE`, id).
		Scan(&status, &orgID)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "subscription not found")
	}
	if err != nil {
		return err
	}
	if status != "suspended" {
		return apperrors.Newf(apperrors.CodeInvalidState, "subscription is not suspended (status %s)", status)
	}
	if _, err = tx.Exec(ctx, `
UPDATE subscriptions SET status='active', grace_until=NULL WHERE id=$1`, id); err != nil {
		return fmt.Errorf("unsuspend subscription: %w", err)
	}
	_, _ = tx.Exec(ctx, `
INSERT INTO audit_logs(organization_id, action, resource_type, resource_id)
VALUES ($1,'subscription.unsuspend','subscription',$2)`, orgID, id)
	return tx.Commit(ctx)
}

// computePeriodEnd maps a billing period onto the end of the window starting
// at start; one_time has no period end (nil).
func computePeriodEnd(start time.Time, billingPeriod string) (*time.Time, error) {
	switch billingPeriod {
	case "hourly", "daily":
		e := start.Add(24 * time.Hour)
		return &e, nil
	case "monthly":
		e := addMonthsClamped(start, 1)
		return &e, nil
	case "quarterly":
		e := addMonthsClamped(start, 3)
		return &e, nil
	case "semiannual":
		e := addMonthsClamped(start, 6)
		return &e, nil
	case "annual":
		e := addMonthsClamped(start, 12)
		return &e, nil
	case "biennial":
		e := addMonthsClamped(start, 24)
		return &e, nil
	case "triennial":
		e := addMonthsClamped(start, 36)
		return &e, nil
	case "quinquennial":
		e := addMonthsClamped(start, 60)
		return &e, nil
	case "one_time":
		return nil, nil
	default:
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid billing period"),
			map[string]string{"billing_period": "must be one of hourly, daily, monthly, quarterly, semiannual, annual, biennial, triennial, quinquennial, one_time"})
	}
}

// addMonthsClamped adds months to t, clamping the day to the last day of the
// target month so e.g. Jan 31 + 1 month yields Feb 28/29 instead of Mar 2/3.
func addMonthsClamped(t time.Time, months int) time.Time {
	y, m, d := t.Date()
	h, min, sec := t.Clock()
	targetMonth := time.Date(y, m+time.Month(months), 1, h, min, sec, t.Nanosecond(), t.Location())
	lastDay := time.Date(targetMonth.Year(), targetMonth.Month()+1, 0, 0, 0, 0, 0, targetMonth.Location()).Day()
	if d > lastDay {
		d = lastDay
	}
	return time.Date(targetMonth.Year(), targetMonth.Month(), d, h, min, sec, t.Nanosecond(), targetMonth.Location())
}

func scanSubscription(scanner interface{ Scan(dest ...any) error }) (*Subscription, error) {
	var sub Subscription
	var recurringAmount string
	if err := scanner.Scan(&sub.ID, &sub.PublicID, &sub.OrganizationID, &sub.ProductID, &sub.PlanID,
		&sub.OrderItemID, &sub.Status, &sub.BillingPeriod, &sub.Currency, &recurringAmount,
		&sub.CurrentPeriodStart, &sub.CurrentPeriodEnd, &sub.NextInvoiceAt, &sub.GraceUntil,
		&sub.CancelAtPeriodEnd, &sub.CancelledAt, &sub.CreatedAt); err != nil {
		return nil, err
	}
	fmt.Sscanf(recurringAmount, "%f", &sub.RecurringAmount)
	return &sub, nil
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}
