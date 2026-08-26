// Admin VMware/vSphere observability: raw vCenter infrastructure inventory
// (hosts, datastores, clusters, resource pools) served from the
// *vmware.Adapter helper method outside the ComputeProvider interface, plus a
// provider-agnostic guest performance endpoint shared with Proxmox via the
// plain interface's GuestMetrics.
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
// rejecting everything that cannot serve infrastructure inventory (unknown
// row, non-vmware kind, or an adapter without the helper surface).
func (s *Server) vmwareAdapterFor(c fiber.Ctx) (uuid.UUID, string, *vmware.Adapter, error) {
	providerID, err := admParseUUIDParam(c, "provider_id", "provider_id")
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	var code, kind string
	err = s.db.QueryRow(c.Context(),
		`SELECT code::text, kind FROM providers WHERE id=$1`, providerID).Scan(&code, &kind)
	if err != nil {
		return uuid.Nil, "", nil, apperrors.New(apperrors.CodeNotFound, "provider not found")
	}
	if kind != vmware.ProviderCode {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"infrastructure inventory is only available for vmware providers (kind=%q)", kind)
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	ad, ok := pv.(*vmware.Adapter)
	if !ok {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"registered provider %q does not expose infrastructure inventory", code)
	}
	return providerID, code, ad, nil
}

// GET /v1/admin/providers/:provider_id/inventory returns the raw vSphere
// view: every host (cpu threads/memory bytes/power), datastore (capacity and
// free space), cluster and resource pool.
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

// adminPerfTimeframes is deliberately narrower than the user-facing metrics
// vocabulary: NOC perf charts only need the realtime hour window and the 5m
// day window both GuestMetrics implementations (vmware + proxmox) support.
var adminPerfTimeframes = map[string]bool{"hour": true, "day": true}

// GET /v1/admin/providers/:provider_id/perf?v=<external_id>&timeframe=hour|day
// serves one guest's metric series through the plain ComputeProvider
// interface — no adapter type assert — so the same endpoint answers for
// vmware and proxmox rows alike.
func (s *Server) adminProviderPerf(c fiber.Ctx) error {
	providerID, err := admParseUUIDParam(c, "provider_id", "provider_id")
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
	var code string
	err = s.db.QueryRow(c.Context(),
		`SELECT code::text FROM providers WHERE id=$1`, providerID).Scan(&code)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return mw.WriteError(c, err)
	}
	data, err := pv.GuestMetrics(c.Context(), vmExt, timeframe)
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
