-- 000009_affiliate.sql
-- Affiliate / referral program: referral codes on users, singleton commission
-- settings, idempotent per-invoice earnings, and unique-visitor click tracking.

-- Referral identity on users. referred_by is set once at registration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_referral_code
ON users(referral_code) WHERE referral_code IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_users_referred_by ON users(referred_by);

-- Singleton settings row (id is always true).
CREATE TABLE IF NOT EXISTS affiliate_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  commission_percent numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (commission_percent BETWEEN 0 AND 100),
  referee_bonus_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (referee_bonus_percent BETWEEN 0 AND 100),
  min_invoice_total numeric(20,4) NOT NULL DEFAULT 0 CHECK (min_invoice_total >= 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO affiliate_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

-- One row per settled invoice (UNIQUE(invoice_id) makes accrual idempotent).
CREATE TABLE IF NOT EXISTS affiliate_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  base_amount numeric(20,4) NOT NULL CHECK (base_amount >= 0),
  commission_amount numeric(20,4) NOT NULL CHECK (commission_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'IDR',
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','paid','reversed')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_affiliate_earnings_referrer_status
ON affiliate_earnings(referrer_user_id, status);
CREATE INDEX IF NOT EXISTS ix_affiliate_earnings_referee
ON affiliate_earnings(referee_user_id);

-- Unique visitors per referral code; visitor_hash = sha256(ip || '|' || user_agent).
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  referral_code text NOT NULL,
  visitor_hash text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (referral_code, visitor_hash)
);
