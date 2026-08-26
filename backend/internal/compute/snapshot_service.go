package compute

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/pricing"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

// Snapshot represents a VM snapshot.
type Snapshot struct {
	ID        uuid.UUID `json:"id"`
	PublicID  string    `json:"public_id"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	SizeBytes int64     `json:"size"`
	CreatedAt string    `json:"created_at"`
}

// NewServiceWithBaseURL behaves like NewService but overrides the public
// download host used by GenerateSnapshotDownloadLink/GenerateBackupDownloadLink
// (e.g. cfg.DownloadBaseURL). Existing NewService callers stay compatible.
func NewServiceWithBaseURL(db *pgxpool.Pool, prov provider.ComputeProvider, baseURL string) *Service {
	s := NewService(db, prov, pricing.NewService(db))
	if baseURL != "" {
		s.baseURL = strings.TrimRight(baseURL, "/")
	}
	return s
}

func jsonMarshal(m map[string]any) []byte {
	b, _ := json.Marshal(m)
	return b
}

// CreateSnapshot creates a snapshot record and enqueues the provider call via a job.
func (s *Service) CreateSnapshot(ctx context.Context, instanceID, orgID, userID uuid.UUID, name, desc string) (*Snapshot, error) {
	if _, err := s.GetByIDAndOrg(ctx, instanceID, orgID); err != nil {
		return nil, err
	}
	var snapID uuid.UUID
	var publicID string
	err := s.db.QueryRow(ctx, `
INSERT INTO snapshots(organization_id, provider_id, instance_id, name, description, status)
SELECT $1, i.provider_id, i.id, $2, NULLIF($3,''), 'pending'
FROM instances i WHERE i.id=$4 AND i.organization_id=$5 AND i.deleted_at IS NULL
RETURNING id, public_id`,
		orgID, name, desc, instanceID, orgID).Scan(&snapID, &publicID)
	if err != nil {
		return nil, fmt.Errorf("insert snapshot: %w", err)
	}
	payload := jsonMarshal(map[string]any{
		"snapshot_id": snapID.String(), "instance_id": instanceID.String(),
	})
	if _, err := s.db.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('provisioning','create_snapshot','snapshot',$1,$2::jsonb)`, snapID, payload); err != nil {
		return nil, err
	}
	return &Snapshot{ID: snapID, PublicID: publicID, Name: name, Status: "pending"}, nil
}

func (s *Service) ListSnapshots(ctx context.Context, orgID uuid.UUID) ([]Snapshot, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, public_id, name, status::text, COALESCE(size_bytes,0), created_at::text
FROM snapshots WHERE deleted_at IS NULL AND organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Snapshot
	for rows.Next() {
		var sn Snapshot
		var sizeStr string
		if err := rows.Scan(&sn.ID, &sn.PublicID, &sn.Name, &sn.Status, &sizeStr, &sn.CreatedAt); err != nil {
			return nil, err
		}
		fmt.Sscanf(sizeStr, "%f", new(float64))
		out = append(out, sn)
	}
	return out, rows.Err()
}

func (s *Service) DeleteSnapshot(ctx context.Context, snapshotID, orgID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE snapshots SET deleted_at=now() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
		snapshotID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "snapshot not found")
	}
	return nil
}

// RestoreFromSnapshot enqueues a restore job.
func (s *Service) RestoreFromSnapshot(ctx context.Context, instanceID, snapshotID, orgID uuid.UUID) error {
	if _, err := s.GetByIDAndOrg(ctx, instanceID, orgID); err != nil {
		return err
	}
	payload := jsonMarshal(map[string]any{
		"instance_id": instanceID.String(), "snapshot_id": snapshotID.String(),
	})
	_, err := s.db.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('provisioning','restore_snapshot','instance',$1,$2::jsonb)`, instanceID, payload)
	return err
}

// RestoreFromBackup enqueues a backup restore job.
func (s *Service) RestoreFromBackup(ctx context.Context, instanceID, backupID, orgID uuid.UUID) error {
	if _, err := s.GetByIDAndOrg(ctx, instanceID, orgID); err != nil {
		return err
	}
	payload := jsonMarshal(map[string]any{
		"instance_id": instanceID.String(), "backup_id": backupID.String(),
	})
	_, err := s.db.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('provisioning','restore_backup','instance',$1,$2::jsonb)`, instanceID, payload)
	return err
}

// Backup represents a VM backup.
type Backup struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	SizeBytes  int64     `json:"size"`
	InstanceID uuid.UUID `json:"instance_id"`
	CreatedAt  string    `json:"created_at"`
}

func parseUUIDOr(s string) uuid.UUID { id, _ := uuid.Parse(s); return id }

// ListBackups returns backups belonging to an organization.
func (s *Service) ListBackups(ctx context.Context, orgID uuid.UUID) ([]Backup, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, COALESCE(name,''), status::text, COALESCE(size_bytes,0)::text,
       COALESCE(instance_id::text,''), created_at::text
FROM backups WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Backup
	for rows.Next() {
		var b Backup
		var sizeStr, instStr string
		if err := rows.Scan(&b.ID, &b.Name, &b.Status, &sizeStr, &instStr, &b.CreatedAt); err != nil {
			return nil, err
		}
		b.InstanceID = parseUUIDOr(instStr)
		fmt.Sscanf(sizeStr, "%d", &b.SizeBytes)
		out = append(out, b)
	}
	return out, rows.Err()
}

// GenerateSnapshotDownloadLink returns a short-lived download URL for a snapshot.
func (s *Service) GenerateSnapshotDownloadLink(ctx context.Context, snapshotID, orgID, userID uuid.UUID) (string, error) {
	var count int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM snapshots WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
		snapshotID, orgID).Scan(&count); err != nil {
		return "", err
	}
	if count == 0 {
		return "", apperrors.New(apperrors.CodeNotFound, "snapshot not found")
	}
	url := fmt.Sprintf("%s/snapshots/%s?token=%d", s.baseURL, snapshotID, time.Now().Unix())
	cipherText, err := encryptURLText(url, orgID[:])
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO snapshot_download_links(snapshot_id, requested_by, url_ciphertext, expires_at)
VALUES ($1,$2,$3, now()+interval '15 minutes')`, snapshotID, userID, cipherText); err != nil {
		return "", err
	}
	return url, nil
}

// GenerateBackupDownloadLink returns a short-lived download URL for a backup.
func (s *Service) GenerateBackupDownloadLink(ctx context.Context, backupID, orgID, userID uuid.UUID) (string, error) {
	var count int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM backups WHERE id=$1 AND organization_id=$2`, backupID, orgID).Scan(&count); err != nil {
		return "", err
	}
	if count == 0 {
		return "", apperrors.New(apperrors.CodeNotFound, "backup not found")
	}
	url := fmt.Sprintf("%s/backups/%s?token=%d", s.baseURL, backupID, time.Now().Unix())
	cipherText, err := encryptURLText(url, orgID[:])
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO backup_download_links(backup_id, requested_by, url_ciphertext, expires_at)
VALUES ($1,$2,$3, now()+interval '15 minutes')`, backupID, userID, cipherText); err != nil {
		return "", err
	}
	return url, nil
}
