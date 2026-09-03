#!/usr/bin/env bash
# Generates .env for local development (kilat-cloud.com domains, dev-only secrets).
# Never commit the resulting .env — it is gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists — leaving it untouched."
  exit 0
fi

JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
KEK="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
PAY="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p -c 48)"

cat > .env <<EOF
APP_ENV=development
APP_PORT=8080

# Public domains (kilat-cloud.com)
APP_DOMAIN=kilat-cloud.com
PUBLIC_API_BASE_URL=https://api.kilat-cloud.com
CONSOLE_BASE_URL=https://console.kilat-cloud.com
ADMIN_CONSOLE_BASE_URL=https://admin.kilat-cloud.com
AUTH_CONSOLE_BASE_URL=https://auth.kilat-cloud.com
DOWNLOAD_BASE_URL=https://dl.kilat-cloud.com

# Per-console API domains (audience scoping) — defaults match compose.env
ADMIN_API_DOMAIN=https://api-admin.kilat-cloud.com
USER_API_DOMAIN=https://api-user.kilat-cloud.com
AUTH_API_DOMAIN=https://api-auth.kilat-cloud.com
LANDING_API_DOMAIN=https://api-landing.kilat-cloud.com
DOCS_API_DOMAIN=https://api-docs.kilat-cloud.com

# OAuth — Google / GitHub (empty = provider disabled, login will redirect with ?error=oauth_not_configured)
# For local dev, add http://localhost:8080/v1/auth/oauth/<provider>/callback to each app's Allowed Redirect URIs.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Local dev services (docker compose -f docker-compose.yml up -d postgres redis rustfs)
DATABASE_URL=postgres://kilat:kilat@localhost:54329/kilat_cloud?sslmode=disable
REDIS_URL=redis://localhost:54389/0

# Auth / encryption (generated dev secrets)
JWT_SECRET=${JWT}
SECRET_ENCRYPTION_KEY=${KEK}
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=720h

ARGON2_MEMORY=65536
ARGON2_ITERATIONS=3
ARGON2_PARALLELISM=4
ARGON2_KEY_LENGTH=32
ARGON2_SALT_LENGTH=16

# Onidel Cloud provider (fill to enable real provisioning)
ONIDEL_BASE_URL=https://api.cloud.onidel.com
ONIDEL_API_KEY=

# Internal object storage (S3/R2) — RustFS (self-hosted) from `make up`.
R2_ENDPOINT=http://localhost:54390
R2_ACCESS_KEY=kilat
R2_SECRET_KEY=kilat-secret
R2_BUCKET=kilat-cloud

# RustFS (self-hosted S3) — used by Docker compose; maps into R2_*.
RUSTFS_ACCESS_KEY=kilat
RUSTFS_SECRET_KEY=kilat-secret
RUSTFS_PORT=54390
RUSTFS_CONSOLE_PORT=54391

# SMTP (Resend). Fill SMTP_PASSWORD with the Resend API key to enable email.
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=
SMTP_FROM=noreply@kilat-cloud.com

PAYMENT_PROVIDER=midtrans
PAYMENT_WEBHOOK_SECRET=${PAY}
# SumoPod (https://api-pay.sumopod.com) — set PAYMENT_PROVIDER=sumopod to use it.
SUMOPOD_API_KEY=
SUMOPOD_BASE_URL=https://api-pay.sumopod.com
SUMOPOD_WEBHOOK_SECRET=
SUMOPOD_WEBHOOK_TOKEN=

RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_REGISTER_PER_HOUR=20

# Production flags — dev conveniences disabled
AUTO_VERIFY_EMAIL=false
OTP_DEBUG_ECHO=false
SUBSCRIPTION_GRACE_DAYS=3

# CORS
CORS_ALLOWED_ORIGINS=https://admin.kilat-cloud.com,https://console.kilat-cloud.com,https://auth.kilat-cloud.com,https://kilat-cloud.com,https://www.kilat-cloud.com,https://landing.kilat-cloud.com,https://docs.kilat-cloud.com
EOF

chmod 600 .env
echo ".env generated (chmod 600)."
