-- Container support on app.instances + the LXC product seed. Runs AFTER
-- 000015 added the enum value (the runner sorts by filename); that separation
-- is what makes using 'container' below legal under the per-file transaction.

ALTER TABLE app.instances
  ADD COLUMN IF NOT EXISTS service_kind service_kind NOT NULL DEFAULT 'vm';

-- Defensive: nothing can be NULL after the NOT NULL DEFAULT above, but keep
-- the sweep so re-runs against drifted databases converge.
UPDATE app.instances SET service_kind='vm' WHERE service_kind IS NULL;

-- LXC sibling of kilat-proxmox-vps: same self-hosted Proxmox routing
-- (products.metadata->>'provider'), ~20% cheaper across the board.
INSERT INTO app.products(code, name, service_kind, description, enabled, sort_order,
                         default_monthly_amount, metadata)
VALUES ('kilat-proxmox-lxc', 'Kilat Proxmox LXC', 'container',
        'Self-hosted Proxmox LXC container - ringan dan hemat, harga di bawah VPS', true, 3,
        20000, '{"provider":"proxmox"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Monthly custom rates, ~20% under the VPS seeds: vCPU 20k vs 25k,
-- RAM 6.4k vs 8k, NVMe 400 vs 500. Same NOT EXISTS guard as 000014.
INSERT INTO app.custom_resource_rates(product_id, dimension_code, currency, billing_period,
                                      unit_price, provider_unit_cost, included_quantity,
                                      min_quantity, max_quantity, step_quantity)
SELECT prod.id, d.code::citext, 'IDR', 'monthly', d.price, d.cost, 0,
       CASE d.code WHEN 'nvme_gb' THEN 20 ELSE 1 END, NULL, 1::numeric
FROM app.products prod
CROSS JOIN (VALUES ('vcpu',20000,11200),('ram_gb',6400,3600),('nvme_gb',400,240)) AS d(code,price,cost)
WHERE prod.code='kilat-proxmox-lxc'
  AND prod.metadata->>'provider'='proxmox'
  AND NOT EXISTS (
    SELECT 1 FROM app.custom_resource_rates r
    WHERE r.product_id=prod.id AND r.dimension_code=d.code::citext
      AND r.currency='IDR' AND r.billing_period='monthly');
