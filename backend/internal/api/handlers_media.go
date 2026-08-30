package api

import (
	"io"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Landing / docs media (logos, images). Uploaded by staff (admin/NOC) and
// served publicly via a stable /v1/media/:id URL so landing pages and docs
// can reference them. Bytes are stored in the DB (landing_media table).

const maxMediaBytes = 10 << 20 // 10 MB

var mediaMimeExts = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"image/svg+xml":   ".svg",
	"application/pdf": ".pdf",
}

// handleUploadMedia stores an uploaded image/logo and returns its public URL.
func (s *Server) handleUploadMedia(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil {
		return mw.WriteError(c, errValidation("file field is required"))
	}
	data, ext, err := readUpload(fh, maxMediaBytes, mediaMimeExts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	mime := baseMime(fh.Header.Get("Content-Type"))
	var id uuid.UUID
	if err := s.db.QueryRow(c.Context(), `
INSERT INTO landing_media (filename, mime_type, size_bytes, data)
VALUES ($1,$2,$3,$4) RETURNING id`,
		fh.Filename, mime, len(data), data).Scan(&id); err != nil {
		return mw.WriteError(c, err)
	}
	_ = ext
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.media.uploaded", "landing_media", id, fiber.Map{
		"filename": fh.Filename, "mime_type": mime, "size_bytes": len(data),
	}))
	return mw.JSON(c, 201, fiber.Map{
		"id":         id,
		"filename":   fh.Filename,
		"mime_type":  mime,
		"size_bytes": len(data),
		"url":        "/v1/media/" + id.String(),
	}, nil)
}

// handleGetMedia serves a stored media file publicly.
func (s *Server) handleGetMedia(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	var (
		mime string
		data []byte
	)
	if err := s.db.QueryRow(c.Context(), `
SELECT mime_type, data FROM landing_media WHERE id=$1`, id).Scan(&mime, &data); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "media not found"))
	}
	c.Set(fiber.HeaderContentType, mime)
	c.Set(fiber.HeaderCacheControl, "public, max-age=31536000, immutable")
	return c.Status(200).Send(data)
}

// handleListMedia lists uploaded media (id, filename, mime, size, created).
func (s *Server) handleListMedia(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
SELECT id::text, filename, mime_type, size_bytes, created_at::text
FROM landing_media ORDER BY created_at DESC`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	type mediaRow struct {
		ID        string `json:"id"`
		Filename  string `json:"filename"`
		MimeType  string `json:"mime_type"`
		SizeBytes int64  `json:"size_bytes"`
		URL       string `json:"url"`
		CreatedAt string `json:"created_at"`
	}
	out := []mediaRow{}
	for rows.Next() {
		var r mediaRow
		if err := rows.Scan(&r.ID, &r.Filename, &r.MimeType, &r.SizeBytes, &r.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		r.URL = "/v1/media/" + r.ID
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handleDeleteMedia removes a stored media file.
func (s *Server) handleDeleteMedia(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	ct, err := s.db.Exec(c.Context(), `DELETE FROM landing_media WHERE id=$1`, id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "media not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.media.deleted", "landing_media", id, fiber.Map{}))
	return c.SendStatus(204)
}

var _ = io.Discard
