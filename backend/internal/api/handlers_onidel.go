// Admin Onidel plane: provider-prefixed catalog + health + instances, no proxmox share.
//
// GET /v1/admin/onidel/:id/catalog       -> regions + instance_types + os_templates (live via Onidel adapter)
// GET /v1/admin/onidel/:id/health        -> enabled/health_status + live probe latency
// GET /v1/admin/onidel/:id/health/detail -> health_status + last_check (DB) + live probe, provider.Lookup-guarded
// GET /v1/admin/onidel/:id/instances     -> live instances filtered by provider_id==:id (DB, infra, polling 5s)
// All ride requireStaff("infra") for GET so NOC can read; POST/DELETE stay platform_admin-only.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

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
