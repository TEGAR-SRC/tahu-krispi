-- VMware vSphere as a third compute provider: product seed + monthly custom
-- rates. The providers row itself is created at runtime by platform admins
-- (POST /v1/admin/providers + PUT .../provider-account), so nothing here
-- touches app.providers or the service_kind enum.

-- Sibling of kilat-proxmox-vps/kilat-lxc: self-hosted routing via
-- products.metadata->>'provider', priced ~10% above Proxmox VPS.
INSERT INTO app.products(code, name, service_kind, description, enabled, sort_order,
                         default_monthly_amount, metadata)
VALUES ('kilat-vmware-vps', 'Kilat VMware VPS', 'vm',
        'Self-hosted VMware vSphere VPS - hypervisor enterprise, harga menengah', true, 4,
        22000, '{"provider":"vmware"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Monthly custom rates, ~10% above the Proxmox seeds: vCPU 22k vs 25k,
-- RAM 7k vs 8k, NVMe 450 vs 500. Same NOT EXISTS guard as 000014/000016.
INSERT INTO app.custom_resource_rates(product_id, dimension_code, currency, billing_period,
                                      unit_price, provider_unit_cost, included_quantity,
                                      min_quantity, max_quantity, step_quantity)
SELECT prod.id, d.code::citext, 'IDR', 'monthly', d.price, d.cost, 0,
       CASE d.code WHEN 'nvme_gb' THEN 20 ELSE 1 END, NULL, 1::numeric
FROM app.products prod
CROSS JOIN (VALUES ('vcpu',22000,15400),('ram_gb',7000,4950),('nvme_gb',450,330)) AS d(code,price,cost)
WHERE prod.code='kilat-vmware-vps'
  AND prod.metadata->>'provider'='vmware'
  AND NOT EXISTS (
    SELECT 1 FROM app.custom_resource_rates r
    WHERE r.product_id=prod.id AND r.dimension_code=d.code::citext
      AND r.currency='IDR' AND r.billing_period='monthly');
