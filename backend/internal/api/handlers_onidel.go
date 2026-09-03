// Admin Onidel plane: provider-prefixed catalog + health, no proxmox share.
//
// GET /v1/admin/onidel/:id/catalog  -> regions + instance_types + os_templates (live via Onidel adapter)
// GET /v1/admin/onidel/:id/health   -> enabled/health_status + live probe latency
// Both ride requireStaff("auto") which resolves GET to "infra" so NOC can read,
// while POST/DELETE on /onidel stays platform_admin-only via staffAreaFor.
package api

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/onidel"
	apperrors "kilat.cloud/backend/pkg/errors"
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
