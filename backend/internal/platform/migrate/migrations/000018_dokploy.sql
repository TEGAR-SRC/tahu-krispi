-- Dokploy (self-hosted PaaS, v0.30.2) as a platform service. Strategy:
-- UNIVERSAL PROXY — every upstream tRPC-style operation (/tag.method) is
-- relayed verbatim through /v1/dokploy/* with the x-api-key header, plus a
-- local MIRROR of the core resources for joins/reporting/orphan cleanup.
-- The providers row is created DISABLED; platform_admin configures
-- api_base_url + api_key via POST /v1/admin/providers (credentials sealed
-- AES-256-GCM as {"token_secret": ...} in credentials_ciphertext).

-- 1) Widen the providers.kind CHECK to admit 'dokploy'. schema.sql declares
-- the constraint inline (no explicit name), so Postgres auto-named it;
-- resolve the actual name instead of hardcoding it.
DO $$
DECLARE
  existing text;
BEGIN
  SELECT c.conname INTO existing
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  WHERE rel.relname = 'providers'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%kind%';
  IF existing IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app.providers DROP CONSTRAINT %I', existing);
  END IF;
END $$;

ALTER TABLE app.providers
  ADD CONSTRAINT providers_kind_check
  CHECK (kind IN ('onidel','proxmox','vmware','xcpng','hyperv','custom','dokploy'));

INSERT INTO app.providers(code, name, kind, api_base_url, enabled, health_status)
VALUES ('dokploy', 'Kilat Dokploy PaaS', 'dokploy', '', false, 'unknown')
ON CONFLICT (code) DO NOTHING;

-- 2) Mirror tables. All ids uuid pk default gen_random_uuid(),
-- created_at/updated_at timestamptz default now() + set_updated_at trigger,
-- data jsonb NOT NULL DEFAULT '{}' holding the raw upstream object.
-- remote_id UNIQUE per table = the Dokploy-side id used for upserts.
-- org_id stays NULL until customer-facing org scoping lands.

CREATE TABLE dokploy_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  remote_id text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_projects_org ON dokploy_projects(org_id);
CREATE TRIGGER trg_dokploy_projects_updated_at BEFORE UPDATE ON dokploy_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  project_remote_id text NOT NULL,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_environments_project ON dokploy_environments(project_remote_id);
CREATE TRIGGER trg_dokploy_environments_updated_at BEFORE UPDATE ON dokploy_environments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  remote_id text NOT NULL UNIQUE,
  project_remote_id text,
  environment_remote_id text,
  name text NOT NULL,
  status text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_applications_org ON dokploy_applications(org_id);
CREATE INDEX ix_dokploy_applications_project ON dokploy_applications(project_remote_id);
CREATE INDEX ix_dokploy_applications_environment ON dokploy_applications(environment_remote_id);
CREATE TRIGGER trg_dokploy_applications_updated_at BEFORE UPDATE ON dokploy_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_composes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  remote_id text NOT NULL UNIQUE,
  project_remote_id text,
  name text NOT NULL,
  status text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_composes_org ON dokploy_composes(org_id);
CREATE INDEX ix_dokploy_composes_project ON dokploy_composes(project_remote_id);
CREATE TRIGGER trg_dokploy_composes_updated_at BEFORE UPDATE ON dokploy_composes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_databases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  remote_id text NOT NULL UNIQUE,
  db_type text NOT NULL CHECK (db_type IN ('postgres','mysql','mariadb','mongo','redis','libsql')),
  project_remote_id text,
  name text NOT NULL,
  status text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_databases_org ON dokploy_databases(org_id);
CREATE INDEX ix_dokploy_databases_project ON dokploy_databases(project_remote_id);
CREATE TRIGGER trg_dokploy_databases_updated_at BEFORE UPDATE ON dokploy_databases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  application_remote_id text,
  compose_remote_id text,
  domain text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_domains_application ON dokploy_domains(application_remote_id);
CREATE INDEX ix_dokploy_domains_compose ON dokploy_domains(compose_remote_id);
CREATE TRIGGER trg_dokploy_domains_updated_at BEFORE UPDATE ON dokploy_domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  resource_kind text NOT NULL CHECK (resource_kind IN ('application','compose','server')),
  resource_remote_id text,
  status text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_deployments_resource ON dokploy_deployments(resource_kind, resource_remote_id);
CREATE TRIGGER trg_dokploy_deployments_updated_at BEFORE UPDATE ON dokploy_deployments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  db_type text,
  database_remote_id text,
  schedule text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dokploy_backups_database ON dokploy_backups(database_remote_id);
CREATE TRIGGER trg_dokploy_backups_updated_at BEFORE UPDATE ON dokploy_backups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  name text NOT NULL,
  ip text,
  status text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_dokploy_servers_updated_at BEFORE UPDATE ON dokploy_servers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_registries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  registry_name text,
  username text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_dokploy_registries_updated_at BEFORE UPDATE ON dokploy_registries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_ssh_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  name text NOT NULL,
  public_key text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_dokploy_ssh_keys_updated_at BEFORE UPDATE ON dokploy_ssh_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dokploy_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remote_id text NOT NULL UNIQUE,
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_dokploy_certificates_updated_at BEFORE UPDATE ON dokploy_certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
