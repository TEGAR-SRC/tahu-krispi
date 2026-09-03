-- 000026_provider_prefixed_slugs.sql
-- Per-provider prefixed slugs: Proxmox sendiri, Onidel sendiri, VMware sendiri, Dokploy sendiri.
-- kode, id, slug semua prefix provider — uniqueness scope adalah (provider_id, code),
-- bukan code global/universal. regions sudah UNIQUE(provider_id, code) sejak schema.sql;
-- migration ini hanya menambah komentar dokumentasi + memastikan instance_types dan
-- os_templates juga unique per (provider_id, code). plans.provider_id sengaja tetap
-- nullable (paket dipilih user via region, provider_id di-resolve otomatis dari region)
-- dan tidak ada data wipe (semua ADD COLUMN / CREATE INDEX pakai IF NOT EXISTS).

-- regions: sudah UNIQUE(provider_id, code) di schema.sql — tidak perlu ALTER, hanya COMMENT.
COMMENT ON TABLE app.regions IS 'Per-provider region catalog. code unique per (provider_id, code); prefix provider (e.g. onidel-jkt, pve-jkt, vmw-jkt, dokploy-jkt) to keep slugs isolated across providers.';
COMMENT ON COLUMN app.regions.code IS 'Provider-prefixed slug, unique per (provider_id, code). Jangan bikin universal — tiap provider punya namespace sendiri.';
COMMENT ON COLUMN app.regions.provider_id IS 'FK to providers.id — scope untuk keunikan code.';

-- instance_types: code nullable citext, uniqueness hanya bila code IS NOT NULL, scope (provider_id, code).
COMMENT ON TABLE app.instance_types IS 'Per-provider instance type catalog. code unique per (provider_id, code) when code IS NOT NULL; prefix provider (e.g. proxmox-c2m4). UNIQUE(provider_id, external_id) tetap untuk sinkronisasi provider.';
COMMENT ON COLUMN app.instance_types.code IS 'Provider-prefixed slug, unique per (provider_id, code) WHERE code IS NOT NULL. Nullable untuk tipe yang hanya dikenali via external_id.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_instance_types_provider_code ON app.instance_types(provider_id, code) WHERE code IS NOT NULL;

-- os_templates: belum ada kolom code di schema.sql — tambahkan nullable citext + unique per-provider.
ALTER TABLE app.os_templates ADD COLUMN IF NOT EXISTS code citext;
COMMENT ON TABLE app.os_templates IS 'Per-provider OS template catalog. code unique per (provider_id, code) when code IS NOT NULL; prefix provider (e.g. onidel-ubuntu22, pve-ubuntu22). UNIQUE(provider_id, external_id) tetap untuk sinkronisasi provider.';
COMMENT ON COLUMN app.os_templates.code IS 'Provider-prefixed slug, unique per (provider_id, code) WHERE code IS NOT NULL. Nullable untuk template yang hanya dikenali via external_id.';
CREATE UNIQUE INDEX IF NOT EXISTS ux_os_templates_provider_code ON app.os_templates(provider_id, code) WHERE code IS NOT NULL;

-- plans: provider_id sengaja tetap nullable — user memilih paket via region, backend resolve provider dari region.
-- Migration ini memastikan kolom tetap nullable dan tidak me-wipe data; jangan tambahkan NOT NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'plans' AND column_name = 'provider_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE app.plans ALTER COLUMN provider_id DROP NOT NULL;
  END IF;
END $$;
COMMENT ON TABLE app.plans IS 'Fixed packages. provider_id nullable: user memilih paket via region, provider di-resolve otomatis dari region.provider_id; jangan wajibkan provider_id dari client.';
COMMENT ON COLUMN app.plans.provider_id IS 'Nullable FK to providers.id. Tetap nullable — auto dari region. Jangan ubah menjadi NOT NULL.';
