// Proxmox HA MigrateRelocate — per-resource HA managed guest migration.
// Endpoints: GET  /admin/proxmox/:id/ha-resources/:sid/migrate (infra, polled 5s)
//            POST /admin/proxmox/:id/ha-resources/:sid/migrate (platform_admin)
// Guard kind==proxmox via proxmoxAdapterFor — non-proxmox answers 501 expect proxmox.
// Adapter: Client().HAResourceMigrateRelocate(ctx, sid, node, relocate) -> POST /cluster/ha/resources/{sid}/migrate or /relocate.
package api

import (
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v3"

	mw "kilat.cloud/backend/pkg/middleware"
)

type haMigrateInput struct {
	TargetNode string `json:"target_node"`
	Target     string `json:"target"`
	Node       string `json:"node"`
	Host       string `json:"host"`
	Relocate   *bool  `json:"relocate"`
	Force      *bool  `json:"force"`
}

func (in *haMigrateInput) targetNode() string {
	for _, c := range []string{in.TargetNode, in.Target, in.Node, in.Host} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

func (in *haMigrateInput) isRelocate() bool {
	if in.Relocate != nil {
		return *in.Relocate
	}
	if in.Force != nil {
		return *in.Force
	}
	return false
}

func (s *Server) adminProxmoxHaMigrateStatus(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawSid := strings.TrimSpace(c.Params("sid"))
	if rawSid == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	if decoded, derr := url.PathUnescape(rawSid); derr == nil {
		rawSid = decoded
	}
	if strings.TrimSpace(rawSid) == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	sid := strings.TrimSpace(rawSid)
	ctx := c.Context()
	nodes, nerr := ad.Nodes(ctx)
	if nerr != nil {
		return mw.WriteError(c, nerr)
	}
	var resource any
	if res, rerr := ad.Client().HAResourcesList(ctx, ""); rerr == nil {
		for _, r := range res {
			if r.SID == sid {
				resource = r
				break
			}
		}
	}
	status, _ := ad.Client().HAStatus(ctx)
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"sid":         sid,
		"resource":    resource,
		"nodes":       nodes,
		"total_nodes": len(nodes),
		"ha_status":   status,
		"hint":        "POST /admin/proxmox/:id/ha-resources/:sid/migrate {target_node, relocate}",
		"example":     map[string]any{"target_node": "pve02", "relocate": false},
	}, nil)
}

func (s *Server) adminProxmoxHaMigrate(c fiber.Ctx) error {
	providerID, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawSid := strings.TrimSpace(c.Params("sid"))
	if rawSid == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	if decoded, derr := url.PathUnescape(rawSid); derr == nil {
		rawSid = decoded
	}
	sid := strings.TrimSpace(rawSid)
	if sid == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	var in haMigrateInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid ha migrate payload"))
	}
	target := in.targetNode()
	if target == "" {
		return mw.WriteError(c, vErrField("target_node", "target_node is required"))
	}
	relocate := in.isRelocate()
	if err := ad.Client().HAResourceMigrateRelocate(c.Context(), sid, target, relocate); err != nil {
		return mw.WriteError(c, err)
	}
	action := "admin.proxmox.ha.migrate"
	if relocate {
		action = "admin.proxmox.ha.relocate"
	}
	s.admAuditMeta(c, action, "provider", &providerID, map[string]any{
		"sid": sid, "target_node": target, "relocate": relocate,
	})
	status := "migrated"
	if relocate {
		status = "relocated"
	}
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"sid":         sid,
		"target_node": target,
		"relocate":    relocate,
		"status":      status,
	}, nil)
}
