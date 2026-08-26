package api

import (
	"net/url"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- VPC ----

type vpcInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IPv4CIDR    string `json:"ipv4_cidr"`
	RegionID    string `json:"region_id"`
}

func (s *Server) handleListVPCs(c fiber.Ctx) error {
	out, err := s.networkSvc.ListVPCs(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateVPC(c fiber.Ctx) error {
	var in vpcInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" || in.IPv4CIDR == "" {
		return mw.WriteError(c, errValidation("name and ipv4_cidr required"))
	}
	vpc, err := s.networkSvc.CreateVPC(c.Context(), networkCreateVPCInput(mustOrgID(c), in))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, vpc, nil)
}

func (s *Server) handleUpdateVPC(c fiber.Ctx) error {
	vpcID, err := uuid.Parse(c.Params("vpc_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid vpc id"))
	}
	var in vpcInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid body"))
	}
	if err := s.networkSvc.UpdateVPC(c.Context(), mustOrgID(c), vpcID, in.Name, in.Description); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteVPC(c fiber.Ctx) error {
	vpcID, err := uuid.Parse(c.Params("vpc_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid vpc id"))
	}
	if err := s.networkSvc.DeleteVPC(c.Context(), mustOrgID(c), vpcID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

// ---- Firewall ----

type firewallInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) handleListFirewalls(c fiber.Ctx) error {
	out, err := s.networkSvc.ListFirewallGroups(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateFirewall(c fiber.Ctx) error {
	var in firewallInput
	if err := c.Bind().Body(&in); err != nil || in.Description == "" && in.Name == "" {
		return mw.WriteError(c, errValidation("name or description required"))
	}
	name := in.Name
	if name == "" {
		name = "firewall"
	}
	g, err := s.networkSvc.CreateFirewallGroup(c.Context(), mustOrgID(c), name, in.Description)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, g, nil)
}

func (s *Server) handleUpdateFirewall(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	var in firewallInput
	if err := c.Bind().Body(&in); err != nil || in.Description == "" {
		return mw.WriteError(c, errValidation("description required"))
	}
	if err := s.networkSvc.UpdateFirewallGroup(c.Context(), mustOrgID(c), fwID, in.Description); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteFirewall(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	if err := s.networkSvc.DeleteFirewallGroup(c.Context(), mustOrgID(c), fwID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

type firewallRuleInput struct {
	Protocol    string `json:"protocol"`
	PortFrom    int    `json:"port_from"`
	PortTo      int    `json:"port_to"`
	Port        string `json:"port"`
	Subnet      string `json:"subnet"`
	Description string `json:"desc"`
	Action      string `json:"action"`
}

func (s *Server) handleListFirewallRules(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	out, err := s.networkSvc.ListFirewallRules(c.Context(), mustOrgID(c), fwID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateFirewallRule(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	var in firewallRuleInput
	if err := c.Bind().Body(&in); err != nil || in.Protocol == "" || in.Subnet == "" {
		return mw.WriteError(c, errValidation("protocol and subnet required"))
	}
	rule, err := s.networkSvc.CreateFirewallRule(c.Context(), fwCreateRuleInput(mustOrgID(c), fwID, in))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, rule, nil)
}

func (s *Server) handleUpdateFirewallRule(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	ruleID, err := uuid.Parse(c.Params("rule_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid rule id"))
	}
	var body struct {
		Desc string `json:"desc"`
	}
	if err := c.Bind().Body(&body); err != nil || len(body.Desc) > 255 {
		return mw.WriteError(c, errValidation("desc required (max 255 chars)"))
	}
	if err := s.networkSvc.UpdateFirewallRuleDescription(c.Context(), mustOrgID(c), fwID, ruleID, body.Desc); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteFirewallRule(c fiber.Ctx) error {
	fwID, err := uuid.Parse(c.Params("firewall_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid firewall id"))
	}
	ruleID, err := uuid.Parse(c.Params("rule_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid rule id"))
	}
	if err := s.networkSvc.DeleteFirewallRule(c.Context(), mustOrgID(c), fwID, ruleID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

func (s *Server) handleListRDNS(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	out, err := s.networkSvc.ListRDNS(c.Context(), mustOrgID(c), instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleSetRDNS(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var body struct {
		IPAddr string `json:"ip_addr"`
		Domain string `json:"domain"`
	}
	if err := c.Bind().Body(&body); err != nil || body.IPAddr == "" || body.Domain == "" {
		return mw.WriteError(c, errValidation("ip_addr and domain required"))
	}
	if err := s.networkSvc.SetRDNS(c.Context(), mustOrgID(c), instanceID, body.IPAddr, body.Domain); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "set"}, nil)
}

func (s *Server) handleDeleteRDNS(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	ipAddr := c.Params("*")
	// Wildcard segments arrive percent-encoded when the value contains "/"
	// (CIDR notation); decode before validation.
	if decoded, decErr := url.PathUnescape(ipAddr); decErr == nil && decoded != "" {
		ipAddr = decoded
	}
	if ipAddr == "" {
		return mw.WriteError(c, errValidation("ip_addr path param required"))
	}
	if err := s.networkSvc.DeleteRDNS(c.Context(), mustOrgID(c), instanceID, ipAddr); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

func (s *Server) handleEnableBGP(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	if err := s.networkSvc.EnableBGP(c.Context(), mustOrgID(c), instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "enabled"}, nil)
}

func (s *Server) handleDisableBGP(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	if err := s.networkSvc.DisableBGP(c.Context(), mustOrgID(c), instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "disabled"}, nil)
}
