// Admin Onidel plane: provider-prefixed catalog + health + instances, no proxmox share.
//
// GET  /v1/admin/onidel/:id/catalog                 -> regions + instance_types + os_templates (live via Onidel adapter)
// GET  /v1/admin/onidel/:id/health                  -> enabled/health_status + live probe latency
// GET  /v1/admin/onidel/:id/health/detail           -> health_status + last_check (DB) + live probe, provider.Lookup-guarded
// GET  /v1/admin/onidel/:id/instances               -> live instances filtered by provider_id==:id (DB, infra, polling 5s)
// GET  /v1/admin/onidel/:id/instances/:instance_id  -> instance detail (provider-scoped, infra readable, polling 5s)
// POST /v1/admin/onidel/:id/instances/:instance_id/suspend   -> suspend (platform_admin, 202)
// POST /v1/admin/onidel/:id/instances/:instance_id/terminate -> terminate (platform_admin, 202)
// POST /v1/admin/onidel/:id/regions/sync            -> enqueue provider_sync (catalog sync) for this onidel provider, onidelAdapterFor-guarded
// POST /v1/admin/onidel/:id/catalog/sync            -> same as regions/sync (billing sync alias, task contract), onidelAdapterFor-guarded
// All GET ride requireStaff("infra") for GET so NOC can read; POST/DELETE stay platform_admin-only.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/onidel"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// onidelAdapterFor resolves a providers row to its live *onidel.Adapter.
// It validates kind==onidel, decrypts the row's api_key when present, and
// falls back to ONIDEL_BASE_URL / ONIDEL_API_KEY env when the row does not
// carry credentials. When neither source provides an api_key it returns a
// clear CodeProviderUnavailable so callers can surface "not configured".
func (s *Server) onidelAdapterFor(c fiber.Ctx) (uuid.UUID, string, *onidel.Adapter, error) {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, "", nil, vErrField("id", "must be a valid uuid")
	}
	var code, kind, apiBaseURL string
	var ct []byte
	err = s.db.QueryRow(c.Context(),
		`SELECT code::text, kind, COALESCE(api_base_url,''), credentials_ciphertext FROM providers WHERE id=$1`, providerID).Scan(&code, &kind, &apiBaseURL, &ct)
	if err != nil {
		return uuid.Nil, "", nil, apperrors.New(apperrors.CodeNotFound, "provider not found")
	}
	if kind != "onidel" {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"onidel catalog is only available for onidel providers (kind=%q)", kind)
	}
	apiKey := ""
	if len(ct) > 0 {
		plain, derr := crypto.Decrypt(s.encKey, ct)
		if derr != nil {
			return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
				"decrypt onidel credentials for %q: %v", code, derr)
		}
		rawKey := strings.TrimSpace(string(plain))
		if rawKey != "" && strings.HasPrefix(rawKey, "{") {
			var m map[string]string
			if jerr := json.Unmarshal([]byte(rawKey), &m); jerr == nil {
				if v, ok := m["api_key"]; ok && strings.TrimSpace(v) != "" {
					rawKey = strings.TrimSpace(v)
				} else if v, ok := m["apiKey"]; ok && strings.TrimSpace(v) != "" {
					rawKey = strings.TrimSpace(v)
				} else if v, ok := m["token"]; ok && strings.TrimSpace(v) != "" {
					rawKey = strings.TrimSpace(v)
				}
			}
		}
		apiKey = rawKey
	}
	baseURL := strings.TrimSpace(apiBaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(s.cfg.OnidelBaseURL)
	}
	if baseURL == "" {
		baseURL = "https://api.cloud.onidel.com"
	}
	if strings.TrimSpace(apiKey) == "" {
		apiKey = strings.TrimSpace(s.cfg.OnidelAPIKey)
	}
	if strings.TrimSpace(apiKey) == "" {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"onidel provider %q is not configured: missing api_key (set via admin providers or ONIDEL_API_KEY env)", code)
	}
	ad := onidel.NewAdapter(baseURL, strings.TrimSpace(apiKey))
	return providerID, code, ad, nil
}

// GET /v1/admin/onidel/:id/catalog
func (s *Server) adminOnidelCatalog(c fiber.Ctx) error {
	providerID, code, ad, err := s.onidelAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx, cancel := context.WithTimeout(c.Context(), 12*time.Second)
	defer cancel()
	instanceTypes, osTemplates, locations, err := ad.SyncCatalog(ctx)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if instanceTypes == nil {
		instanceTypes = []provider.CatalogInstanceType{}
	}
	if osTemplates == nil {
		osTemplates = []provider.CatalogOSTemplate{}
	}
	if locations == nil {
		locations = []provider.CatalogLocation{}
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id":    providerID,
		"code":           code,
		"regions":        locations,
		"instance_types": instanceTypes,
		"os_templates":   osTemplates,
	}, nil)
}

// GET /v1/admin/onidel/:id/health
func (s *Server) adminOnidelHealth(c fiber.Ctx) error {
	providerID, code, ad, err := s.onidelAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var enabled bool
	var healthStatus, apiBaseURL string
	_ = s.db.QueryRow(c.Context(),
		`SELECT enabled, health_status, COALESCE(api_base_url,'') FROM providers WHERE id=$1`, providerID).
		Scan(&enabled, &healthStatus, &apiBaseURL)
	if !enabled {
		return mw.JSON(c, 200, fiber.Map{
			"provider_id":   providerID,
			"code":          code,
			"enabled":       false,
			"health_status": healthStatus,
			"api_base_url":  apiBaseURL,
			"live":          "disabled",
		}, nil)
	}
	ctx, cancel := context.WithTimeout(c.Context(), 8*time.Second)
	defer cancel()
	start := time.Now()
	_, err = ad.Client().ListInstanceTypes(ctx)
	latency := time.Since(start).Milliseconds()
	live := "ok"
	liveErr := ""
	if err != nil {
		live = "error"
		liveErr = err.Error()
		if apiErr, ok := err.(*onidel.APIError); ok {
			liveErr = apiErr.Error()
		}
		return mw.JSON(c, 200, fiber.Map{
			"provider_id":   providerID,
			"code":          code,
			"enabled":       true,
			"health_status": healthStatus,
			"api_base_url":  apiBaseURL,
			"live":          live,
			"latency_ms":    latency,
			"error":         liveErr,
		}, nil)
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id":   providerID,
		"code":          code,
		"enabled":       true,
		"health_status": healthStatus,
		"api_base_url":  apiBaseURL,
		"live":          live,
		"latency_ms":    latency,
	}, nil)
}

// GET /v1/admin/onidel/:id/health/detail
// Returns health_status + last_check (last_health_check_at) from providers
// table plus live probe via provider.Lookup. Guarded to onidel kind only.
func (s *Server) adminOnidelHealthDetail(c fiber.Ctx) error {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return mw.WriteError(c, vErrField("id", "must be a valid uuid"))
	}
	var code, kind, healthStatus, apiBaseURL string
	var enabled bool
	var lastCheck sql.NullTime
	if err := s.db.QueryRow(c.Context(),
		`SELECT code::text, kind, health_status, last_health_check_at, enabled, COALESCE(api_base_url,'') FROM providers WHERE id=$1`, providerID).
		Scan(&code, &kind, &healthStatus, &lastCheck, &enabled, &apiBaseURL); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	if kind != "onidel" {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"onidel health detail is only available for onidel providers (kind=%q)", kind))
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ad, ok := pv.(*onidel.Adapter)
	if !ok {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"registered provider %q does not expose onidel health detail", code))
	}
	var lastCheckStr *string
	if lastCheck.Valid {
		s := lastCheck.Time.UTC().Format(time.RFC3339Nano)
		lastCheckStr = &s
	}
	if !enabled {
		return mw.JSON(c, 200, fiber.Map{
			"provider_id":          providerID,
			"code":                 code,
			"enabled":              false,
			"health_status":        healthStatus,
			"last_check":           lastCheckStr,
			"last_health_check_at": lastCheckStr,
			"api_base_url":         apiBaseURL,
			"live":                 "disabled",
		}, nil)
	}
	ctx, cancel := context.WithTimeout(c.Context(), 8*time.Second)
	defer cancel()
	start := time.Now()
	_, perr := ad.Client().ListInstanceTypes(ctx)
	latency := time.Since(start).Milliseconds()
	live := "ok"
	liveErr := ""
	if perr != nil {
		live = "error"
		liveErr = perr.Error()
		if apiErr, ok := perr.(*onidel.APIError); ok {
			liveErr = apiErr.Error()
		}
		return mw.JSON(c, 200, fiber.Map{
			"provider_id":          providerID,
			"code":                 code,
			"enabled":              true,
			"health_status":        healthStatus,
			"last_check":           lastCheckStr,
			"last_health_check_at": lastCheckStr,
			"api_base_url":         apiBaseURL,
			"live":                 live,
			"latency_ms":           latency,
			"error":                liveErr,
		}, nil)
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id":          providerID,
		"code":                 code,
		"enabled":              true,
		"health_status":        healthStatus,
		"last_check":           lastCheckStr,
		"last_health_check_at": lastCheckStr,
		"api_base_url":         apiBaseURL,
		"live":                 live,
		"latency_ms":           latency,
	}, nil)
}

// GET /v1/admin/onidel/:id/instances — per-provider instances filtered by provider_id==:id.
// Thin wrapper over adminListInstances query with provider pinned to :id; guards
// kind==onidel so proxmox/vmware rows never leak. Paginated (page/per_page +
// optional status) — polling 5s is frontend contract via useInfraGet intervalMs.
func (s *Server) adminOnidelInstances(c fiber.Ctx) error {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return mw.WriteError(c, vErrField("id", "must be a valid uuid"))
	}
	var kind string
	err = s.db.QueryRow(c.Context(), `SELECT kind FROM providers WHERE id=$1`, providerID).Scan(&kind)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	if kind != "onidel" {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"onidel instances is only available for onidel providers (kind=%q)", kind))
	}
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admResourceStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid resource status"))
	}
	where := " AND i.provider_id=$1"
	args := []any{providerID}
	if status != "" {
		args = append(args, status)
		where += " AND i.status=" + admPlaceholder(len(args))
	}
	orgFilter, args, ferr := admOrgFilter("i.organization_id", c.Query("organization_id"), args)
	if ferr != nil {
		return mw.WriteError(c, ferr)
	}
	where += orgFilter
	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM instances i WHERE i.deleted_at IS NULL`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, qerr := s.db.Query(ctx, `
SELECT i.id, i.public_id, i.organization_id, org.public_id, org.slug::text,
       i.name, i.status::text, COALESCE(i.power_status,''), i.vcpu, i.ram_mb, i.disk_gb,
       COALESCE(i.suspended_at::text,''), COALESCE(i.termination_requested_at::text,''),
       i.created_at::text
FROM instances i JOIN organizations org ON org.id=i.organization_id
WHERE i.deleted_at IS NULL`+where+
		` ORDER BY i.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if qerr != nil {
		return mw.WriteError(c, qerr)
	}
	defer rows.Close()
	instances := []admInstanceRow{}
	for rows.Next() {
		var in admInstanceRow
		if rerr := rows.Scan(&in.ID, &in.PublicID, &in.OrganizationID, &in.OrgPublicID, &in.OrgSlug,
			&in.Name, &in.Status, &in.PowerStatus, &in.Vcpu, &in.RamMB, &in.DiskGB,
			&in.SuspendedAt, &in.TerminationRequestedAt, &in.CreatedAt); rerr != nil {
			return mw.WriteError(c, rerr)
		}
		instances = append(instances, in)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, instances, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// GET /v1/admin/onidel/:id/instances/:instance_id — instance detail scoped to that onidel provider (infra-readable).
// Reuses the same select as handleAdminInstanceDetail (GET /admin/instances/:id) but also asserts
// i.provider_id == :id and that the provider kind==onidel, so proxmox rows cannot be leaked via id swapping.
func (s *Server) adminOnidelInstanceDetail(c fiber.Ctx) error {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return mw.WriteError(c, vErrField("id", "must be a valid uuid"))
	}
	var kind string
	if err := s.db.QueryRow(c.Context(), `SELECT kind FROM providers WHERE id=$1`, providerID).Scan(&kind); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	if kind != "onidel" {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"onidel instance detail is only available for onidel providers (kind=%q)", kind))
	}
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	var (
		d           admInstanceDetail
		recurText   string
		subID       *uuid.UUID
		subPublicID string
		subStatus   string
		subRecur    string
		subNextInv  string
	)
	err = s.db.QueryRow(ctx, `
SELECT i.id, i.public_id, i.organization_id, org.id, org.public_id, org.slug::text, org.name,
       i.provider_id, i.provider_account_id, COALESCE(i.external_vm_id,''),
       i.product_id, i.plan_id, i.subscription_id, i.region_id, i.instance_type_id, i.os_template_id,
       i.name, COALESCE(i.hostname,''), i.status::text, COALESCE(i.power_status,''),
       i.pricing_mode::text, i.billing_period::text, i.currency::text, i.recurring_amount::text,
       i.vcpu, i.ram_mb, i.disk_gb, i.additional_hdd_gb, i.bandwidth_gb, i.network_rate_mbps,
       COALESCE(i.primary_ipv4::text,''), COALESCE(i.primary_ipv6::text,''),
       i.bgp_enabled, i.measured_boot_enabled, i.auto_backup_enabled,
       i.sync_status::text, COALESCE(i.last_synced_at::text,''),
       COALESCE(i.provision_started_at::text,''), COALESCE(i.provisioned_at::text,''),
       COALESCE(i.suspended_at::text,''), COALESCE(i.termination_requested_at::text,''),
       COALESCE(i.terminated_at::text,''), COALESCE(i.created_by::text,''),
       i.created_at::text, i.updated_at::text, COALESCE(i.deleted_at::text,''),
       COALESCE(ssub.public_id,''), COALESCE(ssub.status::text,''), COALESCE(ssub.recurring_amount::text,''),
       COALESCE(ssub.next_invoice_at::text,'')
FROM instances i
JOIN organizations org ON org.id = i.organization_id
LEFT JOIN subscriptions ssub ON ssub.id = i.subscription_id
WHERE i.id = $1 AND i.provider_id = $2`, instanceID, providerID).
		Scan(&d.ID, &d.PublicID, &d.OrganizationID,
			&d.Organization.ID, &d.Organization.PublicID, &d.Organization.Slug, &d.Organization.Name,
			&d.ProviderID, &d.ProviderAccountID, &d.ExternalVMID,
			&d.ProductID, &d.PlanID, &subID, &d.RegionID, &d.InstanceTypeID, &d.OSTemplateID,
			&d.Name, &d.Hostname, &d.Status, &d.PowerStatus,
			&d.PricingMode, &d.BillingPeriod, &d.Currency, &recurText,
			&d.Vcpu, &d.RamMB, &d.DiskGB, &d.AdditionalHDDGB, &d.BandwidthGB, &d.NetworkRateMbps,
			&d.PrimaryIPv4, &d.PrimaryIPv6,
			&d.BGPEnabled, &d.MeasuredBootEnabled, &d.AutoBackupEnabled,
			&d.SyncStatus, &d.LastSyncedAt,
			&d.ProvisionStartedAt, &d.ProvisionedAt,
			&d.SuspendedAt, &d.TerminationRequestedAt,
			&d.TerminatedAt, &d.CreatedBy,
			&d.CreatedAt, &d.UpdatedAt, &d.DeletedAt,
			&subPublicID, &subStatus, &subRecur, &subNextInv)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found for this provider"))
		}
		return mw.WriteError(c, err)
	}
	d.SubscriptionID = subID
	_, _ = fmt.Sscanf(recurText, "%f", &d.RecurringAmount)
	if subID != nil {
		sum := &admSubSummary{ID: *subID, PublicID: subPublicID, Status: subStatus, NextInvoiceAt: subNextInv}
		_, _ = fmt.Sscanf(subRecur, "%f", &sum.RecurringAmount)
		d.Subscription = sum
	}
	rows, err := s.db.Query(ctx, `
SELECT pa.id, pa.action, COALESCE(pa.resource_type,''), COALESCE(pa.external_resource_id,''),
       pa.status::text, pa.attempt_count, COALESCE(pa.response_status_code,0),
       COALESCE(pa.last_error,''), COALESCE(pa.started_at::text,''),
       COALESCE(pa.completed_at::text,''), pa.created_at::text
FROM provider_actions pa
WHERE pa.resource_type='vm' AND pa.internal_resource_id=$1
ORDER BY pa.created_at DESC LIMIT 50`, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	d.ProviderActions = []admProviderAction{}
	for rows.Next() {
		var a admProviderAction
		if err := rows.Scan(&a.ID, &a.Action, &a.ResourceType, &a.ExternalResourceID,
			&a.Status, &a.AttemptCount, &a.ResponseStatus,
			&a.LastError, &a.StartedAt, &a.CompletedAt, &a.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		d.ProviderActions = append(d.ProviderActions, a)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	rows2, err := s.db.Query(ctx, `
SELECT j.id, j.queue, j.job_type, j.status, j.attempts, j.max_attempts,
       j.run_after::text, COALESCE(j.locked_by,''), COALESCE(j.last_error,''),
       j.created_at::text, COALESCE(j.completed_at::text,'')
FROM jobs j
WHERE j.resource_type IN ('vm','instance') AND j.resource_id=$1
ORDER BY j.created_at DESC LIMIT 25`, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows2.Close()
	d.Jobs = []admJobBrief{}
	for rows2.Next() {
		var jb admJobBrief
		if err := rows2.Scan(&jb.ID, &jb.Queue, &jb.JobType, &jb.Status, &jb.Attempts, &jb.MaxAttempts,
			&jb.RunAfter, &jb.LockedBy, &jb.LastError, &jb.CreatedAt, &jb.CompletedAt); err != nil {
			return mw.WriteError(c, err)
		}
		d.Jobs = append(d.Jobs, jb)
	}
	if err := rows2.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.db.QueryRow(ctx, `
SELECT (SELECT count(*) FROM snapshots WHERE instance_id=$1 AND deleted_at IS NULL),
       (SELECT count(*) FROM backups   WHERE instance_id=$1)`, instanceID).
		Scan(&d.ChildCounts.Snapshots, &d.ChildCounts.Backups); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, d, nil)
}

// POST /v1/admin/onidel/:id/instances/:instance_id/suspend — suspend, scoped to that onidel provider.
func (s *Server) adminOnidelInstanceSuspend(c fiber.Ctx) error {
	providerID, err := s.parseOnidelProviderID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.assertOnidelInstance(c.Context(), providerID, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	var status string
	if err := s.db.QueryRow(c.Context(), `SELECT status::text FROM instances WHERE id=$1`, instanceID).Scan(&status); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if status == "suspended" || status == "deleting" || status == "deleted" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance cannot be suspended from state "+status))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx, `UPDATE instances SET status='suspended', suspended_at=now() WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "suspend_instance", "instance", instanceID, map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.onidel.instance.suspend", "instance", &instanceID, map[string]any{"provider_id": providerID.String(), "job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "suspended", "job_id": jobID}, nil)
}

// POST /v1/admin/onidel/:id/instances/:instance_id/unsuspend — unsuspend, scoped to that onidel provider.
func (s *Server) adminOnidelInstanceUnsuspend(c fiber.Ctx) error {
	providerID, err := s.parseOnidelProviderID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.assertOnidelInstance(c.Context(), providerID, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	var status string
	if err := s.db.QueryRow(c.Context(), `SELECT status::text FROM instances WHERE id=$1`, instanceID).Scan(&status); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if status != "suspended" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance is not suspended"))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx, `UPDATE instances SET status='active', suspended_at=NULL WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "unsuspend_instance", "instance", instanceID, map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.onidel.instance.unsuspend", "instance", &instanceID, map[string]any{"provider_id": providerID.String(), "job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "active", "job_id": jobID}, nil)
}

// POST /v1/admin/onidel/:id/instances/:instance_id/terminate — force-terminate, scoped to that onidel provider.
func (s *Server) adminOnidelInstanceTerminate(c fiber.Ctx) error {
	providerID, err := s.parseOnidelProviderID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.assertOnidelInstance(c.Context(), providerID, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	var status string
	if err := s.db.QueryRow(c.Context(), `SELECT status::text FROM instances WHERE id=$1`, instanceID).Scan(&status); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if status == "deleting" || status == "deleted" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance is already being terminated"))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx, `UPDATE instances SET termination_requested_at=now() WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "terminate_instance", "instance", instanceID, map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.onidel.instance.terminate", "instance", &instanceID, map[string]any{"provider_id": providerID.String(), "job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "termination_requested", "job_id": jobID}, nil)
}

func (s *Server) parseOnidelProviderID(c fiber.Ctx) (uuid.UUID, error) {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, vErrField("id", "must be a valid uuid")
	}
	var kind string
	if err := s.db.QueryRow(c.Context(), `SELECT kind FROM providers WHERE id=$1`, providerID).Scan(&kind); err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeNotFound, "provider not found")
	}
	if kind != "onidel" {
		return uuid.Nil, apperrors.Newf(apperrors.CodeUnsupported, "onidel instances is only available for onidel providers (kind=%q)", kind)
	}
	return providerID, nil
}

func (s *Server) assertOnidelInstance(ctx context.Context, providerID, instanceID uuid.UUID) error {
	var pid uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT provider_id FROM instances WHERE id=$1`, instanceID).Scan(&pid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperrors.New(apperrors.CodeNotFound, "instance not found")
		}
		return err
	}
	if pid != providerID {
		return apperrors.New(apperrors.CodeNotFound, "instance not found for this provider")
	}
	return nil
}

// POST /v1/admin/onidel/:id/regions/sync — enqueue provider catalog sync for this onidel provider.
// onidelAdapterFor guards kind==onidel so proxmox/vmware rows never leak. The job is the same
// worker provider_sync (queue=catalog, job_type=provider_sync) that POST /admin/providers/:id/sync
// and the generic Onidel catalog sync use — it upserts regions + instance_types + os_templates via
// SyncCatalog. RBAC: requireStaff("") = platform_admin only (NOC 403, like proxmox POST/clone and vmware POST/migrate).
func (s *Server) adminOnidelRegionsSync(c fiber.Ctx) error {
	providerID, code, _, err := s.onidelAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(c.Context(), "catalog", "provider_sync", "provider", providerID,
		map[string]any{"provider_id": providerID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.onidel.regions.sync", "provider", &providerID, map[string]any{
		"code": code, "job_id": jobID,
	})
	return mw.JSON(c, 202, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"job_id":      jobID,
		"status":      "queued",
	}, nil)
}

// POST /v1/admin/onidel/:id/catalog/sync — billing sync alias for regions/sync (task contract).
// Same onidelAdapterFor guard + queue (catalog/provider_sync); kept as distinct audit key
// so billing sync is traceable separately. RBAC: requireStaff("") = platform_admin only.
func (s *Server) adminOnidelCatalogSync(c fiber.Ctx) error {
	providerID, code, _, err := s.onidelAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(c.Context(), "catalog", "provider_sync", "provider", providerID,
		map[string]any{"provider_id": providerID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.onidel.catalog.sync", "provider", &providerID, map[string]any{
		"code": code, "job_id": jobID,
	})
	return mw.JSON(c, 202, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"job_id":      jobID,
		"status":      "queued",
	}, nil)
}
