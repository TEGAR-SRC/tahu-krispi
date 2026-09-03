// Proxmox LXC migrate — per-node container migration.
// Endpoints: GET /admin/proxmox/:id/nodes/:node/lxc/:vmid/migrate (infra, polled 5s)
//           POST /admin/proxmox/:id/nodes/:node/lxc/:vmid/migrate (platform_admin).
// Guard kind==proxmox via proxmoxAdapterFor — non-proxmox answers 501 expect proxmox.
// Adapter: MigrateContainer(ctx, "ct<vmid>", targetNode) mirrors MigrateVM pattern
// (preflight logged, then ContainerMigrate + WaitForTask, 60m timeout).
package api

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	mw "kilat.cloud/backend/pkg/middleware"
)

type lxcMigrateInput struct {
	TargetNode string `json:"target_node"`
	Target     string `json:"target"`
	Node       string `json:"node"`
	Host       string `json:"host"`
}

func (in *lxcMigrateInput) targetNode() string {
	for _, c := range []string{in.TargetNode, in.Target, in.Node, in.Host} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

func (s *Server) adminProxmoxLxcMigrateStatus(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawNode := strings.TrimSpace(c.Params("node"))
	rawVmid := strings.TrimSpace(c.Params("vmid"))
	if rawNode == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidInt, cerr := strconv.Atoi(rawVmid)
	if cerr != nil || vmidInt <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	ctx := c.Context()
	nodes, nerr := ad.Nodes(ctx)
	if nerr != nil {
		return mw.WriteError(c, nerr)
	}
	resources, _ := ad.Client().ClusterResources(ctx)
	var container any
	for _, r := range resources {
		if r.Type == "lxc" && int(r.VMID) == vmidInt {
			container = r
			break
		}
	}
	ext := "ct" + strconv.Itoa(vmidInt)
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"node":        rawNode,
		"vmid":        vmidInt,
		"external_id": ext,
		"container":   container,
		"nodes":       nodes,
		"total_nodes": len(nodes),
		"hint":        "POST /admin/proxmox/:id/nodes/:node/lxc/:vmid/migrate {target_node}",
		"example":     map[string]string{"target_node": "pve02"},
	}, nil)
}

func (s *Server) adminProxmoxLxcMigrate(c fiber.Ctx) error {
	providerID, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawNode := strings.TrimSpace(c.Params("node"))
	rawVmid := strings.TrimSpace(c.Params("vmid"))
	if rawNode == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidInt, cerr := strconv.Atoi(rawVmid)
	if cerr != nil || vmidInt <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var in lxcMigrateInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid migrate payload"))
	}
	target := in.targetNode()
	if target == "" {
		return mw.WriteError(c, vErrField("target_node", "target_node is required"))
	}
	ext := "ct" + strconv.Itoa(vmidInt)
	if err := ad.MigrateContainer(c.Context(), ext, target); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.lxc.migrate", "provider", &providerID, map[string]any{
		"node": rawNode, "vmid": vmidInt, "external_id": ext, "target_node": target,
	})
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"node":        rawNode,
		"vmid":        vmidInt,
		"external_id": ext,
		"target_node": target,
		"status":      "migrated",
	}, nil)
}
