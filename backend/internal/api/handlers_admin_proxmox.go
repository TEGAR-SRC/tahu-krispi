// Admin cluster observability for Proxmox providers: raw PVE inventory
// (nodes, cluster resources, per-node storages and recent tasks) served from
// the *proxmox.Adapter helper methods outside the ComputeProvider interface.
package api

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/proxmox"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// proxmoxAdapterFor resolves a providers row to its live *proxmox.Adapter,
// rejecting everything that cannot serve cluster observability (unknown row,
// non-proxmox kind, or an adapter without the helper surface). This is the
// per-provider guard for the proxmox murni surface — every proxmox-only
// handler (cluster/nodes/disks/certs/command/backup/storages/backup-jobs/
// ha/fw/pools/sdn/ceph/containers + instance clone/template/move) routes
// through here so non-proxmox kind answers 501 expect proxmox.
func (s *Server) proxmoxAdapterFor(c fiber.Ctx) (uuid.UUID, string, *proxmox.Adapter, error) {
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
	if kind != proxmox.ProviderCode {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"cluster observability is only available for proxmox providers (kind=%q) expect proxmox", kind)
	}
	pv, err := provider.Lookup(code)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	ad, ok := pv.(*proxmox.Adapter)
	if !ok {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"registered provider %q does not expose cluster observability", code)
	}
	return providerID, code, ad, nil
}

// GET /v1/admin/providers/:provider_id/cluster returns the PVE node list plus
// the full cluster resource inventory as reported by the cluster.
func (s *Server) adminProviderCluster(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	nodes, err := ad.Nodes(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	resources, err := ad.ClusterResources(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"nodes":       nodes,
		"resources":   resources,
	}, nil)
}

// GET /v1/admin/providers/:provider_id/nodes/:node/storages lists the storages
// visible from one node.
func (s *Server) adminProviderNodeStorages(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	storages, err := ad.NodeStorages(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, storages, nil)
}

// GET /v1/admin/providers/:provider_id/nodes/:node/tasks lists recent tasks
// (still running plus archived) on one node.
func (s *Server) adminProviderNodeTasks(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	tasks, err := ad.RecentTasks(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, tasks, nil)
}

// GET /v1/admin/providers/:provider_id/containers lists the cluster's LXC
// inventory (ContainersListAll) as a NOC view; optional ?node= narrows it to
// one node using the cluster resource map (VMState carries no node field).
// Single-node fallback: when cluster resources are empty or unavailable
// (standalone pve host), enumerates via nodes/pve/lxc and per-node
// /nodes/{node}/lxc so containers remain visible.
func (s *Server) adminProviderContainers(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	filterNode := strings.TrimSpace(c.Query("node"))

	containers, err := ad.ContainersListAll(ctx)
	fallbackUsed := false

	loadFallback := func() ([]provider.VMState, error) {
		var out []provider.VMState
		toVMState := func(vmid uint64, name, status string, cpus int, maxMem, maxDisk uint64) provider.VMState {
			mapped := status
			switch status {
			case "running":
				mapped = "active"
			case "stopped":
				mapped = "stopped"
			default:
				mapped = "unknown"
			}
			return provider.VMState{
				ExternalID:  "ct" + strconv.FormatUint(vmid, 10),
				Name:        name,
				Status:      mapped,
				PowerStatus: status,
				VCPU:        int64(cpus),
				RAM:         int64(maxMem >> 20),
				Disk:        int64(maxDisk >> 30),
			}
		}
		if filterNode != "" {
			if cts, ferr := ad.Client().ContainersList(ctx, filterNode); ferr == nil {
				for _, ct := range cts {
					out = append(out, toVMState(uint64(ct.VMID), ct.Name, ct.Status, ct.CPUs, ct.MaxMem, ct.MaxDisk))
				}
				return out, nil
			}
		}
		if filterNode == "" || filterNode == "pve" {
			if cts, ferr := ad.Client().ContainersList(ctx, "pve"); ferr == nil && len(cts) > 0 {
				for _, ct := range cts {
					out = append(out, toVMState(uint64(ct.VMID), ct.Name, ct.Status, ct.CPUs, ct.MaxMem, ct.MaxDisk))
				}
				if filterNode == "pve" {
					return out, nil
				}
			}
		}
		nodes, nerr := ad.Nodes(ctx)
		if nerr != nil {
			return out, nerr
		}
		seen := map[string]bool{}
		for _, n := range nodes {
			nName := strings.TrimSpace(n.Node)
			if nName == "" {
				nName = strings.TrimSpace(n.Name)
			}
			if nName == "" || seen[nName] {
				continue
			}
			seen[nName] = true
			if filterNode != "" && nName != filterNode {
				continue
			}
			if nName == "pve" && len(out) > 0 {
				continue
			}
			cts, ferr := ad.Client().ContainersList(ctx, nName)
			if ferr != nil {
				continue
			}
			for _, ct := range cts {
				out = append(out, toVMState(uint64(ct.VMID), ct.Name, ct.Status, ct.CPUs, ct.MaxMem, ct.MaxDisk))
			}
		}
		return out, nil
	}

	if err != nil {
		if fb, ferr := loadFallback(); ferr == nil && len(fb) > 0 {
			containers = fb
			fallbackUsed = true
			err = nil
		} else {
			return mw.WriteError(c, err)
		}
	} else if len(containers) == 0 {
		if fb, _ := loadFallback(); len(fb) > 0 {
			containers = fb
			fallbackUsed = true
		}
	}

	if filterNode != "" && !fallbackUsed {
		resources, rerr := ad.ClusterResources(ctx)
		if rerr == nil {
			nodeByVMID := make(map[int]string, len(resources))
			for _, r := range resources {
				if r.Type == "lxc" {
					nodeByVMID[int(r.VMID)] = r.Node
				}
			}
			filtered := make([]provider.VMState, 0, len(containers))
			for _, ct := range containers {
				if vmid, perr := strconv.Atoi(strings.TrimPrefix(ct.ExternalID, "ct")); perr == nil && nodeByVMID[vmid] == filterNode {
					filtered = append(filtered, ct)
				}
			}
			containers = filtered
		} else {
			if fb, ferr := loadFallback(); ferr == nil {
				containers = fb
			} else {
				return mw.WriteError(c, rerr)
			}
		}
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"containers":  containers,
	}, nil)
}
