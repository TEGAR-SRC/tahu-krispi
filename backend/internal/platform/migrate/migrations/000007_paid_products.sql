-- 000007_paid_products.sql
-- Paid-product billing: object-storage services and reserved IPs are
-- provisioned but were never billed. This migration adds the pricing and
-- linkage plumbing so every created resource carries a monthly subscription
-- that the existing renewal sweep invoices (subscription.Service.
-- ProcessTransitions -> worker generateInvoices -> billing.CreateRenewalInvoice).
--
-- 1) products.default_monthly_amount: fallback monthly price used when a
--    resource is created without a provider-reported price. Admins override it
--    via PATCH /admin/products/{id}; the change affects only FUTURE
--    subscriptions, because the price is copied into subscriptions.
--    recurring_amount at attach time and is never re-read afterwards.
-- 2) reserved_ips.subscription_id: links each reserved IP to its billing
--    subscription. object_storage_services already carries subscription_id in
--    the base schema, so only reserved_ips needs the column here.
-- 3) Seeds the two products idempotently: ON CONFLICT backfills
--    default_monthly_amount only when it was never set (still 0), so re-runs
--    and admin-configured prices are never clobbered.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS default_monthly_amount numeric(20,4) NOT NULL DEFAULT 0
    CHECK (default_monthly_amount >= 0);

ALTER TABLE reserved_ips
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL;

INSERT INTO products(code, name, service_kind, description, enabled, sort_order, default_monthly_amount)
VALUES ('kilat-object-storage', 'Kilat Object Storage', 'object_storage',
        'S3-compatible object storage on Kilat Cloud', true, 20, 50000)
ON CONFLICT (code) DO UPDATE
SET default_monthly_amount = EXCLUDED.default_monthly_amount
WHERE products.default_monthly_amount = 0;

INSERT INTO products(code, name, service_kind, description, enabled, sort_order, default_monthly_amount)
VALUES ('kilat-reserved-ip', 'Kilat Reserved IP', 'other',
        'Reserved IPv4 addresses that survive VM deletion', true, 21, 20000)
ON CONFLICT (code) DO UPDATE
SET default_monthly_amount = EXCLUDED.default_monthly_amount
WHERE products.default_monthly_amount = 0;
