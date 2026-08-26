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
// non-proxmox kind, or an adapter without the helper surface).
func (s *Server) proxmoxAdapterFor(c fiber.Ctx) (uuid.UUID, string, *proxmox.Adapter, error) {
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
	if kind != proxmox.ProviderCode {
		return uuid.Nil, "", nil, apperrors.Newf(apperrors.CodeUnsupported,
			"cluster observability is only available for proxmox providers (kind=%q)", kind)
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
func (s *Server) adminProviderContainers(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	containers, err := ad.ContainersListAll(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if node := strings.TrimSpace(c.Query("node")); node != "" {
		resources, err := ad.ClusterResources(c.Context())
		if err != nil {
			return mw.WriteError(c, err)
		}
		nodeByVMID := make(map[int]string, len(resources))
		for _, r := range resources {
			if r.Type == "lxc" {
				nodeByVMID[int(r.VMID)] = r.Node
			}
		}
		filtered := make([]provider.VMState, 0, len(containers))
		for _, ct := range containers {
			if vmid, perr := strconv.Atoi(strings.TrimPrefix(ct.ExternalID, "ct")); perr == nil && nodeByVMID[vmid] == node {
				filtered = append(filtered, ct)
			}
		}
		containers = filtered
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"containers":  containers,
	}, nil)
}
