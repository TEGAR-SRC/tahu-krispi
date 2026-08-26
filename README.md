# tahu-krispi — Kilat Cloud Backend

Backend multi-provider cloud platform (Go + Fiber + PostgreSQL + Redis):

- **Onidel Cloud** (upstream API)
- **Proxmox VE** — VM & LXC container, penuh lifecycle/snapshot/backup/migrate/HA observability
- **VMware vSphere** — govmomi, clone/vMotion/snapshot/tags/perf
- **Dokploy PaaS** — proxy universal seluruh 597 operasi API + mirror DB 12 tabel

## Fitur utama

- Billing hourly → 5 tahun, wallet/topup, kupon, affiliate, invoice PDF
- RBAC 4 role (admin/NOC/finance/customer) + audit log semua aksi admin
- Multi-provider routing per-instance (`instances.provider_id`), isolasi ketat
- Ticketing (lampiran s.d. 100 MB ke S3/R2), ISO kuota 15 GB/10 file/50 GB
- Resource limits on-demand + cost cap, upgrade-lock per provider policy
- REST API terdokumentasi: `docs/API_ENDPOINTS.md` (300+ endpoint)

## Menjalankan

```bash
cd backend
cp .env.example .env   # isi DATABASE_URL, REDIS_URL, JWT_SECRET, dll
make migrate
go run ./cmd/api       # :8081
go run ./cmd/worker
```

## Provider tambahan

Setiap provider dikonfigurasi runtime via `POST /v1/admin/providers`
(kredensial disimpan AES-256-GCM): Proxmox/VMware/Dokploy tinggal
`enabled=true` setelah kredensial cluster asli diisi.
