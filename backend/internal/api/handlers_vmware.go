// VMware vSphere observability — murni vmware, tanpa proxmox.
//
// Inventory (hosts/datastores/clusters/pools) dan perf (GuestMetrics) hanya
// untuk providers dengan kind == "vmware". Guard kind di vmwareAdapterFor
// memastikan proxmox/onidel/dokploy tidak bisa lewat sini.
package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/vmware"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// vmwareAdapterFor resolves a providers row to its live *vmware.Adapter,
// rejecting everything that cannot serve vmware observability (unknown row,
// non-vmware kind, atau adapter tanpa helper surface).
func (s *Server) vmwareAdapterFor(c fiber.Ctx) (uuid.UUID, string, *vmware.Adapter, error) {
	raw := c.Params("id")
	if raw == "" {
		raw = c.Params("provider_id")
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
	if kind != vmware.ProviderCode {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"vmware observability is only available for vmware providers (kind=%q)", kind)
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	ad, ok := pv.(*vmware.Adapter)
	if !ok {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"registered provider %q does not expose vmware inventory", code)
	}
	return providerID, code, ad, nil
}

// GET /v1/admin/providers/:provider_id/inventory — raw vSphere view: hosts
// (cpu threads/memory/power), datastores (capacity/free), clusters dan
// resource pools. Guard kind == vmware via vmwareAdapterFor.
func (s *Server) adminVMwareInventory(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	report, err := ad.Inventory(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id":    providerID,
		"code":           code,
		"hosts":          report.Hosts,
		"datastores":     report.Datastores,
		"clusters":       report.Clusters,
		"resource_pools": report.ResourcePools,
	}, nil)
}

var adminPerfTimeframes = map[string]bool{"hour": true, "day": true}

// GET /v1/admin/providers/:provider_id/perf?v=<external_id>&timeframe=hour|day
// Guest metrics khusus vmware via *vmware.Adapter.GuestMetrics. Guard kind ==
// vmware — proxmox/onidel/dokploy ditolak dengan CodeUnsupported, tidak
// dicampur di file ini.
func (s *Server) adminProviderPerf(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	vmExt := strings.TrimSpace(c.Query("v"))
	if vmExt == "" {
		return mw.WriteError(c, vErrField("v", "guest external id (?v=) is required"))
	}
	timeframe := strings.ToLower(strings.TrimSpace(c.Query("timeframe", "hour")))
	if timeframe == "" {
		timeframe = "hour"
	}
	if !adminPerfTimeframes[timeframe] {
		return mw.WriteError(c, vErrField("timeframe", "must be one of hour, day"))
	}
	data, err := ad.GuestMetrics(c.Context(), vmExt, timeframe)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"external_id": vmExt,
		"timeframe":   timeframe,
		"metrics":     data,
	}, nil)
}

// adminVMwarePerf alias murni vmware untuk route yang ingin nama eksplisit.
func (s *Server) adminVMwarePerf(c fiber.Ctx) error {
	return s.adminProviderPerf(c)
}
