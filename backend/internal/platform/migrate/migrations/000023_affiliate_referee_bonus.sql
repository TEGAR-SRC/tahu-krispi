-- 000023_affiliate_referee_bonus.sql
-- Pay the configured referee bonus (referee_bonus_percent) that was previously
-- read from settings but never applied. Two earnings rows can now exist per
-- invoice: one for the referrer's commission and one for the referee's bonus,
-- distinguished by earning_type.

ALTER TABLE affiliate_earnings ADD COLUMN IF NOT EXISTS earning_type text
  NOT NULL DEFAULT 'referrer_commission'
  CHECK (earning_type IN ('referrer_commission','referee_bonus'));

ALTER TABLE affiliate_earnings ADD COLUMN IF NOT EXISTS referee_bonus_amount numeric(20,4)
  NOT NULL DEFAULT 0 CHECK (referee_bonus_amount >= 0);

-- Replace the single-invoice uniqueness with per (invoice, earning_type).
ALTER TABLE affiliate_earnings DROP CONSTRAINT IF EXISTS affiliate_earnings_invoice_id_key;
DROP INDEX IF EXISTS affiliate_earnings_invoice_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_affiliate_earnings_invoice_type
  ON affiliate_earnings(invoice_id, earning_type);
