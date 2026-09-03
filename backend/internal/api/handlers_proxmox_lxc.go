// Admin Proxmox direct provisioning: LXC and QEMU wrappers over
// provider.ProvisionContainer / ProvisionVM. These bypass the compute.Service
// job queue and execute synchronously against the live cluster — intended for
// platform_admin use on the per-provider /admin/proxmox/:id/* surface.
package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	"kilat.cloud/backend/internal/provider"
	mw "kilat.cloud/backend/pkg/middleware"
)

type proxmoxProvisionInput struct {
	Name     string   `json:"name"`
	Node     string   `json:"node"`
	Location string   `json:"location"`
	CPU      int64    `json:"cpu"`
	RAM      int64    `json:"ram"`
	Disk     int64    `json:"disk"`
	SSHKeys  []string `json:"ssh_keys"`
	ISO      string   `json:"iso"`
}

func (in *proxmoxProvisionInput) normalizedNode() string {
	n := strings.TrimSpace(in.Node)
	if n == "" {
		n = strings.TrimSpace(in.Location)
	}
	return n
}

func (in *proxmoxProvisionInput) validate() error {
	if strings.TrimSpace(in.Name) == "" {
		return vErrField("name", "name is required")
	}
	if in.normalizedNode() == "" {
		return vErrField("node", "node (or location) is required")
	}
	if in.CPU <= 0 {
		return vErrField("cpu", "cpu must be positive")
	}
	if in.RAM <= 0 {
		return vErrField("ram", "ram must be positive")
	}
	if in.Disk <= 0 {
		return vErrField("disk", "disk must be positive")
	}
	return nil
}

func (s *Server) adminProxmoxProvisionLXC(c fiber.Ctx) error {
	providerID, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in proxmoxProvisionInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid lxc provision payload"))
	}
	if err := in.validate(); err != nil {
		return mw.WriteError(c, err)
	}
	spec := provider.InstanceSpec{
		Name:     strings.TrimSpace(in.Name),
		Location: in.normalizedNode(),
		CPU:      in.CPU,
		RAM:      in.RAM,
		Disk:     in.Disk,
		SSHKeyIDs: in.SSHKeys,
	}
	if err := ad.ProvisionContainer(c.Context(), spec); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.provision_lxc", "provider", &providerID, map[string]any{
		"name": spec.Name, "node": spec.Location, "cpu": spec.CPU, "ram": spec.RAM, "disk": spec.Disk,
	})
	return mw.JSON(c, 201, fiber.Map{
		"provider_id": providerID,
		"kind":        "lxc",
		"name":        spec.Name,
		"node":        spec.Location,
		"status":      "provisioned",
	}, nil)
}

func (s *Server) adminProxmoxProvisionQEMU(c fiber.Ctx) error {
	providerID, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in proxmoxProvisionInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid qemu provision payload"))
	}
	if err := in.validate(); err != nil {
		return mw.WriteError(c, err)
	}
	spec := provider.InstanceSpec{
		Name:          strings.TrimSpace(in.Name),
		Location:      in.normalizedNode(),
		CPU:           in.CPU,
		RAM:           in.RAM,
		Disk:          in.Disk,
		SSHKeyIDs:     in.SSHKeys,
		IsoExternalID: strings.TrimSpace(in.ISO),
	}
	if err := ad.ProvisionVM(c.Context(), spec); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.proxmox.provision_qemu", "provider", &providerID, map[string]any{
		"name": spec.Name, "node": spec.Location, "cpu": spec.CPU, "ram": spec.RAM, "disk": spec.Disk,
	})
	return mw.JSON(c, 201, fiber.Map{
		"provider_id": providerID,
		"kind":        "qemu",
		"name":        spec.Name,
		"node":        spec.Location,
		"status":      "provisioned",
	}, nil)
}
