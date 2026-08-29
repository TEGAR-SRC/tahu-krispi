-- Promo engine extensions (owner request):
--  * duration-based validity: admins may set duration_value+duration_unit
--    instead of an absolute ends_at; the API computes ends_at on upsert.
--  * "free" = discount_type 'percent' with value 100 (already allowed).
ALTER TABLE app.coupons
  ADD COLUMN IF NOT EXISTS duration_value integer CHECK (duration_value IS NULL OR duration_value > 0),
  ADD COLUMN IF NOT EXISTS duration_unit text
    CHECK (duration_unit IS NULL OR duration_unit IN ('days','weeks','months','years'));

-- Sample promos so the flow is demonstrable immediately (idempotent).
INSERT INTO app.coupons(code, description, discount_type, discount_value, currency,
                        min_order_amount, max_redemptions, per_user_limit,
                        duration_value, duration_unit, enabled)
VALUES
  ('WELCOME10',  '10% off for new customers',            'percent', 10,   'IDR', 0,      1000, 1,  30,  'days',  true),
  ('GRATIS100',  '100% free month (max 5 redemptions)',  'percent', 100,  'IDR', 0,      5,    1,  NULL,NULL,   true),
  ('HEMAT50K',   'Rp50.000 off, min order Rp200.000',    'fixed',   50000,'IDR', 200000, 500,  2,  90,  'days',  true)
ON CONFLICT (code) DO NOTHING;

-- Duration implies a relative expiry from creation time.
UPDATE app.coupons
SET ends_at = created_at + (duration_value::text || ' ' || duration_unit)::interval
WHERE ends_at IS NULL AND duration_value IS NOT NULL;
