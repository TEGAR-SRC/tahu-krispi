# Kilat Cloud — Security Audit

Audit fokus: **autentikasi & otorisasi** (cegah bypass / IDOR lintas-tenant).
Scope: `backend/` (Go/Fiber) + `frontend/`. Tanggal: 2026-08-31.

## Ringkasan eksekutif

Sistem memakai JWT HS256 + session revocation + audience scoping yang solid di
bagian auth, TAPI ditemukan **1 kerentanan kritikal (Broken Access Control /
IDOR lintas-tenant)** dan **1 gap menengah (akun ter-suspend masih berfungsi
sampai token kadaluwarsa)**. Kerentanan kritikal memungkinkan user yang
terautentikasi mengakses/mengubah resource organisasi lain dengan memanipulasi
header `X-Organization-ID`. Direkomendasikan fix segera.

| # | Severity | Temuan | Status |
|---|----------|--------|--------|
| 1 | **CRITICAL** | `withOrg` tidak verifikasi keanggotaan org → IDOR lintas-tenant | Diperbaiki |
| 2 | **HIGH** | Akun ter-suspend/ter-nonaktifkan tetap punya akses sampai token kedaluwarsa | Terbuka |
| 3 | MEDIUM | Cakupan `audienceAdmin` melayani semua endpoint (by design) | Info |
| 4 | INFO | JWT hardcoded `alg:HS256`, constant-time, cek exp + revoked session — solid | OK |
| 5 | INFO | `npm audit` 0 kerentanan; secret tidak ter-commit | OK |
| 6 | INFO | `govulncheck` belum terpasang (rekomendasi) | Terbuka |

---

## Temuan 1 — CRITICAL: Broken Access Control / IDOR lintas-tenant

**Lokasi:** `backend/internal/api/server.go` → `withOrg()` (baris ~632).

**Masalah:** middleware `withOrg` membaca `org_id` dari header
`X-Organization-ID` (atau query `organization_id`), lalu menyimpannya di locals
`org_id` **tanpa memverifikasi bahwa user terautentikasi adalah anggota org
tersebut**. Banyak handler customer (`handlers_compute.go`, `handlers_iplist.go`,
`handlers_billing.go`, `handlers_dashboard.go`, dll.) lalu memakai
`mustOrgID(c)` (yang cuma membaca locals) dan **tidak** memanggil
`orgSvc.Authorize` / `RequireMember`.

**Dampak:** user (atau API key) yang sudah login dapat mengirim
`X-Organization-ID: <uuid-org-lain>` untuk membaca / mengubah / membuat resource
milik organisasi lain (instance, SSH keys, startup scripts, orders, invoices,
wallet, IP lists, dll). UUID organisasi bukan rahasia dan bisa bocor via
undangan, log, dukungan, dsb.

**Contoh endpoint terdampak (pakai `withOrg` tanpa verifikasi):**
`GET/POST/PATCH/DELETE /ssh-keys`, `/startup-scripts`, `/orders/*`, `/invoices/*`,
`/wallet*`, `/instances/*`, `/ip-lists/*`, `/snapshots/*`, `/backups/*`, dsb.

**Root cause umum** dengan API-key: `authAny()` menerima `X-API-Key`; `withOrg`
juga tidak memvalidasi binding org untuk API key.

**Remediasi (sudah diterapkan):**
- `withOrg` kini memanggil `orgSvc.RequireMember(orgID, userID)` untuk auth JWT →
  non-anggota ditolak `403`.
- Untuk `X-API-Key`, `withOrg` menolak jika org dari header ≠ org binding key.

---

## Temuan 2 — HIGH: Akun ter-suspend tetap bisa akses sampai token kedaluwarsa

**Lokasi:** `backend/internal/api/middleware_auth.go` → `requireStaff()`.

**Masalah:** login memeriksa `status='active'` (`internal/user/service.go:299`),
tapi `requireStaff` per-request hanya memeriksa `deleted_at IS NULL` — **tidak**
memeriksa `status`. Jadi staff yang di-suspend (tidak dihapus) tetap dapat
mengakses `/v1/admin/*` dengan JWT yang belum kedaluwarsa (TTL akses default
15 menit). Sama untuk route customer JWT — tidak ada cek status per-request.

**Remediasi (rekomendasi):** cek `status='active'` di `requireStaff` (dan
opsional di `jwtAuth` untuk semua request bertoken), serta putus session
(Redis revoked) saat akun di-suspend.

---

## Temuan 3 — MEDIUM (info): cakupan audience admin

`middleware_audience.go` → `audienceAdmin` mengembalikan `true` untuk semua
path (staff console boleh akses semua). Ini by-design untuk konsol staff dan
bukan bypass, tapi berarti `api-admin.kilat-cloud.com` juga bisa menjangkau
endpoint customer. Catat sebagai pertimbangan segmentasi jika diperlukan.

## Temuan 4 — INFO: JWT hardening (OK)

- `verifyHS256` memakai `hmac.Equal` (constant-time).
- `alg` tidak dikendalikan attacker (hardcoded HS256; `alg:none` → signature
  tetap wajib).
- `VerifyAccessToken` memeriksa `typ=access` + `exp` + session revoked di Redis.
- Tidak ada `iss`/`aud`, tapi secret symmetric kuat (HS256). Aman dari
  RS256→HS256 karena secret hanya dipakai HMAC.

## Temuan 5 — INFO: Dependency & secret (OK)

- `npm audit` (frontend): **0 vulnerabilities**.
- `backend/compose.env` di-gitignore (`*.env`); hanya `.example` yang di-track.
  Tidak ada secret ter-commit.
- `govulncheck` belum terpasang — jalankan untuk audit dependensi Go:
  `cd backend && go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...`

---

## Remediasi prioritas

| Prioritas | Aksi |
|-----------|------|
| P0 | ✅ `withOrg` + verifikasi keanggotaan org (selesai) |
| P1 | ✅ Cek `status='active'` di `requireStaff` (selesai) |
| P1 | Pasang `govulncheck` di CI + audit dependensi Go berkala |
| P2 | Pertimbangkan segmentasi `audienceAdmin` |

---

## Audit deep-pass (ke-2) — terverifikasi aman

| Area | Hasil |
|------|-------|
| SQL injection (builder `admOrgFilter`, `resourcelimits`, dokploy) | ✅ Parameterized / kolom hardcoded — tidak ada SQLi |
| SSRF (URL ISO) | ✅ `ssrfpkg.Validate` di `handleCreateISO` |
| Media / object storage | ✅ `/v1/media/:id` publik hanya `landing_media` (marketing); avatar/dokumen scoped ke user (`/me/avatar`) |
| Eskalaasi role invite | ✅ Role whitelist **tanpa `owner`**; invite butuh `members.write` |
| Grant admin | ✅ Hanya platform_admin (`staffAreaFor` → `""`) |
| Revoke session | ✅ logout/logout-all/ganti-password/reset set Redis `kc:session:revoked` yang di-cek `VerifyAccessToken` |

## Catatan defense-in-depth (minor, tidak ada celah terbuka)

- `VerifyAccessToken` mengandalkan Redis revoked key untuk invalidasi pasca ganti-password; tidak membandingkan `pwv` token dengan `password_version` DB. Jika **Redis di-flush** (kehilangan key), akses token lama bisa valid kembali sampai TTL (15 mnt). Mitigasi opsional: cek `password_version` per-request (biaya 1 query DB/request) — tidak diterapkan demi performa, karena jalur normal (RevokeAllSessions) sudah menutup ini.

## Cakupan audit tambahan (terverifikasi aman)

| Area | Verifikasi | Hasil |
|------|-----------|-------|
| Semua route `/v1/admin/*` | Butuh `requireStaff` | ✅ Tidak ada yang lolos |
| Semua pembaca `X-Organization-ID` | `withOrg` (RequireMember), api-key handler (`orgSvc.Authorize`), resource-limits (`isOrgMember`) | ✅ Semua validasi keanggotaan |
| Upload file (avatar/dokumen) | Limit ukuran 5/10MB + MIME whitelist + object key server-generated | ✅ Tidak ada path traversal / file tak dikenal |
| Proxy `/v1/dokploy/*` | `requireStaff("auto")` → platform_admin only; relay ke base terkonfigurasi | ✅ SSRF terbatas, bukan public |
| Endpoint auth | Rate limit di login/register/forgot/reset/resend | ⚠️ `/auth/email/verify` & `/auth/refresh` tanpa limiter (low — token high-entropy, tapi DoS kecil) |
| Dependency | `npm audit` 0 vuln | ✅ |

## Temuan low / rekomendasi lanjutan

- ✅ **Terverifikasi:** lockout per-akun (5 gagal → terkunci 15 mnt) + rate-limit per-IP + MFA lockout → brute-force password & TOTP tertutup.
- ✅ **Fixed:** `/v1/auth/email/verify` & `/v1/auth/refresh` kini punya rate limiter.
- ✅ **Fixed:** CI `govulncheck` (backend) + `gitleaks` (secret scan) di `.github/workflows/security.yml`.
- **Rekomendasi (dashboard Cloudflare Pages):** set header `Content-Security-Policy` di tiap project SPA:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.kilat-cloud.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  (Verifikasi dulu bahwa SPA tidak butuh `unsafe-eval`/inline-script sebelum strict.)
- **Catatan:** token JWT di `localStorage` rentan exfil via XSS. Saat ini tidak ada sink XSS (hanya chart terkontrol), tapi untuk hardening lanjutan pertimbangkan cookie `httpOnly` + CSRF token.

