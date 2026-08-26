-- 000003_users_platform_admin.sql
-- Master Prompt §51: separate customer API authorization from platform admin authorization.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_users_platform_admin ON users(is_platform_admin) WHERE is_platform_admin AND deleted_at IS NULL;
