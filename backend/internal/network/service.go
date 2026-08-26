// Package network implements VPC, firewall, IP lists, reserved IPs, and reverse DNS.
package network

import (
	"context"
	"net"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func (s *Service) resolveProvider(ctx context.Context) (uuid.UUID, error) {
	var pid uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM providers WHERE kind='onidel' AND enabled LIMIT 1`).Scan(&pid)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeProviderUnavailable, "onidel provider not configured")
	}
	return pid, nil
}

// ---- VPC ----

type VPC struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	IPv4CIDR    string    `json:"ipv4_cidr"`
	CreatedAt   string    `json:"created_at"`
}

const selectVPCCols = `
SELECT id, name, COALESCE(description,''), status::text, COALESCE(ipv4_cidr::text,''), created_at::text
FROM vpcs WHERE deleted_at IS NULL AND organization_id=$1`

func (s *Service) ListVPCs(ctx context.Context, orgID uuid.UUID) ([]VPC, error) {
	rows, err := s.db.Query(ctx, selectVPCCols+` ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VPC
	for rows.Next() {
		var v VPC
		if err := rows.Scan(&v.ID, &v.Name, &v.Description, &v.Status, &v.IPv4CIDR, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

type CreateVPCInput struct {
	OrganizationID uuid.UUID
	Name           string
	Description    string
	IPv4CIDR       string
	RegionID       *uuid.UUID
}

func (s *Service) CreateVPC(ctx context.Context, in CreateVPCInput) (*VPC, error) {
	if _, _, err := net.ParseCIDR(in.IPv4CIDR); err != nil {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid ipv4_cidr"),
			map[string]string{"ipv4_cidr": err.Error()})
	}
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO vpcs(organization_id, provider_id, region_id, name, description, ipv4_cidr, status)
VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,'active')
RETURNING id, name, COALESCE(description,''), 'active', ipv4_cidr::text, created_at::text`,
		in.OrganizationID, providerID, nullUUID(in.RegionID), in.Name, in.Description, in.IPv4CIDR)
	var v VPC
	if err := row.Scan(&v.ID, &v.Name, &v.Description, &v.Status, &v.IPv4CIDR, &v.CreatedAt); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) UpdateVPC(ctx context.Context, orgID, vpcID uuid.UUID, name, description string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE vpcs SET name=COALESCE(NULLIF($3,''), name),
                description=COALESCE(NULLIF($4,''), description)
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, vpcID, name, description)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "vpc not found")
	}
	return nil
}

func (s *Service) DeleteVPC(ctx context.Context, orgID, vpcID uuid.UUID) error {
	var attached int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM vpc_instance_links WHERE vpc_id=$1 AND detached_at IS NULL`, vpcID).Scan(&attached); err != nil {
		return err
	}
	if attached > 0 {
		return apperrors.New(apperrors.CodeConflict, "VPC still has attached VMs")
	}
	tag, err := s.db.Exec(ctx, `
UPDATE vpcs SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, vpcID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "vpc not found")
	}
	return nil
}

// AttachInstance links a VM to a VPC.
func (s *Service) AttachInstance(ctx context.Context, orgID, vpcID, instanceID uuid.UUID, privateIP string) error {
	var ownerOrg uuid.UUID
	err := s.db.QueryRow(ctx, `
SELECT organization_id FROM instances WHERE id=$1 AND deleted_at IS NULL`, instanceID).Scan(&ownerOrg)
	if err != nil {
		return apperrors.New(apperrors.CodeNotFound, "instance not found")
	}
	if ownerOrg != orgID {
		return apperrors.New(apperrors.CodeForbidden, "instance not owned by this organization")
	}
	tag, err := s.db.Exec(ctx, `
INSERT INTO vpc_instance_links(vpc_id, instance_id, private_ip)
VALUES ($1,$2,NULLIF($3,'')::inet)`, vpcID, instanceID, privateIP)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeConflict, "already attached")
	}
	return nil
}

func (s *Service) DetachInstance(ctx context.Context, orgID, vpcID, instanceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE vpc_instance_links SET detached_at=now()
WHERE vpc_id=$1 AND instance_id=$2 AND detached_at IS NULL`, vpcID, instanceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "link not found or already detached")
	}
	return nil
}

// ---- Firewall ----

type FirewallGroup struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	InstanceCount int       `json:"instance_count"`
	RuleCount     int       `json:"rule_count"`
	CreatedAt     string    `json:"created_at"`
}

const selectFWCols = `
SELECT f.id, f.name, COALESCE(f.description,''),
       (SELECT COUNT(*) FROM firewall_instance_links l WHERE l.firewall_group_id=f.id AND l.detached_at IS NULL),
       (SELECT COUNT(*) FROM firewall_rules r WHERE r.firewall_group_id=f.id),
       f.created_at::text
FROM firewall_groups f WHERE f.deleted_at IS NULL AND f.organization_id=$1`

func (s *Service) ListFirewallGroups(ctx context.Context, orgID uuid.UUID) ([]FirewallGroup, error) {
	rows, err := s.db.Query(ctx, selectFWCols+` ORDER BY f.created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FirewallGroup
	for rows.Next() {
		var g FirewallGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.InstanceCount, &g.RuleCount, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Service) CreateFirewallGroup(ctx context.Context, orgID uuid.UUID, name, description string) (*FirewallGroup, error) {
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO firewall_groups(organization_id, provider_id, name, description)
VALUES ($1,$2,$3,NULLIF($4,''))
RETURNING id, name, COALESCE(description,''), 0, 0, created_at::text`,
		orgID, providerID, name, description)
	var g FirewallGroup
	if err := row.Scan(&g.ID, &g.Name, &g.Description, &g.InstanceCount, &g.RuleCount, &g.CreatedAt); err != nil {
		return nil, err
	}
	return &g, nil
}

func (s *Service) UpdateFirewallGroup(ctx context.Context, orgID, fwID uuid.UUID, description string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE firewall_groups SET description=NULLIF($3,'') WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`,
		orgID, fwID, description)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "firewall group not found")
	}
	return nil
}

func (s *Service) DeleteFirewallGroup(ctx context.Context, orgID, fwID uuid.UUID) error {
	var attached int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM firewall_instance_links WHERE firewall_group_id=$1 AND detached_at IS NULL`, fwID).Scan(&attached); err != nil {
		return err
	}
	if attached > 0 {
		return apperrors.New(apperrors.CodeConflict, "cannot delete: VMs still attached to this firewall group")
	}
	tag, err := s.db.Exec(ctx, `
UPDATE firewall_groups SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, fwID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "firewall group not found")
	}
	return nil
}

type FirewallRule struct {
	ID              uuid.UUID `json:"id"`
	FirewallGroupID uuid.UUID `json:"group"`
	Direction       string    `json:"direction"`
	Protocol        string    `json:"protocol"`
	PortFrom        int       `json:"port_from"`
	PortTo          int       `json:"port_to"`
	SourceCidr      string    `json:"subnet"`
	Action          string    `json:"action"`
	Description     string    `json:"desc"`
}

const validProtocolsMap = "tcp,udp,icmp,ipv6-icmp"

type CreateFirewallRuleInput struct {
	FirewallGroupID uuid.UUID
	OrganizationID  uuid.UUID
	Protocol        string
	PortFrom        int
	PortTo          int
	SourceCidr      string
	Action          string
	Description     string
}

func (s *Service) CreateFirewallRule(ctx context.Context, in CreateFirewallRuleInput) (*FirewallRule, error) {
	switch in.Protocol {
	case "tcp", "udp", "icmp", "ipv6-icmp":
	default:
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid protocol"),
			map[string]string{"protocol": "must be tcp/udp/icmp/ipv6-icmp"})
	}
	if in.SourceCidr != "" {
		if _, _, err := net.ParseCIDR(in.SourceCidr); err != nil && net.ParseIP(in.SourceCidr) == nil {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, "invalid subnet"),
				map[string]string{"subnet": err.Error()})
		}
	}
	if in.PortFrom < 0 || in.PortFrom > 65535 || in.PortTo < 0 || in.PortTo > 65535 || (in.PortTo > 0 && in.PortTo < in.PortFrom) {
		return nil, apperrors.New(apperrors.CodeValidation, "invalid port range")
	}
	if in.Action == "" {
		in.Action = "allow"
	}
	direction := "inbound"
	if in.Protocol == "ipv6-icmp" {
		direction = "ingress"
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO firewall_rules(firewall_group_id, direction, protocol, port_from, port_to,
                           source_cidr, action, description)
SELECT $1,$2,$3,NULLIF($4,0),NULLIF($5,0),NULLIF($6,'')::cidr,$7,NULLIF($8,'')
FROM firewall_groups WHERE id=$1 AND organization_id=$9 AND deleted_at IS NULL
RETURNING id, firewall_group_id, direction::text, protocol, COALESCE(port_from,0), COALESCE(port_to,0),
          COALESCE(source_cidr::text,''), action, COALESCE(description,'')`,
		in.FirewallGroupID, direction, in.Protocol, in.PortFrom, in.PortTo,
		in.SourceCidr, in.Action, in.Description, in.OrganizationID)
	var r FirewallRule
	if err := row.Scan(&r.ID, &r.FirewallGroupID, &r.Direction, &r.Protocol,
		&r.PortFrom, &r.PortTo, &r.SourceCidr, &r.Action, &r.Description); err != nil {
		if isNoRows(err) {
			return nil, apperrors.New(apperrors.CodeNotFound, "firewall group not found")
		}
		return nil, err
	}
	r.Description = in.Description
	return &r, nil
}

func (s *Service) ListFirewallRules(ctx context.Context, orgID, fwID uuid.UUID) ([]FirewallRule, error) {
	rows, err := s.db.Query(ctx, `
SELECT r.id, r.firewall_group_id, r.direction::text, r.protocol,
       COALESCE(r.port_from,0), COALESCE(r.port_to,0),
       COALESCE(r.source_cidr::text,''), r.action, COALESCE(r.description,'')
FROM firewall_rules r JOIN firewall_groups f ON f.id=r.firewall_group_id
WHERE f.organization_id=$1 AND f.id=$2 AND f.deleted_at IS NULL
ORDER BY r.created_at DESC`, orgID, fwID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FirewallRule
	for rows.Next() {
		var r FirewallRule
		if err := rows.Scan(&r.ID, &r.FirewallGroupID, &r.Direction, &r.Protocol,
			&r.PortFrom, &r.PortTo, &r.SourceCidr, &r.Action, &r.Description); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) UpdateFirewallRuleDescription(ctx context.Context, orgID, fwID, ruleID uuid.UUID, desc string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE firewall_rules SET description=$3 WHERE id=$2 AND firewall_group_id IN (
  SELECT id FROM firewall_groups WHERE organization_id=$1 AND id=$4 AND deleted_at IS NULL)`,
		orgID, ruleID, desc, fwID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "firewall rule not found")
	}
	return nil
}

func (s *Service) DeleteFirewallRule(ctx context.Context, orgID, fwID, ruleID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
DELETE FROM firewall_rules WHERE id=$2 AND firewall_group_id IN (
  SELECT id FROM firewall_groups WHERE organization_id=$1 AND id=$3 AND deleted_at IS NULL)`,
		orgID, ruleID, fwID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "firewall rule not found")
	}
	return nil
}

func isNoRows(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	target := "no rows in result set"
	n := len(target)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == target {
			return true
		}
	}
	return false
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}
