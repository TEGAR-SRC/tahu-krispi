package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Blog CRUD. Public GET /blog and /blog/:slug serve published posts; the
// /admin/blog/* surface is the staff editor (platform admin + NOC).

type blogPostOut struct {
	ID          string   `json:"id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Excerpt     string   `json:"excerpt"`
	CoverImage  string   `json:"cover_image"`
	AuthorName  string   `json:"author_name"`
	Content     string   `json:"content"`
	Tags        []string `json:"tags"`
	SortOrder   int      `json:"sort_order"`
	Published   bool     `json:"published"`
	PublishedAt string   `json:"published_at,omitempty"`
	UpdatedAt   string   `json:"updated_at,omitempty"`
}

const blogSelectCols = `
id::text, slug, title, excerpt, cover_image, author_name, content,
COALESCE(tags::text,'[]'), sort_order, published,
COALESCE(published_at::text,''), COALESCE(updated_at::text,'')`

func scanBlogPost(row interface{ Scan(...any) error }) (blogPostOut, error) {
	var (
		b       blogPostOut
		tagsRaw string
	)
	if err := row.Scan(&b.ID, &b.Slug, &b.Title, &b.Excerpt, &b.CoverImage, &b.AuthorName, &b.Content,
		&tagsRaw, &b.SortOrder, &b.Published, &b.PublishedAt, &b.UpdatedAt); err != nil {
		return b, err
	}
	b.Tags = parseStringArray(tagsRaw)
	if b.Tags == nil {
		b.Tags = []string{}
	}
	return b, nil
}

// parseStringArray converts a postgres text[] literal like {a,b} into []string.
func parseStringArray(raw string) []string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "{")
	raw = strings.TrimSuffix(raw, "}")
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.Trim(p, `"`)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// postgresStringArray renders a []string into a postgres text[] literal.
func postgresStringArray(tags []string) string {
	if len(tags) == 0 {
		return "{}"
	}
	quoted := make([]string, 0, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		quoted = append(quoted, `"`+strings.ReplaceAll(t, `"`, `\"`)+`"`)
	}
	if len(quoted) == 0 {
		return "{}"
	}
	return "{" + strings.Join(quoted, ",") + "}"
}

func (s *Server) handleListBlogPosts(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+blogSelectCols+`
FROM blog_posts ORDER BY published_at DESC NULLS LAST, created_at DESC`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []blogPostOut{}
	for rows.Next() {
		b, err := scanBlogPost(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handlePublicBlog lists published posts without the markdown content.
func (s *Server) handlePublicBlog(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT `+blogSelectCols+`
FROM blog_posts WHERE published = true ORDER BY published_at DESC NULLS LAST, created_at DESC`)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	out := []blogPostOut{}
	for rows.Next() {
		b, err := scanBlogPost(rows)
		if err != nil {
			return mw.WriteError(c, err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// handlePublicBlogBySlug serves one published post including content.
func (s *Server) handlePublicBlogBySlug(c fiber.Ctx) error {
	slug := strings.TrimSpace(c.Params("slug"))
	if slug == "" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug is required"))
	}
	var b blogPostOut
	var tagsRaw string
	err := s.db.QueryRow(c.Context(), `SELECT `+blogSelectCols+`
FROM blog_posts WHERE slug=$1 AND published = true`, slug).
		Scan(&b.ID, &b.Slug, &b.Title, &b.Excerpt, &b.CoverImage, &b.AuthorName, &b.Content,
			&tagsRaw, &b.SortOrder, &b.Published, &b.PublishedAt, &b.UpdatedAt)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "post not found"))
	}
	b.Tags = parseStringArray(tagsRaw)
	if b.Tags == nil {
		b.Tags = []string{}
	}
	return mw.JSON(c, 200, b, nil)
}

type blogInput struct {
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Excerpt     string   `json:"excerpt"`
	CoverImage  string   `json:"cover_image"`
	AuthorName  string   `json:"author_name"`
	Content     string   `json:"content"`
	Tags        []string `json:"tags"`
	SortOrder   *int     `json:"sort_order"`
	Published   *bool    `json:"published"`
	PublishedAt *string  `json:"published_at"`
}

func (s *Server) handleCreateBlogPost(c fiber.Ctx) error {
	var in blogInput
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
	author := strings.TrimSpace(in.AuthorName)
	if author == "" {
		author = "Kilat Cloud"
	}
	publishedAt := (*time.Time)(nil)
	if in.PublishedAt != nil && *in.PublishedAt != "" {
		if t, perr := time.Parse(time.RFC3339, *in.PublishedAt); perr == nil {
			publishedAt = &t
		}
	}
	tags := postgresStringArray(in.Tags)
	var id uuid.UUID
	err := s.db.QueryRow(c.Context(), `
INSERT INTO blog_posts (slug, title, excerpt, cover_image, author_name, content, tags, sort_order, published, published_at)
VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10) RETURNING id`,
		slug, in.Title, in.Excerpt, in.CoverImage, author, in.Content, tags, sortOrder, published, publishedAt).Scan(&id)
	if err != nil {
		if isUniqueViolation(err, "blog_posts_slug_key") {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug already exists"))
		}
		return mw.WriteError(c, err)
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.blog.created", "blog_post", id, fiber.Map{"slug": slug, "title": in.Title}))
	return mw.JSON(c, 201, fiber.Map{"id": id, "slug": slug, "status": "created"}, nil)
}

func (s *Server) handleUpdateBlogPost(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	var in blogInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	if slug != "" && !validSlug(slug) {
		return mw.WriteError(c, vErrField("slug", "must be lowercase letters, numbers, -, _, / or ."))
	}
	var publishedAt any = nil
	if in.PublishedAt != nil && *in.PublishedAt != "" {
		publishedAt = *in.PublishedAt
	}
	tags := postgresStringArray(in.Tags)
	ct, err := s.db.Exec(c.Context(), `
UPDATE blog_posts SET
  slug         = CASE WHEN $2 = '' THEN slug ELSE $2 END,
  title        = CASE WHEN $3 = '' THEN title ELSE $3 END,
  excerpt      = $4,
  cover_image  = $5,
  author_name  = CASE WHEN $6 = '' THEN author_name ELSE $6 END,
  content      = $7,
  tags         = $8::text[],
  sort_order   = COALESCE($9, sort_order),
  published    = COALESCE($10, published),
  published_at = COALESCE($11, published_at),
  updated_at   = now()
WHERE id = $1`,
		id, slug, in.Title, in.Excerpt, in.CoverImage, in.AuthorName, in.Content, tags, in.SortOrder, in.Published, publishedAt)
	if err != nil {
		if isUniqueViolation(err, "blog_posts_slug_key") {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "slug already exists"))
		}
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "post not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.blog.updated", "blog_post", id, fiber.Map{"slug": slug, "title": in.Title}))
	return mw.JSON(c, 200, fiber.Map{"id": id, "status": "updated"}, nil)
}

func (s *Server) handleDeleteBlogPost(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "invalid id"))
	}
	ct, err := s.db.Exec(c.Context(), `DELETE FROM blog_posts WHERE id=$1`, id)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ct.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "post not found"))
	}
	adminID := mustUserID(c)
	s.auditSvc.Log(c.Context(), auditEntry(c, uuid.Nil, &adminID, "admin.blog.deleted", "blog_post", id, fiber.Map{}))
	return c.SendStatus(204)
}
