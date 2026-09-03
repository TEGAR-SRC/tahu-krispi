package api

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/storage"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Storage backends admin CRUD: each asset category (avatar/document/iso/
// ticket/invoice) gets its own bucket, endpoint and credentials. Credentials
// are write-only: they are stored AES-256-GCM encrypted and never returned.

func strPtrOrNull(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

type storageBackendOut struct {
	ID             string `json:"id"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	Driver         string `json:"driver"`
	Endpoint       string `json:"endpoint"`
	Region         string `json:"region,omitempty"`
	BucketName     string `json:"bucket_name"`
	HasCredentials bool   `json:"has_credentials"`
	Enabled        bool   `json:"enabled"`
}

func (s *Server) handleListStorageBackends(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
SELECT id::text, code::text, name, driver::text,
       COALESCE(endpoint,''), COALESCE(region,''), bucket_name,
       credentials_ciphertext IS NOT NULL, enabled
FROM object_storage_backends ORDER BY code`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []storageBackendOut{}
	for rows.Next() {
		var b storageBackendOut
		if err := rows.Scan(&b.ID, &b.Code, &b.Name, &b.Driver, &b.Endpoint, &b.Region, &b.BucketName, &b.HasCredentials, &b.Enabled); err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleGetStorageBackend(c fiber.Ctx) error {
	code := strings.ToLower(strings.TrimSpace(c.Params("code")))
	validCodes := map[string]bool{"avatar": true, "document": true, "iso": true, "ticket": true, "invoice": true}
	if !validCodes[code] {
		return mw.WriteError(c, vErrField("code", "must be one of avatar, document, iso, ticket, invoice"))
	}
	var b storageBackendOut
	var createdAt, updatedAt string
	err := s.db.QueryRow(c.Context(), `
SELECT id::text, code::text, name, driver::text,
       COALESCE(endpoint,''), COALESCE(region,''), bucket_name,
       credentials_ciphertext IS NOT NULL, enabled,
       created_at::text, updated_at::text
FROM object_storage_backends WHERE code=$1`, code).
		Scan(&b.ID, &b.Code, &b.Name, &b.Driver, &b.Endpoint, &b.Region, &b.BucketName, &b.HasCredentials, &b.Enabled, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "backend not found"))
		}
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"backend":    b,
		"created_at": createdAt,
		"updated_at": updatedAt,
	}, nil)
}

type storageBucketRow struct {
	ID        string `json:"id"`
	ObjectKey string `json:"object_key"`
	Purpose   string `json:"purpose"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

func (s *Server) handleListStorageBackendBuckets(c fiber.Ctx) error {
	code := strings.ToLower(strings.TrimSpace(c.Params("code")))
	validCodes := map[string]bool{"avatar": true, "document": true, "iso": true, "ticket": true, "invoice": true}
	if !validCodes[code] {
		return mw.WriteError(c, vErrField("code", "must be one of avatar, document, iso, ticket, invoice"))
	}
	var backendID uuid.UUID
	err := s.db.QueryRow(c.Context(), `SELECT id FROM object_storage_backends WHERE code=$1`, code).Scan(&backendID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "backend not found"))
		}
		return mw.WriteError(c, err)
	}
	limit := 50
	if n, perr := parsePositiveInt(c.Query("limit"), 0); perr == nil && n > 0 {
		if n > 200 {
			n = 200
		}
		limit = n
	}
	offset := 0
	if n, perr := parsePositiveInt(c.Query("offset"), 0); perr == nil && n >= 0 {
		offset = n
	}
	rows, err := s.db.Query(c.Context(), `
SELECT id::text, object_key, purpose, COALESCE(mime_type,''), COALESCE(size_bytes,0), created_at::text
FROM stored_objects WHERE storage_backend_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC LIMIT $2 OFFSET $3`, backendID, limit, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []storageBucketRow{}
	for rows.Next() {
		var r storageBucketRow
		if err := rows.Scan(&r.ID, &r.ObjectKey, &r.Purpose, &r.MimeType, &r.SizeBytes, &r.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	var total int
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM stored_objects WHERE storage_backend_id=$1 AND deleted_at IS NULL`, backendID).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, fiber.Map{"total": total, "limit": limit, "offset": offset})
}

func parsePositiveInt(s string, def int) (int, error) {
	if s == "" {
		return def, errors.New("empty")
	}
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, errors.New("not a number")
		}
		n = n*10 + int(ch-'0')
	}
	return n, nil
}

type storageBackendInput struct {
	Name      string  `json:"name"`
	Driver    string  `json:"driver"`
	Endpoint  *string `json:"endpoint"`
	Region    *string `json:"region"`
	Bucket    string  `json:"bucket_name"`
	AccessKey *string `json:"access_key"`
	SecretKey *string `json:"secret_key"`
	Enabled   *bool   `json:"enabled"`
}

func (s *Server) handleUpsertStorageBackend(c fiber.Ctx) error {
	code := strings.ToLower(strings.TrimSpace(c.Params("code")))
	validCodes := map[string]bool{"avatar": true, "document": true, "iso": true, "ticket": true, "invoice": true}
	if !validCodes[code] {
		return mw.WriteError(c, vErrField("code", "must be one of avatar, document, iso, ticket, invoice"))
	}
	var in storageBackendInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	driver := strings.ToLower(in.Driver)
	if driver == "" {
		driver = "s3"
	}
	if driver != "s3" && driver != "r2" && driver != "minio" {
		return mw.WriteError(c, vErrField("driver", "must be s3, r2 or minio"))
	}
	if in.Bucket == "" {
		return mw.WriteError(c, vErrField("bucket_name", "is required"))
	}
	if (in.AccessKey != nil) != (in.SecretKey != nil) || (in.AccessKey != nil && (*in.AccessKey == "" || *in.SecretKey == "")) {
		return mw.WriteError(c, vErrField("access_key", "both access_key and secret_key are required to set credentials"))
	}

	var creds any
	if in.AccessKey != nil {
		plain, err := json.Marshal(struct{ AccessKey, SecretKey string }{*in.AccessKey, *in.SecretKey})
		if err != nil {
			return mw.WriteError(c, err)
		}
		if creds, err = crypto.Encrypt(s.encKey, plain); err != nil {
			return mw.WriteError(c, err)
		}
	}

	name := in.Name
	if name == "" {
		name = strings.ToUpper(code[:1]) + code[1:] + " storage"
	}
	endpointAny, regionAny := strPtrOrNull(in.Endpoint), strPtrOrNull(in.Region)
	var id uuid.UUID
	err := s.db.QueryRow(c.Context(), `
INSERT INTO object_storage_backends(code, name, driver, endpoint, region, bucket_name, credentials_ciphertext, enabled)
VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true))
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, driver=EXCLUDED.driver,
  endpoint=COALESCE(EXCLUDED.endpoint, object_storage_backends.endpoint),
  region=COALESCE(EXCLUDED.region, object_storage_backends.region),
  bucket_name=EXCLUDED.bucket_name,
  credentials_ciphertext=COALESCE(EXCLUDED.credentials_ciphertext, object_storage_backends.credentials_ciphertext),
  enabled=EXCLUDED.enabled
RETURNING id`,
		code, name, driver, endpointAny, regionAny, in.Bucket, creds, in.Enabled).Scan(&id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	storage.InvalidateBackendCache()
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.storage_backend.updated", "storage_backend", id, fiber.Map{
		"code": code, "bucket": in.Bucket, "credentials_set": creds != nil,
	}))
	return mw.JSON(c, 200, fiber.Map{"id": id, "code": code, "status": "updated"}, nil)
}

func (s *Server) handleDisableStorageBackend(c fiber.Ctx) error {
	code := c.Params("code")
	ct, err := s.db.Exec(c.Context(),
		`UPDATE object_storage_backends SET enabled=false WHERE code=$1`, code)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "backend not found"))
	}
	storage.InvalidateBackendCache()
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.storage_backend.disabled", "storage_backend", uuid.Nil, fiber.Map{"code": code}))
	return mw.JSON(c, 200, fiber.Map{"code": code, "status": "disabled"}, nil)
}
