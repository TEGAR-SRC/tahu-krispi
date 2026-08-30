-- Documentation pages and landing media uploads. Docs are CRUD-ed by staff
-- (admin/NOC, area "marketing") and served publicly. landing_media stores
-- uploaded logo/image bytes for the landing page and docs (served publicly).
CREATE TABLE IF NOT EXISTS docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',   -- markdown body
  sort_order  integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_docs_slug ON docs (slug);
CREATE INDEX IF NOT EXISTS ix_docs_published ON docs (published, sort_order);

CREATE TABLE IF NOT EXISTS landing_media (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename   text NOT NULL,
  mime_type  text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_landing_media_created ON landing_media (created_at DESC);
