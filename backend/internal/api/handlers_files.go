package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/storage"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Profile files (avatar & KYC documents) ----

const (
	maxAvatarBytes    = 5 << 20
	maxDocumentBytes  = 10 << 20
	presignTTLMinutes = 15
)

// avatarMimeExts whitelists avatar content types onto file extensions.
var avatarMimeExts = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// documentMimeExts whitelists KYC document content types onto file extensions.
var documentMimeExts = map[string]string{
	"application/pdf": ".pdf",
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
}

// authUserID extracts the authenticated user id from JWT locals. Unlike
// mustUserID it works on routes that are not wrapped by withOrg.
func authUserID(c fiber.Ctx) (uuid.UUID, error) {
	str, _ := c.Locals(auth.LocalsUserID).(string)
	id, err := uuid.Parse(str)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeUnauthorized, "authentication required")
	}
	return id, nil
}

func baseMime(contentType string) string {
	mt := strings.TrimSpace(strings.ToLower(contentType))
	if i := strings.Index(mt, ";"); i >= 0 {
		mt = strings.TrimSpace(mt[:i])
	}
	return mt
}

// presignTTLFor returns the lifetime of presigned download URLs.
func presignTTLFor() time.Duration { return presignTTLMinutes * time.Minute }

// readUpload reads at most limit+1 bytes from the multipart file and validates
// the declared mime type against the whitelist, returning the extension to use.
func readUpload(fh *multipart.FileHeader, limit int64, whitelist map[string]string) ([]byte, string, error) {
	if fh.Size > limit {
		return nil, "", vErrField("file", "file exceeds the maximum allowed size")
	}
	f, err := fh.Open()
	if err != nil {
		return nil, "", errValidation("cannot read uploaded file")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, "", errValidation("cannot read uploaded file")
	}
	if int64(len(data)) > limit {
		return nil, "", vErrField("file", "file exceeds the maximum allowed size")
	}
	ext, ok := whitelist[baseMime(fh.Header.Get("Content-Type"))]
	if !ok {
		return nil, "", vErrField("file", "unsupported file type")
	}
	return data, ext, nil
}

// putStoredObject uploads bytes to object storage, registers the stored_object
// row for the user and returns it. purpose maps to the dedicated storage
// backend: "avatar" or "kyc_document" (bucket per category).
func (s *Server) putStoredObject(c fiber.Ctx, userID uuid.UUID, key, purpose, filename, mime string, data []byte) (*storage.StoredObject, error) {
	ctx := c.Context()
	backendCode := purpose
	if backendCode == "kyc_document" {
		backendCode = "document"
	}
	cl, backendID, err := s.objClientFor(ctx, backendCode)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	if _, err := cl.PutObject(ctx, key, bytes.NewReader(data), int64(len(data)), mime); err != nil {
		return nil, err
	}
	return s.storageSvc.RegisterStoredObject(ctx, storage.RegisterObjectInput{
		StorageBackendID: backendID,
		OwnerUserID:      &userID,
		ObjectKey:        key,
		Purpose:          purpose,
		Filename:         filename,
		MimeType:         mime,
		SizeBytes:        int64(len(data)),
		SHA256:           hex.EncodeToString(sum[:]),
	})
}

func (s *Server) handleUploadAvatar(c fiber.Ctx) error {
	userID, err := authUserID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return mw.WriteError(c, errValidation("file required"))
	}
	data, ext, err := readUpload(fh, maxAvatarBytes, avatarMimeExts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	mime := baseMime(fh.Header.Get("Content-Type"))
	key := "users/" + userID.String() + "/avatar/" + uuid.NewString() + ext

	obj, err := s.putStoredObject(c, userID, key, "avatar", fh.Filename, mime, data)
	if err != nil {
		return mw.WriteError(c, err)
	}

	tag, err := s.db.Exec(c.Context(), `
UPDATE user_profiles SET avatar_object_id=$2 WHERE user_id=$1`, userID, obj.ID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.db.Exec(c.Context(), `
INSERT INTO user_profiles(user_id, avatar_object_id) VALUES ($1,$2)
ON CONFLICT (user_id) DO UPDATE SET avatar_object_id=EXCLUDED.avatar_object_id`,
			userID, obj.ID); err != nil {
			return mw.WriteError(c, err)
		}
	}

	return mw.JSON(c, 201, obj, nil)
}

func (s *Server) handleGetAvatar(c fiber.Ctx) error {
	userID, err := authUserID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var objectKey string
	err = s.db.QueryRow(c.Context(), `
SELECT so.object_key FROM user_profiles up
JOIN stored_objects so ON so.id = up.avatar_object_id
WHERE up.user_id=$1 AND up.avatar_object_id IS NOT NULL AND so.deleted_at IS NULL`, userID).Scan(&objectKey)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "avatar not found"))
	}
	cl, _, err := s.objClientFor(c.Context(), "avatar")
	if err != nil {
		return mw.WriteError(c, err)
	}
	url, err := cl.PresignedGet(c.Context(), objectKey, presignTTLFor())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"url": url}, nil)
}

type documentView struct {
	ID                 uuid.UUID `json:"id"`
	DocumentType       string    `json:"document_type"`
	VerificationStatus string    `json:"verification_status"`
	MimeType           string    `json:"mime_type"`
	SizeBytes          int64     `json:"size_bytes"`
	URL                string    `json:"url"`
	CreatedAt          string    `json:"created_at"`
}

func (s *Server) handleUploadDocument(c fiber.Ctx) error {
	userID, err := authUserID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	documentType := strings.TrimSpace(c.FormValue("document_type"))
	if documentType == "" {
		return mw.WriteError(c, errValidation("document_type required"))
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return mw.WriteError(c, errValidation("file required"))
	}
	data, ext, err := readUpload(fh, maxDocumentBytes, documentMimeExts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	mime := baseMime(fh.Header.Get("Content-Type"))
	key := "users/" + userID.String() + "/documents/" + uuid.NewString() + ext

	obj, err := s.putStoredObject(c, userID, key, "kyc_document", fh.Filename, mime, data)
	if err != nil {
		return mw.WriteError(c, err)
	}

	var docID uuid.UUID
	var status, createdAt string
	err = s.db.QueryRow(c.Context(), `
INSERT INTO user_documents(user_id, document_type, object_id)
VALUES ($1,$2,$3)
RETURNING id, verification_status::text, created_at::text`,
		userID, documentType, obj.ID).Scan(&docID, &status, &createdAt)
	if err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 201, documentView{
		ID:                 docID,
		DocumentType:       documentType,
		VerificationStatus: status,
		MimeType:           obj.MimeType,
		SizeBytes:          obj.SizeBytes,
		CreatedAt:          createdAt,
	}, nil)
}

func (s *Server) handleListDocuments(c fiber.Ctx) error {
	ctx := c.Context()
	userID, err := authUserID(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	cl, _, err := s.objClientFor(ctx, "document")
	if err != nil {
		return mw.WriteError(c, err)
	}

	rows, err := s.db.Query(ctx, `
SELECT d.id, d.document_type, d.verification_status::text,
       COALESCE(o.mime_type,''), COALESCE(o.size_bytes,0), o.object_key, d.created_at::text
FROM user_documents d
JOIN stored_objects o ON o.id = d.object_id AND o.deleted_at IS NULL
WHERE d.user_id=$1
ORDER BY d.created_at DESC`, userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	docs := []documentView{}
	for rows.Next() {
		var v documentView
		var objectKey string
		if err := rows.Scan(&v.ID, &v.DocumentType, &v.VerificationStatus,
			&v.MimeType, &v.SizeBytes, &objectKey, &v.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		url, perr := cl.PresignedGet(ctx, objectKey, presignTTLFor())
		if perr != nil {
			return mw.WriteError(c, perr)
		}
		v.URL = url
		docs = append(docs, v)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	data, meta := paginateViews(c, docs)
	return httputil.OK(c, 200, data, meta)
}
