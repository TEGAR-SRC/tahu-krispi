// Package pricing implements the pricing engine for fixed plans and custom resources.
package pricing

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type QuoteRequest struct {
	OrganizationID *uuid.UUID
	UserID         uuid.UUID
	ProductID      *uuid.UUID
	PlanID         *uuid.UUID
	RegionID       *uuid.UUID
	Currency       string
	BillingPeriod  string
	// Custom resource dimensions, keyed by dimension code.
	CustomResources map[string]float64
	// Instance type for custom builds (optional).
	InstanceTypeID *uuid.UUID
}

type BreakdownLine struct {
	DimensionCode string  `json:"dimension_code"`
	Description   string  `json:"description"`
	Quantity      float64 `json:"quantity"`
	IncludedQty   float64 `json:"included_quantity"`
	BillableQty   float64 `json:"billable_quantity"`
	UnitPrice     float64 `json:"unit_price"`
	Amount        float64 `json:"amount"`
}

type QuoteResult struct {
	QuoteID        uuid.UUID       `json:"quote_id"`
	ProductID      *uuid.UUID      `json:"product_id"`
	PlanID         *uuid.UUID      `json:"plan_id"`
	RegionID       *uuid.UUID      `json:"region_id"`
	PriceMode      string          `json:"price_mode"`
	Currency       string          `json:"currency"`
	BillingPeriod  string          `json:"billing_period"`
	Breakdown      []BreakdownLine `json:"breakdown"`
	Subtotal       float64         `json:"subtotal"`
	Discount       float64         `json:"discount"`
	Tax            float64         `json:"tax"`
	SetupFee       float64         `json:"setup_fee"`
	Total          float64         `json:"total"`
	ExpiresAt      time.Time       `json:"expires_at"`
	PricingPayload json.RawMessage `json:"pricing_breakdown"`
	// RequestedResources echoes the custom resources the caller asked to price.
	RequestedResources map[string]float64 `json:"requested_resources,omitempty"`
	// ProviderEstimatedCost is internal (provider unit costs aggregated); never exposed via JSON.
	ProviderEstimatedCost float64 `json:"-"`
}

const defaultTaxRate = 0.11 // PPN 11%
var quoteTTL = 24 * time.Hour

func (s *Service) Quote(ctx context.Context, req QuoteRequest) (*QuoteResult, error) {
	if req.Currency == "" {
		req.Currency = "IDR"
	}
	if req.BillingPeriod == "" {
		req.BillingPeriod = "monthly"
	}
	var res *QuoteResult
	var err error
	if req.PlanID != nil {
		res, err = s.quoteFixedPlan(ctx, req)
	} else {
		res, err = s.quoteCustom(ctx, req)
	}
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(res.Breakdown)
	res.PricingPayload = payload
	res.ExpiresAt = time.Now().Add(quoteTTL)

	var orgID any
	if req.OrganizationID != nil {
		orgID = *req.OrganizationID
	}
	err = s.db.QueryRow(ctx, `
INSERT INTO price_quotes(organization_id, user_id, product_id, plan_id, region_id, price_mode,
                         currency, billing_period, requested_resources, pricing_breakdown,
                         subtotal, discount, tax, total, provider_estimated_cost, expires_at)
VALUES ($1,$2,$3,$4,$5,$6::price_mode,$7,$8::billing_period,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
RETURNING id`,
		orgID, req.UserID, nullUUID(res.ProductID), nullUUID(req.PlanID), nullUUID(req.RegionID),
		res.PriceMode, res.Currency, res.BillingPeriod,
		mustJSONRaw(customResourcesJSON(req.CustomResources)), payload,
		res.Subtotal, res.Discount, res.Tax, res.Total, providerCostOrNull(res.ProviderEstimatedCost), res.ExpiresAt).Scan(&res.QuoteID)
	if err != nil {
		return nil, fmt.Errorf("save quote: %w", err)
	}
	return res, nil
}

func customResourcesJSON(m map[string]float64) []byte {
	b, _ := json.Marshal(m)
	return b
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func mustJSONRaw(b []byte) []byte { return b }

func (s *Service) quoteFixedPlan(ctx context.Context, req QuoteRequest) (*QuoteResult, error) {
	var productID uuid.UUID
	var setupFee float64
	var name string
	var vcpu, ramMB, diskGB *int
	var bandwidthGB *int64
	var ipv4Count int
	err := s.db.QueryRow(ctx, `
SELECT p.product_id, p.name, COALESCE(p.setup_fee,0), p.vcpu, p.ram_mb, p.disk_gb, p.bandwidth_gb, p.ipv4_count
FROM plans p WHERE p.id=$1 AND p.enabled`, *req.PlanID).
		Scan(&productID, &name, &setupFee, &vcpu, &ramMB, &diskGB, &bandwidthGB, &ipv4Count)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodePlanUnavailable, "plan not found or unavailable")
	}
	if err != nil {
		return nil, err
	}
	var regionAny any
	if req.RegionID != nil {
		regionAny = *req.RegionID
	} else {
		regionAny = nil
	}
	var amountStr string
	err = s.db.QueryRow(ctx, `
SELECT amount::text FROM current_plan_prices
WHERE plan_id=$1 AND currency=$2 AND billing_period=$3::billing_period
  AND ($4::uuid IS NULL OR region_id IS NULL OR region_id=$4::uuid)
ORDER BY region_id NULLS LAST LIMIT 1`, *req.PlanID, req.Currency, req.BillingPeriod, regionAny).Scan(&amountStr)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodePlanUnavailable, "no active price for this plan/currency/billing_period")
	}
	if err != nil {
		return nil, err
	}
	var amount float64
	fmt.Sscanf(amountStr, "%f", &amount)
	line := BreakdownLine{
		DimensionCode: "fixed_plan", Description: name,
		Quantity: 1, IncludedQty: 0, BillableQty: 1, UnitPrice: amount, Amount: amount,
	}
	subtotal := amount + setupFee
	tax := round2(subtotal * defaultTaxRate)
	total := round2(subtotal + tax)
	return &QuoteResult{
		ProductID: &productID, PlanID: req.PlanID, RegionID: req.RegionID,
		PriceMode: "fixed_plan", Currency: req.Currency, BillingPeriod: req.BillingPeriod,
		Breakdown: []BreakdownLine{line}, Subtotal: subtotal, Tax: tax, SetupFee: setupFee, Total: total,
	}, nil
}

func (s *Service) quoteCustom(ctx context.Context, req QuoteRequest) (*QuoteResult, error) {
	cp, err := s.priceCustomDims(ctx, req.ProductID, req.Currency, req.BillingPeriod,
		req.RegionID, req.InstanceTypeID, req.CustomResources)
	if err != nil {
		return nil, err
	}
	setupFee := 0.0
	tax := round2(cp.subtotal * defaultTaxRate)
	total := round2(cp.subtotal + tax + setupFee)
	return &QuoteResult{
		ProductID: &cp.productID, PlanID: nil, RegionID: req.RegionID,
		PriceMode: "custom_resource", Currency: req.Currency, BillingPeriod: req.BillingPeriod,
		Breakdown: cp.breakdown, Subtotal: round2(cp.subtotal), Tax: tax, SetupFee: setupFee, Total: total,
		RequestedResources:    req.CustomResources,
		ProviderEstimatedCost: cp.providerCost,
	}, nil
}

// RecurringForSpec prices the recurring amount for a concrete set of custom
// resource dimensions through the same rate-selection rules and per-dimension
// math as the quote flow (both go through priceCustomDims), but persists no
// price_quotes row. Meant for repricing an existing custom subscription, e.g.
// after a VM resize; the returned subtotal follows the rounded
// QuoteResult.Subtotal semantics.
func (s *Service) RecurringForSpec(ctx context.Context, productID uuid.UUID, currency, billingPeriod string,
	regionID *uuid.UUID, dims map[string]float64) (subtotal float64, providerCost float64, err error) {
	cp, err := s.priceCustomDims(ctx, &productID, currency, billingPeriod, regionID, nil, dims)
	if err != nil {
		return 0, 0, err
	}
	return round2(cp.subtotal), cp.providerCost, nil
}

// customPricing is the shared outcome of pricing a set of custom dimensions.
type customPricing struct {
	productID    uuid.UUID
	subtotal     float64 // unrounded sum of line amounts
	providerCost float64
	breakdown    []BreakdownLine
}

// priceCustomDims is the single source of truth for custom-resource pricing:
// product resolution, applicable-rate loading and the validated per-dimension
// line math all live here so quoteCustom and RecurringForSpec cannot drift.
func (s *Service) priceCustomDims(ctx context.Context, productID *uuid.UUID, currency, billingPeriod string,
	regionID, instanceTypeID *uuid.UUID, dims map[string]float64) (*customPricing, error) {
	if len(dims) == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "custom_resources required")
	}
	pid := uuid.Nil
	if productID != nil {
		row := s.db.QueryRow(ctx, `SELECT id FROM products WHERE id=$1 AND enabled AND service_kind='vm'`, *productID)
		if err := row.Scan(&pid); err != nil {
			return nil, apperrors.New(apperrors.CodeValidation, "valid enabled vm product_id required")
		}
	} else {
		err := s.db.QueryRow(ctx, `
SELECT id FROM products WHERE service_kind='vm' AND enabled ORDER BY sort_order LIMIT 1`).Scan(&pid)
		if err != nil {
			return nil, apperrors.New(apperrors.CodePlanUnavailable, "no active vm product")
		}
	}
	rates, err := s.loadCustomRates(ctx, pid, currency, billingPeriod, regionID, instanceTypeID)
	if err != nil {
		return nil, err
	}
	var subtotal, providerTotal float64
	var breakdown []BreakdownLine
	for code, qty := range dims {
		r, ok := rates[code]
		if !ok {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, "unknown or unpriced dimension"),
				map[string]string{"custom_resources": code})
		}
		if qty < r.min {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeLimitExceeded, fmt.Sprintf("%s below minimum %v", code, r.min)),
				map[string]string{"custom_resources": code})
		}
		if r.max > 0 && qty > r.max {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeLimitExceeded, fmt.Sprintf("%s above maximum %v", code, r.max)),
				map[string]string{"custom_resources": code})
		}
		if steps := (qty - r.min) / r.step; math.Abs(steps-math.Round(steps)) > 1e-6 {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, fmt.Sprintf("%s must be increased in steps of %v above minimum", code, r.step)),
				map[string]string{"custom_resources": code})
		}
		billable := qty - r.included
		if billable < 0 {
			billable = 0
		}
		amount := round6(billable * r.unitPrice)
		subtotal += amount
		providerTotal += billable * r.providerCost
		breakdown = append(breakdown, BreakdownLine{
			DimensionCode: code, Description: r.name,
			Quantity: qty, IncludedQty: r.included, BillableQty: billable,
			UnitPrice: r.unitPrice, Amount: amount,
		})
	}
	return &customPricing{productID: pid, subtotal: subtotal, providerCost: providerTotal, breakdown: breakdown}, nil
}

// customRate mirrors one applicable custom_resource_rates row.
type customRate struct {
	unitPrice, included, min, max, step, providerCost float64
	name                                              string
}

// loadCustomRates selects every rate row currently applicable to the product/
// currency/billing period (+ optional region/instance-type filters) and keeps,
// per dimension code, the first row of the established ordering.
func (s *Service) loadCustomRates(ctx context.Context, productID uuid.UUID, currency, billingPeriod string,
	regionID, instanceTypeID *uuid.UUID) (map[string]customRate, error) {
	var regionAny, instanceTypeAny any
	if regionID != nil {
		regionAny = *regionID
	}
	if instanceTypeID != nil {
		instanceTypeAny = *instanceTypeID
	}
	rows, err := s.db.Query(ctx, `
SELECT cr.dimension_code::text, cr.unit_price::text, cr.included_quantity::text,
       cr.min_quantity::text, cr.max_quantity::text, cr.step_quantity::text,
       cr.provider_unit_cost::text, rd.name
FROM custom_resource_rates cr
JOIN resource_dimensions rd ON rd.code=cr.dimension_code
WHERE cr.product_id=$1 AND cr.currency=$2 AND cr.billing_period=$3::billing_period
  AND cr.active_from <= now() AND (cr.active_until IS NULL OR cr.active_until > now())
  AND ($4::uuid IS NULL OR cr.region_id IS NULL OR cr.region_id=$4::uuid)
  AND ($5::uuid IS NULL OR cr.instance_type_id IS NULL OR cr.instance_type_id=$5::uuid)
ORDER BY cr.dimension_code, cr.region_id NULLS LAST, cr.active_from DESC`,
		productID, currency, billingPeriod, regionAny, instanceTypeAny)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rates := map[string]customRate{}
	for rows.Next() {
		var code, name string
		var up, inc, mn, step string
		var mxPtr, costPtr *string
		if err := rows.Scan(&code, &up, &inc, &mn, &mxPtr, &step, &costPtr, &name); err != nil {
			return nil, err
		}
		if mxPtr != nil && *mxPtr == "" {
			mxPtr = nil
		}
		if _, seen := rates[code]; !seen {
			var maxV float64
			if mxPtr != nil {
				fmt.Sscanf(*mxPtr, "%f", &maxV)
			}
			parseF := func(s string) float64 {
				var f float64
				fmt.Sscanf(s, "%f", &f)
				return f
			}
			r := customRate{unitPrice: parseF(up), included: parseF(inc), min: parseF(mn), max: maxV, step: parseF(step), name: name}
			if r.step <= 0 {
				r.step = 1
			}
			if costPtr != nil {
				r.providerCost = parseF(*costPtr)
			}
			rates[code] = r
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Derivation fallback: hourly/daily quotes may inherit monthly rates
	// (÷720 hours / ÷24 days) when no explicit rows exist for that period,
	// so on-demand pricing works before an admin seeds dedicated rates.
	if len(rates) == 0 && billingPeriod == "hourly" {
		derived, err := s.loadCustomRates(ctx, productID, currency, "monthly", regionID, instanceTypeID)
		if err != nil || len(derived) == 0 {
			return rates, err
		}
		for code, r := range derived {
			r.unitPrice = round6(r.unitPrice / 720)
			if r.providerCost > 0 {
				r.providerCost = round6(r.providerCost / 720)
			}
			r.name += " (derived from monthly)"
			rates[code] = r
		}
	}
	return rates, nil
}

func round2(v float64) float64 { return float64(int64(v*100+sign(v)*0.5)) / 100 }
func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}
func round6(v float64) float64 { return float64(int64(v*1e6+sign(v)*0.5)) / 1e6 }

func providerCostOrNull(v float64) any {
	if v <= 0 {
		return nil
	}
	return v
}

// LoadSnapshot returns a previously issued, unexpired quote so orders are always
// priced from the stored snapshot instead of client-supplied amounts.
func (s *Service) LoadSnapshot(ctx context.Context, quoteID, orgID, userID uuid.UUID) (*QuoteResult, error) {
	var res QuoteResult
	var breakdown []byte
	var requested []byte
	var productID uuid.UUID
	var planID, regionID *uuid.UUID
	err := s.db.QueryRow(ctx, `
SELECT id, product_id, plan_id, region_id, price_mode::text, currency, billing_period::text,
       requested_resources, pricing_breakdown, subtotal::text, discount::text, tax::text,
       total::text, expires_at
FROM price_quotes
WHERE id=$1 AND expires_at > now()
  AND (organization_id=$2 OR (organization_id IS NULL AND user_id=$3))`,
		quoteID, orgID, userID).
		Scan(&res.QuoteID, &productID, &planID, &regionID, &res.PriceMode, &res.Currency,
			&res.BillingPeriod, &requested, &breakdown,
			parseFPtr(&res.Subtotal), parseFPtr(&res.Discount), parseFPtr(&res.Tax),
			parseFPtr(&res.Total), &res.ExpiresAt)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeQuoteExpired, "quote not found or expired")
	}
	if err != nil {
		return nil, err
	}
	res.ProductID = &productID
	res.PlanID = planID
	res.RegionID = regionID
	if err := json.Unmarshal(breakdown, &res.Breakdown); err != nil {
		return nil, fmt.Errorf("decode quote breakdown: %w", err)
	}
	if len(requested) > 0 {
		_ = json.Unmarshal(requested, &res.RequestedResources)
	}
	// Setup fee is embedded in the stored subtotal; recover it from the lines.
	var lineSum float64
	for _, l := range res.Breakdown {
		lineSum += l.Amount
	}
	res.SetupFee = math.Max(0, round2(res.Subtotal-lineSum))
	return &res, nil
}

// parseFPtr lets Scan decode numeric::text columns straight into float64 fields.
func parseFPtr(dst *float64) any { return (*numericText)(dst) }

type numericText float64

func (n *numericText) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		return nil
	case string:
		_, err := fmt.Sscanf(v, "%f", (*float64)(n))
		return err
	case []byte:
		_, err := fmt.Sscanf(string(v), "%f", (*float64)(n))
		return err
	default:
		return fmt.Errorf("unsupported numeric type %T", src)
	}
}
