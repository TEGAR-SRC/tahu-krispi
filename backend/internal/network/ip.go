package network

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/billing"
)

// ---- IP Lists ----

type IPList struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	EntryCount  int       `json:"entry_count"`
	CreatedAt   string    `json:"created_at"`
}

type IPListEntry struct {
	ID        uuid.UUID `json:"id"`
	Type      string    `json:"type"`
	Value     string    `json:"value"`
	CreatedAt string    `json:"created_at"`
}

func (s *Service) ListIPLists(ctx context.Context, orgID uuid.UUID) ([]IPList, error) {
	rows, err := s.db.Query(ctx, `
SELECT l.id, l.name, COALESCE(l.description,''),
       (SELECT COUNT(*) FROM ip_list_entries e WHERE e.ip_list_id=l.id),
       l.created_at::text
FROM ip_lists l WHERE l.organization_id=$1 AND l.deleted_at IS NULL
ORDER BY l.created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IPList
	for rows.Next() {
		var l IPList
		if err := rows.Scan(&l.ID, &l.Name, &l.Description, &l.EntryCount, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Service) GetIPList(ctx context.Context, orgID, listID uuid.UUID) (*IPList, []IPListEntry, error) {
	var l IPList
	err := s.db.QueryRow(ctx, `
SELECT id, name, COALESCE(description,''), 0, created_at::text
FROM ip_lists WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`,
		orgID, listID).Scan(&l.ID, &l.Name, &l.Description, &l.EntryCount, &l.CreatedAt)
	if err != nil {
		if isNoRows(err) {
			return nil, nil, notFoundErr("ip list not found")
		}
		return nil, nil, err
	}
	rows, err := s.db.Query(ctx, `
SELECT id,
       CASE WHEN family(network)=4 THEN 'ipv4' ELSE 'ipv6' END,
       network::text, created_at::text
FROM ip_list_entries WHERE ip_list_id=$1 ORDER BY created_at DESC`, listID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var entries []IPListEntry
	for rows.Next() {
		var e IPListEntry
		if err := rows.Scan(&e.ID, &e.Type, &e.Value, &e.CreatedAt); err != nil {
			return nil, nil, err
		}
		entries = append(entries, e)
	}
	l.EntryCount = len(entries)
	return &l, entries, rows.Err()
}

func (s *Service) CreateIPList(ctx context.Context, orgID uuid.UUID, name, description string) (*IPList, error) {
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO ip_lists(organization_id, provider_id, name, description)
VALUES ($1,$2,$3,NULLIF($4,''))
RETURNING id, name, COALESCE(description,''), 0, created_at::text`,
		orgID, providerID, name, description)
	var l IPList
	if err := row.Scan(&l.ID, &l.Name, &l.Description, &l.EntryCount, &l.CreatedAt); err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *Service) UpdateIPList(ctx context.Context, orgID, listID uuid.UUID, name, description string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE ip_lists SET name=COALESCE(NULLIF($3,''), name),
                    description=COALESCE(NULLIF($4,''), description)
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, listID, name, description)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("ip list not found")
	}
	return nil
}

func (s *Service) DeleteIPList(ctx context.Context, orgID, listID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE ip_lists SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, listID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("ip list not found")
	}
	return nil
}

func (s *Service) AddIPListEntry(ctx context.Context, orgID, listID uuid.UUID, value, desc string) (*IPListEntry, error) {
	if err := validateCIDR(value); err != nil {
		return nil, invalidField("value", "invalid IP or CIDR (the /0 prefix is not allowed)")
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO ip_list_entries(ip_list_id, network, description)
SELECT $1, $2::cidr, NULLIF($3,'')
FROM ip_lists WHERE id=$1 AND organization_id=$4 AND deleted_at IS NULL
RETURNING id,
          CASE WHEN family(network)=4 THEN 'ipv4' ELSE 'ipv6' END,
          network::text, created_at::text`,
		listID, value, desc, orgID)
	var e IPListEntry
	if err := row.Scan(&e.ID, &e.Type, &e.Value, &e.CreatedAt); err != nil {
		if isNoRows(err) {
			return nil, notFoundErr("ip list not found")
		}
		if isUnique(err, "ip_list_entries_ip_list_id_network_key") {
			return nil, conflictErr("entry already exists in this list")
		}
		return nil, err
	}
	return &e, nil
}

func (s *Service) DeleteIPListEntry(ctx context.Context, orgID, listID, entryID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
DELETE FROM ip_list_entries e USING ip_lists l
WHERE e.ip_list_id=l.id AND e.id=$2 AND l.id=$1 AND l.organization_id=$3`, listID, entryID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("ip list entry not found")
	}
	return nil
}

// ---- Reserved IPs ----

type ReservedIP struct {
	ID               uuid.UUID  `json:"id"`
	Name             string     `json:"name"`
	Address          string     `json:"ip_addr"`
	Status           string     `json:"status"`
	AttachedInstance *uuid.UUID `json:"attachment_instance"`
	CreatedAt        string     `json:"created_at"`
}

func (s *Service) ListReservedIPs(ctx context.Context, orgID uuid.UUID) ([]ReservedIP, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, COALESCE(name,''), address::text, status::text,
       attached_instance_id::text, created_at::text
FROM reserved_ips WHERE organization_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReservedIP
	for rows.Next() {
		var r ReservedIP
		var attached string
		if err := rows.Scan(&r.ID, &r.Name, &r.Address, &r.Status, &attached, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.AttachedInstance = parseUUIDPtr(attached)
		out = append(out, r)
	}
	return out, rows.Err()
}

type CreateReservedIPInput struct {
	OrganizationID uuid.UUID
	Name           string
	Address        string
	RegionID       *uuid.UUID
}

// CreateReservedIP inserts the reserved IP and, when it is billable
// (provider-reported monthly_amount or the product's default price), its
// monthly subscription in the SAME transaction — an IP without a subscription
// would silently escape renewal invoicing.
func (s *Service) CreateReservedIP(ctx context.Context, in CreateReservedIPInput) (*ReservedIP, error) {
	ip := parseIP(in.Address)
	if ip == nil {
		return nil, invalidField("address", "invalid IP address")
	}
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var r ReservedIP
	var monthlyAmount *string
	var currency string
	row := tx.QueryRow(ctx, `
INSERT INTO reserved_ips(organization_id, provider_id, name, address, region_id, status)
VALUES ($1,$2,NULLIF($3,''),$4,$5,'active')
RETURNING id, COALESCE(name,''), address::text, 'active', NULL, created_at::text,
          monthly_amount::text, COALESCE(currency::text,'')`,
		in.OrganizationID, providerID, in.Name, in.Address, nullUUID(in.RegionID))
	if err := row.Scan(&r.ID, &r.Name, &r.Address, &r.Status, new(*uuid.UUID), &r.CreatedAt,
		&monthlyAmount, &currency); err != nil {
		if isUnique(err, "reserved_ips_provider_id_address_key") {
			return nil, conflictErr("reserved IP already exists for this address")
		}
		return nil, err
	}

	subID, err := billing.AttachProductSubscription(ctx, tx, in.OrganizationID,
		billing.ProductCodeReservedIP, nullableAmount(monthlyAmount), currency)
	if err != nil {
		return nil, err
	}
	if subID != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE reserved_ips SET subscription_id=$2 WHERE id=$1`, r.ID, *subID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &r, nil
}

// nullableAmount parses an optional numeric column into a charge; absent or
// unparsable values mean "use the product default" (0).
func nullableAmount(raw *string) float64 {
	if raw == nil || *raw == "" {
		return 0
	}
	var f float64
	fmt.Sscanf(*raw, "%f", &f)
	return f
}

func (s *Service) AttachToInstance(ctx context.Context, orgID, ripID, instanceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE reserved_ips SET attached_instance_id=$3, updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, ripID, instanceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("reserved IP not found")
	}
	return nil
}

func (s *Service) DetachFromInstance(ctx context.Context, orgID, ripID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE reserved_ips SET attached_instance_id=NULL, updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, ripID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("reserved IP not found")
	}
	return nil
}

func (s *Service) Rename(ctx context.Context, orgID, ripID uuid.UUID, name string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE reserved_ips SET name=NULLIF($3,'') WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`,
		orgID, ripID, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("reserved IP not found")
	}
	return nil
}

// DeleteReservedIP soft-deletes the reserved IP and cancels its billing
// subscription in the same transaction, so a deleted IP stops renewing.
func (s *Service) DeleteReservedIP(ctx context.Context, orgID, ripID uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var subID *uuid.UUID
	err = tx.QueryRow(ctx, `
UPDATE reserved_ips SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL
RETURNING subscription_id`, orgID, ripID).Scan(&subID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundErr("reserved IP not found")
		}
		return err
	}
	if subID != nil {
		if err := billing.DetachProductSubscription(ctx, tx, *subID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ConvertPrimary converts a VM's primary IPv4 to a reserved IP.
func (s *Service) ConvertPrimary(ctx context.Context, orgID, instanceID uuid.UUID, ipAddress, name string) (*ReservedIP, error) {
	var primaryIP string
	err := s.db.QueryRow(ctx, `
SELECT primary_ipv4::text FROM instances
WHERE id=$1 AND organization_id=$2 AND primary_ipv4 IS NOT NULL AND deleted_at IS NULL`,
		instanceID, orgID).Scan(&primaryIP)
	if err != nil {
		return nil, notFoundErr("instance or primary_ipv4 not found")
	}
	if primaryIP != ipAddress {
		return nil, forbiddenErr("provided IP is not the instance's primary IPv4")
	}
	return s.CreateReservedIP(ctx, CreateReservedIPInput{
		OrganizationID: orgID,
		Name:           name,
		Address:        ipAddress,
	})
}

// ---- Reverse DNS ----

type RDNSRecord struct {
	IP     string `json:"ip"`
	Domain string `json:"domain"`
}

func (s *Service) ListRDNS(ctx context.Context, orgID, instanceID uuid.UUID) ([]RDNSRecord, error) {
	rows, err := s.db.Query(ctx, `
SELECT address::text, ptr_record FROM reverse_dns_records
WHERE organization_id=$1 AND instance_id=$2 ORDER BY created_at DESC`, orgID, instanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RDNSRecord
	for rows.Next() {
		var r RDNSRecord
		if err := rows.Scan(&r.IP, &r.Domain); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) SetRDNS(ctx context.Context, orgID, instanceID uuid.UUID, ipAddress, domain string) error {
	if parseIP(ipAddress) == nil {
		return invalidField("ip_addr", "invalid IP address")
	}
	if domain == "" || len(domain) > 255 {
		return invalidField("domain", "invalid domain")
	}
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
INSERT INTO reverse_dns_records(organization_id, provider_id, instance_id, address, ptr_record)
VALUES ($1,$2,$3,$4::inet,$5)
ON CONFLICT (provider_id, address) DO UPDATE SET ptr_record=EXCLUDED.ptr_record, updated_at=now()`,
		orgID, providerID, instanceID, ipAddress, domain)
	return err
}

func (s *Service) DeleteRDNS(ctx context.Context, orgID, instanceID uuid.UUID, ipAddress string) error {
	tag, err := s.db.Exec(ctx, `
DELETE FROM reverse_dns_records WHERE organization_id=$1 AND instance_id=$2 AND address=$3::inet`,
		orgID, instanceID, ipAddress)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("reverse DNS record not found")
	}
	return nil
}

// ---- BGP ----

func (s *Service) EnableBGP(ctx context.Context, orgID, instanceID uuid.UUID) error {
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `
INSERT INTO bgp_sessions(instance_id, provider_id, enabled, enabled_at)
SELECT $1,$2,true,now()
FROM instances WHERE id=$1 AND organization_id=$3 AND deleted_at IS NULL
ON CONFLICT (instance_id, provider_id) DO UPDATE SET enabled=true, enabled_at=now(), disabled_at=NULL`,
		instanceID, providerID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("instance not found")
	}
	return nil
}

func (s *Service) DisableBGP(ctx context.Context, orgID, instanceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE bgp_sessions b SET enabled=false, disabled_at=now()
FROM instances i
WHERE b.instance_id=i.id AND b.instance_id=$1 AND i.organization_id=$2`, instanceID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("BGP session not found")
	}
	return nil
}
