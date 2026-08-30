-- Blog posts. CRUD-ed by staff (admin/NOC, area "marketing") and served
-- publicly. slug is the URL path; content is markdown with syntax highlighting
-- on the public blog site. Featured/cover images come from landing_media.
CREATE TABLE IF NOT EXISTS blog_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  excerpt     text NOT NULL DEFAULT '',
  cover_image text NOT NULL DEFAULT '',      -- media URL (landing_media)
  author_name text NOT NULL DEFAULT 'Kilat Cloud',
  content     text NOT NULL DEFAULT '',      -- markdown body
  tags        text[] NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_blog_posts_slug ON blog_posts (slug);
CREATE INDEX IF NOT EXISTS ix_blog_posts_published ON blog_posts (published, published_at DESC);
