// Per-provider Proxmox clone: POST /admin/proxmox/:id/clone — VM (qemu) + LXC clone.
package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

type proxmoxCloneInput struct {
	Source     string `json:"source"`
	Name       string `json:"name"`
	ExternalID string `json:"external_id"`
	VMID       string `json:"vmid"`
	CTID       string `json:"ctid"`
}

func (in *proxmoxCloneInput) sourceID() string {
	for _, c := range []string{in.Source, in.ExternalID, in.VMID, in.CTID} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return ""
}

func (s *Server) adminProxmoxClone(c fiber.Ctx) error {
	providerID, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in proxmoxCloneInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid clone payload"))
	}
	src := in.sourceID()
	name := strings.TrimSpace(in.Name)
	if src == "" {
		return mw.WriteError(c, vErrField("source", "source (vmid or ct<vmid>) is required"))
	}
	if name == "" {
		return mw.WriteError(c, vErrField("name", "name is required"))
	}
	if len(name) > 64 {
		return mw.WriteError(c, vErrField("name", "name must be at most 64 characters"))
	}
	if err := ad.CloneVM(c.Context(), src, name); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.clone", "provider", &providerID, map[string]any{
		"source": src, "name": name,
	})
	kind := "qemu"
	if strings.HasPrefix(strings.TrimSpace(src), "ct") {
		kind = "lxc"
	}
	return mw.JSON(c, 201, fiber.Map{
		"provider_id": providerID,
		"kind":        kind,
		"source":      src,
		"name":        name,
		"status":      "cloned",
	}, nil)
}

func (s *Server) adminProxmoxCloneStatus(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	nodes, nerr := ad.Nodes(ctx)
	if nerr != nil {
		return mw.WriteError(c, nerr)
	}
	resources, rerr := ad.ClusterResources(ctx)
	if rerr != nil {
		return mw.WriteError(c, rerr)
	}
	guests := make([]map[string]any, 0)
	for _, r := range resources {
		if r.Type != "qemu" && r.Type != "lxc" {
			continue
		}
		guests = append(guests, map[string]any{
			"id":     r.ID,
			"type":   r.Type,
			"vmid":   r.VMID,
			"name":   r.Name,
			"node":   r.Node,
			"status": r.Status,
			"tags":   r.Tags,
			"pool":   r.Pool,
		})
	}
	if len(guests) > 200 {
		guests = guests[:200]
	}
	return mw.JSON(c, 200, fiber.Map{
		"nodes":   nodes,
		"guests":  guests,
		"total":   len(guests),
		"hint":    "POST /admin/proxmox/:id/clone {source, name}",
		"example": map[string]string{"source": "101", "name": "web-01-clone"},
	}, nil)
}

var _ = apperrors.CodeNotFound
