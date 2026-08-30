# Kilat Cloud Frontend

Monorepo React (npm workspaces) berisi **empat aplikasi web** untuk platform Kilat Cloud. Semua aplikasi berbagi stack dasar yang sama (React, Vite, TypeScript, Tailwind) tetapi memiliki fokus dan dependensi masing-masing.

| Aplikasi | Folder | Port dev | Domain prod | API |
|----------|--------|:--------:|-------------|-----|
| **Admin Console** | `apps/console-admin` | 5173 | `admin.kilat-cloud.com` | `https://api-admin.kilat-cloud.com` |
| **User Console** | `apps/console-user` | 5174 | `console.kilat-cloud.com` | `https://api-user.kilat-cloud.com` |
| **Landing Page** | `apps/console-landing` | 5175 | `kilat-cloud.com` | `https://api-landing.kilat-cloud.com` |
| **Docs Site** | `apps/console-docs` | 5176 | `docs.kilat-cloud.com` | `https://api-docs.kilat-cloud.com` |

---

## Stack Umum

Semua aplikasi menggunakan:

- **React 19** + **TypeScript 6** + **Vite 8**
- **Tailwind CSS 4** (`@tailwindcss/vite`) + `tailwind-merge` + `clsx` + `class-variance-authority`
- **shadcn/ui** + **radix-ui** primitives
- `react-router-dom` v7, `@fontsource-variable/geist`, `tw-animate-css`
- Alias path `@/` → `src/`
- Proxy `/api` ke API domain masing-masing (rewrite strip `/api`)

Aplikasi **Admin** & **User** juga memakai `recharts` (grafik), `qrcode.react` (QR/TOTP), `cmdk` (command menu), `sonner` (toast), `next-themes` (tema).

Aplikasi **Landing** & **Docs** lebih ringan dan memakai pipeline markdown: `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js`.

---

## Setup

```bash
cd frontend
npm install        # install semua workspaces (apps/*)
```

## Menjalankan Dev

```bash
npm run dev:admin      # console-admin  @ http://localhost:5173
npm run dev:user       # console-user   @ http://localhost:5174
npm run dev:landing    # console-landing @ http://localhost:5175
npm run dev:docs       # console-docs   @ http://localhost:5176
```

## Build & Verifikasi

```bash
npm run build        # build keempat app (tsc -b && vite build)
npm run typecheck    # tsc --noEmit keempat app
npm run lint         # eslint keempat app
npm run format       # prettier --write
```

Per-aplikasi:

```bash
npm run build -w apps/console-admin
npm run dev    -w apps/console-user
# dst.
```

---

## Aplikasi

### 1. Admin Console (`console-admin`)

Konsol internal dengan layout **role-gated** (`admin`, `noc`, `finance`).

- **Auth**: login, signup, forgot/reset password, verify email, OAuth callback, terms/privacy.
- **Admin** (`/admin`): Dashboard, Users, Organizations, Orphans, Tickets, Audit Logs, konten Landing/Docs/Blog, Security (Incidents, BlockedNetworks, FeatureFlags, AppSettings), Instances & Detail, Jobs, Providers (Nodes, Storages, BackupJobs, HA, Firewall, SDN, Ceph, Containers, Pools, VMware Inventory, Guest Perf), Regions/Pools, StorageBackends, Billing (Summary, Reports, Orders, Invoices, Payments, Wallets, Coupons, Products/Plans, CustomRates, Affiliate), Account (Profile, Security, ApiKeys, Notifications), dan integrasi **Dokploy** lengkap (apps, databases, traefik, monitoring, deployments, dll).
- **NOC** (`/noc`): dashboard operasional, instances, providers, tiket, security, konten.
- **Finance** (`/finance`): ringkasan keuangan, laporan, orders/invoices/payments, wallets, coupons, catalog, rates, affiliate.

### 2. User Console (`console-user`)

Konsol pelanggan di bawah `/app`.

- **Auth**: login, signup, forgot/reset, verify email, OAuth, terms/privacy.
- **Pelanggan** (`/app`): Overview, Instances (buat/kelola: overview, metrics, console, firewall, agent, network, notes/tags, snapshot, resize), ISO, Backups, Network (firewall, IP list), Object Storage, Catalog, Wallet (topup, transaksi), Measured Boot, Orders, Invoices, Subscriptions, Affiliate, Tickets, Organizations, Account (profil, security/MFA, alamat, API keys, SSH keys, webhooks, audit), Startup Scripts.

### 3. Landing Page (`console-landing`)

Situs pemasaran publik. Konten di-render dari API (`GET /landing`), dikelola di **console-admin** (bukan hardcode).

- `/` — landing: section **hero, features, pricing, testimonials, faq, banner, blog/list** + fallback header/footer.
- `/blog` — daftar artikel.
- `/blog/:slug` — detail artikel (markdown).

### 4. Docs Site (`console-docs`)

Viewer dokumentasi satu halaman.

- `/docs` — redirect ke dokumen pertama (urutan sort).
- `/docs/:slug` — render dokumen markdown.
- Sidebar kiri yang bisa dicari (filter teks penuh atas judul/deskripsi/konten), drawer navigasi mobile, highlight kode.

---

## Env & Konfigurasi

Setiap app punya `.env.example` (dev) dan `.env.production` (deploy). Variabel `VITE_*`:

| Variabel | Keterangan |
|----------|-----------|
| `VITE_APP_TITLE` | Judul aplikasi |
| `VITE_APP_DOMAIN` | Domain produksi |
| `VITE_API_BASE_URL` | Base URL API backend |
| `VITE_PORT` | Port dev Vite |
| `VITE_CONSOLE_BASE_URL` | URL konsol (untuk deep-link/WebAuthn) |
| `VITE_DOWNLOAD_BASE_URL` | Base URL unduhan |
| `VITE_REQUEST_ID_HEADER` | Header request-id |

> Variabel `VITE_*` di-*inline* saat build — build yang sudah jadi tidak bisa mengubah konfigurasi runtime. Untuk ganti domain, rebuild dengan `.env.production` yang sesuai.

---

## Deployment

Aplikasi adalah **SPA statis** — build menghasilkan folder `dist/` yang bisa disajikan via Cloudflare Pages atau Nginx. Gunakan `scripts/build-if-changed.sh` untuk hanya membangun folder yang berubah (hemat waktu di CI).

```bash
cd frontend
npm run build
# hasil: apps/<app>/dist/
```

Backend API perlu diarahkan lewat domain masing-masing (lihat `docs/DEPLOY_CLOUDFLARE_TUNNEL.md` di repo root untuk routing API + tunnel).
