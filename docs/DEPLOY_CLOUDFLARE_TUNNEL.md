# Deploy Backend via Docker Compose + Cloudflare Tunnel

Menyebarkan backend Kilat Cloud dengan Docker Compose dan mengeksposnya ke
internet lewat **Cloudflare Tunnel** — tanpa membuka port publik. Database,
Redis, dan RustFS berjalan di network Docker internal; hanya cloudflared yang
keluar ke Cloudflare.

## Ringkasan arsitektur

```
Internet ──▶ Cloudflare (edge) ──▶ cloudflared (tunnel) ──▶ api:8080
                                                            ├── postgres:5432
                                                            ├── redis:6379
                                                            └── rustfs:9000 (S3)
```

- Semua service ada di network `kilat-net` (bridge).
- Hanya `cloudflared` yang menghubungi Cloudflare (outbound); tidak ada port
  publik yang perlu dibuka di firewall kecuali SSH untuk admin.
- Data persist di filesystem lokal via bind mount `./data/`.

## Prasyarat

- Server dengan Docker Engine (≥ 20.10) + Docker Compose v2.
- Token Cloudflare Tunnel (remotely-managed). Ambil di:
  Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** → simpan token.

## 1. Siapkan env

```bash
cd backend
cp compose.env.example compose.env
# Wajib diisi:
#   JWT_SECRET, SECRET_ENCRYPTION_KEY  (openssl rand -hex 32)
#   CLOUDFLARE_TUNNEL_TOKEN            (token dari dashboard)
# Opsional: kredensial SMTP, R2/RustFS, dsb.
```

> `compose.env` ter-gitignore (pola `*.env`), jadi aman berisi token/secret.

## 2. Build & jalankan

```bash
docker compose --env-file compose.env up -d --build
```

Yang berjalan:

| Service     | Keterangan                                  |
| ----------- | ------------------------------------------- |
| `postgres`  | PostgreSQL 16, data di `./data/postgres`    |
| `redis`     | Redis 7 (appendonly), data di `./data/redis`|
| `rustfs`    | Object storage S3, data di `./data/rustfs`  |
| `api`       | Backend Go, auto-migrate saat startup       |
| `cloudflared`| Tunnel Cloudflare                          |
| `migrate`   | (opsional) `docker compose --profile migrate run --rm migrate` |

## 3. Konfigurasi routing di Cloudflare Dashboard

Karena token adalah **remotely-managed tunnel**, routing hostname → service
dilakukan di dashboard, bukan di compose:

Zero Trust → **Networks → Tunnels → <tunnel> → Public Hostnames**, tambahkan
setiap hostname dan arahkan ke service di network `kilat-net`:

| Hostname (public)       | Service         | Tipe   | Keterangan                   |
| ----------------------- | --------------- | ------ | ---------------------------- |
| `api.kilat-cloud.com`   | `http://api:8080` | HTTP  | API generik (semua endpoint) |
| `api-admin.kilat-cloud.com` | `http://api:8080` | HTTP | API admin console          |
| `api-user.kilat-cloud.com`  | `http://api:8080` | HTTP | API user console           |
| `api-auth.kilat-cloud.com`  | `http://api:8080` | HTTP | API auth console (identitas) |
| `api-landing.kilat-cloud.com`| `http://api:8080` | HTTP | API landing page           |
| `api-docs.kilat-cloud.com`   | `http://api:8080` | HTTP | API docs site              |

> Frontend console standalone (`auth.kilat-cloud.com`) di-deploy via Cloudflare
> Pages dengan domain `auth.kilat-cloud.com`, dan berbicara ke `api-auth.kilat-cloud.com`.

> Service name `api` = nama container dalam network Docker, bukan `localhost`.

Backend melakukan **audience scoping** dari Host header: tiap domain API hanya
melayani endpoint yang relevan (lihat `middleware_audience.go`).

### (Opsional) Akses DB / Redis / RustFS dari luar

Jangan expose database ke internet umum. Jika benar-benar perlu akses dari
mesin admin, gunakan Cloudflare Tunnel **TCP route** di dashboard ke
`tcp://postgres:5432`, `tcp://redis:6379`, `tcp://rustfs:9000` — dibatasi via
Access policies (Zero Trust → Access). Lebih aman: `docker compose exec postgres psql ...`.

## 4. Verifikasi

```bash
docker compose --env-file compose.env ps        # semua up
docker compose --env-file compose.env logs -f cloudflared   # tunnel connected
curl -s https://api.kilat-cloud.com/healthz     # "ok"
curl -s https://api.kilat-cloud.com/v1/landing  # public JSON
```

## Network & keamanan

- Semua service di `kilat-net` (bridge) — komunikasi internal antar container.
- `cloudflared` hanya melakukan outbound ke Cloudflare → firewall tidak perlu
  buka port 8080/5432/6379/9000 ke publik.
- Data persist: `backend/data/{postgres,redis,rustfs}` — backup folder ini.
- Ganti `JWT_SECRET` & `SECRET_ENCRYPTION_KEY` di produksi.
