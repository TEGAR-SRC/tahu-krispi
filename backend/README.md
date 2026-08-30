# Kilat Cloud Backend

Production-ready Go backend for the Kilat Cloud VPS platform (domain `kilat-cloud.com`),
implementing the contracts in:

1. `docs/Master Prompt Backend Kilat Cloud.md` — business rules & architecture (highest priority)
2. `docs/kilat_cloud_schema_v2.sql` — database schema & constraints
3. `docs/openapi(2) (1).yaml` — HTTP API contract

## Stack

- **Go 1.27**, **Fiber v3** (HTTP), **pgx/v5** (PostgreSQL pool), **go-redis/v9**
- **Argon2id** password hashing (PHC format), AES-256-GCM secret encryption (`SECRET_ENCRYPTION_KEY`)
- **go-webauthn** for passkey MFA, **minio-go** (S3/R2 object storage), **fpdf** (invoice PDFs)
- PostgreSQL as source of truth; Redis for sessions/OTP/rate limits/idempotency/webhook challenge state

## Layout

```
cmd/
  api/        HTTP server entry point
  worker/     durable job worker (wallet credits, renewals, reconciliation, provisioning)
  migrate/    base schema (embedded docs/kilat_cloud_schema_v2.sql) + versioned migrations/
internal/
  api/          Fiber server, all handlers, auth/idempotency middleware wiring
  auth/         JWT access tokens, refresh-token sessions, revoke
  user/         registration, login, profile, addresses, MFA (TOTP/passkey/recovery codes)
  iam/          RBAC roles/permissions, platform-admin checks
  apikey/       API keys: scopes, rotation, revocation
  organization/ orgs, membership, invitations
  catalog/      regions/plans/instance-types/OS templates, SSH keys, startup scripts
  pricing/      quote engine: fixed plans + custom resource dimensions
  compute/      instance lifecycle, snapshots, backups
  network/      VPCs, firewalls + rules, IP lists, reserved IPs, rDNS, BGP session requests
  storage/      object-storage product + internal stored-object metadata
  billing/      orders, invoices, coupons, renewals
  wallet/       ledger-based wallets with idempotent transactions
  payment/      topup creation, HMAC webhook processing (idempotent via payment_events)
  subscription/ plan subscription lifecycle
  support/      tickets, messages
  notification/ in-app notifications and preferences
  webhook/      customer webhooks with HMAC signing secrets
  audit/        audit log writer/reader
  provider/     provider abstraction (ComputeProvider interface) + Onidel adapter
  platform/     config, postgres, redis, crypto, queue, logger, mail, objectstorage
pkg/
  errors/       stable application error codes
  middleware/   request-id, security headers, rate limit, response envelopes, error writer
  validation/   email/phone(E.164)/username/CIDR normalization & checks
scripts/
  gen-env.sh    generates a complete local .env
  smoke.sh      end-to-end endpoint smoke test (62 checks)
  initdb-extensions.sql
```

## Running locally

```bash
make env            # generate .env (or cp .env.example .env and fill values)

# Start dev infra (postgres + redis + rustfs). API/worker run via `go run`.
make up             # docker compose -f docker-compose.yml up -d postgres redis rustfs...

# Option B: local services (Homebrew postgresql@16 + redis)
# createdb kilat_cloud && createuser-compatible setup as in DATABASE_URL

make migrate        # base schema + migrations 000002..000005 (idempotent)
make api            # HTTP API on :8080 (set APP_PORT to override, e.g. 8081)
make worker         # job worker
```

Required env vars (fail-fast): `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`.

### Docker deployment

The backend ships a multi-stage Dockerfile (`backend/Dockerfile`, static no-cgo
binary) plus a single compose file (`backend/docker-compose.yml`) that runs the
full stack: API + PostgreSQL + Redis + RustFS (S3) + Cloudflare Tunnel. The API
auto-migrates on startup, so a fresh deploy is self-healing. Data persists on
the local filesystem via bind mounts under `backend/data/`.

```bash
# 1) prepare env for compose (secrets + Cloudflare tunnel token)
cp backend/compose.env.example backend/compose.env   # edit JWT_SECRET, SECRET_ENCRYPTION_KEY, CLOUDFLARE_TUNNEL_TOKEN

# 2) build & run the full stack
docker compose -f backend/docker-compose.yml --env-file backend/compose.env up -d --build

# 3) optional manual migration
docker compose -f backend/docker-compose.yml --env-file backend/compose.env \
  --profile migrate run --rm migrate

# 4) only infra (dev): postgres + redis + rustfs
docker compose -f backend/docker-compose.yml --env-file backend/compose.env up -d postgres redis rustfs
```

For Cloudflare Tunnel routing, see `docs/DEPLOY_CLOUDFLARE_TUNNEL.md`.

Build context is the repo root:

```bash
docker build -f backend/Dockerfile -t kilat-backend:latest .
```

The image defaults to the API server; override `CMD` for `worker` / `migrate`.

### Development conveniences (never enable in production)

- `AUTO_VERIFY_EMAIL=true` — marks e-mail verified at registration when SMTP is not configured.
- `OTP_DEBUG_ECHO=true` — returns phone OTP codes in API responses instead of sending SMS.

## Verification

```bash
make fmt            # gofmt -w .
make vet            # go vet ./...
make test           # go test ./...
make build          # go build ./...

# end-to-end smoke test against a running stack:
APP_PORT=8081 make api && APP_PORT=8081 make worker &
BASE=http://localhost:8081 bash scripts/smoke.sh
```

The smoke test covers health, auth (+negative cases), profile/addresses/sessions/security events,
MFA TOTP confirm, API key lifecycle (create/get/rotate/authenticate/revoke), catalog,
wallet topup + idempotent signed webhook + worker credit, orders/invoices/subscriptions,
VPC/firewall/IP-list CRUD, tickets/notifications/webhooks, audit logs, dashboard, admin guard.

## Health endpoints

- `GET /healthz` — liveness
- `GET /readyz` — checks Postgres + Redis
- `GET /metrics` — basic runtime metrics (protect at ingress; not for public internet)

## Auth model

- `POST /v1/auth/register` → personal org + wallet created transactionally
- `POST /v1/auth/login` → access token (15 min) + rotating refresh token; MFA challenge when enabled
- MFA: TOTP (secret AES-GCM encrypted at rest), recovery codes (hashed), WebAuthn passkeys
  (register/list/remove); every security-relevant event is written to the audit log
- Session revocation: single (`logout`), all devices (`logout-all`), automatic on password change/reset
- Org context via `X-Organization-ID` header; RBAC permission checked per endpoint
- Machine auth via `X-API-Key` with scoped keys

## Conventions

- Money is `numeric(20,4)` in Postgres and parsed as decimal strings in Go (no float storage)
- Every list response uses the `{data, meta, request_id}` envelope; errors use stable codes from `pkg/errors`
- Provider mutations go through `provider_actions` rows + `jobs` table (durable outbox pattern); the HTTP path never calls Onidel synchronously for provisioning
- Webhooks are HMAC-signed and idempotent via `payment_events(provider, external_event_id)` unique constraint
- Idempotency-Key supported on money-moving POST endpoints via Redis-backed middleware
