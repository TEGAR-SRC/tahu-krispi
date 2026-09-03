// Proxmox QEMU migrate + clone — per-node QEMU live migration and clone.
// Endpoints: GET  /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate (infra, polled 5s)
//            POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate (platform_admin)
//            POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/clone   (platform_admin)
// Guard kind==proxmox via proxmoxAdapterFor — non-proxmox answers 501 expect proxmox.
// Adapter: MigrateVM(ctx, "<vmid>", targetNode) mirrors MigrateContainer pattern
// (preflight logged, then QEMUMigrate + WaitForTask); CloneVM(ctx, "<vmid>", name).
package api

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	mw "kilat.cloud/backend/pkg/middleware"
)

type qemuMigrateInput struct {
	TargetNode string `json:"target_node"`
	Target     string `json:"target"`
	Node       string `json:"node"`
	Host       string `json:"host"`
}

func (in *qemuMigrateInput) targetNode() string {
	for _, c := range []string{in.TargetNode, in.Target, in.Node, in.Host} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

type qemuCloneInput struct {
	Name string `json:"name"`
}

func (s *Server) adminProxmoxQemuMigrateStatus(c fiber.Ctx) error {
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
	var guest any
	for _, r := range resources {
		if r.Type == "qemu" && int(r.VMID) == vmidInt {
			guest = r
			break
		}
	}
	ext := strconv.Itoa(vmidInt)
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"node":        rawNode,
		"vmid":        vmidInt,
		"external_id": ext,
		"guest":       guest,
		"nodes":       nodes,
		"total_nodes": len(nodes),
		"hint":        "POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate {target_node} + POST .../clone {name}",
		"example":     map[string]string{"target_node": "pve02", "name": "web-01-clone"},
	}, nil)
}

func (s *Server) adminProxmoxQemuMigrate(c fiber.Ctx) error {
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
	var in qemuMigrateInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid migrate payload"))
	}
	target := in.targetNode()
	if target == "" {
		return mw.WriteError(c, vErrField("target_node", "target_node is required"))
	}
	ext := strconv.Itoa(vmidInt)
	if err := ad.MigrateVM(c.Context(), ext, target); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.qemu.migrate", "provider", &providerID, map[string]any{
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

func (s *Server) adminProxmoxQemuClone(c fiber.Ctx) error {
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
	var in qemuCloneInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid clone payload"))
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return mw.WriteError(c, vErrField("name", "name is required"))
	}
	if len(name) > 64 {
		return mw.WriteError(c, vErrField("name", "name must be at most 64 characters"))
	}
	ext := strconv.Itoa(vmidInt)
	if err := ad.CloneVM(c.Context(), ext, name); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.qemu.clone", "provider", &providerID, map[string]any{
		"node": rawNode, "vmid": vmidInt, "external_id": ext, "name": name,
	})
	return mw.JSON(c, 201, fiber.Map{
		"provider_id": providerID,
		"node":        rawNode,
		"vmid":        vmidInt,
		"external_id": ext,
		"name":        name,
		"status":      "cloned",
	}, nil)
}
