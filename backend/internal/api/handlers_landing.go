package api

import (
	"encoding/json"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Landing / marketing content. Public GET /landing serves published sections
// to the marketing site; the /admin/landing/* surface is the staff CRUD editor
// (platform admin + NOC; finance has no "marketing" area grant).

type landingSectionOut struct {
	ID         string         `json:"id"`
	SectionKey string         `json:"section_key"`
	Title      string         `json:"title"`
	Subtitle   string         `json:"subtitle"`
	Body       string         `json:"body"`
	MediaURL   string         `json:"media_url"`
	Data       map[string]any `json:"data"`
	SortOrder  int            `json:"sort_order"`
	Published  bool           `json:"published"`
	UpdatedAt  string         `json:"updated_at,omitempty"`
}

func validSectionKeys() map[string]bool {
	return map[string]bool{
		"hero": true, "features": true, "pricing": true, "testimonials": true,
		"faq": true, "blog": true, "banner": true,
	}
}

func scanLandingSection(row interface{ Scan(...any) error }) (landingSectionOut, error) {
	var o landingSectionOut
	var raw string
	if err := row.Scan(&o.ID, &o.SectionKey, &o.Title, &o.Subtitle, &o.Body, &o.MediaURL, &raw, &o.SortOrder, &o.Published, &o.UpdatedAt); err != nil {
		return o, err
	}
	_ = json.Unmarshal([]byte(raw), &o.Data)
	if o.Data == nil {
		o.Data = map[string]any{}
	}
	return o, nil
}

const landingSelectCols = `
id::text, section_key, title, subtitle, body, media_url, data::text, sort_order, published, updated_at::text`

func (s *Server) handleListLandingSections(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+landingSelectCols+`
FROM landing_sections ORDER BY section_key, sort_order`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []landingSectionOut{}
	for rows.Next() {
		o, err := scanLandingSection(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handlePublicLanding serves only published sections (the public marketing site).
func (s *Server) handlePublicLanding(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+landingSelectCols+`
FROM landing_sections WHERE published = true ORDER BY section_key, sort_order`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []landingSectionOut{}
	for rows.Next() {
		o, err := scanLandingSection(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

type landingSectionInput struct {
	SectionKey string         `json:"section_key"`
	Title      string         `json:"title"`
	Subtitle   string         `json:"subtitle"`
	Body       string         `json:"body"`
	MediaURL   string         `json:"media_url"`
	Data       map[string]any `json:"data"`
	SortOrder  *int           `json:"sort_order"`
	Published  *bool          `json:"published"`
}

func (s *Server) handleCreateLandingSection(c fiber.Ctx) error {
	var in landingSectionInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	key := strings.ToLower(strings.TrimSpace(in.SectionKey))
	if !validSectionKeys()[key] {
		return mw.WriteError(c, vErrField("section_key", "must be one of hero, features, pricing, testimonials, faq, blog, banner"))
	}
	if strings.TrimSpace(in.Title) == "" {
		return mw.WriteError(c, vErrField("title", "is required"))
	}
	raw, _ := json.Marshal(in.Data)
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
INSERT INTO landing_sections (section_key, title, subtitle, body, media_url, data, sort_order, published)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		key, in.Title, in.Subtitle, in.Body, in.MediaURL, raw, sortOrder, published).Scan(&id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.landing.created", "landing_section", id, fiber.Map{"section_key": key, "title": in.Title}))
	return mw.JSON(c, 201, fiber.Map{"id": id, "status": "created"}, nil)
}

func (s *Server) handleUpdateLandingSection(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	var in landingSectionInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	key := strings.ToLower(strings.TrimSpace(in.SectionKey))
	if key != "" && !validSectionKeys()[key] {
		return mw.WriteError(c, vErrField("section_key", "must be one of hero, features, pricing, testimonials, faq, blog, banner"))
	}
	raw, _ := json.Marshal(in.Data)
	ct, err := s.db.Exec(c.Context(), `
UPDATE landing_sections SET
  section_key = CASE WHEN $2 = '' THEN section_key ELSE $2 END,
  title       = CASE WHEN $3 = '' THEN title ELSE $3 END,
  subtitle    = $4,
  body        = $5,
  media_url   = $6,
  data        = CASE WHEN $7 = 'null' THEN data ELSE $7::jsonb END,
  sort_order  = COALESCE($8, sort_order),
  published   = COALESCE($9, published),
  updated_at  = now()
WHERE id = $1`,
		id, key, in.Title, in.Subtitle, in.Body, in.MediaURL, string(raw), in.SortOrder, in.Published)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "landing section not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.landing.updated", "landing_section", id, fiber.Map{"section_key": key, "title": in.Title}))
	return mw.JSON(c, 200, fiber.Map{"id": id, "status": "updated"}, nil)
}

func (s *Server) handleDeleteLandingSection(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	ct, err := s.db.Exec(c.Context(), `DELETE FROM landing_sections WHERE id=$1`, id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "landing section not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.landing.deleted", "landing_section", id, fiber.Map{}))
	return c.SendStatus(204)
}
