// Package catalog implements products, plans, regions, instance types, OS templates, SSH keys, startup scripts.
package catalog

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ---- Region / instance type / OS template (read-only catalogs) ----

type Region struct {
	ID      uuid.UUID `json:"id"`
	Code    string    `json:"code"`
	Name    string    `json:"name"`
	Country string    `json:"country_code"`
	City    string    `json:"city"`
	Enabled bool      `json:"enabled"`
}

func (s *Service) ListRegions(ctx context.Context) ([]Region, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, code::text, name, COALESCE(country_code,''), COALESCE(city,''), enabled
FROM regions WHERE enabled ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Region
	for rows.Next() {
		var r Region
		if err := rows.Scan(&r.ID, &r.Code, &r.Name, &r.Country, &r.City, &r.Enabled); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type InstanceType struct {
	ID          uuid.UUID `json:"id"`
	ExternalID  string    `json:"external_id"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	MaxVCPU     int       `json:"max_vcpu"`
	MaxRAMMB    int       `json:"max_ram_mb"`
	MaxDiskGB   int       `json:"max_disk_gb"`
	NetworkRate float64   `json:"network_rate"`
}

func (s *Service) ListInstanceTypes(ctx context.Context) ([]InstanceType, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, external_id, name, COALESCE(category,''),
       COALESCE(max_vcpu,0), COALESCE(max_ram_mb,0), COALESCE(max_disk_gb,0),
       COALESCE((provider_payload->>'network_rate_mbps')::numeric, 0)
FROM instance_types WHERE enabled ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InstanceType
	for rows.Next() {
		var it InstanceType
		if err := rows.Scan(&it.ID, &it.ExternalID, &it.Name, &it.Category,
			&it.MaxVCPU, &it.MaxRAMMB, &it.MaxDiskGB, &it.NetworkRate); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

type OSTemplate struct {
	ID         uuid.UUID `json:"id"`
	ExternalID string    `json:"external_id"`
	Name       string    `json:"name"`
	Family     string    `json:"family"`
	Version    string    `json:"version"`
	Arch       string    `json:"architecture"`
	MinDiskGB  int       `json:"min_disk_gb"`
}

func (s *Service) ListOSTemplates(ctx context.Context) ([]OSTemplate, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, external_id, name, COALESCE(family,''), COALESCE(version,''), COALESCE(architecture,''), COALESCE(min_disk_gb,0)
FROM os_templates WHERE enabled ORDER BY family, version`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OSTemplate
	for rows.Next() {
		var t OSTemplate
		if err := rows.Scan(&t.ID, &t.ExternalID, &t.Name, &t.Family, &t.Version, &t.Arch, &t.MinDiskGB); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ---- Plans ----

type Plan struct {
	ID            uuid.UUID       `json:"id"`
	Code          string          `json:"code"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	ProductID     uuid.UUID       `json:"product_id"`
	PriceMode     string          `json:"price_mode"`
	Vcpu          *int            `json:"vcpu"`
	RamMB         *int            `json:"ram_mb"`
	DiskGB        *int            `json:"disk_gb"`
	BandwidthGB   *int64          `json:"bandwidth_gb"`
	IPv4Count     int             `json:"ipv4_count"`
	IPv6Count     int             `json:"ipv6_count"`
	BackupSlots   int             `json:"backup_slots"`
	SnapshotSlots int             `json:"snapshot_slots"`
	Featured      bool            `json:"featured"`
	Metadata      json.RawMessage `json:"metadata"`
}

func (s *Service) ListPlans(ctx context.Context) ([]Plan, error) {
	rows, err := s.db.Query(ctx, `
SELECT p.id, p.code::text, p.name, COALESCE(p.description,''), p.product_id, p.price_mode::text,
       p.vcpu, p.ram_mb, p.disk_gb, p.bandwidth_gb,
       p.ipv4_count, p.ipv6_count, p.backup_slots, p.snapshot_slots, p.featured, p.metadata
FROM plans p JOIN products pr ON pr.id=p.product_id AND pr.enabled
WHERE p.enabled ORDER BY pr.sort_order, p.sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Plan
	for rows.Next() {
		var pl Plan
		if err := rows.Scan(&pl.ID, &pl.Code, &pl.Name, &pl.Description, &pl.ProductID, &pl.PriceMode,
			&pl.Vcpu, &pl.RamMB, &pl.DiskGB, &pl.BandwidthGB,
			&pl.IPv4Count, &pl.IPv6Count, &pl.BackupSlots, &pl.SnapshotSlots, &pl.Featured, &pl.Metadata); err != nil {
			return nil, err
		}
		out = append(out, pl)
	}
	return out, rows.Err()
}

func (s *Service) GetPlan(ctx context.Context, planID uuid.UUID) (*Plan, error) {
	row := s.db.QueryRow(ctx, `
SELECT id, code::text, name, COALESCE(description,''), product_id, price_mode::text,
       vcpu, ram_mb, disk_gb, bandwidth_gb,
       ipv4_count, ipv6_count, backup_slots, snapshot_slots, featured, metadata
FROM plans WHERE id=$1 AND enabled`, planID)
	var pl Plan
	err := row.Scan(&pl.ID, &pl.Code, &pl.Name, &pl.Description, &pl.ProductID, &pl.PriceMode,
		&pl.Vcpu, &pl.RamMB, &pl.DiskGB, &pl.BandwidthGB,
		&pl.IPv4Count, &pl.IPv6Count, &pl.BackupSlots, &pl.SnapshotSlots, &pl.Featured, &pl.Metadata)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodePlanUnavailable, "plan not found or unavailable")
	}
	if err != nil {
		return nil, err
	}
	return &pl, nil
}

// ---- SSH Keys ----

type SSHKey struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	PublicKey   string    `json:"public_key"`
	Fingerprint string    `json:"fingerprint"`
	CreatedAt   string    `json:"created_at"`
}

func (s *Service) ListSSHKeys(ctx context.Context, orgID uuid.UUID) ([]SSHKey, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, name, public_key, COALESCE(fingerprint,''), created_at::text
FROM ssh_keys WHERE organization_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SSHKey
	for rows.Next() {
		var k SSHKey
		if err := rows.Scan(&k.ID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

type CreateSSHKeyInput struct {
	OrganizationID uuid.UUID
	CreatedBy      uuid.UUID
	Name           string
	PublicKey      string
}

func fingerprintOf(pub string) string { return sshFingerprintSHA256(pub) }

func (s *Service) CreateSSHKey(ctx context.Context, in CreateSSHKeyInput) (*SSHKey, error) {
	fp := fingerprintOf(in.PublicKey)
	if fp == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "invalid SSH public key")
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO ssh_keys(organization_id, name, public_key, fingerprint, created_by)
VALUES ($1,$2,$3,$4,$5)
RETURNING id, name, public_key, fingerprint, created_at::text`,
		in.OrganizationID, in.Name, in.PublicKey, fp, in.CreatedBy)
	var k SSHKey
	err := row.Scan(&k.ID, &k.Name, &k.PublicKey, &k.Fingerprint, &k.CreatedAt)
	if err != nil && isUniqueViolation(err, "ux_ssh_keys_org_fingerprint") {
		return nil, apperrors.New(apperrors.CodeConflict, "ssh key with same fingerprint already exists")
	}
	if err != nil {
		return nil, err
	}
	return &k, nil
}

func (s *Service) UpdateSSHKey(ctx context.Context, orgID, keyID uuid.UUID, name, publicKey string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE ssh_keys SET name=$3, public_key=$4, fingerprint=$5, updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`,
		orgID, keyID, name, publicKey, fingerprintOf(publicKey))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "ssh key not found")
	}
	return nil
}

func (s *Service) DeleteSSHKey(ctx context.Context, orgID, keyID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE ssh_keys SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, keyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "ssh key not found")
	}
	return nil
}

// ---- Startup scripts ----

type StartupScript struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Content       string    `json:"content"`
	ContentSHA256 string    `json:"content_sha256"`
	CreatedAt     string    `json:"created_at"`
}

const maxStartupScriptBytes = 48000

func (s *Service) ListStartupScripts(ctx context.Context, orgID uuid.UUID) ([]StartupScript, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, name, content, COALESCE(content_sha256,''), created_at::text
FROM startup_scripts WHERE organization_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StartupScript
	for rows.Next() {
		var sc StartupScript
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Content, &sc.ContentSHA256, &sc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

type CreateStartupScriptInput struct {
	OrganizationID uuid.UUID
	CreatedBy      uuid.UUID
	Name           string
	Content        string
}

const maxStartupScriptsPerOrg = 10

func (s *Service) CreateStartupScript(ctx context.Context, in CreateStartupScriptInput) (*StartupScript, error) {
	if len(in.Content) > maxStartupScriptBytes {
		return nil, apperrors.New(apperrors.CodeValidation, "script content too large")
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var count int
	if err := tx.QueryRow(ctx, `
SELECT count(*) FROM startup_scripts WHERE organization_id=$1 AND deleted_at IS NULL`, in.OrganizationID).Scan(&count); err != nil {
		return nil, err
	}
	if count >= maxStartupScriptsPerOrg {
		return nil, apperrors.New(apperrors.CodeLimitExceeded, "maximum startup scripts per organization reached")
	}
	sha := sha256HexStr(in.Content)
	row := tx.QueryRow(ctx, `
INSERT INTO startup_scripts(organization_id, name, content, content_sha256, created_by)
VALUES ($1,$2,$3,$4,$5)
RETURNING id, name, content, content_sha256, created_at::text`,
		in.OrganizationID, in.Name, in.Content, sha, in.CreatedBy)
	var sc StartupScript
	if err := row.Scan(&sc.ID, &sc.Name, &sc.Content, &sc.ContentSHA256, &sc.CreatedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &sc, nil
}

func (s *Service) UpdateStartupScript(ctx context.Context, orgID, scriptID uuid.UUID, name, content string) error {
	if len(content) > maxStartupScriptBytes {
		return apperrors.New(apperrors.CodeValidation, "script content too large")
	}
	tag, err := s.db.Exec(ctx, `
UPDATE startup_scripts SET name=$3, content=$4, content_sha256=$5, updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`,
		orgID, scriptID, name, content, sha256HexStr(content))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "startup script not found")
	}
	return nil
}

func (s *Service) DeleteStartupScript(ctx context.Context, orgID, scriptID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE startup_scripts SET deleted_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL`, orgID, scriptID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "startup script not found")
	}
	return nil
}

func isUniqueViolation(err error, constraint string) bool {
	if err == nil || constraint == "" {
		return false
	}
	s := err.Error()
	n := len(constraint)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == constraint {
			return true
		}
	}
	return false
}
