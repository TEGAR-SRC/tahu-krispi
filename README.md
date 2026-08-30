# Kilat Cloud

> Platform cloud / VPS multi-provider dengan backend Go yang production-ready, empat konsol web React, dan deployment Docker Compose + Cloudflare Tunnel di bawah domain `kilat-cloud.com`.

Kilat Cloud adalah platform komputasi awan yang mengelola **instance virtual (VM/LXC), container PaaS, object storage, jaringan, dan billing** di atas beberapa penyedia infrastruktur (Onidel, Proxmox VE, VMware vSphere, Dokploy) melalui satu API terpusat dan empat frontend web.

Repo ini adalah **monorepo** yang berisi:

| Direktori | Isi |
|-----------|-----|
| `backend/` | API server Go + job worker + migrasi + Docker deployment |
| `frontend/` | Monorepo React (npm workspaces) dengan 4 aplikasi |
| `docs/` | Kontrak bisnis, skema DB, dokumentasi API, panduan deploy |

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Arsitektur](#arsitektur)
- [Stack Teknologi](#stack-teknologi)
- [Struktur Repositori](#struktur-repositori)
- [Konsol & Domain](#konsol--domain)
- [Audience Scoping (Isolasi Per-Konsol)](#audience-scoping-isolasi-per-konsol)
- [Memulai (Development)](#memulai-development)
- [Konfigurasi Environment](#konfigurasi-environment)
- [Deployment (Docker + Cloudflare Tunnel)](#deployment-docker--cloudflare-tunnel)
- [Keamanan](#keamanan)
- [Verifikasi & Pengujian](#verifikasi--pengujian)
- [Dokumentasi Tambahan](#dokumentasi-tambahan)

---

## Fitur Utama

### Compute & Provididing
- **Multi-provider routing** per instance (`instances.provider_id`) dengan isolasi ketat antar penyedia.
- **Onidel Cloud** — API upstream; **Proxmox VE** — VM & LXC penuh (lifecycle, snapshot, backup, migrate, HA); **VMware vSphere** — govmomi (clone, vMotion, snapshot, tags, performance); **Dokploy PaaS** — proxy universal 597 operasi API + mirror 12 tabel DB.
- **ISO kuota** (15 GB / 10 file / 50 GB), custom ISO by-upload atau by-URL (dengan validasi SSRF).
- **Resource limits on-demand + cost cap**, kebijakan upgrade-lock per provider, resize atomik (spec + reprice).

### Billing & Keuangan
- Billing period **hourly → 5 tahun**, invoice PDF, kupon, promo.
- **Wallet** berbasis ledger dengan transaksi idempoten (lock row + non-negatif guard).
- Topup via **SumoPod** (payment gateway), webhook HMAC + svix, idempoten via `payment_events`.
- **Affiliate** — komisi referrer + bonus referee (migrasi `000023`), withdrawal ke wallet.
- Subscription lifecycle, renewal otomatis, reconciliation.

### Keamanan & Akses
- **RBAC 4 role**: `admin`, `noc`, `finance`, `customer` + permission per endpoint.
- **MFA**: TOTP (secret AES-256-GCM), recovery codes (hashed), **WebAuthn passkey**.
- **API keys** dengan scope, rotasi, dan revoke.
- **Audit log** untuk semua aksi admin/keamanan.
- Rate limiting, idempotency-key middleware, SSRF guard, per-konsol audience scoping.

### Produk
- Object storage (S3-compatible, self-hosted **RustFS**), jaringan (VPC, firewall, reserved IP, rDNS, BGP), ticketing (lampiran s.d. 100 MB ke S3), notifikasi, webhook pelanggan, in-app dashboard.

### Frontend
- **4 konsol React**: Admin (role-gated admin/NOC/finance), User (pelanggan), Landing (pemasaran), Docs (dokumentasi).
- Konten **landing/docs/blog** dikelola via DB (CRUD oleh admin), bukan hardcode.

---

## Arsitektur

```
                        ┌────────────────────────────┐
   Browser              │        Cloudflare Edge     │
  admin/user/landing/   │   (HTTPS + tunnel ingress) │
  docs consoles         └─────────────┬──────────────┘
        │                             │ cloudflared (Tunnel)
        ▼                             ▼
   api-admin / api-user /        ┌────────────────────────────┐
   api-landing / api-docs        │        docker: kilat-net    │
   (Host-header scoping) ──────▶ │  api (Go/Fiber) ── postgres │
        │                        │        ├────── redis        │
        ▼                        │        └────── rustfs (S3)  │
   (semua API)                   │  cloudflared ── outbound    │
                                 └────────────────────────────┘
```

- **Backend**: API server (`cmd/api`), job worker (`cmd/worker`), migrator (`cmd/migrate`).
- **Data**: PostgreSQL sebagai source of truth; Redis untuk session/OTP/rate-limit/idempotency/lock; RustFS (S3) untuk objek/berkas.
- **Frontend**: 4 SPA React statis (Cloudflare Pages atau Nginx), masing-masing menunjuk API domain-nya sendiri.

---

## Stack Teknologi

### Backend (`backend/`)
- **Go 1.27**, **Fiber v3** (HTTP), **pgx/v5** (PostgreSQL pool), **go-redis/v9**
- **Argon2id** password hashing (PHC), **AES-256-GCM** secret encryption (`SECRET_ENCRYPTION_KEY`)
- **go-webauthn** (passkey MFA), **minio-go** (S3/R2), **go-pdf/fpdf** (invoice PDF), **govmomi** (VMware), **go-proxmox** (PVE)
- PostgreSQL = source of truth; Redis = session/OTP/rate-limit/idempotency/webhook-state

### Frontend (`frontend/`)
- **React 19**, **Vite 8**, **TypeScript 6**, **Tailwind CSS 4**, **shadcn/ui** + **radix-ui**
- `react-router-dom` v7, `recharts` (grafik), `qrcode.react`, `cmdk`, `sonner`, `next-themes`
- Landing & Docs: `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js`

---

## Struktur Repositori

```
tahu-krispi/
├── backend/
│   ├── cmd/
│   │   ├── api/        # HTTP server entry point
│   │   ├── worker/     # durable job worker (provisioning, renewals, email, webhook, iso)
│   │   └── migrate/    # base schema + versioned migrations (000001..000023)
│   ├── internal/
│   │   ├── api/        # Fiber server, semua handler, auth/idempotency/audience middleware
│   │   ├── auth/       # JWT, refresh-token sessions, revoke
│   │   ├── user/       # registrasi, login, profil, alamat, MFA (TOTP/passkey/recovery)
│   │   ├── iam/        # RBAC roles/permissions
│   │   ├── apikey/     # API keys: scope, rotasi, revoke
│   │   ├── organization/ # org, membership, invitation
│   │   ├── catalog/    # regions/plans/instance-types/OS, SSH keys, startup scripts
│   │   ├── pricing/    # quote engine (fixed plan + custom resource)
│   │   ├── compute/    # instance lifecycle, snapshot, backup, resize
│   │   ├── network/    # VPC, firewall, IP list, reserved IP, rDNS, BGP
│   │   ├── storage/    # object-storage product + metadata berkas
│   │   ├── billing/    # orders, invoices, coupons, renewals
│   │   ├── wallet/     # ledger wallet, transaksi idempoten
│   │   ├── payment/    # topup, webhook SumoPod (idempoten)
│   │   ├── subscription/ # lifecycle subscription
│   │   ├── affiliate/  # komisi referrer + bonus referee
│   │   ├── support/    # tiket & pesan
│   │   ├── notification/ # notifikasi in-app
│   │   ├── webhook/    # webhook pelanggan (HMAC secret)
│   │   ├── audit/      # audit log
│   │   ├── provider/   # abstraction ComputeProvider + Onidel/Proxmox/VMware/Dokploy
│   │   └── platform/   # config, postgres, redis, crypto, queue, mail, objectstorage, migrate
│   ├── pkg/
│   │   ├── errors/     # kode error aplikasi yang stabil
│   │   ├── middleware/ # request-id, security headers, rate limit, envelope, error writer
│   │   ├── validation/ # email/phone(E.164)/username/CIDR
│   │   ├── ssrf/       # proteksi SSRF (block loopback/private/metadata)
│   │   └── httputil/   # helper HTTP
│   ├── scripts/        # gen-env.sh, smoke.sh, rbac_smoke.sh, detail_smoke.sh
│   ├── Dockerfile      # multi-stage, static no-cgo
│   ├── docker-compose.yml
│   ├── compose.env(.example)
│   ├── Makefile
│   └── .env(.example)  # (gitignored) env lokal untuk `go run`
│
├── frontend/
│   ├── apps/
│   │   ├── console-admin/   # admin.kilat-cloud.com :5173
│   │   ├── console-user/    # console.kilat-cloud.com :5174
│   │   ├── console-landing/ # landing (kilat-cloud.com) :5175
│   │   └── console-docs/    # docs (docs.kilat-cloud.com) :5176
│   └── scripts/build-if-changed.sh  # skip build folder yang tidak berubah
│
└── docs/
    ├── API_ENDPOINTS.md
    ├── DEPLOY_CLOUDFLARE_TUNNEL.md
    ├── ERD_FITUR_BARU.md
    ├── kilat_cloud_schema_v2.sql
    ├── openapi(2) (1).yaml
    └── Master Prompt Backend/Frontend Kilat Cloud.md
```

---

## Konsol & Domain

| Konsol | Folder | Port dev | Domain prod | API domain |
|--------|--------|:--------:|-------------|------------|
| Admin Console | `frontend/apps/console-admin` | 5173 | `admin.kilat-cloud.com` | `https://api-admin.kilat-cloud.com` |
| User Console | `frontend/apps/console-user` | 5174 | `console.kilat-cloud.com` | `https://api-user.kilat-cloud.com` |
| Landing Page | `frontend/apps/console-landing` | 5175 | `kilat-cloud.com` | `https://api-landing.kilat-cloud.com` |
| Docs Site | `frontend/apps/console-docs` | 5176 | `docs.kilat-cloud.com` | `https://api-docs.kilat-cloud.com` |
| API generik | — | — | — | `https://api.kilat-cloud.com` (semua endpoint) |

Domain API konsol diatur lewat env: `ADMIN_API_DOMAIN`, `USER_API_DOMAIN`, `LANDING_API_DOMAIN`, `DOCS_API_DOMAIN`.

---

## Audience Scoping (Isolasi Per-Konsol)

Backend menentukan **audience** dari **Host header** setiap request dan hanya melayani endpoint yang relevan (`middleware_audience.go`):

| Audience | Domain Host | Yang dilayani |
|----------|-------------|---------------|
| `admin` | `api-admin.kilat-cloud.com` | `/v1/admin/*` + permukaan staff |
| `user` | `api-user.kilat-cloud.com` | endpoint pelanggan |
| `landing` | `api-landing.kilat-cloud.com` | marketing publik + media |
| `docs` | `api-docs.kilat-cloud.com` | docs publik + media |
| `all` | `api.kilat-cloud.com` / localhost | semua endpoint |

> Endpoint admin hanya bisa diakses via `api-admin`; domain user tidak bisa memanggil endpoint admin (ditolak `403`). Otentikasi sebenarnya tetap dari **JWT + RBAC**, audience scoping adalah lapisan isolasi tambahan.

---

## Memulai (Development)

### Prasyarat
- Go 1.27+
- Node 20+ & npm 10+
- Docker (untuk `make up` — postgres/redis/rustfs) **atau** PostgreSQL 16 + Redis lokal
- `make` (GNU Make)

### 1. Backend

```bash
cd backend
make env              # generate .env lokal (postgres/redis/rustfs + secret)
make up               # start infra: docker compose up postgres redis rustfs
make migrate          # apply base schema + semua migration (idempoten)
make api              # API server di :8080 (override APP_PORT)
# terminal terpisah:
make worker           # job worker
```

Smoke test end-to-end (butuh API berjalan):

```bash
APP_PORT=8081 make api &   # atau set APP_PORT di .env
BASE=http://localhost:8081 bash scripts/smoke.sh
```

### 2. Frontend

Dari root `frontend/`:

```bash
cd frontend
npm install                    # install semua workspaces
npm run dev:admin              # console-admin @ :5173
npm run dev:user               # console-user  @ :5174
npm run dev:landing            # console-landing @ :5175
npm run dev:docs               # console-docs   @ :5176
```

Bangun semua (produksi):

```bash
npm run build                  # build keempat app
npm run typecheck              # typecheck keempat app
npm run lint                   # eslint keempat app
```

> Perkecil build dengan `frontend/scripts/build-if-changed.sh` (hanya build folder yang berubah — berguna untuk Cloudflare Pages per-folder).

---

## Konfigurasi Environment

### Backend lokal — `backend/.env` (gitignored)
Di-generate oleh `make env` (`scripts/gen-env.sh`) atau salin dari `.env.example`. Variabel yang **wajib** (fail-fast):

```
DATABASE_URL
REDIS_URL
JWT_SECRET                  # openssl rand -hex 32
SECRET_ENCRYPTION_KEY       # openssl rand -hex 32
PAYMENT_WEBHOOK_SECRET
```

Variabel penting lainnya: `APP_ENV`, `APP_DOMAIN`, `PUBLIC_API_BASE_URL`, `CONSOLE_BASE_URL`, `ADMIN_CONSOLE_BASE_URL`, `DOWNLOAD_BASE_URL`, `ADMIN_API_DOMAIN`, `USER_API_DOMAIN`, `LANDING_API_DOMAIN`, `DOCS_API_DOMAIN`, `CORS_ALLOWED_ORIGINS`, `SMTP_*`, `SUMOPOD_*`, `ONIDEL_API_KEY`, `R2_*`/`RUSTFS_*`, `AUTO_VERIFY_EMAIL` (jangan `true` di prod), `OTP_DEBUG_ECHO` (jangan `true` di prod).

> **Keamanan env**: file berisi secret (`.env`, `compose.env`) ter-gitignore. Jangan pernah commit secret nyata ke repo. Template (`*.env.example`, `*.example`) hanya berisi placeholder.

### Frontend — `frontend/apps/<app>/.env.production`
Setiap app punya `.env.production` yang menentukan `VITE_APP_TITLE`, `VITE_APP_DOMAIN`, `VITE_API_BASE_URL`, `VITE_PORT`. Salin pola dari `.env.example` untuk dev.

---

## Deployment (Docker + Cloudflare Tunnel)

Backend di-deploy sebagai satu stack Docker Compose yang berjalan di belakang **Cloudflare Tunnel** — tanpa membuka port publik ke internet.

### 1. Siapkan env compose

```bash
cd backend
cp compose.env.example compose.env
# Isi wajib:
#   JWT_SECRET, SECRET_ENCRYPTION_KEY, PAYMENT_WEBHOOK_SECRET, CLOUDFLARE_TUNNEL_TOKEN
# Opsional: SMTP (Resend), SUMOPOD_*, dsb.
```

> `compose.env` ter-gitignore — aman berisi token/secret.

### 2. Build & jalankan stack

```bash
docker compose --env-file compose.env up -d --build
```

Yang berjalan di network `kilat-net`:

| Service | Keterangan |
|---------|-----------|
| `postgres` | PostgreSQL 16, data `./data/postgres` |
| `redis` | Redis 7 (appendonly), data `./data/redis` |
| `rustfs` | Object storage S3, data `./data/rustfs` |
| `api` | Backend Go, **auto-migrate saat startup** |
| `cloudflared` | Tunnel Cloudflare (outbound) |
| `migrate` | (opsional) `docker compose --profile migrate run --rm migrate` |

### 3. Routing di Cloudflare Dashboard

Karena token tunnel adalah **remotely-managed**, routing hostname → service dilakukan di dashboard (Zero Trust → Networks → Tunnels → Public Hostnames):

| Hostname publik | Service Docker | Tipe |
|-----------------|----------------|------|
| `api.kilat-cloud.com` | `http://api:8080` | HTTP |
| `api-admin.kilat-cloud.com` | `http://api:8080` | HTTP |
| `api-user.kilat-cloud.com` | `http://api:8080` | HTTP |
| `api-landing.kilat-cloud.com` | `http://api:8080` | HTTP |
| `api-docs.kilat-cloud.com` | `http://api:8080` | HTTP |

Detail lengkap: [`docs/DEPLOY_CLOUDFLARE_TUNNEL.md`](docs/DEPLOY_CLOUDFLARE_TUNNEL.md).

### 4. Verifikasi

```bash
docker compose --env-file compose.env ps
docker compose --env-file compose.env logs -f cloudflared   # tunnel connected
curl -s https://api.kilat-cloud.com/healthz                 # "ok"
curl -s https://api.kilat-cloud.com/v1/landing              # public JSON
```

---

## Keamanan

- **Secret**: `.env` & `compose.env` gitignored; template hanya placeholder. Rotasi secret yang pernah terekspos di riwayat git.
- **Password**: Argon2id (PHC) + perbandingan constant-time.
- **MFA**: TOTP secret AES-256-GCM di rest; recovery codes di-hash; passkey WebAuthn; lockout per-akun (5 gagal → 15 menit) pada verifikasi 2FA; men-disable MFA wajib kode saat ini.
- **Token**: JWT HS256 access (15 menit) + refresh rotate; token OAuth dikirim via URL **fragment** (`#`), bukan query string.
- **Injection/SSRF**: semua query parameterized; SSRF guard untuk URL outbound; ISO by-URL divalidasi ulang.
- **Idempotency**: middleware `Idempotency-Key` per-user untuk endpoint pemindah-uang; key gagal dilepas (bukan replay palsu).
- **Authorization**: RBAC 4 role + audience scoping per domain; invoice/payment diverifikasi kepemilikan org; refund topup dibalik di ledger.
- **Cryptography**: AES-256-GCM dengan nonce acak (tidak ada nonce/IV reuse); key diderivasi dari secret server.
- **Worker**: job `running` dengan lease di-reclaim bila worker crash; graceful drain saat shutdown.
- **Network**: semua service di network internal; hanya `cloudflared` outbound ke Cloudflare.

---

## Verifikasi & Pengujian

### Backend

```bash
cd backend
make fmt            # gofmt -w .
make vet            # go vet ./...
make test           # go test ./...
make build          # go build ./...
make smoke          # end-to-end smoke test (62 checks)
make rbac           # matriks role admin/finance/noc
```

Smoke test mencakup: health, auth (termasuk negatif), profil/alamat/sesi/event keamanan, MFA TOTP, API key, catalog, wallet topup + webhook idempoten, orders/invoices/subscriptions, VPC/firewall/IP-list, tiket/notifikasi/webhook, audit log, dashboard, guard admin.

### Frontend

```bash
cd frontend
npm run typecheck    # tsc --noEmit untuk keempat app
npm run lint         # eslint keempat app
npm run build        # build keempat app
```

---

## Dokumentasi Tambahan

- [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md) — daftar endpoint (300+)
- [`docs/openapi(2) (1).yaml`](docs/openapi(2) (1).yaml) — kontrak HTTP API
- [`docs/kilat_cloud_schema_v2.sql`](docs/kilat_cloud_schema_v2.sql) — skema & constraint DB
- [`docs/ERD_FITUR_BARU.md`](docs/ERD_FITUR_BARU.md) — ERD fitur
- [`docs/DEPLOY_CLOUDFLARE_TUNNEL.md`](docs/DEPLOY_CLOUDFLARE_TUNNEL.md) — panduan deploy
- `docs/Master Prompt Backend Kilat Cloud.md` & `docs/Master Prompt Frontend Kilat Cloud — React User & Admin.md` — kontrak bisnis & arsitektur

---

## Lisensi

Proyek ini privat (`tahu-krispi`). Jangan distribusikan tanpa izin.
