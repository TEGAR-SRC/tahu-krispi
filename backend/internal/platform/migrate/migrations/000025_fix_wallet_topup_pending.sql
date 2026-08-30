-- 000025_fix_wallet_topup_pending.sql
-- Idempotent backfill for wallet top-ups that were completed in SumoPod
-- (pay_2d62977a94e0bd4f3026, pay_0551296e1b7993bdeb64 — 2026-08-30) but stayed
-- pending in app.payments because the webhook never reached paid (tunnel/DNS
-- payment.kilat-cloud.com 1014 + pay.sumopod.com No answer before fa692be).
-- After this, Wallet Balance + Transactions appear without manual psql.

DO $$
DECLARE
  r RECORD;
  w_id uuid;
  amt numeric;
  bal_before numeric;
BEGIN
  FOR r IN
    SELECT id, public_id, organization_id, currency::text AS cur, amount::text AS amt_text
    FROM app.payments
    WHERE public_id IN ('pay_2d62977a94e0bd4f3026','pay_0551296e1b7993bdeb64')
      AND status = 'pending'
  LOOP
    -- 1) mark paid (idempotent)
    UPDATE app.payments SET status='paid', paid_at=COALESCE(paid_at, now())
    WHERE id=r.id AND status='pending';

    -- 2) ensure wallet exists
    INSERT INTO app.wallets(organization_id, currency)
    VALUES (r.organization_id, r.cur)
    ON CONFLICT (organization_id, currency) DO NOTHING;

    SELECT id, balance INTO w_id, bal_before
    FROM app.wallets WHERE organization_id=r.organization_id AND currency=r.cur
    FOR UPDATE;

    amt := r.amt_text::numeric;

    -- 3) ledger credit idempotent via (wallet_id, idempotency_key) = topup-<payment_id>
    BEGIN
      INSERT INTO app.wallet_transactions(wallet_id, direction, amount, balance_before, balance_after,
                                          reference_type, reference_id, idempotency_key, description)
      VALUES (w_id, 'credit', amt, bal_before, bal_before + amt,
              'topup', r.id, 'topup-'||r.id::text, 'wallet topup '||r.public_id);
      UPDATE app.wallets SET balance = bal_before + amt WHERE id=w_id;
    EXCEPTION WHEN unique_violation THEN
      -- already credited (idempotency_key hit) — do nothing
      NULL;
    END;
  END LOOP;
END $$;
