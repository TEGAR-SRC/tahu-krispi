package api

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/network"
	mw "kilat.cloud/backend/pkg/middleware"
)

type networkCreateReservedIP = network.CreateReservedIPInput

// ---- IP Lists ----

type ipListInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) handleListIPLists(c fiber.Ctx) error {
	out, err := s.networkSvc.ListIPLists(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateIPList(c fiber.Ctx) error {
	var in ipListInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" {
		return mw.WriteError(c, errValidation("name required"))
	}
	l, err := s.networkSvc.CreateIPList(c.Context(), mustOrgID(c), in.Name, in.Description)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, l, nil)
}

func (s *Server) handleGetIPList(c fiber.Ctx) error {
	listID, err := uuid.Parse(c.Params("list_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid list id"))
	}
	l, entries, err := s.networkSvc.GetIPList(c.Context(), mustOrgID(c), listID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"ip_list": l, "entries": entries}, nil)
}

func (s *Server) handleUpdateIPList(c fiber.Ctx) error {
	listID, err := uuid.Parse(c.Params("list_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid list id"))
	}
	var in ipListInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid body"))
	}
	if err := s.networkSvc.UpdateIPList(c.Context(), mustOrgID(c), listID, in.Name, in.Description); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteIPList(c fiber.Ctx) error {
	listID, err := uuid.Parse(c.Params("list_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid list id"))
	}
	if err := s.networkSvc.DeleteIPList(c.Context(), mustOrgID(c), listID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

type ipEntryInput struct {
	Value       string `json:"value"`
	Description string `json:"description"`
}

func (s *Server) handleAddIPListEntry(c fiber.Ctx) error {
	listID, err := uuid.Parse(c.Params("list_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid list id"))
	}
	var in ipEntryInput
	if err := c.Bind().Body(&in); err != nil || in.Value == "" {
		return mw.WriteError(c, errValidation("value required"))
	}
	e, err := s.networkSvc.AddIPListEntry(c.Context(), mustOrgID(c), listID, in.Value, in.Description)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, e, nil)
}

func (s *Server) handleDeleteIPListEntry(c fiber.Ctx) error {
	listID, err := uuid.Parse(c.Params("list_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid list id"))
	}
	entryID, err := uuid.Parse(c.Params("entry_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid entry id"))
	}
	if err := s.networkSvc.DeleteIPListEntry(c.Context(), mustOrgID(c), listID, entryID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

// ---- Reserved IPs ----

type reservedIPInput struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Region  string `json:"region_id"`
}

func (s *Server) handleListReservedIPs(c fiber.Ctx) error {
	out, err := s.networkSvc.ListReservedIPs(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateReservedIP(c fiber.Ctx) error {
	var in reservedIPInput
	if err := c.Bind().Body(&in); err != nil || in.Address == "" {
		return mw.WriteError(c, errValidation("address required"))
	}
	rin := networkCreateReservedIPInput(mustOrgID(c), in)
	ip, err := s.networkSvc.CreateReservedIP(c.Context(), rin)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, ip, nil)
}

func (s *Server) handleConvertReservedIP(c fiber.Ctx) error {
	var body struct {
		IPAddress string `json:"ip_address"`
		Name      string `json:"name"`
	}
	if err := c.Bind().Body(&body); err != nil || body.IPAddress == "" {
		return mw.WriteError(c, errValidation("ip_address required"))
	}
	var instanceParam struct {
		InstanceID string `json:"instance_id"`
	}
	_ = c.Bind().Body(&instanceParam)
	instanceID, err := uuid.Parse(instanceParam.InstanceID)
	if err != nil {
		return mw.WriteError(c, vErrField("instance_id", "instance_id of the VM owning this IP is required"))
	}
	ip, err := s.networkSvc.ConvertPrimary(c.Context(), mustOrgID(c), instanceID, body.IPAddress, body.Name)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, ip, nil)
}

func (s *Server) handleDeleteReservedIP(c fiber.Ctx) error {
	ripID, err := uuid.Parse(c.Params("rip_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid reserved ip id"))
	}
	if err := s.networkSvc.DeleteReservedIP(c.Context(), mustOrgID(c), ripID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

func (s *Server) handlePatchReservedIP(c fiber.Ctx) error {
	ripID, err := uuid.Parse(c.Params("rip_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid reserved ip id"))
	}
	var body struct {
		Name     string  `json:"name"`
		AnchorIP *string `json:"anchor_ip"`
	}
	if err := c.Bind().Body(&body); err != nil {
		return mw.WriteError(c, errValidation("invalid body"))
	}
	if body.AnchorIP == nil && body.Name != "" {
		if err := s.networkSvc.Rename(c.Context(), mustOrgID(c), ripID, body.Name); err != nil {
			return mw.WriteError(c, err)
		}
		return mw.JSON(c, 200, fiber.Map{"name": body.Name}, nil)
	}
	if body.AnchorIP != nil && *body.AnchorIP != "" {
		instanceID, err := uuid.Parse(*body.AnchorIP)
		if err != nil {
			return mw.WriteError(c, vErrField("anchor_ip", "must be the uuid of the VM to attach to"))
		}
		if err := s.networkSvc.AttachToInstance(c.Context(), mustOrgID(c), ripID, instanceID); err != nil {
			return mw.WriteError(c, err)
		}
		return mw.JSON(c, 200, fiber.Map{"attachment": fiber.Map{"id": instanceID}}, nil)
	}
	if err := s.networkSvc.DetachFromInstance(c.Context(), mustOrgID(c), ripID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "detached"}, nil)
}

func networkCreateReservedIPInput(orgID uuid.UUID, in reservedIPInput) networkCreateReservedIP {
	cin := networkCreateReservedIP{OrganizationID: orgID, Name: in.Name, Address: in.Address}
	if id, err := uuid.Parse(in.Region); err == nil {
		cin.RegionID = &id
	}
	return cin
}
