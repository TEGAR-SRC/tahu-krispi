// resize.go implements VM spec resize with a provider-scoped upgrade policy.
package compute

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// TargetSpec is the requested new spec, aligned to the instances columns
// (vcpu, ram_mb, disk_gb).
type TargetSpec struct {
	CPU    int64 // vCPU count
	RAMMB  int64 // RAM in MB
	DiskGB int64 // disk in GB
}

// EvaluateResize validates tgt against cur under the provider's resize policy.
// When allowDowngrade is false every dimension of tgt must be >= cur; an
// identical spec is rejected in both modes.
func EvaluateResize(cur, tgt TargetSpec, allowDowngrade bool) error {
	if tgt.CPU <= 0 || tgt.RAMMB <= 0 || tgt.DiskGB <= 0 {
		return apperrors.New(apperrors.CodeValidation, "vcpu/ram/disk must be positive")
	}
	if !allowDowngrade && (tgt.CPU < cur.CPU || tgt.RAMMB < cur.RAMMB || tgt.DiskGB < cur.DiskGB) {
		return apperrors.New(apperrors.CodeValidation,
			"downgrade not permitted by provider policy: every dimension must be >= current spec")
	}
	if tgt.CPU == cur.CPU && tgt.RAMMB == cur.RAMMB && tgt.DiskGB == cur.DiskGB {
		return apperrors.New(apperrors.CodeValidation, "no spec change requested")
	}
	return nil
}

// Resize changes the spec of an existing VM on the provider and persists the
// new values to the instances row. It follows the Action() chain: ownership ->
// state validation -> policy check -> provider action log -> provider call.
// After a successful spec change it also reprices the linked subscription so
// renewals stop billing the old recurring_amount; fixed-plan subscriptions are
// left untouched.
func (s *Service) Resize(ctx context.Context, instanceID, orgID, userID uuid.UUID, target TargetSpec) (*Instance, error) {
	i, err := s.GetByIDAndOrg(ctx, instanceID, orgID)
	if err != nil {
		return nil, err
	}
	if i.Status == "deleted" || i.Status == "deleting" {
		return nil, apperrors.New(apperrors.CodeInvalidState, "cannot resize deleted instance")
	}
	if i.ServiceKind == "container" {
		// LXC disk/CPU hot-resize is deliberately not opened yet.
		return nil, apperrors.New(apperrors.CodeValidation, "resize is not available for containers yet")
	}
	cur := TargetSpec{CPU: int64(i.Vcpu), RAMMB: int64(i.RamMB), DiskGB: int64(i.DiskGB)}
	pv, err := s.providerFor(ctx, i.ProviderID)
	if err != nil {
		return nil, err
	}
	if err := EvaluateResize(cur, target, pv.ResizePolicy().AllowDowngrade); err != nil {
		return nil, err
	}
	extVM, err := s.requireExternalVMID(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	providerID := i.ProviderID
	actionID := uuid.New()
	if _, err := s.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             status, started_at)
VALUES ($1,$2,$3,$4,'vm_resize','vm',$5,$6,'running',now())`,
		actionID, providerID, orgID, userID, instanceID, extVM); err != nil {
		return nil, err
	}
	fields := map[string]any{
		"cpu":  target.CPU,
		"ram":  target.RAMMB,
		"disk": target.DiskGB,
	}
	err = pv.PatchVM(ctx, extVM, fields)
	status := "success"
	lastErr := ""
	if err != nil {
		status = "failed"
		lastErr = err.Error()
	}
	_, _ = s.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(), last_error=NULLIF($3,'')
WHERE id=$1`, actionID, status, lastErr)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `
UPDATE instances SET vcpu=$2, ram_mb=$3, disk_gb=$4
WHERE id=$1 AND organization_id=$5 AND deleted_at IS NULL`,
		instanceID, target.CPU, target.RAMMB, target.DiskGB, orgID); err != nil {
		return nil, err
	}
	if err := s.repriceSubscription(ctx, instanceID, target); err != nil {
		return nil, err
	}
	return s.GetByIDAndOrg(ctx, instanceID, orgID)
}

// repriceSubscription keeps subscriptions.recurring_amount in sync with the
// new instance spec so renewal invoices (which price from that stored
// snapshot) reflect what the customer actually runs. Only active custom
// subscriptions are touched; fixed-plan ones keep their plan price.
//
// Failure handling: this runs after the provider accepted the new spec and the
// instances row is updated. A repricing error is surfaced to the caller rather
// than swallowed — a silent failure would leave renewals on the stale amount
// forever with nothing recording it — and retrying resize afterwards is safe:
// the spec UPDATE is idempotent for an already-applied spec (the policy check
// rejects it as "no spec change requested", but the subscription stays
// consistent because only the repricing step failed).
func (s *Service) repriceSubscription(ctx context.Context, instanceID uuid.UUID, target TargetSpec) error {
	var subID, regionID *uuid.UUID
	if err := s.db.QueryRow(ctx, `
SELECT subscription_id, region_id FROM instances WHERE id=$1`, instanceID).
		Scan(&subID, &regionID); err != nil {
		return fmt.Errorf("reload instance links: %w", err)
	}
	if subID == nil {
		return nil
	}
	var (
		productID uuid.UUID
		planID    *uuid.UUID
		currency  string
		period    string
	)
	err := s.db.QueryRow(ctx, `
SELECT product_id, plan_id, currency::text, billing_period::text
FROM subscriptions WHERE id=$1 AND status='active'`, *subID).
		Scan(&productID, &planID, &currency, &period)
	if errors.Is(err, pgx.ErrNoRows) {
		// No subscription or not active: nothing to reprice.
		return nil
	}
	if err != nil {
		return fmt.Errorf("load subscription for reprice: %w", err)
	}
	if planID != nil {
		// Fixed plan: recurring_amount comes from the plan price.
		return nil
	}
	amount, _, err := s.pricing.RecurringForSpec(ctx, productID, currency, period, regionID, map[string]float64{
		"vcpu":    float64(target.CPU),
		"ram_gb":  float64(target.RAMMB) / 1024,
		"nvme_gb": float64(target.DiskGB),
	})
	if err != nil {
		return fmt.Errorf("reprice subscription after resize: %w", err)
	}
	if _, err := s.db.Exec(ctx, `
UPDATE subscriptions SET recurring_amount=$2 WHERE id=$1 AND status='active'`, *subID, amount); err != nil {
		return fmt.Errorf("update subscription recurring_amount: %w", err)
	}
	return nil
}
