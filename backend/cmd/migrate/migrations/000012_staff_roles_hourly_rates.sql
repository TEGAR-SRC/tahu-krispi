-- Platform staff roles (owner request): beyond platform_admin there are
-- FINANCE (money: orders/invoices/payments/wallets/pricing/coupons/affiliate)
-- and NOC (infrastructure ops: instances/jobs/providers/network blocks/
-- security incidents/tickets). Enforcement lives in internal/iam.StaffCan.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS staff_role text NOT NULL DEFAULT 'none'
  CHECK (staff_role IN ('none','platform_admin','finance','noc'));
CREATE INDEX IF NOT EXISTS ix_users_staff_role
  ON app.users(staff_role) WHERE staff_role <> 'none';

-- Hourly/daily reference rates for every enabled VM product so on-demand
-- quotes work out of the box. Admins can override via /v1/admin/custom-rates;
-- when absent entirely the pricing engine derives them from monthly /720 (/24).
INSERT INTO app.custom_resource_rates(product_id, dimension_code, currency, billing_period,
                                     unit_price, provider_unit_cost, included_quantity,
                                     min_quantity, max_quantity, step_quantity)
SELECT p.id, d.code::citext, 'IDR', d.period::app.billing_period,
       d.hourly_price, 0, 0,
       CASE d.code WHEN 'nvme_gb' THEN 20 ELSE 1 END, NULL, 1
FROM app.products p
CROSS JOIN (VALUES
  ('vcpu',    'hourly', 50),
  ('ram_gb',  'hourly', 20),
  ('nvme_gb', 'hourly', 2),
  ('vcpu',    'daily',  1200),
  ('ram_gb',  'daily',  480),
  ('nvme_gb', 'daily',  48)
) AS d(code, period, hourly_price)
WHERE p.service_kind='vm' AND p.enabled
  AND NOT EXISTS (
    SELECT 1 FROM app.custom_resource_rates r
    WHERE r.product_id=p.id AND r.dimension_code=d.code::citext
      AND r.currency='IDR' AND r.billing_period=d.period::app.billing_period
  );
