package api

import (
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/network"
)

func networkCreateVPCInput(orgID uuid.UUID, in vpcInput) network.CreateVPCInput {
	cin := network.CreateVPCInput{
		OrganizationID: orgID,
		Name:           in.Name,
		Description:    in.Description,
		IPv4CIDR:       in.IPv4CIDR,
	}
	if id, err := uuid.Parse(in.RegionID); err == nil {
		cin.RegionID = &id
	}
	return cin
}

func fwCreateRuleInput(orgID, fwID uuid.UUID, in firewallRuleInput) network.CreateFirewallRuleInput {
	return network.CreateFirewallRuleInput{
		FirewallGroupID: fwID,
		OrganizationID:  orgID,
		Protocol:        in.Protocol,
		PortFrom:        in.PortFrom,
		PortTo:          in.PortTo,
		SourceCidr:      in.Subnet,
		Action:          in.Action,
		Description:     in.Description,
	}
}
