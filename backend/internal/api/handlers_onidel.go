// Admin Onidel plane: provider-prefixed catalog + health, no proxmox share.
//
// GET /v1/admin/onidel/:id/catalog  -> regions + instance_types + os_templates (live via Onidel adapter)
// GET /v1/admin/onidel/:id/health   -> enabled/health_status + live probe latency
// Both ride requireStaff("auto") which resolves GET to "infra" so NOC can read,
// while POST/DELETE on /onidel stays platform_admin-only via staffAreaFor.
package api

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/onidel"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// onidelAdapterFor resolves a providers row to its live *onidel.Adapter.
// It rejects unknown rows and non-onidel kinds with provider-prefixed errors
// and never touches the proxmox/vmware helper surface.
func (s *Server) onidelAdapterFor(c fiber.Ctx) (uuid.UUID, string, *onidel.Adapter, error) {
	raw := strings.TrimSpace(c.Params("id"))
	if raw == "" {
		raw = strings.TrimSpace(c.Params("provider_id"))
	}
	providerID, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, "", nil, vErrField("id", "must be a valid uuid")
	}
	var code, kind string
	err = s.db.QueryRow(c.Context(),
		`SELECT code::text, kind FROM providers WHERE id=$1`, providerID).Scan(&code, &kind)
	if err != nil {
		return uuid.Nil, "", nil, apperrors.New(apperrors.CodeNotFound, "provider not found")
	}
	if kind != "onidel" {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"onidel catalog is only available for onidel providers (kind=%q)", kind)
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	ad, ok := pv.(*onidel.Adapter)
	if !ok {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"registered provider %q does not expose onidel catalog", code)
	}
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
