-- Seed one login account per platform role (owner request).
-- Local dev only: platform_admin / finance / noc / customer (staff_role='none').
-- Password for every account: KilatCloud#2026  (Argon2id, same params as runtime).
-- Safe to re-run: guarded by ON CONFLICT DO NOTHING on the partial unique indexes.

INSERT INTO app.users
  (email, username, password_hash, password_algorithm, password_version,
   password_changed_at, force_password_change,
   email_status, email_verified_at,
   status, locale, timezone,
   terms_accepted_at, privacy_accepted_at, marketing_consent_at,
   staff_role)
VALUES
  -- Platform admin: full access (IAM StaffCan(platform_admin) covers everything).
  ('admin@kilat-cloud.com',  'admin',
   '$argon2id$v=19$m=65536,t=3,p=4$04ajIlIAlXbVh/zFZSB6Pw$OxzYuXNB9ylhpgsuSStay34Hsr7YhIPH+4Plao2ULO4',
   'argon2id', 1, now(), false,
   'verified', now(), 'active', 'id-ID', 'Asia/Jakarta',
   now(), now(), now(), 'platform_admin'),
  -- Finance: money domain (orders/invoices/payments/wallets/pricing/coupons/affiliate).
  ('finance@kilat-cloud.com', 'finance',
   '$argon2id$v=19$m=65536,t=3,p=4$+Px4dFkVnSpl4JSegqYSQw$ymd8XxgQg7fKf+k0rW+YHDOQTHCSXQBUR2L5X6ug0g0',
   'argon2id', 1, now(), false,
   'verified', now(), 'active', 'id-ID', 'Asia/Jakarta',
   now(), now(), now(), 'finance'),
  -- NOC: infrastructure ops (instances/jobs/providers/network/security/tickets).
  ('noc@kilat-cloud.com',    'noc',
   '$argon2id$v=19$m=65536,t=3,p=4$/PiHnxicoDiwhPygGUU4sQ$DvHtn7KO85+Vnb2uEW9KUXZeBuuC3jvjiBBI+FC1Xg0',
   'argon2id', 1, now(), false,
   'verified', now(), 'active', 'id-ID', 'Asia/Jakarta',
   now(), now(), now(), 'noc'),
  -- Regular customer (staff_role='none'): self-service portal only.
  ('user@kilat-cloud.com',   'user',
   '$argon2id$v=19$m=65536,t=3,p=4$BcKPE07QCL9DOQE1hkn7BA$33T8PBB3uwiHZMpzPbz8yfuBFHto+ZVXkNZ6QKGppc0',
   'argon2id', 1, now(), false,
   'verified', now(), 'active', 'id-ID', 'Asia/Jakarta',
   now(), now(), now(), 'none')
ON CONFLICT DO NOTHING;

-- Display names on the profile side.
INSERT INTO app.user_profiles (user_id, full_name, display_name)
SELECT id, 'Admin Kilat Cloud', 'Admin'
FROM app.users WHERE email = 'admin@kilat-cloud.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app.user_profiles (user_id, full_name, display_name)
SELECT id, 'Finance Kilat Cloud', 'Finance'
FROM app.users WHERE email = 'finance@kilat-cloud.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app.user_profiles (user_id, full_name, display_name)
SELECT id, 'NOC Kilat Cloud', 'NOC'
FROM app.users WHERE email = 'noc@kilat-cloud.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app.user_profiles (user_id, full_name, display_name)
SELECT id, 'Customer Kilat Cloud', 'Customer'
FROM app.users WHERE email = 'user@kilat-cloud.com'
ON CONFLICT (user_id) DO NOTHING;
