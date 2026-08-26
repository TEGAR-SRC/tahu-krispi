// resource_limits.go implements Onidel-style resource limits for provisioning:
// caps apply ONLY to on-demand HOURLY instances, come in two kinds (max
// instance COUNT and max instance MONTHLY COST — the max possible charge of
// active hourly instances within a month), span ALL teams (organizations) a
// user owns, and resolve inside a team to min(team owner's limit, requester's
// limit).
package compute

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// UnknownInstanceCost is the sentinel passed to CheckProvisionAllowed when the
// new instance's monthly cost could not be priced (validation error from the
// pricing engine, e.g. an unpriced dimension); the cost check is then skipped.
const UnknownInstanceCost = -1.0

// hourlyUsageStatuses are the resource_status values whose hourly instances
// occupy quota: everything that exists and can still become billable capacity
// ('failed'/'deleting'/'deleted' do not; 'deleted' is also covered by the
// deleted_at IS NULL filter). Mirrors docs/kilat_cloud_schema_v2.sql enums.
var hourlyUsageStatuses = []string{"provisioning", "pending", "active", "stopped", "suspended"}

// ResourceUsage aggregates the current on-demand footprint across every team
// (organization) a user owns.
type ResourceUsage struct {
	ActiveHourlyInstances int     `json:"active_hourly_instances"`
	EstimatedMonthlyCost  float64 `json:"estimated_monthly_cost"`
}

// EffectiveLimits returns the effective limits when acting inside a team: for
// each limit kind the stricter (minimum) of the team owner's and the
// requester's own limit.
func EffectiveLimits(ownerMax, requesterMax int, ownerCost, requesterCost float64) (int, float64) {
	maxInst := ownerMax
	if requesterMax < maxInst {
		maxInst = requesterMax
	}
	maxCost := ownerCost
	if requesterCost < maxCost {
		maxCost = requesterCost
	}
	return maxInst, maxCost
}

// CheckProvisionAllowed rejects provisioning one more hourly instance against
// the effective limits. newInstEstimatedCost < 0 (see UnknownInstanceCost)
// means the cost could not be priced and skips the cost check. Boundary
// equalities are allowed: landing exactly on either cap passes, exceeding it
// fails with an apperrors.CodeLimitExceeded error quoting usage vs limit.
func CheckProvisionAllowed(effMaxInst int, effMaxCost float64, usage ResourceUsage, newInstEstimatedCost float64) error {
	if usage.ActiveHourlyInstances+1 > effMaxInst {
		return apperrors.Newf(apperrors.CodeLimitExceeded,
			"instance limit reached (%d/%d hourly instances)",
			usage.ActiveHourlyInstances, effMaxInst)
	}
	if newInstEstimatedCost >= 0 && usage.EstimatedMonthlyCost+newInstEstimatedCost > effMaxCost {
		return apperrors.Newf(apperrors.CodeLimitExceeded,
			"instance cost limit reached: estimated $%.2f of $%.2f monthly",
			usage.EstimatedMonthlyCost+newInstEstimatedCost, effMaxCost)
	}
	return nil
}

// EnforceHourlyLimits gates Provision: it only applies when the new instance's
// billing period resolves to 'hourly' and runs before any provider call or
// instances insert. Usage is counted over all organizations owned by the
// binding user (the team owner when acting inside someone else's team).
func (s *Service) enforceHourlyLimits(ctx context.Context, in ProvisionInput) error {
	if strings.ToLower(strings.TrimSpace(in.BillingPeriod)) != "hourly" {
		return nil // limits govern on-demand hourly instances only
	}
	ownerID, err := s.orgOwner(ctx, in.OrganizationID)
	if err != nil {
		return err
	}
	requesterProf, err := s.loadLimitProfile(ctx, in.CreatedBy)
	if err != nil {
		return err
	}
	if requesterProf == nil {
		return apperrors.New(apperrors.CodeInternal, "resource limit profile missing for requesting user")
	}

	effInst, effCost := requesterProf.maxInst, requesterProf.maxCost
	scopeOwner := in.CreatedBy
	if ownerID != uuid.Nil && ownerID != in.CreatedBy {
		ownerProf, err := s.loadLimitProfile(ctx, ownerID)
		if err != nil {
			return err
		}
		if ownerProf != nil {
			effInst, effCost = EffectiveLimits(ownerProf.maxInst, requesterProf.maxInst,
				ownerProf.maxCost, requesterProf.maxCost)
		}
		// Usage always spans the teams of the org's owner, even if their own
		// profile row is gone (only the requester's cap then still applies).
		scopeOwner = ownerID
	}

	usage, err := s.hourlyUsage(ctx, scopeOwner)
	if err != nil {
		return err
	}
	newCost, known := s.estimateNewInstanceMonthlyCost(ctx, in)
	if !known {
		newCost = UnknownInstanceCost
	}
	return CheckProvisionAllowed(effInst, effCost, usage, newCost)
}

// LimitSnapshot is what GET /me/resource-limits reports: effective limits,
// current usage across the scoped teams, and what remains of each allowance.
type LimitSnapshot struct {
	Scope                   string        `json:"scope"` // "team" (org context) or "user"
	EffectiveMaxInstances   int           `json:"effective_max_hourly_instances"`
	EffectiveMaxMonthlyCost float64       `json:"effective_max_instance_monthly_cost"`
	Currency                string        `json:"currency"`
	Usage                   ResourceUsage `json:"usage"`
	RemainingInstances      int           `json:"remaining_hourly_instances"`
	RemainingMonthlyCost    float64       `json:"remaining_monthly_cost"`
}

// ResourceLimitSnapshot computes the customer-facing view. With orgID set the
// requester must belong to that organization and the effective limits become
// min(org owner, requester); otherwise the user's own limits apply over their
// own teams.
func (s *Service) ResourceLimitSnapshot(ctx context.Context, requesterID uuid.UUID, orgID *uuid.UUID) (*LimitSnapshot, error) {
	requesterProf, err := s.loadLimitProfile(ctx, requesterID)
	if err != nil {
		return nil, err
	}
	if requesterProf == nil {
		return nil, apperrors.New(apperrors.CodeNotFound, "user not found")
	}

	scopeOwner := requesterID
	scope := "user"
	prof := requesterProf
	if orgID != nil {
		ownerID, err := s.orgOwner(ctx, *orgID)
		if err != nil {
			return nil, err
		}
		member, err := s.isOrgMember(ctx, *orgID, requesterID)
		if err != nil {
			return nil, err
		}
		if !member && ownerID != requesterID {
			return nil, apperrors.New(apperrors.CodeForbidden, "you are not a member of this organization")
		}
		if ownerID != uuid.Nil {
			scopeOwner = ownerID
			scope = "team"
			if ownerProf, err := s.loadLimitProfile(ctx, ownerID); err != nil {
				return nil, err
			} else if ownerProf != nil {
				inst, cost := EffectiveLimits(ownerProf.maxInst, requesterProf.maxInst,
					ownerProf.maxCost, requesterProf.maxCost)
				prof = &limitProfile{maxInst: inst, maxCost: cost, currency: requesterProf.currency}
			}
		}
	}

	usage, err := s.hourlyUsage(ctx, scopeOwner)
	if err != nil {
		return nil, err
	}
	snap := &LimitSnapshot{
		Scope:                   scope,
		EffectiveMaxInstances:   prof.maxInst,
		EffectiveMaxMonthlyCost: prof.maxCost,
		Currency:                prof.currency,
		Usage:                   usage,
	}
	snap.RemainingInstances = prof.maxInst - usage.ActiveHourlyInstances
	if snap.RemainingInstances < 0 {
		snap.RemainingInstances = 0
	}
	snap.RemainingMonthlyCost = math.Max(0, math.Round((prof.maxCost-usage.EstimatedMonthlyCost)*100)/100)
	return snap, nil
}

// limitProfile mirrors one users row's limit columns.
type limitProfile struct {
	maxInst  int
	maxCost  float64
	currency string
}

// loadLimitProfile reads a user's limit columns; nil (with no error) when the
// user row does not exist or is soft-deleted — callers decide how strict to be.
func (s *Service) loadLimitProfile(ctx context.Context, userID uuid.UUID) (*limitProfile, error) {
	var p limitProfile
	var costText string
	err := s.db.QueryRow(ctx, `
SELECT max_hourly_instances, max_instance_monthly_cost::text, limit_currency::text
FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).
		Scan(&p.maxInst, &costText, &p.currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fmt.Sscanf(costText, "%f", &p.maxCost)
	return &p, nil
}

// orgOwner resolves organizations.created_by — the team owner. Returns
// uuid.Nil when the column is NULL (owner removed); a missing organization is
// a NotFound error.
func (s *Service) orgOwner(ctx context.Context, orgID uuid.UUID) (uuid.UUID, error) {
	var ownerStr *string
	err := s.db.QueryRow(ctx, `
SELECT created_by::text FROM organizations WHERE id=$1 AND deleted_at IS NULL`, orgID).Scan(&ownerStr)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperrors.New(apperrors.CodeNotFound, "organization not found")
	}
	if err != nil {
		return uuid.Nil, err
	}
	if ownerStr == nil || *ownerStr == "" {
		return uuid.Nil, nil
	}
	id, perr := uuid.Parse(*ownerStr)
	if perr != nil {
		return uuid.Nil, fmt.Errorf("parse organization created_by: %w", perr)
	}
	return id, nil
}

func (s *Service) isOrgMember(ctx context.Context, orgID, userID uuid.UUID) (bool, error) {
	var member bool
	err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2)`,
		orgID, userID).Scan(&member)
	return member, err
}

// hourlyUsage counts every quota-occupying hourly instance across all teams
// owned by scopeOwner and sums the estimated monthly costs of those whose cost
// could be priced.
//
// Cost estimation loops the pricing engine per instance (bounded by the
// instance count). An instance's contribution is treated as UNKNOWN — counted
// toward the instance cap but skipped in the cost sum — whenever pricing
// returns a validation error (unpriced dimension) or no product is known for
// it (instances.product_id falls back to subscriptions.product_id). Costs are
// summed at face value in each instance's currency without FX conversion;
// users.limit_currency is informational today.
func (s *Service) hourlyUsage(ctx context.Context, scopeOwner uuid.UUID) (ResourceUsage, error) {
	rows, err := s.db.Query(ctx, `
SELECT i.product_id::text, sub.product_id::text, i.currency::text, i.region_id::text,
       i.vcpu, i.ram_mb, i.disk_gb
FROM instances i
LEFT JOIN subscriptions sub ON sub.id=i.subscription_id
WHERE i.deleted_at IS NULL
  AND i.billing_period='hourly'
  AND i.status = ANY($1::resource_status[])
  AND i.organization_id IN (SELECT o.id FROM organizations o WHERE o.created_by=$2 AND o.deleted_at IS NULL)`,
		hourlyUsageStatuses, scopeOwner)
	if err != nil {
		return ResourceUsage{}, err
	}
	defer rows.Close()

	usage := ResourceUsage{}
	for rows.Next() {
		usage.ActiveHourlyInstances++
		var prodStr, subProdStr, regionStr *string
		var cur string
		var vcpu, ramMB, diskGB int
		if err := rows.Scan(&prodStr, &subProdStr, &cur, &regionStr, &vcpu, &ramMB, &diskGB); err != nil {
			return ResourceUsage{}, err
		}
		pidStr := prodStr
		if pidStr == nil {
			pidStr = subProdStr
		}
		if pidStr == nil {
			continue // no product known: cost UNKNOWN, skipped (count still enforced)
		}
		productID, perr := uuid.Parse(*pidStr)
		if perr != nil {
			continue
		}
		var regionID *uuid.UUID
		if regionStr != nil && *regionStr != "" {
			if rid, rerr := uuid.Parse(*regionStr); rerr == nil {
				regionID = &rid
			}
		}
		cost, known := s.estimateMonthlyCost(ctx, &productID, cur, regionID, vcpu, ramMB, diskGB)
		if known {
			usage.EstimatedMonthlyCost += cost
		}
	}
	return usage, rows.Err()
}

// estimateNewInstanceMonthlyCost prices the incoming spec at its monthly rate.
// ProvisionInput carries no product, so the default enabled vm product is used
// — the same fallback the pricing engine itself applies when no product is
// supplied.
func (s *Service) estimateNewInstanceMonthlyCost(ctx context.Context, in ProvisionInput) (float64, bool) {
	if s.pricing == nil {
		return 0, false
	}
	var productID uuid.UUID
	if err := s.db.QueryRow(ctx, `
SELECT id FROM products WHERE service_kind='vm' AND enabled ORDER BY sort_order LIMIT 1`).Scan(&productID); err != nil {
		return 0, false
	}
	return s.estimateMonthlyCost(ctx, &productID, orDefault(strings.ToUpper(strings.TrimSpace(in.Currency)), "IDR"),
		in.RegionID, in.Vcpu, in.RamMB, in.DiskGB)
}

// estimateMonthlyCost prices dims through RecurringForSpec at the monthly
// billing period: the monthly-equivalent recurring price of those dimensions,
// i.e. the max possible charge such an instance accrues within a month. Any
// pricing failure (unpriced dimension, missing rates) yields known=false.
func (s *Service) estimateMonthlyCost(ctx context.Context, productID *uuid.UUID, currency string,
	regionID *uuid.UUID, vcpu, ramMB, diskGB int) (float64, bool) {
	if s.pricing == nil || productID == nil {
		return 0, false
	}
	subtotal, _, err := s.pricing.RecurringForSpec(ctx, *productID, currency, "monthly", regionID, map[string]float64{
		"vcpu":    float64(vcpu),
		"ram_gb":  float64(ramMB) / 1024,
		"nvme_gb": float64(diskGB),
	})
	if err != nil {
		return 0, false
	}
	return subtotal, true
}
