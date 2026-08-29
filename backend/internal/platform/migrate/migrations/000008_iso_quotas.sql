-- 000008_iso_quotas.sql
-- Custom ISO quotas on the Onidel provider: at most 15 GiB per ISO file, at
-- most 10 ISOs, and a 50 GiB total quota per user across every organization
-- that user owns (ownership resolved via organizations.created_by).
--
-- size_bytes / source_object_id (FK to stored_objects) already exist in the
-- base schema; they are re-asserted with IF NOT EXISTS so environments created
-- before those columns landed converge.
--
-- New for the upload-first flow:
--   storage_key     R2/S3 key of the uploaded file inside the internal bucket.
--   register_status upload->provider registration lifecycle, separate from the
--                   user-facing resource_status column:
--                     'uploaded'     bytes are in internal storage, not yet pushed
--                     'registering'  push to Onidel in flight
--                     'active'       confirmed present on the provider
--                     'failed'       registration gave up; object kept for retry
--                     'removed'      row soft-deleted; quota freed
--   created_by      records which user registered each ISO row.

ALTER TABLE custom_isos ADD COLUMN IF NOT EXISTS size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0);

ALTER TABLE custom_isos ADD COLUMN IF NOT EXISTS source_object_id uuid REFERENCES stored_objects(id) ON DELETE SET NULL;

ALTER TABLE custom_isos ADD COLUMN IF NOT EXISTS storage_key text;

ALTER TABLE custom_isos ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE custom_isos ADD COLUMN IF NOT EXISTS register_status text
  NOT NULL DEFAULT 'uploaded'
  CHECK (register_status IN ('uploaded','registering','active','failed','removed'));

-- Backfill row attribution from the owning organization's creator.
UPDATE custom_isos ci
SET created_by = o.created_by
FROM organizations o
WHERE ci.organization_id = o.id AND ci.created_by IS NULL;

-- Backfill register_status for rows that predate the upload flow: rows with a
-- provider mapping are active, soft-deleted rows are removed, failed rows stay
-- failed, and everything else is mid-registration on the by-URL path.
UPDATE custom_isos
SET register_status = CASE
  WHEN deleted_at IS NOT NULL THEN 'removed'
  WHEN status = 'failed' THEN 'failed'
  WHEN external_iso_id IS NOT NULL THEN 'active'
  ELSE 'registering'
END;

COMMENT ON COLUMN custom_isos.size_bytes IS 'ISO size in bytes (upload- or HEAD-derived); counts against the 50 GiB per-user custom ISO quota.';
COMMENT ON COLUMN custom_isos.storage_key IS 'R2/S3 key of the uploaded ISO inside the internal bucket; empty for by-URL registrations.';
COMMENT ON COLUMN custom_isos.register_status IS 'Upload/registration lifecycle: uploaded -> registering -> active | failed; removed once soft-deleted. Failed keeps the stored object for retry.';
COMMENT ON COLUMN custom_isos.created_by IS 'User who registered this custom ISO; quotas are enforced per user via organizations.created_by.';
