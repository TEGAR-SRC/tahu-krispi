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
DOWNLOAD_BASE_URL=https://dl.kilat-cloud.com

# OAuth — Google / GitHub (empty = provider disabled, login will redirect with ?error=oauth_not_configured)
# For local dev, add http://localhost:8080/v1/auth/oauth/<provider>/callback to each app's Allowed Redirect URIs.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Local dev services (docker compose -f docker-compose.dev.yml up -d)
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

# Internal object storage (S3/R2). Empty = file endpoints return 503.
# Defaults below target the local MinIO from `make up` (buckets auto-created);
# for production point these at real Cloudflare R2 / S3 credentials.
R2_ENDPOINT=http://localhost:54390
R2_ACCESS_KEY=kilat
R2_SECRET_KEY=kilat-secret
R2_BUCKET=kilat-cloud-dev

# SMTP (empty host = email jobs parked as failed; flows keep working)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
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

# Dev-only: echo phone OTP in API responses (no SMS gateway yet)
# Dev-only: auto-activate accounts on registration (SMTP not configured)
AUTO_VERIFY_EMAIL=true
OTP_DEBUG_ECHO=true
SUBSCRIPTION_GRACE_DAYS=3
EOF

chmod 600 .env
echo ".env generated (chmod 600)."
