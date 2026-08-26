// Package storage implements Onidel object-storage services (customer product) and internal file metadata.
package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/platform/crypto"
	objstore "kilat.cloud/backend/internal/platform/objectstorage"

	"kilat.cloud/backend/internal/billing"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type ObjectStorageService struct {
	ID         uuid.UUID `json:"id"`
	PublicID   string    `json:"public_id"`
	Name       string    `json:"name"`
	Endpoint   string    `json:"endpoint"`
	Status     string    `json:"status"`
	CapacityKB int64     `json:"capacity"`
	UsedKB     int64     `json:"used_capacity"`
	CreatedAt  string    `json:"created_at"`
}

const selectOSSvcCols = `
SELECT id, public_id, name, COALESCE(endpoint,''), status::text,
       COALESCE(capacity_bytes,0)/1024, used_bytes/1024, created_at::text
FROM object_storage_services WHERE deleted_at IS NULL AND organization_id=$1`

func (s *Service) ListServices(ctx context.Context, orgID uuid.UUID) ([]ObjectStorageService, error) {
	rows, err := s.db.Query(ctx, selectOSSvcCols+` ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ObjectStorageService
	for rows.Next() {
		var svc ObjectStorageService
		if err := rows.Scan(&svc.ID, &svc.PublicID, &svc.Name, &svc.Endpoint, &svc.Status,
			&svc.CapacityKB, &svc.UsedKB, &svc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, svc)
	}
	return out, rows.Err()
}

type Bucket struct {
	ID         uuid.UUID `json:"id"`
	BucketName string    `json:"bucket_name"`
	ServiceID  uuid.UUID `json:"service_id"`
	Versioning bool      `json:"versioning_enabled"`
	ObjectLock bool      `json:"object_lock_enabled"`
	CreatedAt  string    `json:"created_at"`
}

type CreateServiceInput struct {
	OrganizationID uuid.UUID
	Name           string
	RegionID       *uuid.UUID
}

// CreateService inserts a customer object-storage service row and its monthly
// billing subscription in one transaction. The SERVICE is the billable unit —
// buckets are free — so the subscription is attached here, priced at the
// product's default_monthly_amount (migration 000007) unless a
// provider-reported price is passed in a future integration.
func (s *Service) CreateService(ctx context.Context, in CreateServiceInput) (*ObjectStorageService, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "name is required"),
			map[string]string{"name": "required"})
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

	var productID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM products WHERE code=$1 AND enabled`, billing.ProductCodeObjectStorage).
		Scan(&productID); err != nil {
		return nil, fmt.Errorf("product %s not found or disabled: %w", billing.ProductCodeObjectStorage, err)
	}
	charge, err := billing.EffectiveMonthlyCharge(ctx, tx, billing.ProductCodeObjectStorage, 0)
	if err != nil {
		return nil, err
	}

	var svc ObjectStorageService
	row := tx.QueryRow(ctx, `
INSERT INTO object_storage_services(organization_id, provider_id, product_id, region_id,
                                    name, status, recurring_amount, currency)
VALUES ($1,$2,$3,$4,$5,'pending',$6,'IDR')
RETURNING id, public_id, name, '', 'pending', 0, 0, created_at::text`,
		in.OrganizationID, providerID, productID, nullUUID(in.RegionID), in.Name, charge)
	if err := row.Scan(&svc.ID, &svc.PublicID, &svc.Name, &svc.Endpoint, &svc.Status,
		&svc.CapacityKB, &svc.UsedKB, &svc.CreatedAt); err != nil {
		return nil, err
	}

	subID, err := billing.AttachProductSubscription(ctx, tx, in.OrganizationID,
		billing.ProductCodeObjectStorage, charge, "IDR")
	if err != nil {
		return nil, err
	}
	if subID != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE object_storage_services SET subscription_id=$2 WHERE id=$1`, svc.ID, *subID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &svc, nil
}

// DeleteService soft-deletes the storage service and cancels its billing
// subscription in the same transaction; buckets cascade per their FK.
func (s *Service) DeleteService(ctx context.Context, orgID, serviceID uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var subID *uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT subscription_id FROM object_storage_services
WHERE id=$2 AND organization_id=$1 AND deleted_at IS NULL
FOR UPDATE`, orgID, serviceID).Scan(&subID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFoundErr("storage service not found")
		}
		return err
	}
	if _, err := tx.Exec(ctx, `
UPDATE object_storage_services SET deleted_at=now(), updated_at=now() WHERE id=$1`, serviceID); err != nil {
		return err
	}
	if subID != nil {
		if err := billing.DetachProductSubscription(ctx, tx, *subID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) ListBuckets(ctx context.Context, orgID, serviceID uuid.UUID) ([]Bucket, error) {
	rows, err := s.db.Query(ctx, `
SELECT b.id, b.bucket_name, b.storage_service_id, b.versioning_enabled, b.object_lock_enabled, b.created_at::text
FROM storage_buckets b JOIN object_storage_services o ON o.id=b.storage_service_id
WHERE o.organization_id=$1 AND b.storage_service_id=$2 AND b.deleted_at IS NULL
ORDER BY b.created_at DESC`, orgID, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bucket
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.ID, &b.BucketName, &b.ServiceID, &b.Versioning, &b.ObjectLock, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

type CreateBucketInput struct {
	OrganizationID uuid.UUID
	ServiceID      uuid.UUID
	BucketName     string
	Versioning     bool
	ObjectLock     bool
}

func (s *Service) CreateBucket(ctx context.Context, in CreateBucketInput) (*Bucket, error) {
	if in.BucketName == "" || len(in.BucketName) > 63 {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid bucket name"),
			map[string]string{"bucket_name": "1-63 chars"})
	}
	providerID, err := s.resolveProvider(ctx)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO storage_buckets(organization_id, storage_service_id, provider_id, bucket_name,
                            versioning_enabled, object_lock_enabled)
SELECT $1,$2,$3,$4,$5,$6 FROM object_storage_services o
WHERE o.id=$2 AND o.organization_id=$1 AND o.deleted_at IS NULL
RETURNING id, bucket_name, storage_service_id, versioning_enabled, object_lock_enabled, created_at::text`,
		in.OrganizationID, in.ServiceID, providerID, in.BucketName, in.Versioning, in.ObjectLock)
	var b Bucket
	err = row.Scan(&b.ID, &b.BucketName, &b.ServiceID, &b.Versioning, &b.ObjectLock, &b.CreatedAt)
	if err != nil && isNoRows(err) {
		return nil, notFoundErr("storage service not found")
	}
	if err != nil && isUnique(err, "storage_buckets_provider_id_bucket_name_key") {
		return nil, conflictErr("bucket name already exists")
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

type AccessKey struct {
	AccessKeyID string `json:"access_key"`
	SecretKey   string `json:"secret_key,omitempty"`
}

// ListAccessKeys returns access keys for a bucket; secrets are never returned.
func (s *Service) ListAccessKeys(ctx context.Context, orgID, serviceID uuid.UUID, bucketName string) ([]AccessKey, error) {
	rows, err := s.db.Query(ctx, `
SELECT k.access_key_id FROM storage_access_keys k
JOIN storage_buckets b ON b.id=k.bucket_id
JOIN object_storage_services o ON o.id=b.storage_service_id
WHERE o.organization_id=$1 AND o.id=$2 AND b.bucket_name=$3 AND k.status='active'`,
		orgID, serviceID, bucketName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccessKey
	for rows.Next() {
		var k AccessKey
		if err := rows.Scan(&k.AccessKeyID); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Service) resolveProvider(ctx context.Context) (uuid.UUID, error) {
	var pid uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM providers WHERE kind='onidel' AND enabled LIMIT 1`).Scan(&pid)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeProviderUnavailable, "onidel provider not configured")
	}
	return pid, nil
}

// ---- Internal stored objects (avatars, invoice PDFs, etc.) ----

type StoredObject struct {
	ID        uuid.UUID `json:"id"`
	ObjectKey string    `json:"object_key"`
	Purpose   string    `json:"purpose"`
	MimeType  string    `json:"mime_type"`
	SizeBytes int64     `json:"size_bytes"`
}

type RegisterObjectInput struct {
	StorageBackendID uuid.UUID
	OrganizationID   *uuid.UUID
	OwnerUserID      *uuid.UUID
	ObjectKey        string
	Purpose          string
	Filename         string
	MimeType         string
	SizeBytes        int64
	SHA256           string
}

func (s *Service) RegisterStoredObject(ctx context.Context, in RegisterObjectInput) (*StoredObject, error) {
	row := s.db.QueryRow(ctx, `
INSERT INTO stored_objects(storage_backend_id, organization_id, owner_user_id, object_key,
                           purpose, original_filename, mime_type, size_bytes, sha256)
VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,0),NULLIF($9,''))
RETURNING id, object_key, purpose, COALESCE(mime_type,''), COALESCE(size_bytes,0)`,
		in.StorageBackendID, nullUUID(in.OrganizationID), nullUUID(in.OwnerUserID),
		in.ObjectKey, in.Purpose, in.Filename, in.MimeType, in.SizeBytes, in.SHA256)
	var obj StoredObject
	if err := row.Scan(&obj.ID, &obj.ObjectKey, &obj.Purpose, &obj.MimeType, &obj.SizeBytes); err != nil {
		if isUnique(err, "stored_objects_storage_backend_id_object_key_key") {
			return nil, conflictErr("object key already exists on this backend")
		}
		return nil, err
	}
	return &obj, nil
}

func (s *Service) GetDefaultBackend(ctx context.Context) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.db.QueryRow(ctx, `
SELECT id FROM object_storage_backends WHERE enabled ORDER BY created_at LIMIT 1`).Scan(&id)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeProviderUnavailable, "no enabled storage backend configured")
	}
	return id, nil
}

var validProtocols = map[string]bool{}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
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

func isUnique(err error, constraint string) bool {
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

func notFoundErr(msg string) error { return apperrors.New(apperrors.CodeNotFound, msg) }
func conflictErr(msg string) error { return apperrors.New(apperrors.CodeConflict, msg) }

// ---- Purpose-scoped internal storage backends ----
//
// Each asset category (avatar, document, iso, ticket, invoice) resolves to its
// own object_storage_backends row — dedicated bucket, endpoint and encrypted
// credentials. Rows with empty endpoint/NULL credentials inherit the global
// R2_* environment fallback so existing deployments keep working.

// FallbackStorage carries the global environment credentials used when a
// backend row does not override them.
type FallbackStorage struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
}

type resolvedBackend struct {
	id     uuid.UUID
	client *objstore.Client
}

var (
	backendMu    sync.Mutex
	backendCache = map[string]resolvedBackend{}
)

// ResolveBackend returns a client bound to the backend registered for the
// given category code plus the backend id (for stored_objects rows).
func (s *Service) ResolveBackend(ctx context.Context, encKey []byte, code string, fb FallbackStorage) (uuid.UUID, *objstore.Client, error) {
	var id uuid.UUID
	var name, driver, bucket, region, endpoint string
	var creds []byte
	err := s.db.QueryRow(ctx, `
SELECT id, name::text, driver::text, bucket_name::text,
       COALESCE(region,''), COALESCE(endpoint,''), credentials_ciphertext
FROM object_storage_backends WHERE code=$1 AND enabled`, code).
		Scan(&id, &name, &driver, &bucket, &region, &endpoint, &creds)
	if errors.Is(err, pgx.ErrNoRows) {
		// No dedicated row: fall back to the default enabled backend.
		defID, derr := s.GetDefaultBackend(ctx)
		if derr != nil {
			return uuid.Nil, nil, apperrors.New(apperrors.CodeProviderUnavailable, "object storage not configured")
		}
		cl, cerr := fbClient(fb)
		return defID, cl, cerr
	}
	if err != nil {
		return uuid.Nil, nil, err
	}

	accessKey, secretKey := fb.AccessKey, fb.SecretKey
	if len(creds) > 0 {
		var plain []byte
		if plain, err = crypto.Decrypt(encKey, creds); err != nil {
			return uuid.Nil, nil, fmt.Errorf("decrypt storage backend %s credentials: %w", code, err)
		}
		var parsed struct{ AccessKey, SecretKey string }
		if err := json.Unmarshal(plain, &parsed); err != nil || parsed.AccessKey == "" || parsed.SecretKey == "" {
			return uuid.Nil, nil, fmt.Errorf("storage backend %s has malformed stored credentials", code)
		}
		accessKey, secretKey = parsed.AccessKey, parsed.SecretKey
	}

	cacheKey := code
	backendMu.Lock()
	if hit, ok := backendCache[cacheKey]; ok {
		backendMu.Unlock()
		return hit.id, hit.client, nil
	}
	backendMu.Unlock()

	effEndpoint := endpoint
	if effEndpoint == "" {
		effEndpoint = fb.Endpoint
	}
	if effEndpoint == "" || bucket == "" {
		return uuid.Nil, nil, apperrors.New(apperrors.CodeProviderUnavailable, "object storage not configured")
	}
	useSSL := !strings.HasPrefix(effEndpoint, "http://")
	ep := strings.TrimPrefix(strings.TrimPrefix(effEndpoint, "https://"), "http://")
	cl, err := objstore.New(ctx, ep, accessKey, secretKey, region, bucket, useSSL)
	if err != nil {
		return uuid.Nil, nil, err
	}
	backendMu.Lock()
	backendCache[cacheKey] = resolvedBackend{id: id, client: cl}
	backendMu.Unlock()
	return id, cl, nil
}

func fbClient(fb FallbackStorage) (*objstore.Client, error) {
	if fb.Endpoint == "" || fb.Bucket == "" {
		return nil, apperrors.New(apperrors.CodeProviderUnavailable, "object storage not configured")
	}
	useSSL := !strings.HasPrefix(fb.Endpoint, "http://")
	ep := strings.TrimPrefix(strings.TrimPrefix(fb.Endpoint, "https://"), "http://")
	return objstore.New(context.Background(), ep, fb.AccessKey, fb.SecretKey, "", fb.Bucket, useSSL)
}

// InvalidateBackendCache drops cached clients after admin edits.
func InvalidateBackendCache() {
	backendMu.Lock()
	backendCache = map[string]resolvedBackend{}
	backendMu.Unlock()
}
