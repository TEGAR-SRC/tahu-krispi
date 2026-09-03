// VMware vSphere observability + snapshots — murni vmware, tanpa proxmox.
//
// Inventory (hosts/datastores/clusters/pools), perf (GuestMetrics) dan snapshots
// (create/list/revert/delete) hanya untuk providers dengan kind == "vmware".
// Guard kind di vmwareAdapterFor memastikan proxmox/onidel/dokploy tidak bisa
// lewat sini.
package api

import (
	"net/url"
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
			"vmware observability is only available for vmware providers (kind=%q) expect vmware", kind)
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

// GET /v1/admin/vmware/:id/perf/:vmid — per-VM realtime perf drill-down.
// Path-param variant of /perf for detail pages that poll every 5s.
// Guard kind==vmware via vmwareAdapterFor; RBAC infra (NOC readable, finance 403).
// :vmid is the vSphere VM external id (e.g. VirtualMachine:vm-42 or vm-42, url-escaped).
// Optional query timeframe=hour|day (default hour = realtime 20s interval).
func (s *Server) adminVMwarePerfDetail(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawVmid := c.Params("vmid")
	if rawVmid == "" {
		rawVmid = c.Params("vmId")
	}
	decoded, _ := url.PathUnescape(rawVmid)
	vmExt := strings.TrimSpace(decoded)
	if vmExt == "" {
		vmExt = strings.TrimSpace(c.Query("v"))
	}
	if vmExt == "" {
		return mw.WriteError(c, vErrField("vmid", "vm external id is required (e.g. VirtualMachine:vm-42 or vm-42)"))
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
		"vmid":        vmExt,
		"timeframe":   timeframe,
		"metrics":     data,
	}, nil)
}

// GET /v1/admin/vmware/:id/datastores — only the datastores slice of the
// vCenter inventory (capacity/free/type). Polling via useInfraGet every 5s.
// RBAC infra (NOC readable, finance 403).
func (s *Server) adminVMwareDatastores(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	report, err := ad.Inventory(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	ds := report.Datastores
	if ds == nil {
		ds = []vmware.DatastoreInventory{}
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"datastores":  ds,
	}, nil)
}

// ---- Snapshots (vmware murni) ----

// GET /v1/admin/vmware/:id/snapshots — list every snapshot across all
// Kilat-managed VMs on this vCenter. RBAC infra (NOC readable, finance 403).
func (s *Server) adminVmwareSnapshotsList(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	snaps, err := ad.ListSnapshots(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if snaps == nil {
		snaps = []provider.ProviderSnapshot{}
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"snapshots":   snaps,
	}, nil)
}

// POST /v1/admin/vmware/:id/snapshots — create snapshot of one VM.
// Body { vm, name, desc? } where vm is the provider external id
// ("VirtualMachine:vm-123") and name is the snapshot name. RBAC "" (platform_admin only).
func (s *Server) adminVmwareSnapshotCreate(c fiber.Ctx) error {
	providerID, _, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		VM   string `json:"vm"`
		Name string `json:"name"`
		Desc string `json:"desc"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid snapshot payload"))
	}
	vmExt := strings.TrimSpace(in.VM)
	name := strings.TrimSpace(in.Name)
	desc := strings.TrimSpace(in.Desc)
	if vmExt == "" {
		return mw.WriteError(c, vErrField("vm", "vm external id is required (e.g. VirtualMachine:vm-123)"))
	}
	if name == "" {
		return mw.WriteError(c, vErrField("name", "snapshot name is required"))
	}
	snapshotID, err := ad.CreateSnapshot(c.Context(), vmExt, name, desc)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.vmware.snapshot.create", "provider", &providerID, map[string]any{
		"vm": vmExt, "name": name, "snapshot_id": snapshotID,
	})
	return mw.JSON(c, 201, fiber.Map{"snapshot_id": snapshotID, "vm": vmExt, "name": name}, nil)
}

// POST /v1/admin/vmware/:id/snapshots/revert — revert VM to snapshot.
// Body { snapshot_id, vm? }. snapshot_id is the provider snapshot extID
// ("VirtualMachine:vm-123/snapname"). When vm is omitted it is derived from
// the prefix before "/". RBAC "" (platform_admin only).
func (s *Server) adminVmwareSnapshotRevert(c fiber.Ctx) error {
	providerID, _, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		VM         string `json:"vm"`
		SnapshotID string `json:"snapshot_id"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid revert payload"))
	}
	snapshotID := strings.TrimSpace(in.SnapshotID)
	if snapshotID == "" {
		return mw.WriteError(c, vErrField("snapshot_id", "snapshot_id is required (e.g. VirtualMachine:vm-123/snapname)"))
	}
	vmExt := strings.TrimSpace(in.VM)
	if vmExt == "" {
		if idx := strings.Index(snapshotID, "/"); idx > 0 {
			vmExt = strings.TrimSpace(snapshotID[:idx])
		}
	}
	if vmExt == "" {
		return mw.WriteError(c, vErrField("vm", "vm external id is required"))
	}
	// Guard mismatch: snapshot_id prefix must equal vm when both supplied.
	if in.VM != "" {
		prefix := snapshotID
		if idx := strings.Index(snapshotID, "/"); idx > 0 {
			prefix = snapshotID[:idx]
		}
		if prefix != vmExt {
			return mw.WriteError(c, vErrField("snapshot_id", "snapshot_id does not belong to vm"))
		}
	}
	if err := ad.RestoreFromSnapshot(c.Context(), vmExt, snapshotID); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.vmware.snapshot.revert", "provider", &providerID, map[string]any{
		"vm": vmExt, "snapshot_id": snapshotID,
	})
	return mw.JSON(c, 200, fiber.Map{"status": "reverted", "vm": vmExt, "snapshot_id": snapshotID}, nil)
}

// DELETE /v1/admin/vmware/:id/snapshots?snapshot_id=... — delete snapshot.
// Query snapshot_id is the provider snapshot extID ("VirtualMachine:vm-123/snapname").
// RBAC "" (platform_admin only).
func (s *Server) adminVmwareSnapshotDelete(c fiber.Ctx) error {
	providerID, _, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	snapshotID := strings.TrimSpace(c.Query("snapshot_id"))
	if snapshotID == "" {
		// Also accept JSON body for programmatic callers that cannot send query.
		var in struct {
			SnapshotID string `json:"snapshot_id"`
		}
		_ = c.Bind().Body(&in)
		snapshotID = strings.TrimSpace(in.SnapshotID)
	}
	if snapshotID == "" {
		return mw.WriteError(c, vErrField("snapshot_id", "query parameter snapshot_id is required (e.g. VirtualMachine:vm-123/snapname)"))
	}
	if err := ad.DeleteSnapshot(c.Context(), snapshotID); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.vmware.snapshot.delete", "provider", &providerID, map[string]any{
		"snapshot_id": snapshotID,
	})
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "snapshot_id": snapshotID}, nil)
}

// ---- Migrate (vmware murni — vMotion wizard) ----

// vmwareMigrateInput supports flexible keys for wizard callers — source may
// come as source/external_id/vm_id and target as target_host/target_node/host.
type vmwareMigrateInput struct {
	Source     string `json:"source"`
	ExternalID string `json:"external_id"`
	VMID       string `json:"vm_id"`
	VMIdAlt    string `json:"vmId"`
	VM         string `json:"vm"`
	TargetHost string `json:"target_host"`
	TargetNode string `json:"target_node"`
	Host       string `json:"host"`
	Target     string `json:"target"`
}

func (in *vmwareMigrateInput) sourceID() string {
	for _, c := range []string{in.Source, in.ExternalID, in.VMID, in.VMIdAlt, in.VM} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

func (in *vmwareMigrateInput) targetHost() string {
	for _, c := range []string{in.TargetHost, in.TargetNode, in.Host, in.Target} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

// GET /v1/admin/vmware/:id/migrate — wizard preload: hosts from Inventory plus
// managed VMs from ListVMs. Infra-readable (NOC) so the wizard can poll before
// the mutation. Polling contract: frontend useInfraGet intervalMs 5000 like
// proxmox clone.
func (s *Server) adminVMwareMigrateStatus(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	report, err := ad.Inventory(ctx)
	if err != nil {
		return mw.WriteError(c, err)
	}
	vms, _ := ad.ListVMs(ctx, "")
	vmRows := make([]map[string]any, 0, len(vms))
	for _, vm := range vms {
		vmRows = append(vmRows, map[string]any{
			"external_id":  vm.ExternalID,
			"name":         vm.Name,
			"status":       vm.Status,
			"power_status": vm.PowerStatus,
			"vcpu":         vm.VCPU,
			"ram_mb":       vm.RAM,
		})
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"hosts":       report.Hosts,
		"vms":         vmRows,
		"total_hosts": len(report.Hosts),
		"total_vms":   len(vmRows),
		"hint":        "POST /admin/vmware/:id/migrate {source, target_host}",
		"example":     map[string]string{"source": "VirtualMachine:vm-42", "target_host": "esxi-02.example.com"},
	}, nil)
}

// GET /v1/admin/vmware/:id/hosts/:host — single ESXi host detail from
// vCenter inventory. Guard kind==vmware via vmwareAdapterFor; RBAC infra
// (NOC readable, finance 403). Polling via useInfraGet every 5s. :host is the
// ESXi host name (url-escaped), matched exactly against InventoryReport.Hosts.
func (s *Server) adminVMwareHostDetail(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawHost := c.Params("host")
	hostName, _ := url.PathUnescape(rawHost)
	hostName = strings.TrimSpace(hostName)
	if hostName == "" {
		return mw.WriteError(c, vErrField("host", "host name is required"))
	}
	report, err := ad.Inventory(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	for _, h := range report.Hosts {
		if h.Name == hostName {
			return mw.JSON(c, 200, fiber.Map{
				"provider_id": providerID,
				"code":        code,
				"host":        h,
			}, nil)
		}
	}
	return mw.WriteError(c, apperrors.Newf(apperrors.CodeNotFound, "vmware: host %q not found", hostName))
}

// GET /v1/admin/vmware/:id/datastores/:ds — single datastore detail from
// vCenter inventory. Guard kind==vmware via vmwareAdapterFor; RBAC infra
// (NOC readable, finance 403). Polling via useInfraGet every 5s. :ds is the
// datastore name (url-escaped), matched exactly against InventoryReport.Datastores.
func (s *Server) adminVMwareDatastoreDetail(c fiber.Ctx) error {
	providerID, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawDS := c.Params("ds")
	dsName, _ := url.PathUnescape(rawDS)
	dsName = strings.TrimSpace(dsName)
	if dsName == "" {
		return mw.WriteError(c, vErrField("ds", "datastore name is required"))
	}
	report, err := ad.Inventory(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	for _, d := range report.Datastores {
		if d.Name == dsName {
			return mw.JSON(c, 200, fiber.Map{
				"provider_id": providerID,
				"code":        code,
				"datastore":   d,
			}, nil)
		}
	}
	return mw.WriteError(c, apperrors.Newf(apperrors.CodeNotFound, "vmware: datastore %q not found", dsName))
}

// GET /v1/admin/vmware/:id/datastores/:ds/browse — browse files inside one
// vSphere datastore (VMFS/vSAN/NFS) via HostDatastoreBrowser. Guard
// kind==vmware via vmwareAdapterFor; RBAC infra (NOC readable, finance 403).
// Polling via useInfraGet every 5s. :ds is the datastore name (url-escaped);
// query ?path=<datastore-relative path> defaults to "/" (root). Results are
// sorted folder-first.
func (s *Server) adminVMwareDatastoreBrowse(c fiber.Ctx) error {
	_, code, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawDS := c.Params("ds")
	dsName, _ := url.PathUnescape(rawDS)
	dsName = strings.TrimSpace(dsName)
	if dsName == "" {
		return mw.WriteError(c, vErrField("ds", "datastore name is required"))
	}
	dsRel := strings.TrimSpace(c.Query("path", "/"))
	files, folderPath, err := ad.DatastoreBrowse(c.Context(), dsName, dsRel)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if files == nil {
		files = []vmware.DatastoreBrowseFile{}
	}
	return mw.JSON(c, 200, fiber.Map{
		"code":        code,
		"datastore":   dsName,
		"path":        dsRel,
		"folder_path": folderPath,
		"files":       files,
		"total":       len(files),
	}, nil)
}

// POST /v1/admin/vmware/:id/migrate — vMotion a VM to another ESXi host within
// the same vCenter. Guard kind==vmware via vmwareAdapterFor, target_host
// re-validated server-side by finder.HostSystem (unknown host → 422).
// Platform_admin only (requireStaff "").
func (s *Server) adminVMwareMigrate(c fiber.Ctx) error {
	providerID, _, ad, err := s.vmwareAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in vmwareMigrateInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid migrate payload"))
	}
	src := in.sourceID()
	target := in.targetHost()
	if src == "" {
		return mw.WriteError(c, vErrField("source", "source (vm external id, e.g. VirtualMachine:vm-42 or vm-42) is required"))
	}
	if target == "" {
		return mw.WriteError(c, vErrField("target_host", "target_host (ESXi host name) is required"))
	}
	if err := ad.MigrateVM(c.Context(), src, target); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.vmware.migrate", "provider", &providerID, map[string]any{
		"source": src, "target_host": target,
	})
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"source":      src,
		"target_host": target,
		"status":      "migrated",
	}, nil)
}
