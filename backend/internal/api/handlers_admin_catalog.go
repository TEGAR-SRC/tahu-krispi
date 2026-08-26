// Admin module (§51): catalog management — products, plans, prices, custom rates, regions.
package api

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Products ----

type admProductRow struct {
	ID                   uuid.UUID `json:"id"`
	Code                 string    `json:"code"`
	Name                 string    `json:"name"`
	ServiceKind          string    `json:"service_kind"`
	Description          string    `json:"description"`
	Enabled              bool      `json:"enabled"`
	SortOrder            int       `json:"sort_order"`
	DefaultMonthlyAmount float64   `json:"default_monthly_amount"`
	CreatedAt            string    `json:"created_at"`
}

func (s *Server) adminListProducts(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM products`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT id, code::text, name, service_kind::text, COALESCE(description,''), enabled, sort_order,
       default_monthly_amount::text, created_at::text
FROM products
ORDER BY sort_order ASC, name ASC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	products := []admProductRow{}
	for rows.Next() {
		var p admProductRow
		var defAmt string
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.ServiceKind,
			&p.Description, &p.Enabled, &p.SortOrder, &defAmt, &p.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		p.DefaultMonthlyAmount = admParseFloat(defAmt)
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, products, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertProductInput struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	ServiceKind string `json:"service_kind"`
	Description string `json:"description"`
	Enabled     *bool  `json:"enabled"`
	SortOrder   int    `json:"sort_order"`
}

func (s *Server) adminUpsertProduct(c fiber.Ctx) error {
	var in admUpsertProductInput
	if err := c.Bind().Body(&in); err != nil || in.Code == "" || in.Name == "" {
		return mw.WriteError(c, errValidation("code and name are required"))
	}
	kind := lower(in.ServiceKind)
	if err := admCheckChoice("service_kind", kind, admServiceKinds); err != nil {
		return mw.WriteError(c, err)
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	var p admProductRow
	err := s.db.QueryRow(c.Context(), `
INSERT INTO products(code, name, service_kind, description, enabled, sort_order)
VALUES ($1,$2,$3::service_kind,NULLIF($4,''),$5,$6)
ON CONFLICT (code) DO UPDATE SET
    name=EXCLUDED.name,
    service_kind=EXCLUDED.service_kind,
    description=EXCLUDED.description,
    enabled=EXCLUDED.enabled,
    sort_order=EXCLUDED.sort_order
RETURNING id, code::text, name, service_kind::text, COALESCE(description,''), enabled, sort_order, created_at::text`,
		in.Code, in.Name, kind, in.Description, enabled, in.SortOrder).
		Scan(&p.ID, &p.Code, &p.Name, &p.ServiceKind, &p.Description, &p.Enabled, &p.SortOrder, &p.CreatedAt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.product.upsert", "product", &p.ID, map[string]any{
		"code": p.Code, "service_kind": p.ServiceKind, "enabled": p.Enabled,
	})
	return mw.JSON(c, 200, p, nil)
}

// ---- Plans ----

type admPlanRow struct {
	ID              uuid.UUID `json:"id"`
	ProductID       uuid.UUID `json:"product_id"`
	ProductCode     string    `json:"product_code"`
	Code            string    `json:"code"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	PriceMode       string    `json:"price_mode"`
	Vcpu            int       `json:"vcpu"`
	RamMB           int       `json:"ram_mb"`
	DiskGB          int       `json:"disk_gb"`
	AdditionalHddGB int       `json:"additional_hdd_gb"`
	BandwidthGB     int64     `json:"bandwidth_gb"`
	IPv4Count       int       `json:"ipv4_count"`
	IPv6Count       int       `json:"ipv6_count"`
	BackupSlots     int       `json:"backup_slots"`
	SnapshotSlots   int       `json:"snapshot_slots"`
	NetworkRateMbps int       `json:"network_rate_mbps"`
	SetupFee        float64   `json:"setup_fee"`
	Enabled         bool      `json:"enabled"`
	Featured        bool      `json:"featured"`
	SortOrder       int       `json:"sort_order"`
	CreatedAt       string    `json:"created_at"`
}

const admPlanSelect = `
SELECT pl.id, pl.product_id, pr.code::text, pl.code::text, pl.name, COALESCE(pl.description,''),
       pl.price_mode::text,
       COALESCE(pl.vcpu,0), COALESCE(pl.ram_mb,0), COALESCE(pl.disk_gb,0), pl.additional_hdd_gb,
       COALESCE(pl.bandwidth_gb,0), pl.ipv4_count, pl.ipv6_count, pl.backup_slots, pl.snapshot_slots,
       COALESCE(pl.network_rate_mbps,0), pl.setup_fee::text, pl.enabled, pl.featured, pl.sort_order,
       pl.created_at::text
FROM plans pl JOIN products pr ON pr.id=pl.product_id`

type admRowScanner interface{ Scan(...any) error }

func scanAdmPlan(row admRowScanner) (*admPlanRow, error) {
	var p admPlanRow
	var setupFee string
	err := row.Scan(&p.ID, &p.ProductID, &p.ProductCode, &p.Code, &p.Name, &p.Description,
		&p.PriceMode, &p.Vcpu, &p.RamMB, &p.DiskGB, &p.AdditionalHddGB, &p.BandwidthGB,
		&p.IPv4Count, &p.IPv6Count, &p.BackupSlots, &p.SnapshotSlots, &p.NetworkRateMbps,
		&setupFee, &p.Enabled, &p.Featured, &p.SortOrder, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	p.SetupFee = admParseFloat(setupFee)
	return &p, nil
}

func (s *Server) adminListPlansAdmin(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM plans`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, admPlanSelect+`
ORDER BY pl.sort_order ASC, pl.name ASC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	plans := []admPlanRow{}
	for rows.Next() {
		p, err := scanAdmPlan(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		plans = append(plans, *p)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, plans, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertPlanInput struct {
	ProductID       string         `json:"product_id"`
	Code            string         `json:"code"`
	Name            string         `json:"name"`
	Description     string         `json:"description"`
	PriceMode       string         `json:"price_mode"`
	ProviderID      string         `json:"provider_id"`
	InstanceTypeID  string         `json:"instance_type_id"`
	Enabled         *bool          `json:"enabled"`
	Featured        *bool          `json:"featured"`
	SortOrder       int            `json:"sort_order"`
	Vcpu            *int           `json:"vcpu"`
	RamMB           *int           `json:"ram_mb"`
	DiskGB          *int           `json:"disk_gb"`
	AdditionalHddGB int            `json:"additional_hdd_gb"`
	BandwidthGB     *int64         `json:"bandwidth_gb"`
	IPv4Count       int            `json:"ipv4_count"`
	IPv6Count       int            `json:"ipv6_count"`
	BackupSlots     int            `json:"backup_slots"`
	SnapshotSlots   int            `json:"snapshot_slots"`
	NetworkRateMbps *int           `json:"network_rate_mbps"`
	SetupFee        float64        `json:"setup_fee"`
	Metadata        map[string]any `json:"metadata"`
}

func (s *Server) adminUpsertPlan(c fiber.Ctx) error {
	var in admUpsertPlanInput
	if err := c.Bind().Body(&in); err != nil || in.Code == "" || in.Name == "" {
		return mw.WriteError(c, errValidation("code and name are required"))
	}
	productID, err := admOptionalUUID(in.ProductID, "product_id")
	if err != nil || productID == nil {
		if err != nil {
			return mw.WriteError(c, err)
		}
		return mw.WriteError(c, vErrField("product_id", "is required"))
	}
	priceMode := lower(in.PriceMode)
	if priceMode == "" {
		priceMode = "fixed_plan"
	}
	if err := admCheckChoice("price_mode", priceMode, admPriceModes); err != nil {
		return mw.WriteError(c, err)
	}
	providerID, err := admOptionalUUID(in.ProviderID, "provider_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	instanceTypeID, err := admOptionalUUID(in.InstanceTypeID, "instance_type_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	if in.SetupFee < 0 || in.AdditionalHddGB < 0 ||
		in.IPv4Count < 0 || in.IPv6Count < 0 || in.BackupSlots < 0 || in.SnapshotSlots < 0 {
		return mw.WriteError(c, errValidation("negative values are not allowed"))
	}
	checkPositive := map[string]*int{"vcpu": in.Vcpu, "ram_mb": in.RamMB, "disk_gb": in.DiskGB, "network_rate_mbps": in.NetworkRateMbps}
	for field, val := range checkPositive {
		if val != nil && *val <= 0 {
			return mw.WriteError(c, vErrField(field, "must be > 0 when provided"))
		}
	}
	if in.BandwidthGB != nil && *in.BandwidthGB < 0 {
		return mw.WriteError(c, vErrField("bandwidth_gb", "must be >= 0"))
	}
	metaJSON := "{}"
	if len(in.Metadata) > 0 {
		b, err := json.Marshal(in.Metadata)
		if err != nil {
			return mw.WriteError(c, errValidation("invalid metadata"))
		}
		metaJSON = string(b)
	}

	ctx := c.Context()
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1)`, *productID).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "product not found"))
	}

	row := s.db.QueryRow(ctx, `
INSERT INTO plans(product_id, code, name, description, price_mode, provider_id, instance_type_id,
                  enabled, featured, sort_order,
                  vcpu, ram_mb, disk_gb, additional_hdd_gb, bandwidth_gb,
                  ipv4_count, ipv6_count, backup_slots, snapshot_slots, network_rate_mbps,
                  setup_fee, metadata)
VALUES ($1,$2,$3,NULLIF($4,''),$5::price_mode,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)
ON CONFLICT (code) DO UPDATE SET
    product_id=EXCLUDED.product_id,
    name=EXCLUDED.name,
    description=EXCLUDED.description,
    price_mode=EXCLUDED.price_mode,
    provider_id=EXCLUDED.provider_id,
    instance_type_id=EXCLUDED.instance_type_id,
    enabled=EXCLUDED.enabled,
    featured=EXCLUDED.featured,
    sort_order=EXCLUDED.sort_order,
    vcpu=EXCLUDED.vcpu,
    ram_mb=EXCLUDED.ram_mb,
    disk_gb=EXCLUDED.disk_gb,
    additional_hdd_gb=EXCLUDED.additional_hdd_gb,
    bandwidth_gb=EXCLUDED.bandwidth_gb,
    ipv4_count=EXCLUDED.ipv4_count,
    ipv6_count=EXCLUDED.ipv6_count,
    backup_slots=EXCLUDED.backup_slots,
    snapshot_slots=EXCLUDED.snapshot_slots,
    network_rate_mbps=EXCLUDED.network_rate_mbps,
    setup_fee=EXCLUDED.setup_fee,
    metadata=EXCLUDED.metadata
RETURNING id, product_id, (SELECT code::text FROM products pr WHERE pr.id=plans.product_id),
          code::text, name, COALESCE(description,''), price_mode::text,
          COALESCE(vcpu,0), COALESCE(ram_mb,0), COALESCE(disk_gb,0), additional_hdd_gb,
          COALESCE(bandwidth_gb,0), ipv4_count, ipv6_count, backup_slots, snapshot_slots,
          COALESCE(network_rate_mbps,0), setup_fee::text, enabled, featured, sort_order, created_at::text`,
		productID, in.Code, in.Name, in.Description, priceMode, providerID, instanceTypeID,
		in.Enabled, in.Featured, in.SortOrder,
		in.Vcpu, in.RamMB, in.DiskGB, in.AdditionalHddGB, in.BandwidthGB,
		in.IPv4Count, in.IPv6Count, in.BackupSlots, in.SnapshotSlots, in.NetworkRateMbps,
		in.SetupFee, metaJSON)

	p, err := scanAdmPlan(row)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.plan.upsert", "plan", &p.ID, map[string]any{"code": p.Code, "price_mode": p.PriceMode})
	return mw.JSON(c, 200, p, nil)
}

// ---- Plan prices ----

type admUpsertPlanPriceInput struct {
	RegionID      string   `json:"region_id"`
	Currency      string   `json:"currency"`
	BillingPeriod string   `json:"billing_period"`
	Amount        *float64 `json:"amount"`
	ProviderCost  *float64 `json:"provider_cost"`
	MinimumCharge *float64 `json:"minimum_charge"`
}

func (s *Server) adminUpsertPlanPrice(c fiber.Ctx) error {
	planID, err := admParseUUIDParam(c, "plan_id", "plan_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admUpsertPlanPriceInput
	if err := c.Bind().Body(&in); err != nil || in.Amount == nil {
		return mw.WriteError(c, errValidation("amount is required"))
	}
	if *in.Amount < 0 {
		return mw.WriteError(c, vErrField("amount", "must be >= 0"))
	}
	if in.MinimumCharge != nil && *in.MinimumCharge < 0 {
		return mw.WriteError(c, vErrField("minimum_charge", "must be >= 0"))
	}
	currency := upper(strings.TrimSpace(in.Currency))
	if len(currency) != 3 {
		return mw.WriteError(c, vErrField("currency", "must be a 3-letter ISO code"))
	}
	period := lower(strings.TrimSpace(in.BillingPeriod))
	if err := admCheckChoice("billing_period", period, admBillingPeriods); err != nil {
		return mw.WriteError(c, err)
	}
	regionID, err := admOptionalUUID(in.RegionID, "region_id")
	if err != nil {
		return mw.WriteError(c, err)
	}

	ctx := c.Context()
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM plans WHERE id=$1)`, planID).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "plan not found"))
	}

	minimumCharge := 0.0
	if in.MinimumCharge != nil {
		minimumCharge = *in.MinimumCharge
	}
	var id uuid.UUID
	var activeFrom string
	err = s.db.QueryRow(ctx, `
INSERT INTO plan_prices(plan_id, region_id, currency, billing_period, amount, provider_cost, minimum_charge)
VALUES ($1,$2,$3,$4::billing_period,$5,$6,$7)
RETURNING id, active_from::text`,
		planID, regionID, currency, period, *in.Amount, in.ProviderCost, minimumCharge).Scan(&id, &activeFrom)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.plan_price.create", "plan", &planID, map[string]any{
		"plan_price_id": id, "currency": currency, "billing_period": period, "amount": *in.Amount,
	})
	return mw.JSON(c, 201, fiber.Map{
		"id": id, "plan_id": planID, "region_id": regionID, "currency": currency,
		"billing_period": period, "amount": *in.Amount, "provider_cost": in.ProviderCost,
		"minimum_charge": minimumCharge, "active_from": activeFrom,
	}, nil)
}

// ---- Custom resource rates ----

type admCustomRateRow struct {
	ID            uuid.UUID  `json:"id"`
	ProductID     uuid.UUID  `json:"product_id"`
	ProductCode   string     `json:"product_code"`
	DimensionCode string     `json:"dimension_code"`
	Currency      string     `json:"currency"`
	BillingPeriod string     `json:"billing_period"`
	UnitPrice     float64    `json:"unit_price"`
	IncludedQty   float64    `json:"included_quantity"`
	MinQuantity   float64    `json:"min_quantity"`
	MaxQuantity   *float64   `json:"max_quantity"`
	StepQuantity  float64    `json:"step_quantity"`
	RegionID      *uuid.UUID `json:"region_id"`
	ActiveFrom    string     `json:"active_from"`
	ActiveUntil   string     `json:"active_until"`
}

const admCustomRateSelect = `
SELECT r.id, r.product_id, p.code::text, r.dimension_code::text, r.currency::text,
       r.billing_period::text, r.unit_price::text, r.included_quantity::text,
       r.min_quantity::text, r.max_quantity::text, r.step_quantity::text,
       r.region_id, COALESCE(r.active_from::text,''), COALESCE(r.active_until::text,'')
FROM custom_resource_rates r JOIN products p ON p.id=r.product_id`

func scanAdmCustomRate(row admRowScanner) (*admCustomRateRow, error) {
	var r admCustomRateRow
	var unitPrice, included, minQ, stepQ string
	var maxQ *string
	if err := row.Scan(&r.ID, &r.ProductID, &r.ProductCode, &r.DimensionCode, &r.Currency,
		&r.BillingPeriod, &unitPrice, &included, &minQ, &maxQ, &stepQ,
		&r.RegionID, &r.ActiveFrom, &r.ActiveUntil); err != nil {
		return nil, err
	}
	r.UnitPrice = admParseFloat(unitPrice)
	r.IncludedQty = admParseFloat(included)
	r.MinQuantity = admParseFloat(minQ)
	r.StepQuantity = admParseFloat(stepQ)
	if maxQ != nil {
		v := admParseFloat(*maxQ)
		r.MaxQuantity = &v
	}
	return &r, nil
}

func (s *Server) adminListCustomRates(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM custom_resource_rates`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, admCustomRateSelect+`
ORDER BY r.active_from DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	rates := []admCustomRateRow{}
	for rows.Next() {
		r, err := scanAdmCustomRate(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		rates = append(rates, *r)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, rates, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertCustomRateInput struct {
	ProductID     string   `json:"product_id"`
	DimensionCode string   `json:"dimension_code"`
	Currency      string   `json:"currency"`
	BillingPeriod string   `json:"billing_period"`
	UnitPrice     *float64 `json:"unit_price"`
	IncludedQty   *float64 `json:"included_quantity"`
	MinQuantity   *float64 `json:"min_quantity"`
	MaxQuantity   *float64 `json:"max_quantity"`
	StepQuantity  *float64 `json:"step_quantity"`
	RegionID      string   `json:"region_id"`
}

func (s *Server) adminUpsertCustomRate(c fiber.Ctx) error {
	var in admUpsertCustomRateInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	productID, err := admOptionalUUID(in.ProductID, "product_id")
	if err != nil || productID == nil {
		if err != nil {
			return mw.WriteError(c, err)
		}
		return mw.WriteError(c, vErrField("product_id", "is required"))
	}
	dimension := lower(strings.TrimSpace(in.DimensionCode))
	if dimension == "" {
		return mw.WriteError(c, vErrField("dimension_code", "is required"))
	}
	currency := upper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "IDR"
	}
	if len(currency) != 3 {
		return mw.WriteError(c, vErrField("currency", "must be a 3-letter ISO code"))
	}
	period := lower(strings.TrimSpace(in.BillingPeriod))
	if period == "" {
		period = "monthly"
	}
	if err := admCheckChoice("billing_period", period, admBillingPeriods); err != nil {
		return mw.WriteError(c, err)
	}
	unitPrice := 0.0
	if in.UnitPrice != nil {
		unitPrice = *in.UnitPrice
	}
	if unitPrice < 0 {
		return mw.WriteError(c, vErrField("unit_price", "must be >= 0"))
	}
	included, minQ, stepQ := 0.0, 0.0, 1.0
	if in.IncludedQty != nil {
		included = *in.IncludedQty
	}
	if in.MinQuantity != nil {
		minQ = *in.MinQuantity
	}
	if in.StepQuantity != nil {
		stepQ = *in.StepQuantity
	}
	if included < 0 || minQ < 0 {
		return mw.WriteError(c, errValidation("quantities must be >= 0"))
	}
	if stepQ <= 0 {
		return mw.WriteError(c, vErrField("step_quantity", "must be > 0"))
	}
	maxQ := in.MaxQuantity
	if maxQ != nil && *maxQ < minQ {
		return mw.WriteError(c, vErrField("max_quantity", "must be >= min_quantity"))
	}
	regionID, err := admOptionalUUID(in.RegionID, "region_id")
	if err != nil {
		return mw.WriteError(c, err)
	}

	ctx := c.Context()
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1)`, *productID).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "product not found"))
	}
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM resource_dimensions WHERE code=$1)`, dimension).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "dimension not found: "+dimension))
	}

	var id uuid.UUID
	var activeFrom string
	err = s.db.QueryRow(ctx, `
INSERT INTO custom_resource_rates(product_id, dimension_code, currency, billing_period,
                                  unit_price, included_quantity, min_quantity, max_quantity,
                                  step_quantity, region_id)
VALUES ($1,$2,$3,$4::billing_period,$5,$6,$7,$8,$9,$10)
RETURNING id, active_from::text`,
		productID, dimension, currency, period, unitPrice, included, minQ, maxQ, stepQ, regionID).
		Scan(&id, &activeFrom)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.custom_rate.upsert", "product", productID, map[string]any{
		"rate_id": id, "dimension_code": dimension, "currency": currency,
		"billing_period": period, "unit_price": unitPrice,
	})
	return mw.JSON(c, 201, fiber.Map{
		"id": id, "product_id": productID, "dimension_code": dimension,
		"currency": currency, "billing_period": period, "unit_price": unitPrice,
		"included_quantity": included, "min_quantity": minQ, "max_quantity": maxQ,
		"step_quantity": stepQ, "region_id": regionID, "active_from": activeFrom,
	}, nil)
}

// ---- Regions ----

type admRegionRow struct {
	ID         uuid.UUID `json:"id"`
	ProviderID uuid.UUID `json:"provider_id"`
	ExternalID string    `json:"external_id"`
	Code       string    `json:"code"`
	Name       string    `json:"name"`
	Country    string    `json:"country_code"`
	City       string    `json:"city"`
	Enabled    bool      `json:"enabled"`
}

func (s *Server) adminListRegions(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM regions`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT id, provider_id, COALESCE(external_id,''), code::text, name,
       COALESCE(country_code,''), COALESCE(city,''), enabled
FROM regions
ORDER BY code ASC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	regions := []admRegionRow{}
	for rows.Next() {
		var r admRegionRow
		if err := rows.Scan(&r.ID, &r.ProviderID, &r.ExternalID, &r.Code, &r.Name,
			&r.Country, &r.City, &r.Enabled); err != nil {
			return mw.WriteError(c, err)
		}
		regions = append(regions, r)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, regions, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertRegionInput struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	Country    string `json:"country_code"`
	City       string `json:"city"`
	ExternalID string `json:"external_id"`
	Enabled    *bool  `json:"enabled"`
}

func (s *Server) adminUpsertRegion(c fiber.Ctx) error {
	var in admUpsertRegionInput
	if err := c.Bind().Body(&in); err != nil || in.Code == "" || in.Name == "" {
		return mw.WriteError(c, errValidation("code and name are required"))
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	ctx := c.Context()
	var providerID uuid.UUID
	err := s.db.QueryRow(ctx,
		`SELECT id FROM providers WHERE lower(code::text)='onidel' LIMIT 1`).Scan(&providerID)
	if err != nil {
		err = s.db.QueryRow(ctx,
			`SELECT id FROM providers ORDER BY created_at ASC LIMIT 1`).Scan(&providerID)
	}
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "no provider configured; create a provider first"))
	}

	var r admRegionRow
	err = s.db.QueryRow(ctx, `
INSERT INTO regions(provider_id, external_id, code, name, country_code, city, enabled)
VALUES ($1,NULLIF($2,''),$3,$4,NULLIF($5,''),NULLIF($6,''),$7)
ON CONFLICT (provider_id, code) DO UPDATE SET
    external_id=COALESCE(EXCLUDED.external_id, regions.external_id),
    name=EXCLUDED.name,
    country_code=EXCLUDED.country_code,
    city=EXCLUDED.city,
    enabled=EXCLUDED.enabled
RETURNING id, provider_id, COALESCE(external_id,''), code::text, name,
          COALESCE(country_code,''), COALESCE(city,''), enabled`,
		providerID, in.ExternalID, in.Code, in.Name, upper(in.Country), in.City, enabled).
		Scan(&r.ID, &r.ProviderID, &r.ExternalID, &r.Code, &r.Name, &r.Country, &r.City, &r.Enabled)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.region.upsert", "region", &r.ID, map[string]any{
		"code": r.Code, "enabled": r.Enabled,
	})
	return mw.JSON(c, 200, r, nil)
}
