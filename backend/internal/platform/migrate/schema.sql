-- Kilat Cloud PostgreSQL Schema v2.0
-- PostgreSQL 16+
-- Backend: Go (recommended: Fiber + pgx/sqlc or Bun/GORM if preferred)
-- Authentication: Argon2id PHC strings; Redis for ephemeral sessions/OTP/rate limits
-- Object storage: S3-compatible / Cloudflare R2; PostgreSQL stores metadata only
-- Provider model: Onidel first, extensible to Proxmox/VMware/XCP-ng/etc.
--
-- IMPORTANT SECURITY MODEL
-- * users.password_hash stores a complete Argon2id PHC string including random salt.
-- * Reversible credentials (provider tokens, TOTP secrets, S3 secret keys, webhook secrets)
--   are encrypted by the application with envelope encryption/KMS. Never store plaintext.
-- * Redis is not the source of truth for users, orders, payments, or cloud resources.
-- * Provider IDs are kept separate from Kilat Cloud internal UUIDs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE account_status AS ENUM ('pending','active','suspended','disabled','closed');
CREATE TYPE verification_status AS ENUM ('unverified','pending','verified','rejected');
CREATE TYPE member_role AS ENUM ('owner','admin','billing','operator','developer','viewer');
CREATE TYPE resource_status AS ENUM ('draft','pending','provisioning','active','stopped','suspended','deleting','deleted','failed','unknown');
CREATE TYPE sync_status AS ENUM ('never','queued','syncing','synced','failed');
CREATE TYPE billing_period AS ENUM ('hourly','daily','monthly','quarterly','semiannual','annual','one_time');
CREATE TYPE price_mode AS ENUM ('fixed_plan','custom_resource','manual_quote');
CREATE TYPE order_status AS ENUM ('draft','pending_payment','paid','processing','completed','cancelled','failed','refunded');
CREATE TYPE invoice_status AS ENUM ('draft','unpaid','paid','overdue','void','refunded','partially_refunded');
CREATE TYPE payment_status AS ENUM ('pending','processing','paid','failed','expired','cancelled','refunded','partially_refunded');
CREATE TYPE ledger_direction AS ENUM ('credit','debit');
CREATE TYPE subscription_status AS ENUM ('pending','active','past_due','suspended','cancelled','expired');
CREATE TYPE api_key_status AS ENUM ('active','revoked','expired');
CREATE TYPE api_key_owner_type AS ENUM ('user','organization');
CREATE TYPE ticket_status AS ENUM ('open','waiting_customer','waiting_staff','resolved','closed');
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE notification_channel AS ENUM ('email','web','whatsapp','telegram','sms','push');
CREATE TYPE object_visibility AS ENUM ('private','public');
CREATE TYPE address_change_kind AS ENUM ('email','phone');
CREATE TYPE change_request_status AS ENUM ('pending','verified','applied','cancelled','expired');
CREATE TYPE provider_action_status AS ENUM ('queued','running','success','failed','cancelled');
CREATE TYPE service_kind AS ENUM ('vm','object_storage','bare_metal','block_storage','database','kubernetes','hosting','domain','other');

-- ============================================================
-- COMMON FUNCTIONS / TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_negative_wallet_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance < 0 THEN
    RAISE EXCEPTION 'wallet balance cannot be negative';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- IDENTITY / USERS
-- ============================================================
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('usr_' || encode(gen_random_bytes(10), 'hex')),
  email citext NOT NULL,
  phone_e164 text,
  username citext,

  password_hash text NOT NULL,
  password_algorithm text NOT NULL DEFAULT 'argon2id' CHECK (password_algorithm = 'argon2id'),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  password_version integer NOT NULL DEFAULT 1 CHECK (password_version > 0),
  force_password_change boolean NOT NULL DEFAULT false,

  email_status verification_status NOT NULL DEFAULT 'unverified',
  email_verified_at timestamptz,
  phone_status verification_status NOT NULL DEFAULT 'unverified',
  phone_verified_at timestamptz,

  status account_status NOT NULL DEFAULT 'pending',
  locale text NOT NULL DEFAULT 'id-ID',
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',

  signup_ip inet,
  signup_user_agent text,
  last_login_at timestamptz,
  last_login_ip inet,
  last_login_user_agent text,
  last_seen_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,

  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  marketing_consent_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT users_email_nonempty CHECK (length(trim(email::text)) >= 3),
  CONSTRAINT users_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT users_username_check CHECK (username IS NULL OR username::text ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$')
);

-- No duplicate active email/phone. A pending phone change is separately reserved below.
CREATE UNIQUE INDEX ux_users_email_live ON users (lower(email::text)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_users_phone_live ON users (phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_users_username_live ON users (lower(username::text)) WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_users_last_seen ON users (last_seen_at DESC);
CREATE INDEX ix_users_status ON users (status) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name text,
  display_name text,
  company_name text,
  date_of_birth date,
  country_code char(2),
  province text,
  city text,
  postal_code text,
  address_line1 text,
  address_line2 text,
  tax_id text,
  avatar_object_id uuid,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contact_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind address_change_kind NOT NULL,
  old_value citext,
  new_value citext NOT NULL,
  status change_request_status NOT NULL DEFAULT 'pending',
  verification_token_hash text,
  otp_hash text,
  requested_ip inet,
  requested_user_agent text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_contact_change_user ON contact_change_requests(user_id, created_at DESC);
CREATE INDEX ix_contact_change_pending ON contact_change_requests(kind, new_value) WHERE status = 'pending';

-- Prevent two users from simultaneously reserving the same pending phone/email change.
CREATE UNIQUE INDEX ux_pending_phone_change
ON contact_change_requests(lower(new_value::text))
WHERE kind = 'phone' AND status = 'pending';
CREATE UNIQUE INDEX ux_pending_email_change
ON contact_change_requests(lower(new_value::text))
WHERE kind = 'email' AND status = 'pending';

CREATE TABLE password_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_algorithm text NOT NULL DEFAULT 'argon2id',
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_ip inet,
  changed_user_agent text
);
CREATE INDEX ix_password_history_user ON password_history(user_id, changed_at DESC);

CREATE TABLE user_mfa_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('totp','webauthn','recovery_codes')),
  label text,
  secret_ciphertext bytea,
  credential_id bytea,
  credential_public_key bytea,
  sign_count bigint,
  transports text[],
  enabled boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_mfa_user ON user_mfa_methods(user_id);
CREATE TRIGGER trg_user_mfa_updated_at BEFORE UPDATE ON user_mfa_methods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE oauth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  provider_email citext,
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX ix_oauth_user ON oauth_accounts(user_id);
CREATE TRIGGER trg_oauth_updated_at BEFORE UPDATE ON oauth_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, code_hash)
);

CREATE TABLE auth_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  success boolean NOT NULL,
  ip inet,
  user_agent text,
  request_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_events_user_time ON auth_events(user_id, created_at DESC);
CREATE INDEX ix_auth_events_ip_time ON auth_events(ip, created_at DESC);

-- Durable refresh-token / session index. Raw token is NEVER stored.
-- Redis may hold the hot session body and TTL; this table supports revoke-all/audit/device views.
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  refresh_token_hash bytea NOT NULL UNIQUE,
  device_name text,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX ix_user_sessions_user_live ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;

-- ============================================================
-- ORGANIZATIONS / IAM
-- ============================================================
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('org_' || encode(gen_random_bytes(10), 'hex')),
  slug citext NOT NULL,
  name text NOT NULL,
  status account_status NOT NULL DEFAULT 'active',
  billing_email citext,
  billing_phone_e164 text,
  country_code char(2),
  legal_name text,
  tax_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT organizations_slug_check CHECK (slug::text ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}$')
);
CREATE UNIQUE INDEX ux_organizations_slug_live ON organizations(lower(slug::text)) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'viewer',
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX ix_org_members_user ON organization_members(user_id);
CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role member_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_org_invites_org ON organization_invitations(organization_id, created_at DESC);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('key_' || encode(gen_random_bytes(10), 'hex')),
  owner_type api_key_owner_type NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  key_prefix text NOT NULL UNIQUE,
  secret_hash bytea NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  allowed_ips inet[] NOT NULL DEFAULT '{}',
  status api_key_status NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT api_key_owner_exactly_one CHECK (
    (owner_type = 'user' AND user_id IS NOT NULL AND organization_id IS NULL)
    OR
    (owner_type = 'organization' AND organization_id IS NOT NULL)
  )
);
CREATE INDEX ix_api_keys_user ON api_keys(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ix_api_keys_org ON api_keys(organization_id) WHERE organization_id IS NOT NULL;

-- ============================================================
-- OBJECT STORAGE METADATA FOR KILAT INTERNAL FILES (R2/S3)
-- ============================================================
CREATE TABLE object_storage_backends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  driver text NOT NULL CHECK (driver IN ('s3','r2','minio')),
  endpoint text,
  region text,
  bucket_name text NOT NULL,
  public_base_url text,
  credentials_ciphertext bytea,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_object_backends_updated_at BEFORE UPDATE ON object_storage_backends FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stored_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_backend_id uuid NOT NULL REFERENCES object_storage_backends(id),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  object_key text NOT NULL,
  purpose text NOT NULL,
  visibility object_visibility NOT NULL DEFAULT 'private',
  original_filename text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  etag text,
  sha256 text,
  encryption text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(storage_backend_id, object_key)
);
CREATE INDEX ix_stored_objects_owner ON stored_objects(owner_user_id, created_at DESC);
CREATE INDEX ix_stored_objects_org ON stored_objects(organization_id, created_at DESC);
CREATE INDEX ix_stored_objects_purpose ON stored_objects(purpose, created_at DESC);

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_avatar_object
  FOREIGN KEY (avatar_object_id) REFERENCES stored_objects(id) ON DELETE SET NULL;

CREATE TABLE user_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  object_id uuid NOT NULL REFERENCES stored_objects(id) ON DELETE RESTRICT,
  verification_status verification_status NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_documents_user ON user_documents(user_id, document_type);
CREATE TRIGGER trg_user_documents_updated_at BEFORE UPDATE ON user_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- CLOUD PROVIDER ABSTRACTION
-- ============================================================
CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('onidel','proxmox','vmware','xcpng','hyperv','custom')),
  api_base_url text,
  credentials_ciphertext bytea,
  enabled boolean NOT NULL DEFAULT true,
  health_status text NOT NULL DEFAULT 'unknown',
  last_health_check_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_providers_updated_at BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One organization may map to a provider team/account.
CREATE TABLE provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_account_id text,
  external_account_name text,
  external_role text,
  credentials_ciphertext bytea,
  sync_status sync_status NOT NULL DEFAULT 'never',
  last_synced_at timestamptz,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, organization_id),
  UNIQUE(provider_id, external_account_id)
);
CREATE TRIGGER trg_provider_accounts_updated_at BEFORE UPDATE ON provider_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id text,
  code citext NOT NULL,
  name text NOT NULL,
  country_code char(2),
  city text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  UNIQUE(provider_id, code)
);
CREATE INDEX ix_regions_enabled ON regions(provider_id, enabled);

CREATE TABLE instance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  code citext,
  name text NOT NULL,
  category text,
  min_vcpu integer,
  max_vcpu integer,
  min_ram_mb integer,
  max_ram_mb integer,
  min_disk_gb integer,
  max_disk_gb integer,
  enabled boolean NOT NULL DEFAULT true,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  UNIQUE(provider_id, external_id)
);

CREATE TABLE os_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  family text,
  version text,
  architecture text,
  min_disk_gb integer,
  enabled boolean NOT NULL DEFAULT true,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  UNIQUE(provider_id, external_id)
);

-- Generic record of every provider API action. This is important for retries,
-- debugging, idempotency, and making sure a failed HTTP request does not create duplicates.
CREATE TABLE provider_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  internal_resource_id uuid,
  external_resource_id text,
  idempotency_key text,
  request_method text,
  request_path text,
  request_payload jsonb,
  response_status_code integer,
  response_payload jsonb,
  status provider_action_status NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, idempotency_key)
);
CREATE INDEX ix_provider_actions_resource ON provider_actions(resource_type, internal_resource_id, created_at DESC);
CREATE INDEX ix_provider_actions_retry ON provider_actions(status, created_at) WHERE status IN ('queued','failed');

CREATE TABLE provider_sync_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  cursor_value text,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, provider_account_id, resource_type)
);

-- ============================================================
-- CATALOG / PACKAGES / CUSTOM RESOURCE PRICING
-- ============================================================
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  service_kind service_kind NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Fixed packages, e.g. 2 vCPU / 4 GB / 80 GB / 2 TB bandwidth.
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code citext NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_mode price_mode NOT NULL DEFAULT 'fixed_plan',
  provider_id uuid REFERENCES providers(id),
  instance_type_id uuid REFERENCES instance_types(id),
  enabled boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,

  vcpu integer CHECK (vcpu IS NULL OR vcpu > 0),
  ram_mb integer CHECK (ram_mb IS NULL OR ram_mb > 0),
  disk_gb integer CHECK (disk_gb IS NULL OR disk_gb > 0),
  additional_hdd_gb integer NOT NULL DEFAULT 0 CHECK (additional_hdd_gb >= 0),
  bandwidth_gb bigint CHECK (bandwidth_gb IS NULL OR bandwidth_gb >= 0),
  ipv4_count integer NOT NULL DEFAULT 1 CHECK (ipv4_count >= 0),
  ipv6_count integer NOT NULL DEFAULT 1 CHECK (ipv6_count >= 0),
  backup_slots integer NOT NULL DEFAULT 0 CHECK (backup_slots >= 0),
  snapshot_slots integer NOT NULL DEFAULT 0 CHECK (snapshot_slots >= 0),
  network_rate_mbps integer CHECK (network_rate_mbps IS NULL OR network_rate_mbps > 0),

  setup_fee numeric(20,4) NOT NULL DEFAULT 0 CHECK (setup_fee >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_plans_product ON plans(product_id, enabled, sort_order);
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE plan_regions (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  provider_cost_override numeric(20,4),
  stock_limit integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(plan_id, region_id)
);

CREATE TABLE plan_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  region_id uuid REFERENCES regions(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'IDR',
  billing_period billing_period NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount >= 0),
  provider_cost numeric(20,4) CHECK (provider_cost IS NULL OR provider_cost >= 0),
  minimum_charge numeric(20,4) NOT NULL DEFAULT 0 CHECK (minimum_charge >= 0),
  active_from timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_prices_time CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE INDEX ix_plan_prices_lookup ON plan_prices(plan_id, region_id, currency, billing_period, active_from DESC);

-- Custom builder dimensions. Example dimension codes:
-- vcpu, ram_gb, nvme_gb, hdd_gb, bandwidth_gb, ipv4, ipv6, backup_gb, snapshot_gb.
CREATE TABLE resource_dimensions (
  code citext PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('integer','decimal','boolean')),
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE custom_resource_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE,
  region_id uuid REFERENCES regions(id) ON DELETE CASCADE,
  instance_type_id uuid REFERENCES instance_types(id) ON DELETE SET NULL,
  dimension_code citext NOT NULL REFERENCES resource_dimensions(code),
  currency char(3) NOT NULL DEFAULT 'IDR',
  billing_period billing_period NOT NULL DEFAULT 'monthly',
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  provider_unit_cost numeric(20,6) CHECK (provider_unit_cost IS NULL OR provider_unit_cost >= 0),
  included_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (included_quantity >= 0),
  min_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  max_quantity numeric(20,6),
  step_quantity numeric(20,6) NOT NULL DEFAULT 1 CHECK (step_quantity > 0),
  active_from timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT custom_rate_max CHECK (max_quantity IS NULL OR max_quantity >= min_quantity),
  CONSTRAINT custom_rate_time CHECK (active_until IS NULL OR active_until > active_from)
);
CREATE INDEX ix_custom_rates_lookup ON custom_resource_rates(product_id, region_id, dimension_code, currency, billing_period, active_from DESC);

CREATE TABLE price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES products(id),
  plan_id uuid REFERENCES plans(id),
  region_id uuid REFERENCES regions(id),
  provider_id uuid REFERENCES providers(id),
  price_mode price_mode NOT NULL,
  currency char(3) NOT NULL DEFAULT 'IDR',
  billing_period billing_period NOT NULL,
  requested_resources jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  discount numeric(20,4) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  provider_estimated_cost numeric(20,4),
  provider_price_payload jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_price_quotes_org ON price_quotes(organization_id, created_at DESC);

-- Seed common custom dimensions.
INSERT INTO resource_dimensions(code,name,unit,value_type,sort_order) VALUES
  ('vcpu','vCPU','vCPU','integer',10),
  ('ram_gb','RAM','GB','decimal',20),
  ('nvme_gb','NVMe Storage','GB','decimal',30),
  ('hdd_gb','HDD Storage','GB','decimal',40),
  ('bandwidth_gb','Bandwidth','GB','decimal',50),
  ('ipv4','IPv4 Address','IP','integer',60),
  ('ipv6','IPv6 Address','IP','integer',70),
  ('backup_gb','Backup Storage','GB','decimal',80),
  ('snapshot_gb','Snapshot Storage','GB','decimal',90)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SSH KEYS / STARTUP SCRIPTS (ONIDEL)
-- ============================================================
CREATE TABLE ssh_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE,
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_ssh_key_id text,
  name text NOT NULL,
  public_key text NOT NULL,
  fingerprint text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_ssh_key_id)
);
CREATE UNIQUE INDEX ux_ssh_keys_org_fingerprint ON ssh_keys(organization_id, fingerprint) WHERE fingerprint IS NOT NULL AND deleted_at IS NULL;
CREATE TRIGGER trg_ssh_keys_updated_at BEFORE UPDATE ON ssh_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE startup_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES providers(id) ON DELETE CASCADE,
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_script_id text,
  name text NOT NULL,
  content text NOT NULL,
  content_sha256 text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_script_id)
);
CREATE INDEX ix_startup_scripts_org ON startup_scripts(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_startup_scripts_updated_at BEFORE UPDATE ON startup_scripts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- COMPUTE / VM (ONIDEL)
-- ============================================================
CREATE TABLE instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('vm_' || encode(gen_random_bytes(10), 'hex')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_vm_id text,
  product_id uuid REFERENCES products(id),
  plan_id uuid REFERENCES plans(id),
  subscription_id uuid,
  region_id uuid REFERENCES regions(id),
  instance_type_id uuid REFERENCES instance_types(id),
  os_template_id uuid REFERENCES os_templates(id),

  name text NOT NULL,
  hostname text,
  status resource_status NOT NULL DEFAULT 'pending',
  power_status text,

  pricing_mode price_mode NOT NULL DEFAULT 'fixed_plan',
  billing_period billing_period NOT NULL DEFAULT 'monthly',
  currency char(3) NOT NULL DEFAULT 'IDR',
  recurring_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (recurring_amount >= 0),

  vcpu integer NOT NULL CHECK (vcpu > 0),
  ram_mb integer NOT NULL CHECK (ram_mb > 0),
  disk_gb integer NOT NULL CHECK (disk_gb > 0),
  additional_hdd_gb integer NOT NULL DEFAULT 0 CHECK (additional_hdd_gb >= 0),
  bandwidth_gb bigint CHECK (bandwidth_gb IS NULL OR bandwidth_gb >= 0),
  network_rate_mbps integer CHECK (network_rate_mbps IS NULL OR network_rate_mbps > 0),

  primary_ipv4 inet,
  primary_ipv6 inet,
  bgp_enabled boolean NOT NULL DEFAULT false,
  measured_boot_enabled boolean NOT NULL DEFAULT false,
  auto_backup_enabled boolean NOT NULL DEFAULT false,

  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_status sync_status NOT NULL DEFAULT 'never',
  last_synced_at timestamptz,
  provision_started_at timestamptz,
  provisioned_at timestamptz,
  suspended_at timestamptz,
  termination_requested_at timestamptz,
  terminated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_vm_id)
);
CREATE INDEX ix_instances_org_status ON instances(organization_id, status, created_at DESC);
CREATE INDEX ix_instances_provider_sync ON instances(provider_id, sync_status, last_synced_at);
CREATE INDEX ix_instances_external ON instances(provider_id, external_vm_id) WHERE external_vm_id IS NOT NULL;
CREATE TRIGGER trg_instances_updated_at BEFORE UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE instance_ip_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES providers(id),
  external_ip_id text,
  address inet NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_reserved boolean NOT NULL DEFAULT false,
  mac_address macaddr,
  gateway inet,
  ptr_record text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id, address)
);
CREATE INDEX ix_instance_ips_address ON instance_ip_addresses(address);
CREATE UNIQUE INDEX ux_instance_primary_v4 ON instance_ip_addresses(instance_id) WHERE is_primary AND family(address) = 4;
CREATE UNIQUE INDEX ux_instance_primary_v6 ON instance_ip_addresses(instance_id) WHERE is_primary AND family(address) = 6;
CREATE TRIGGER trg_instance_ips_updated_at BEFORE UPDATE ON instance_ip_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vm_configuration_history (
  id bigserial PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('user','admin','provider_sync','system')),
  old_config jsonb,
  new_config jsonb NOT NULL,
  provider_action_id uuid REFERENCES provider_actions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vm_config_history_instance ON vm_configuration_history(instance_id, created_at DESC);

-- Onidel VNC/noVNC sessions are ephemeral credentials. Keep only metadata/history here.
CREATE TABLE vm_console_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_action_id uuid REFERENCES provider_actions(id) ON DELETE SET NULL,
  console_type text NOT NULL DEFAULT 'novnc',
  provider_session_id text,
  url_ciphertext bytea,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX ix_console_sessions_instance ON vm_console_sessions(instance_id, created_at DESC);

CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  instance_id uuid REFERENCES instances(id) ON DELETE SET NULL,
  external_snapshot_id text,
  name text NOT NULL,
  description text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status resource_status NOT NULL DEFAULT 'pending',
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_snapshot_id)
);
CREATE INDEX ix_snapshots_instance ON snapshots(instance_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE snapshot_download_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  url_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  instance_id uuid REFERENCES instances(id) ON DELETE SET NULL,
  external_backup_id text,
  name text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status resource_status NOT NULL DEFAULT 'pending',
  copied_object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  checksum_sha256 text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  provider_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE(provider_id, external_backup_id)
);
CREATE INDEX ix_backups_instance ON backups(instance_id, created_at DESC);

CREATE TABLE backup_download_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id uuid NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  url_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_isos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_iso_id text,
  name text NOT NULL,
  source_url text,
  source_object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status resource_status NOT NULL DEFAULT 'pending',
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_iso_id)
);
CREATE INDEX ix_custom_isos_org ON custom_isos(organization_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE measured_boot_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_image_id text,
  name text NOT NULL,
  filename text,
  description text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  source_object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_image_id)
);
CREATE INDEX ix_measured_boot_org ON measured_boot_images(organization_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE instance_measured_boot_attachments (
  instance_id uuid PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES measured_boot_images(id) ON DELETE RESTRICT,
  external_attachment_id text,
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================================
-- NETWORKING: VPC / FIREWALL / IP LIST / RESERVED IP / RDNS
-- ============================================================
CREATE TABLE vpcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_vpc_id text,
  region_id uuid REFERENCES regions(id),
  name text NOT NULL,
  description text,
  ipv4_cidr cidr,
  status resource_status NOT NULL DEFAULT 'pending',
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_vpc_id)
);
CREATE INDEX ix_vpcs_org ON vpcs(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_vpcs_updated_at BEFORE UPDATE ON vpcs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vpc_instance_links (
  vpc_id uuid NOT NULL REFERENCES vpcs(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  private_ip inet,
  mac_address macaddr,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  PRIMARY KEY(vpc_id, instance_id)
);

CREATE TABLE firewall_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_firewall_id text,
  name text NOT NULL,
  description text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_firewall_id)
);
CREATE INDEX ix_firewall_groups_org ON firewall_groups(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_firewalls_updated_at BEFORE UPDATE ON firewall_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE firewall_instance_links (
  firewall_group_id uuid NOT NULL REFERENCES firewall_groups(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  PRIMARY KEY(firewall_group_id, instance_id)
);

CREATE TABLE ip_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_ip_list_id text,
  name text NOT NULL,
  description text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_ip_list_id)
);
CREATE INDEX ix_ip_lists_org ON ip_lists(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_ip_lists_updated_at BEFORE UPDATE ON ip_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ip_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_list_id uuid NOT NULL REFERENCES ip_lists(id) ON DELETE CASCADE,
  external_entry_id text,
  network cidr NOT NULL,
  description text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ip_list_id, network),
  UNIQUE(ip_list_id, external_entry_id)
);

CREATE TABLE firewall_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firewall_group_id uuid NOT NULL REFERENCES firewall_groups(id) ON DELETE CASCADE,
  external_rule_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','ingress','egress')),
  protocol text NOT NULL,
  port_from integer CHECK (port_from IS NULL OR port_from BETWEEN 0 AND 65535),
  port_to integer CHECK (port_to IS NULL OR port_to BETWEEN 0 AND 65535),
  source_cidr cidr,
  destination_cidr cidr,
  source_ip_list_id uuid REFERENCES ip_lists(id) ON DELETE SET NULL,
  destination_ip_list_id uuid REFERENCES ip_lists(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'allow',
  priority integer,
  description text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firewall_port_range CHECK (port_from IS NULL OR port_to IS NULL OR port_to >= port_from),
  UNIQUE(firewall_group_id, external_rule_id)
);
CREATE INDEX ix_firewall_rules_group ON firewall_rules(firewall_group_id);
CREATE TRIGGER trg_firewall_rules_updated_at BEFORE UPDATE ON firewall_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reserved_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_reserved_ip_id text,
  region_id uuid REFERENCES regions(id),
  name text,
  address inet,
  status resource_status NOT NULL DEFAULT 'pending',
  attached_instance_id uuid REFERENCES instances(id) ON DELETE SET NULL,
  converted_from_instance_id uuid REFERENCES instances(id) ON DELETE SET NULL,
  monthly_amount numeric(20,4) CHECK (monthly_amount IS NULL OR monthly_amount >= 0),
  currency char(3),
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_reserved_ip_id),
  UNIQUE(provider_id, address)
);
CREATE INDEX ix_reserved_ips_org ON reserved_ips(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_reserved_ips_updated_at BEFORE UPDATE ON reserved_ips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reverse_dns_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id),
  instance_id uuid REFERENCES instances(id) ON DELETE CASCADE,
  reserved_ip_id uuid REFERENCES reserved_ips(id) ON DELETE CASCADE,
  address inet NOT NULL,
  ptr_record text NOT NULL,
  external_id text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reverse_dns_owner CHECK (instance_id IS NOT NULL OR reserved_ip_id IS NOT NULL),
  UNIQUE(provider_id, address)
);
CREATE TRIGGER trg_rdns_updated_at BEFORE UPDATE ON reverse_dns_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bgp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id),
  enabled boolean NOT NULL DEFAULT false,
  customer_asn bigint,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id, provider_id)
);

-- ============================================================
-- ONIDEL OBJECT STORAGE SERVICE / BUCKET / ACCESS KEYS
-- ============================================================
CREATE TABLE object_storage_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('s3_' || encode(gen_random_bytes(10), 'hex')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  external_service_id text,
  product_id uuid REFERENCES products(id),
  plan_id uuid REFERENCES plans(id),
  subscription_id uuid,
  name text NOT NULL,
  region_id uuid REFERENCES regions(id),
  endpoint text,
  status resource_status NOT NULL DEFAULT 'pending',
  capacity_bytes bigint CHECK (capacity_bytes IS NULL OR capacity_bytes >= 0),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  upload_usage_bytes bigint NOT NULL DEFAULT 0 CHECK (upload_usage_bytes >= 0),
  download_usage_bytes bigint NOT NULL DEFAULT 0 CHECK (download_usage_bytes >= 0),
  object_count bigint NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  recurring_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (recurring_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'IDR',
  billing_period billing_period NOT NULL DEFAULT 'monthly',
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_status sync_status NOT NULL DEFAULT 'never',
  last_synced_at timestamptz,
  provisioned_at timestamptz,
  renewal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_service_id)
);
CREATE INDEX ix_object_storage_services_org ON object_storage_services(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_object_storage_services_updated_at BEFORE UPDATE ON object_storage_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE storage_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  storage_service_id uuid NOT NULL REFERENCES object_storage_services(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(id),
  external_bucket_id text,
  bucket_name text NOT NULL,
  endpoint text,
  region text,
  versioning_enabled boolean NOT NULL DEFAULT false,
  object_lock_enabled boolean NOT NULL DEFAULT false,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(provider_id, external_bucket_id),
  UNIQUE(provider_id, bucket_name)
);
CREATE INDEX ix_storage_buckets_service ON storage_buckets(storage_service_id) WHERE deleted_at IS NULL;

CREATE TABLE storage_access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_service_id uuid REFERENCES object_storage_services(id) ON DELETE CASCADE,
  bucket_id uuid REFERENCES storage_buckets(id) ON DELETE CASCADE,
  external_key_id text,
  name text,
  access_key_id text NOT NULL,
  secret_ciphertext bytea NOT NULL,
  status api_key_status NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT storage_access_key_owner CHECK (storage_service_id IS NOT NULL OR bucket_id IS NOT NULL),
  UNIQUE(access_key_id)
);

-- ============================================================
-- BILLING / WALLET / ORDERS / SUBSCRIPTIONS
-- ============================================================
CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  currency char(3) NOT NULL DEFAULT 'IDR',
  balance numeric(20,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_balance numeric(20,4) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, currency)
);
CREATE TRIGGER trg_wallet_nonnegative BEFORE INSERT OR UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION prevent_negative_wallet_balance();

CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  direction ledger_direction NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  balance_before numeric(20,4) NOT NULL,
  balance_after numeric(20,4) NOT NULL,
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wallet_id, idempotency_key)
);
CREATE INDEX ix_wallet_transactions_wallet ON wallet_transactions(wallet_id, created_at DESC);

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code citext NOT NULL UNIQUE,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('fixed','percent')),
  discount_value numeric(20,4) NOT NULL CHECK (discount_value > 0),
  currency char(3),
  max_discount numeric(20,4),
  min_order_amount numeric(20,4) NOT NULL DEFAULT 0,
  max_redemptions integer,
  per_user_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_coupons_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('ord_' || encode(gen_random_bytes(10), 'hex')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES price_quotes(id) ON DELETE SET NULL,
  coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
  currency char(3) NOT NULL DEFAULT 'IDR',
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  discount numeric(20,4) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  status order_status NOT NULL DEFAULT 'draft',
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE(organization_id, idempotency_key)
);
CREATE INDEX ix_orders_org ON orders(organization_id, created_at DESC);
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  plan_id uuid REFERENCES plans(id),
  region_id uuid REFERENCES regions(id),
  service_kind service_kind NOT NULL,
  description text NOT NULL,
  quantity numeric(20,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(20,4) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  billing_period billing_period,
  resource_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_id uuid REFERENCES providers(id),
  provider_estimated_cost numeric(20,4),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_order_items_order ON order_items(order_id);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('inv_' || encode(gen_random_bytes(10), 'hex')),
  invoice_number text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  currency char(3) NOT NULL DEFAULT 'IDR',
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  discount numeric(20,4) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  amount_paid numeric(20,4) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_due numeric(20,4) NOT NULL CHECK (amount_due >= 0),
  status invoice_status NOT NULL DEFAULT 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  pdf_object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_invoices_org_status ON invoices(organization_id, status, created_at DESC);
CREATE INDEX ix_invoices_due ON invoices(due_at) WHERE status IN ('unpaid','overdue');
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(20,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(20,4) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('pay_' || encode(gen_random_bytes(10), 'hex')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  provider text NOT NULL,
  method text,
  external_payment_id text,
  external_reference text,
  currency char(3) NOT NULL DEFAULT 'IDR',
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  fee numeric(20,4) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status payment_status NOT NULL DEFAULT 'pending',
  checkout_url_ciphertext bytea,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, external_payment_id)
);
CREATE INDEX ix_payments_invoice ON payments(invoice_id, created_at DESC);
CREATE INDEX ix_payments_org_status ON payments(organization_id, status, created_at DESC);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_events (
  id bigserial PRIMARY KEY,
  payment_id uuid REFERENCES payments(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_event_id text,
  event_type text NOT NULL,
  signature_valid boolean,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, external_event_id)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT ('sub_' || encode(gen_random_bytes(10), 'hex')),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  plan_id uuid REFERENCES plans(id),
  order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
  status subscription_status NOT NULL DEFAULT 'pending',
  billing_period billing_period NOT NULL,
  currency char(3) NOT NULL DEFAULT 'IDR',
  recurring_amount numeric(20,4) NOT NULL CHECK (recurring_amount >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_invoice_at timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_subscriptions_org ON subscriptions(organization_id, status, next_invoice_at);
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE instances
  ADD CONSTRAINT fk_instances_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
ALTER TABLE object_storage_services
  ADD CONSTRAINT fk_object_storage_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE TABLE subscription_usage_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  dimension_code citext NOT NULL REFERENCES resource_dimensions(code),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  amount numeric(20,4) NOT NULL CHECK (amount >= 0),
  invoiced_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, dimension_code, period_start, period_end)
);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  discount_amount numeric(20,4) NOT NULL CHECK (discount_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(coupon_id, order_id)
);

-- ============================================================
-- GENERIC SERVICE / RESOURCE RELATION
-- ============================================================
CREATE TABLE service_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  service_kind service_kind NOT NULL,
  resource_table text NOT NULL,
  resource_id uuid NOT NULL,
  display_name text,
  status resource_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_table, resource_id)
);
CREATE INDEX ix_service_resources_org ON service_resources(organization_id, service_kind, status);
CREATE TRIGGER trg_service_resources_updated_at BEFORE UPDATE ON service_resources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- USAGE / METERING / COST
-- ============================================================
CREATE TABLE resource_usage_hourly (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  service_kind service_kind NOT NULL,
  resource_id uuid NOT NULL,
  dimension_code citext NOT NULL REFERENCES resource_dimensions(code),
  bucket_start timestamptz NOT NULL,
  quantity numeric(30,8) NOT NULL CHECK (quantity >= 0),
  provider_cost numeric(20,6),
  customer_amount numeric(20,6),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(service_kind, resource_id, dimension_code, bucket_start)
);
CREATE INDEX ix_usage_hourly_org_time ON resource_usage_hourly(organization_id, bucket_start DESC);

CREATE TABLE resource_usage_daily (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  service_kind service_kind NOT NULL,
  resource_id uuid NOT NULL,
  usage_date date NOT NULL,
  metrics jsonb NOT NULL,
  provider_cost numeric(20,4),
  customer_amount numeric(20,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_kind, resource_id, usage_date)
);
CREATE INDEX ix_usage_daily_org ON resource_usage_daily(organization_id, usage_date DESC);

-- ============================================================
-- PROVISIONING / JOBS / IDEMPOTENCY
-- ============================================================
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue text NOT NULL,
  job_type text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  resource_type text,
  resource_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued','running','retry','success','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ix_jobs_ready ON jobs(queue, run_after, created_at) WHERE status IN ('queued','retry');
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  scope text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  resource_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, key)
);
CREATE INDEX ix_idempotency_expiry ON idempotency_keys(expires_at);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  web_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT false,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  telegram_enabled boolean NOT NULL DEFAULT false,
  billing_events boolean NOT NULL DEFAULT true,
  security_events boolean NOT NULL DEFAULT true,
  product_events boolean NOT NULL DEFAULT true,
  marketing_events boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  event_type text NOT NULL,
  template_key text,
  subject text,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','read')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  last_error text
);
CREATE INDEX ix_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX ix_notifications_queue ON notifications(status, created_at) WHERE status IN ('queued','failed');

-- ============================================================
-- SUPPORT / TICKETS
-- ============================================================
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  subject text NOT NULL,
  category text,
  status ticket_status NOT NULL DEFAULT 'open',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  related_service_kind service_kind,
  related_resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_reply_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX ix_support_tickets_org ON support_tickets(organization_id, status, updated_at DESC);
CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_type text NOT NULL CHECK (author_type IN ('customer','staff','system')),
  body text NOT NULL,
  internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_support_messages_ticket ON support_messages(ticket_id, created_at);

CREATE TABLE support_message_attachments (
  message_id uuid NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES stored_objects(id) ON DELETE RESTRICT,
  PRIMARY KEY(message_id, object_id)
);

-- ============================================================
-- WEBHOOKS / EVENTS
-- ============================================================
CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  resource_type text,
  resource_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_domain_events_org ON domain_events(organization_id, created_at DESC);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  secret_ciphertext bytea NOT NULL,
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  request_payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(webhook_id, event_id)
);
CREATE INDEX ix_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE delivered_at IS NULL;

-- ============================================================
-- AUDIT / SECURITY / ABUSE
-- ============================================================
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  ip inet,
  user_agent text,
  request_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_org_time ON audit_logs(organization_id, created_at DESC);
CREATE INDEX ix_audit_resource ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX ix_audit_actor ON audit_logs(actor_user_id, created_at DESC);

CREATE TABLE security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  description text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX ix_security_incidents_open ON security_incidents(severity, created_at DESC) WHERE status IN ('open','investigating');

CREATE TABLE blocked_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network cidr NOT NULL UNIQUE,
  reason text,
  expires_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PROVIDER SYNC / RECONCILIATION
-- ============================================================
CREATE TABLE resource_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  status provider_action_status NOT NULL DEFAULT 'queued',
  discovered_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reconciliation_provider ON resource_reconciliation_runs(provider_id, created_at DESC);

CREATE TABLE orphan_provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id),
  provider_account_id uuid REFERENCES provider_accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  external_resource_id text NOT NULL,
  provider_payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  UNIQUE(provider_id, resource_type, external_resource_id)
);

-- ============================================================
-- OPTIONAL APP SETTINGS / FEATURE FLAGS
-- ============================================================
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- VIEWS
-- ============================================================
CREATE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL AND status <> 'closed';

CREATE VIEW active_instances AS
SELECT * FROM instances WHERE deleted_at IS NULL AND status <> 'deleted';

CREATE VIEW current_plan_prices AS
SELECT DISTINCT ON (plan_id, region_id, currency, billing_period)
  *
FROM plan_prices
WHERE active_from <= now() AND (active_until IS NULL OR active_until > now())
ORDER BY plan_id, region_id, currency, billing_period, active_from DESC;

-- ============================================================
-- COMMENTS / OPERATION MAPPING FOR ONIDEL OPENAPI 1.2.0
-- ============================================================
COMMENT ON TABLE provider_accounts IS 'Maps a Kilat Cloud organization to an Onidel Team/account or another provider account.';
COMMENT ON TABLE ssh_keys IS 'Onidel: list/create/get/update/delete SSH keys.';
COMMENT ON TABLE vpcs IS 'Onidel: list/create/get/update/delete VPCs.';
COMMENT ON TABLE firewall_groups IS 'Onidel: list/create/get/update/delete firewall groups.';
COMMENT ON TABLE firewall_rules IS 'Onidel: list/create/get/update/delete firewall rules.';
COMMENT ON TABLE ip_lists IS 'Onidel: list/create/get/update/delete IP lists.';
COMMENT ON TABLE ip_list_entries IS 'Onidel: create/delete IP list entries.';
COMMENT ON TABLE os_templates IS 'Onidel: OS template catalog.';
COMMENT ON TABLE instance_types IS 'Onidel: instance type catalog.';
COMMENT ON TABLE price_quotes IS 'Can persist Onidel getInstancePrice response plus Kilat Cloud markup/custom calculation.';
COMMENT ON TABLE measured_boot_images IS 'Onidel: list/upload/delete measured boot images.';
COMMENT ON TABLE custom_isos IS 'Onidel: list/create/get/delete custom ISO.';
COMMENT ON TABLE snapshots IS 'Onidel: list/generate download URL/delete/restore/create VM snapshot.';
COMMENT ON TABLE backups IS 'Onidel: list/generate download URL/restore backup.';
COMMENT ON TABLE instances IS 'Onidel: list/provision/get/patch/delete/stop/reboot plus BGP/measured boot actions.';
COMMENT ON TABLE vm_console_sessions IS 'Onidel: create VNC/noVNC session. Sensitive console URL is encrypted.';
COMMENT ON TABLE reverse_dns_records IS 'Onidel: get/set/delete reverse DNS/PTR.';
COMMENT ON TABLE object_storage_services IS 'Onidel: list/get object storage services.';
COMMENT ON TABLE storage_buckets IS 'Onidel: create bucket and map bucket metadata.';
COMMENT ON TABLE storage_access_keys IS 'Onidel: list bucket access keys. Secret material encrypted.';
COMMENT ON TABLE reserved_ips IS 'Onidel: list/create/convert/get/delete/update reserved IPs, including attach/detach VM.';
COMMENT ON TABLE startup_scripts IS 'Onidel: list/create/get/update/delete startup scripts.';

COMMIT;
