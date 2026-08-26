-- 000002_user_addresses.sql
-- Master Prompt §16: normalize addresses out of user_profiles into user_addresses
-- so one user can hold home/billing/legal/company/other addresses.
-- Old address columns on user_profiles stop being used (kept for backward-aware rollback).

CREATE TABLE IF NOT EXISTS user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('home','billing','legal','company','other')),
  label text,

  recipient_name text,
  company_name text,

  country_code char(2),
  province text,
  city_or_regency text,
  district text,
  subdistrict text,

  postal_code text,

  address_line1 text,
  address_line2 text,

  rt text,
  rw text,

  contact_phone_e164 text CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),

  is_default boolean NOT NULL DEFAULT false,
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_addresses_default
ON user_addresses(user_id, type) WHERE (is_default AND deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS ix_user_addresses_user ON user_addresses(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_user_addresses_updated_at BEFORE UPDATE ON user_addresses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: one billing-type address per user from legacy profile columns (only when present).
INSERT INTO user_addresses(user_id, type, recipient_name, company_name, country_code, province, city_or_regency, postal_code, address_line1, address_line2, is_default)
SELECT p.user_id, 'billing', p.full_name, p.company_name, p.country_code, p.province, p.city, p.postal_code, p.address_line1, p.address_line2, true
FROM user_profiles p
WHERE (p.address_line1 IS NOT NULL OR p.city IS NOT NULL OR p.postal_code IS NOT NULL)
ON CONFLICT DO NOTHING;
