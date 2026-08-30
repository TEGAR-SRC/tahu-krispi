package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Documentation CRUD. Public GET /docs and /docs/:slug serve published pages;
// the /admin/docs/* surface is the staff editor (platform admin + NOC).

type docOut struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	SortOrder   int    `json:"sort_order"`
	Published   bool   `json:"published"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

const docSelectCols = `
id::text, slug, title, description, content, sort_order, published, updated_at::text`

func scanDocRow(row interface{ Scan(...any) error }) (docOut, error) {
	var d docOut
	if err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.Content, &d.SortOrder, &d.Published, &d.UpdatedAt); err != nil {
		return d, err
	}
	return d, nil
}

// isUniqueViolation reports whether err is a PostgreSQL unique-violation on
// the given constraint (SQLSTATE 23505).
func isUniqueViolation(err error, constraint string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if !strings.Contains(msg, "23505") {
		return false
	}
	if constraint == "" {
		return true
	}
	return strings.Contains(msg, constraint)
}

func (s *Server) handleListDocs(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+docSelectCols+`
FROM docs ORDER BY sort_order, title`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []docOut{}
	for rows.Next() {
		d, err := scanDocRow(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handlePublicDocs lists published docs without the markdown content (sidebar).
func (s *Server) handlePublicDocs(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
SELECT id::text, slug, title, description, ''::text, sort_order, published, updated_at::text
FROM docs WHERE published = true ORDER BY sort_order, title`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []docOut{}
	for rows.Next() {
		d, err := scanDocRow(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handlePublicDocBySlug serves one published doc including its content.
func (s *Server) handlePublicDocBySlug(c fiber.Ctx) error {
	slug := strings.TrimSpace(c.Params("slug"))
	if slug == "" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug is required"))
	}
	var d docOut
	if err := s.db.QueryRow(c.Context(), `SELECT `+docSelectCols+`
FROM docs WHERE slug=$1 AND published = true`, slug).
		Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.Content, &d.SortOrder, &d.Published, &d.UpdatedAt); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "document not found"))
	}
	return mw.JSON(c, 200, d, nil)
}

func validSlug(slug string) bool {
	if slug == "" || len(slug) > 80 {
		return false
	}
	for _, r := range slug {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_', r == '/', r == '.':
		default:
			return false
		}
	}
	return true
}

type docInput struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	SortOrder   *int   `json:"sort_order"`
	Published   *bool  `json:"published"`
}

func (s *Server) handleCreateDoc(c fiber.Ctx) error {
	var in docInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	if !validSlug(slug) {
		return mw.WriteError(c, vErrField("slug", "must be lowercase letters, numbers, -, _, / or ."))
	}
	if strings.TrimSpace(in.Title) == "" {
		return mw.WriteError(c, vErrField("title", "is required"))
	}
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	var id uuid.UUID
	err := s.db.QueryRow(c.Context(), `
INSERT INTO docs (slug, title, description, content, sort_order, published)
VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		slug, in.Title, in.Description, in.Content, sortOrder, published).Scan(&id)
	if err != nil {
		if isUniqueViolation(err, "docs_slug_key") {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug already exists"))
		}
		return mw.WriteError(c, err)
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.docs.created", "doc", id, fiber.Map{"slug": slug, "title": in.Title}))
	return mw.JSON(c, 201, fiber.Map{"id": id, "slug": slug, "status": "created"}, nil)
}

func (s *Server) handleUpdateDoc(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	var in docInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	if slug != "" && !validSlug(slug) {
		return mw.WriteError(c, vErrField("slug", "must be lowercase letters, numbers, -, _, / or ."))
	}
	ct, err := s.db.Exec(c.Context(), `
UPDATE docs SET
  slug        = CASE WHEN $2 = '' THEN slug ELSE $2 END,
  title       = CASE WHEN $3 = '' THEN title ELSE $3 END,
  description = $4,
  content     = $5,
  sort_order  = COALESCE($6, sort_order),
  published   = COALESCE($7, published),
  updated_at  = now()
WHERE id = $1`,
		id, slug, in.Title, in.Description, in.Content, in.SortOrder, in.Published)
	if err != nil {
		if isUniqueViolation(err, "docs_slug_key") {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug already exists"))
		}
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "document not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.docs.updated", "doc", id, fiber.Map{"slug": slug, "title": in.Title}))
	return mw.JSON(c, 200, fiber.Map{"id": id, "status": "updated"}, nil)
}

func (s *Server) handleDeleteDoc(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	ct, err := s.db.Exec(c.Context(), `DELETE FROM docs WHERE id=$1`, id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "document not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.docs.deleted", "doc", id, fiber.Map{}))
	return c.SendStatus(204)
}
