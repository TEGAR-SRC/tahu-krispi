-- 000004_seed_provider_and_product.sql
-- Seed the Onidel provider row and the default VM product so catalog,
-- network provisioning, and pricing flows have their required references.
-- Credentials are NOT seeded here; admins set them via PUT /v1/admin/providers.

INSERT INTO providers(code, name, kind, enabled, health_status)
VALUES ('onidel', 'Onidel Cloud', 'onidel', true, 'unknown')
ON CONFLICT (code) DO NOTHING;

INSERT INTO products(code, name, service_kind, description, enabled, sort_order)
VALUES ('kilat-vps', 'Kilat Cloud VPS', 'vm', 'Virtual private servers on Kilat Cloud', true, 10)
ON CONFLICT (code) DO NOTHING;
