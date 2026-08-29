-- Landing / marketing content sections. Each row is one content block the
-- staff console edits (hero, features, pricing, testimonials, faq, blog,
-- banners). body is plain text; data is free-form JSON for lists/images/links.
-- published=true rows are served by the public GET /landing endpoint.
CREATE TABLE IF NOT EXISTS landing_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,             -- hero | features | pricing | testimonials | faq | blog | banner
  title       text NOT NULL DEFAULT '',
  subtitle    text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  media_url   text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order  integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_landing_sections_key ON landing_sections (section_key, sort_order);
CREATE INDEX IF NOT EXISTS ix_landing_sections_published ON landing_sections (published);
