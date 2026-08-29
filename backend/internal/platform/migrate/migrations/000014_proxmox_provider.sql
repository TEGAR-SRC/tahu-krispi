-- Proxmox VE as the second (self-hosted, cheaper) compute provider.
-- The row is created DISABLED; platform_admin fills api_base_url +
-- token credentials via PUT /v1/admin/providers/:id/provider-account
-- (credentials stored AES-256-GCM encrypted in credentials_ciphertext)
-- and flips enabled=true. NOC operates day-2 through /admin/providers/*.

INSERT INTO app.providers(code, name, kind, api_base_url, enabled, health_status)
VALUES ('proxmox', 'Kilat Proxmox Cloud', 'proxmox', '', false, 'unknown')
ON CONFLICT (code) DO NOTHING;

-- Cheaper self-hosted product: same dimensions, lower unit prices than Onidel
-- (no upstream margin). Provider routing reads products.metadata->>'provider'.
INSERT INTO app.products(code, name, service_kind, description, enabled, sort_order,
                         default_monthly_amount, metadata)
VALUES ('kilat-proxmox-vps', 'Kilat Proxmox VPS', 'vm',
        'Self-hosted Proxmox VPS - infrastruktur sendiri, harga lebih murah', true, 2,
        25000, '{"provider":"proxmox"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Monthly custom rates (cheaper than Onidel seeds): vCPU 25k vs 35k,
-- RAM 8k vs 12k, NVMe 500 vs 800. Hourly/daily inherit the derivation fallback.
INSERT INTO app.custom_resource_rates(product_id, dimension_code, currency, billing_period,
                                      unit_price, provider_unit_cost, included_quantity,
                                      min_quantity, max_quantity, step_quantity)
SELECT prod.id, d.code::citext, 'IDR', 'monthly', d.price, d.cost, 0,
       CASE d.code WHEN 'nvme_gb' THEN 20 ELSE 1 END, NULL, 1::numeric
FROM app.products prod
CROSS JOIN (VALUES ('vcpu',25000,14000),('ram_gb',8000,4500),('nvme_gb',500,300)) AS d(code,price,cost)
WHERE prod.code='kilat-proxmox-vps'
  AND prod.metadata->>'provider'='proxmox'
  AND NOT EXISTS (
    SELECT 1 FROM app.custom_resource_rates r
    WHERE r.product_id=prod.id AND r.dimension_code=d.code::citext
      AND r.currency='IDR' AND r.billing_period='monthly');

-- Region rows bound to the Proxmox provider: a Proxmox "region" is a cluster
-- whose placement target is a NODE (external_id). Disabled until NOC wires
-- the cluster credentials; enable + rename freely afterwards.
INSERT INTO app.regions(provider_id, external_id, code, name, enabled)
SELECT pv.id, r.node, r.code, r.name, false
FROM app.providers pv
JOIN (VALUES
  ('pve-jkt','Proxmox Jakarta','pve-jkt'),
  ('pve-sby','Proxmox Surabaya','pve-sby')
) AS r(code,name,node) ON pv.code='proxmox'
WHERE NOT EXISTS (
  SELECT 1 FROM app.regions x WHERE x.provider_id=pv.id AND x.external_id=r.node);
