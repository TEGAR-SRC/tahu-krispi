# Kilat Cloud — API Endpoint Inventory

Role: PUBLIC (tanpa auth) · CUSTOMER [JWT] · CUSTOMER+ORG [JWT atau X-API-Key + X-Organization-ID, RBAC per-scope] · ADMIN/STAFF [platform_admin, finance, noc — area diatur middleware `requireStaff` + `iam.StaffCan`].

## RBAC platform — ringkas (single source of truth: `backend/internal/iam/iam.go:183`)

| Staff role | `staff_role` di `app.users` | Area grants (`iam.StaffCan`) | Akses admin |
|---|---|---|---|
| **platform_admin** (`Admin = *`) | `platform_admin` atau `is_platform_admin=true` | `*` | Semua action GET/POST/PUT/PATCH/DELETE di semua area |
| **noc** | `noc` | `infra` + `tickets` + `users.read` + `marketing` | **GET** infra (observability) boleh, **POST/PUT/DELETE infra tetap platform_admin saja**; tickets full; users read-only; marketing (landing/docs/blog/media) read+write |
| **finance** | `finance` | `billing` + `affiliate` + `users.read` | Billing/affiliate read+write, users read-only; **tidak ada akses infra/tickets/marketing** |
| **user/customer** | `none` | — | Paket via `region` (tanpa `provider_id` di body — provider di-derive dari `regions.provider_id`); tidak menyentuh `/v1/admin/*` |

Aturan keras per-provider: **jangan universal**. Tiap provider punya namespace sendiri — `code`, `id`, `slug`, `region.code`, `plan.code`, `external_id` semua diawali prefix provider (`onidel-*`, `proxmox`/`pve-*`, `vmware`/`vc-*`, `dokploy`). Menu/admin/frontend pun dipisah per provider (lihat `frontend/apps/console-admin/src/features/admin/nav.tsx`, `noc/nav.tsx`, `finance/nav.tsx`).

## Provider registry — seed IDs contoh (4)

> Sumber seed: `backend/internal/platform/migrate/migrations/000004_seed_provider_and_product.sql` (onidel), `000014_proxmox_provider.sql` (proxmox), `000017_vmware_support.sql` (vmware product), `000018_dokploy.sql` (dokploy). Credentials TIDAK di-seed — admin isi via `POST /v1/admin/providers` / `PUT /v1/admin/organizations/:org_id/provider-account` (AES-256-GCM `credentials_ciphertext`).

| # | `providers.code` | `providers.kind` | `providers.name` | slug/id prefix | contoh `providers.id` / `external_id` / `regions.code` | `enabled` default | `health_status` |
|---|---|---|---|---|---|---|---|
| 1 | `onidel` | `onidel` | Onidel Cloud | `onidel-` | `code=onidel` · `regions` sync dari Onidel `locations[].code` (mis. `onidel-jkt`, `onidel-sgp`) · `products.code=kilat-vps` | `true` | `unknown` |
| 2 | `proxmox` | `proxmox` | Kilat Proxmox Cloud | `proxmox` / `pve-` | `code=proxmox` · `regions: pve-jkt / pve-sby` (`external_id = pve-jkt`) · `products: kilat-proxmox-vps (vm), kilat-proxmox-lxc (container)` | `false` (aktifkan setelah isi `api_base_url`+token) | `unknown` |
| 3 | `vmware` | `vmware` | Kilat VMware VPS | `vmware` / `vc-` | `code=vmware` (dibuat runtime via `POST /v1/admin/providers`, bukan seed row) · `products: kilat-vmware-vps` · region contoh `vc-jkt` | — (row dibuat admin) | `unknown` |
| 4 | `dokploy` | `dokploy` | Kilat Dokploy PaaS | `dokploy` | `code=dokploy` · `api_base_url` = URL Dokploy tanpa `/api` · mirror tables `dokploy_projects|servers|registries|...` (`remote_id` upstream) | `false` | `unknown` |

- `providers.kind CHECK` = `onidel, proxmox, vmware, xcpng, hyperv, custom, dokploy` (dokploy ditambah di `000018_dokploy.sql`).
- Produk per-provider lewat `products.metadata->>'provider'`: `kilat-vps` (onidel, `service_kind=vm`), `kilat-proxmox-vps` (`proxmox/vm`), `kilat-proxmox-lxc` (`proxmox/container`), `kilat-vmware-vps` (`vmware/vm`). Custom rates per `product_id + dimension_code` sudah di-seed per provider.
- **User plane**: `POST /v1/instances` dan `POST /v1/pricing/quote` **tanpa `provider_id`** — client kirim `region_id`/`plan_id`; backend resolve `provider_id` dari `regions.provider_id` / `plans.provider_id` / `products.metadata.provider`. Jangan kirim `provider_id` manual dari UI user.

## WebAuthn Relying Party config derives from the existing public-domain (21)

- `POST /v1/auth/register` [JWT/API-Key]
- `POST /v1/auth/login` [JWT/API-Key]
- `POST /v1/auth/refresh` [JWT/API-Key]
- `POST /v1/auth/logout` [JWT/API-Key]
- `POST /v1/auth/logout-all` [JWT/API-Key]
- `POST /v1/auth/password/forgot` [JWT/API-Key]
- `POST /v1/auth/password/reset` [JWT/API-Key]
- `POST /v1/auth/email/verify` [JWT/API-Key]
- `POST /v1/auth/email/resend` [JWT/API-Key]
- `GET /v1/me` [JWT/API-Key]
- `PATCH /v1/me/profile` [JWT]
- `POST /v1/me/password/change` [JWT]
- `GET /v1/me/sessions` [JWT]
- `DELETE /v1/me/sessions/:session_id` [JWT]
- `GET /v1/me/security/events` [JWT]
- `GET /v1/me/resource-limits` [JWT]
- `GET /v1/me/profile-completion` [JWT]
- `POST /v1/me/contact-change` [JWT]
- `POST /v1/me/phone/otp/request` [JWT]
- `POST /v1/me/phone/otp/verify` [JWT]
- `POST /v1/contact-change/confirm` [JWT/API-Key]

## MFA (9)

- `GET /v1/me/mfa` [JWT]
- `POST /v1/me/mfa/totp/setup` [JWT]
- `POST /v1/me/mfa/totp/confirm` [JWT]
- `POST /v1/me/mfa/totp/disable` [JWT]
- `POST /v1/me/mfa/recovery-codes` [JWT]
- `GET /v1/me/mfa/passkeys` [JWT]
- `POST /v1/me/mfa/passkeys/begin-registration` [JWT]
- `POST /v1/me/mfa/passkeys/register` [JWT]
- `DELETE /v1/me/mfa/passkeys/:method_id` [JWT]

## API keys (6)

- `GET /v1/api-keys` [JWT/API-Key]
- `POST /v1/api-keys` [JWT/API-Key]
- `GET /v1/api-keys/:key_id` [JWT/API-Key]
- `PATCH /v1/api-keys/:key_id` [JWT/API-Key]
- `DELETE /v1/api-keys/:key_id` [JWT/API-Key]
- `POST /v1/api-keys/:key_id/rotate` [JWT/API-Key]

## User addresses (5)

- `GET /v1/me/addresses` [JWT]
- `POST /v1/me/addresses` [JWT]
- `PATCH /v1/me/addresses/:address_id` [JWT]
- `DELETE /v1/me/addresses/:address_id` [JWT]
- `POST /v1/me/addresses/:address_id/default` [JWT]

## Profile files (8)

- `POST /v1/me/avatar` [JWT]
- `GET /v1/me/avatar` [JWT]
- `POST /v1/me/documents` [JWT]
- `GET /v1/me/documents` [JWT]
- `GET /v1/regions` [JWT/API-Key] — list region aktif; kolom `provider_id`/`provider_code` ikut terespons tapi **user tidak perlu isi `provider_id` saat order** (auto dari `region`)
- `GET /v1/plans` [JWT/API-Key] — filter `?region_id=` opsional; plan sudah terikat `products.metadata.provider` per-provider
- `GET /v1/instance-types` [JWT/API-Key]
- `GET /v1/os-templates` [JWT/API-Key]

## Organizations (4)

- `GET /v1/organizations` [JWT/API-Key]
- `POST /v1/organizations` [JWT]
- `POST /v1/organizations/:org_id/invitations` [JWT]
- `POST /v1/organizations/invitations/accept` [JWT]

## SSH keys / startup scripts (8)

- `GET /v1/ssh-keys` [JWT/API-Key]
- `POST /v1/ssh-keys` [JWT/API-Key]
- `PATCH /v1/ssh-keys/:key_id` [JWT/API-Key]
- `DELETE /v1/ssh-keys/:key_id` [JWT/API-Key]
- `GET /v1/startup-scripts` [JWT/API-Key]
- `POST /v1/startup-scripts` [JWT/API-Key]
- `PATCH /v1/startup-scripts/:script_id` [JWT/API-Key]
- `DELETE /v1/startup-scripts/:script_id` [JWT/API-Key]

## Pricing (1)

- `POST /v1/pricing/quote` [JWT/API-Key] — body `region_id`/`plan_id`/`custom_resources` tanpa `provider_id`; provider di-derive dari region/plan

## Billing (9)

- `POST /v1/orders` [JWT/API-Key]
- `GET /v1/orders` [JWT/API-Key]
- `GET /v1/orders/:order_id` [JWT/API-Key]
- `POST /v1/orders/:order_id/cancel` [JWT/API-Key]
- `GET /v1/invoices` [JWT/API-Key]
- `GET /v1/invoices/:invoice_id` [JWT/API-Key]
- `POST /v1/invoices/:invoice_id/pay-wallet` [JWT/API-Key]
- `POST /v1/invoices/:invoice_id/payments` [JWT/API-Key]
- `POST /v1/payments/webhook` [JWT/API-Key]

## Wallet (3)

- `GET /v1/wallet` [JWT/API-Key]
- `GET /v1/wallet/transactions` [JWT/API-Key]
- `POST /v1/wallet/topup` [JWT/API-Key]

## Subscriptions (3)

- `GET /v1/subscriptions` [JWT/API-Key]
- `GET /v1/subscriptions/:subscription_id` [JWT/API-Key]
- `POST /v1/subscriptions/:subscription_id/cancel` [JWT/API-Key]

## Instances (20)

Catatan untuk instance dengan `service_kind=container` (LXC, provider `proxmox`): start/stop/reboot, serial-console (`POST /instances/:id/serial-console`), metrics (`GET /instances/:id/metrics`), dan snapshot dijalankan lewat rute yang sama dan otomatis diteruskan ke cabang kontainer provider; fitur VM-only — pause, hibernate, reset, vnc, agent/* — menjawab `501` dari provider tanpa blokir manual di API. **User tidak kirim `provider_id`** — routing via `instances.provider_id` (diisi dari `regions.provider_id` saat provision).

- `GET /v1/instances` [JWT/API-Key]
- `GET /v1/instances/:id` [JWT/API-Key]
- `POST /v1/instances` [JWT/API-Key] — body `region_id` wajib, `provider_id` **dilarang** (auto)
- `PATCH /v1/instances/:id` [JWT/API-Key]
- `DELETE /v1/instances/:id` [JWT/API-Key]
- `POST /v1/instances/:id/start` [JWT/API-Key]
- `POST /v1/instances/:id/stop` [JWT/API-Key]
- `POST /v1/instances/:id/reboot` [JWT/API-Key]
- `POST /v1/instances/:id/resize` [JWT/API-Key]
- `POST /v1/instances/:id/snapshot` [JWT/API-Key]
- `POST /v1/instances/:id/restore-snapshot` [JWT/API-Key]
- `POST /v1/instances/:id/restore-backup` [JWT/API-Key]
- `POST /v1/instances/:id/vnc` [JWT/API-Key]
- `POST /v1/instances/:id/attach-measured-boot` [JWT/API-Key]
- `POST /v1/instances/:id/detach-measured-boot` [JWT/API-Key]
- `GET /v1/snapshots` [JWT/API-Key]
- `POST /v1/snapshots/:snapshot_id/download-url` [JWT/API-Key]
- `DELETE /v1/snapshots/:snapshot_id` [JWT/API-Key]
- `GET /v1/backups` [JWT/API-Key]
- `POST /v1/backups/:backup_id/download-url` [JWT/API-Key]
  - Catatan: respons `{url}` adalah tautan unduh berumur pendek (15 menit); untuk instance proxmox, file backup disajikan sebagai stream dari cluster PVE melalui proxy backend (PVE tidak memiliki presigned URL).

## Instances — Proxmox power, console, notes/tags, metrics, agent & per-VM firewall (26)

Hanya untuk instance `provider.kind=proxmox` (prefix `pve-`/`proxmox`). Non-proxmox → `501 PROVIDER_UNSUPPORTED` dari provider.

- `POST /v1/instances/:id/reset` [JWT/API-Key]
- `POST /v1/instances/:id/pause` [JWT/API-Key]
- `POST /v1/instances/:id/resume` [JWT/API-Key]
- `POST /v1/instances/:id/hibernate` [JWT/API-Key]
- `POST /v1/instances/:id/serial-console` [JWT/API-Key] — pola respons sama dengan `/vnc`: URL serial konsol terenkripsi berumur pendek
- `GET /v1/instances/:id/notes` [JWT/API-Key]
- `PUT /v1/instances/:id/notes` [JWT/API-Key]
- `GET /v1/instances/:id/tags` [JWT/API-Key]
- `PUT /v1/instances/:id/tags` [JWT/API-Key] — maks. 32 tag, masing-masing ≤64 karakter
- `GET /v1/instances/:id/metrics` [JWT/API-Key] — query `?timeframe=hour|day|week|month` (default `hour`)
- `GET /v1/instances/:id/agent/osinfo` [JWT/API-Key]
- `GET /v1/instances/:id/agent/fsinfo` [JWT/API-Key]
- `GET /v1/instances/:id/agent/info` [JWT/API-Key]
- `POST /v1/instances/:id/agent/ping` [JWT/API-Key]
- `GET /v1/instances/:id/firewall/rules` [JWT/API-Key]
- `POST /v1/instances/:id/firewall/rules` [JWT/API-Key]
- `DELETE /v1/instances/:id/firewall/rules/:pos` [JWT/API-Key] — `pos` bilangan bulat ≥0
- `GET /v1/instances/:id/firewall/options` [JWT/API-Key]
- `PUT /v1/instances/:id/firewall/options` [JWT/API-Key] — menolak kunci level rule (`dport`/`proto`/`action`)
- `GET /v1/instances/:id/firewall/ipsets` [JWT/API-Key]
- `POST /v1/instances/:id/firewall/ipsets` [JWT/API-Key] — body `{name, comment?}`; nama ipset 1–32 karakter `[a-z0-9_-]` (201)
- `DELETE /v1/instances/:id/firewall/ipsets/:name` [JWT/API-Key] — query `?force=1` opsional untuk menghapus ipset yang masih berisi entri
- `GET /v1/instances/:id/firewall/ipsets/:name/entries` [JWT/API-Key]
- `POST /v1/instances/:id/firewall/ipsets/:name/entries` [JWT/API-Key] — body `{cidr, comment?}`; `cidr` wajib (201)
- `PUT /v1/instances/:id/firewall/ipsets/:name/entries/*` [JWT/API-Key] — segmen wildcard membawa CIDR lama (mengandung `/`); body `{new_cidr?, comment?}`
- `DELETE /v1/instances/:id/firewall/ipsets/:name/entries` [JWT/API-Key] — query `?cidr=` wajib; bentuk wildcard `.../entries/*` (CIDR di path) terdaftar ke handler yang sama

## ISOs & measured boot images (9)

- `GET /v1/isos` [JWT/API-Key]
- `POST /v1/isos` [JWT/API-Key]
- `POST /v1/isos/upload` [JWT/API-Key]
- `POST /v1/isos/:iso_id/retry` [JWT/API-Key]
- `GET /v1/isos/:iso_id` [JWT/API-Key]
- `DELETE /v1/isos/:iso_id` [JWT/API-Key]
- `GET /v1/measured-boot-images` [JWT/API-Key]
- `POST /v1/measured-boot-images` [JWT/API-Key]
- `DELETE /v1/measured-boot-images/:image_id` [JWT/API-Key]

## Network (29)

- `GET /v1/vpcs` [JWT/API-Key]
- `POST /v1/vpcs` [JWT/API-Key]
- `PATCH /v1/vpcs/:vpc_id` [JWT/API-Key]
- `DELETE /v1/vpcs/:vpc_id` [JWT/API-Key]
- `GET /v1/firewall-groups` [JWT/API-Key]
- `POST /v1/firewall-groups` [JWT/API-Key]
- `PUT /v1/firewall-groups/:firewall_id` [JWT/API-Key]
- `DELETE /v1/firewall-groups/:firewall_id` [JWT/API-Key]
- `GET /v1/firewall-groups/:firewall_id/rules` [JWT/API-Key]
- `POST /v1/firewall-groups/:firewall_id/rules` [JWT/API-Key]
- `PATCH /v1/firewall-groups/:firewall_id/rules/:rule_id` [JWT/API-Key]
- `DELETE /v1/firewall-groups/:firewall_id/rules/:rule_id` [JWT/API-Key]
- `GET /v1/ip-lists` [JWT/API-Key]
- `POST /v1/ip-lists` [JWT/API-Key]
- `GET /v1/ip-lists/:list_id` [JWT/API-Key]
- `PATCH /v1/ip-lists/:list_id` [JWT/API-Key]
- `DELETE /v1/ip-lists/:list_id` [JWT/API-Key]
- `POST /v1/ip-lists/:list_id/entries` [JWT/API-Key]
- `DELETE /v1/ip-lists/:list_id/entries/:entry_id` [JWT/API-Key]
- `GET /v1/reserved-ips` [JWT/API-Key]
- `POST /v1/reserved-ips` [JWT/API-Key]
- `POST /v1/reserved-ips/convert` [JWT/API-Key]
- `DELETE /v1/reserved-ips/:rip_id` [JWT/API-Key]
- `PATCH /v1/reserved-ips/:rip_id` [JWT/API-Key]
- `GET /v1/instances/:id/rdns` [JWT/API-Key]
- `POST /v1/instances/:id/rdns` [JWT/API-Key]
- `DELETE /v1/instances/:id/rdns/*` [JWT/API-Key]
- `POST /v1/instances/:id/enable-bgp` [JWT/API-Key]
- `POST /v1/instances/:id/disable-bgp` [JWT/API-Key]

## Storage (7)

- `POST /v1/object-storage` [JWT/API-Key]
- `DELETE /v1/object-storage/:service_id` [JWT/API-Key]
- `GET /v1/object-storage` [JWT/API-Key]
- `GET /v1/object-storage/:service_id` [JWT/API-Key]
- `GET /v1/object-storage/:service_id/buckets` [JWT/API-Key]
- `POST /v1/object-storage/:service_id/buckets` [JWT/API-Key]
- `GET /v1/object-storage/:service_id/buckets/:bucket_name/access_keys` [JWT/API-Key]

## Support (7)

- `GET /v1/tickets` [JWT/API-Key]
- `POST /v1/tickets` [JWT/API-Key]
- `GET /v1/tickets/:ticket_id/messages` [JWT/API-Key]
- `POST /v1/tickets/:ticket_id/messages` [JWT/API-Key]
- `POST /v1/tickets/:ticket_id/close` [JWT/API-Key]
- `POST /v1/tickets/:ticket_id/messages/attachments` [JWT/API-Key]
- `GET /v1/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id` [JWT/API-Key]

## Notifications (5)

- `GET /v1/notifications` [JWT]
- `POST /v1/notifications/:notification_id/read` [JWT]
- `POST /v1/notifications/read-all` [JWT]
- `GET /v1/notifications/preferences` [JWT]
- `PATCH /v1/notifications/preferences` [JWT]

## Webhooks (4)

- `GET /v1/webhooks` [JWT/API-Key]
- `POST /v1/webhooks` [JWT/API-Key]
- `DELETE /v1/webhooks/:webhook_id` [JWT/API-Key]
- `GET /v1/webhook-deliveries` [JWT/API-Key]

## Dashboard (1)

- `GET /v1/dashboard/summary` [JWT/API-Key]

## Audit (1)

- `GET /v1/audit-logs` [JWT/API-Key]

## Affiliate / referral program — user plane (4)

- `GET /v1/me/affiliate` [JWT]
- `POST /v1/me/affiliate/code` [JWT]
- `POST /v1/me/affiliate/withdraw` [JWT]
- `POST /v1/affiliate/track/:code` [JWT/API-Key]

## Admin — umum (platform scope, bukan per-provider) (28)

Semua rute `/v1/admin/*` di `backend/internal/api/server.go:485` butuh `authJWT()` + `allowAudiences(admin,auth)` + `requireStaff(area)`. **NOC `GET` infra boleh, mutasi infra `POST/PUT/DELETE` tetap platform_admin.** Finance hanya `billing/affiliate` + `users.read`.

- `GET /v1/admin/users` [`users` — NOC+Finance read, platform_admin full] — list customer, filter `?q=&role=`
- `PATCH /v1/admin/users/:user_id/limits` [`""` — platform_admin only]
- `POST /v1/admin/users/:user_id/suspend` [`""` — platform_admin only]
- `POST /v1/admin/users/:user_id/activate` [`""` — platform_admin only]
- `POST /v1/admin/users/:user_id/grant-admin` [`""` — platform_admin only]
- `GET /v1/admin/organizations` [`""` — platform_admin only]
- `POST /v1/admin/organizations/:org_id/suspend` [`""` — platform_admin only]
- `PUT /v1/admin/organizations/:org_id/provider-account` [`infra` — NOC GET? tidak, ini mutasi → platform_admin only; NOC read-only infra tidak boleh upsert]
- `GET /v1/admin/feature-flags/:key` [`""` — platform_admin only]
- `PUT /v1/admin/feature-flags/:key` [`""` — platform_admin only]
- `GET /v1/admin/app-settings/:key` [`""` — platform_admin only]
- `PUT /v1/admin/app-settings/:key` [`""` — platform_admin only]
- `GET /v1/admin/audit-logs` [`""` — platform_admin only; NOC/finance 403]
- `GET /v1/admin/finance/summary` [`auto` → `""` — platform_admin + finance (NOC 403)] — ringkasan keuangan periode `?days=N` (default 30, clamp 365)
- `GET /v1/admin/providers` [`auto` → `infra` — platform_admin + NOC GET; finance 403] — list registry; `code` sudah prefix provider
- `POST /v1/admin/providers` [`auto` → `""` — platform_admin only; NOC 403] — upsert provider (body `code/kind/name/api_base_url/enabled`); `code` wajib prefix (`onidel`/`proxmox`/`vmware`/`dokploy`)
- `POST /v1/admin/providers/:provider_id/test` [`auto` → `""` — platform_admin only] — test koneksi provider (contoh `provider_id` = `onidel` / `proxmox` / `vmware` / `dokploy`)
- `POST /v1/admin/providers/:provider_id/sync` [`auto` → `""` — platform_admin only] — sync catalog (Onidel: instance_types/os_templates/locations; Proxmox/VMware: no-op/sync infra)
- `DELETE /v1/admin/providers/:provider_id` [`auto` → `""` — platform_admin only; 409 bila masih direferensikan instances/regions/provider_accounts (nonaktifkan via `POST /v1/admin/providers` `enabled=false`)]
- `GET /v1/admin/affiliate/settings` [`billing` — platform_admin+finance] 
- `PUT /v1/admin/affiliate/settings` [`billing` — platform_admin+finance]
- `GET /v1/admin/affiliate/earnings` [`billing` — platform_admin+finance]
- `POST /v1/admin/affiliate/earnings/:earning_id/reverse` [`billing` — platform_admin+finance]
- `GET /v1/admin/products` [`billing` — platform_admin+finance] — `products.code` prefix provider (`kilat-vps`, `kilat-proxmox-vps`, `kilat-proxmox-lxc`, `kilat-vmware-vps`)
- `POST /v1/admin/products` [`billing` — platform_admin+finance]
- `PATCH /v1/admin/products/:product_id` [`billing` — platform_admin+finance]
- `GET /v1/admin/plans` [`billing` — platform_admin+finance] — `plans.code`/`provider_id` konsisten prefix provider
- `POST /v1/admin/plans` [`billing` — platform_admin+finance]
- `POST /v1/admin/plans/:plan_id/prices` [`billing` — platform_admin+finance]
- `GET /v1/admin/custom-rates` [`billing` — platform_admin+finance] — `custom_resource_rates` per `product_id` prefix provider
- `POST /v1/admin/custom-rates` [`billing` — platform_admin+finance]
- `GET /v1/admin/regions` [`billing` — platform_admin+finance] — `regions.code` prefix provider (`pve-jkt` untuk proxmox, `onidel-*` untuk onidel, `vc-*` untuk vmware)
- `POST /v1/admin/regions` [`billing` — platform_admin+finance]
- `GET /v1/admin/coupons` [`billing` — platform_admin+finance]
- `POST /v1/admin/coupons` [`billing` — platform_admin+finance]
- `DELETE /v1/admin/coupons/:coupon_id` [`billing` — platform_admin+finance]
- `GET /v1/admin/coupons/:coupon_id` [`billing` — platform_admin+finance]
- `GET /v1/admin/orders` [`billing` — platform_admin+finance]
- `GET /v1/admin/orders/:order_id` [`billing` — platform_admin+finance]
- `POST /v1/admin/orders/:order_id/void` [`billing` — platform_admin+finance]
- `GET /v1/admin/invoices` [`billing` — platform_admin+finance]
- `GET /v1/admin/invoices/:invoice_id` [`billing` — platform_admin+finance]
- `POST /v1/admin/invoices/:invoice_id/void` [`billing` — platform_admin+finance]
- `GET /v1/admin/payments` [`billing` — platform_admin+finance]
- `POST /v1/admin/wallets/:org_id/adjust` [`billing` — platform_admin+finance]
- `GET /v1/admin/storage-backends` [`infra` — platform_admin+NOC GET; finance 403]
- `PUT /v1/admin/storage-backends/:code` [`infra` — platform_admin only]
- `DELETE /v1/admin/storage-backends/:code` [`infra` — platform_admin only]
- `GET /v1/admin/landing` [`marketing` — platform_admin+NOC]
- `POST /v1/admin/landing` [`marketing` — platform_admin+NOC]
- `PUT /v1/admin/landing/:id` [`marketing` — platform_admin+NOC]
- `DELETE /v1/admin/landing/:id` [`marketing` — platform_admin+NOC]
- `GET /v1/admin/docs` [`marketing` — platform_admin+NOC]
- `POST /v1/admin/docs` [`marketing` — platform_admin+NOC]
- `PUT /v1/admin/docs/:id` [`marketing` — platform_admin+NOC]
- `DELETE /v1/admin/docs/:id` [`marketing` — platform_admin+NOC]
- `GET /v1/admin/blog` [`marketing` — platform_admin+NOC]
- `POST /v1/admin/blog` [`marketing` — platform_admin+NOC]
- `PUT /v1/admin/blog/:id` [`marketing` — platform_admin+NOC]
- `DELETE /v1/admin/blog/:id` [`marketing` — platform_admin+NOC]
- `POST /v1/admin/media` [`marketing` — platform_admin+NOC]
- `GET /v1/admin/media` [`marketing` — platform_admin+NOC]
- `DELETE /v1/admin/media/:id` [`marketing` — platform_admin+NOC]

## Admin — Onidel (provider `onidel`, prefix `onidel-`) — registry only

Onidel adalah provider `kind=onidel` (`code=onidel`). Tidak ada sub-rute infra khusus Onidel di luar registry generik — catalog sync dan operasional VM lewat generic provider interface. Semua rute di bawah memakai `requireStaff("auto")` yang resolve ke `infra` untuk `GET /providers`.

- `GET /v1/admin/providers` — lihat contoh `code=onidel` (prefix `onidel-` untuk region/plan) [platform_admin+NOC GET]
- `POST /v1/admin/providers` — upsert `code=onidel` (`kind=onidel`) [platform_admin only]
- `POST /v1/admin/providers/onidel/sync` — sync `instance_types`/`os_templates`/`locations` Onidel → `regions`/`instance_types`/`os_templates` [platform_admin only]
- `POST /v1/admin/providers/onidel/test` — test `api_base_url`+`api_key` Onidel [platform_admin only]
- `GET /v1/admin/providers/onidel/cluster` → `501` (hanya proxmox yang implement cluster) — doc sentinel bahwa Onidel tidak punya cluster API

> Instance Onidel diakses user via `POST /v1/instances {region_id: <id region onidel>}` tanpa `provider_id`; admin lihat via `GET /v1/admin/instances?provider=onidel`.

## Admin — Proxmox (provider `proxmox`, prefix `proxmox`/`pve-`) — infra read (NOC) + mutate (admin) (51)

Semua rute `requireStaff("auto")`: **GET = `infra` (NOC + platform_admin)**, **POST/PUT/DELETE = platform_admin only**. `provider_id` contoh = `proxmox` (code) atau UUID provider proxmox; `node` contoh = `pve-jkt`/`pve-sby`; `storage` contoh = `local-lvm`/`ceph-01`; semua id/slug diawali `pve-` atau `proxmox-`. Non-proxmox provider → `501 PROVIDER_UNSUPPORTED`.

Instance ops (by `instances.provider_id = proxmox`):

- `POST /v1/admin/instances/:instance_id/clone` — body `{name}`; enqueue job clone (202) — 501 non-proxmox
- `POST /v1/admin/instances/:instance_id/template` — konversi VM→template PVE sinkron — 501 non-proxmox
- `POST /v1/admin/instances/:instance_id/move-volume` — body `{volume, target_storage}` sinkron
- `POST /v1/admin/instances/:instance_id/migrate` — body `{target_node}`; enqueue migrasi (202); 501 non-proxmox

Cluster & node observability:

- `GET /v1/admin/providers/proxmox/cluster` — daftar node + inventaris resource cluster PVE
- `GET /v1/admin/providers/proxmox/containers` — inventaris LXC seluruh cluster, filter `?node=pve-jkt` opsional
- `GET /v1/admin/providers/proxmox/nodes/:node/storages` — storage terlihat dari satu node
- `GET /v1/admin/providers/proxmox/nodes/:node/tasks` — task berjalan + arsip pada satu node
- `GET /v1/admin/providers/proxmox/nodes/:node/detail` — status detail satu node PVE
- `GET /v1/admin/providers/proxmox/nodes/:node/disks` — inventaris disk node
- `GET /v1/admin/providers/proxmox/nodes/:node/certs` — sertifikat node
- `POST /v1/admin/providers/proxmox/nodes/:node/command` **[admin only]** — body `{command}` ∈ `reboot|shutdown|wakeonlan` (202)
- `POST /v1/admin/providers/proxmox/nodes/:node/backup` **[admin only]** — vzdump ad-hoc, body `{vmid, storage, mode?}` (202)
- `GET /v1/admin/providers/proxmox/nodes/:node/dns` — resolver DNS node
- `PUT /v1/admin/providers/proxmox/nodes/:node/dns` **[admin only]** — body `{search}` wajib + `{dns1?, dns2?, dns3?}`
- `GET /v1/admin/providers/proxmox/nodes/:node/time` — jam & zona waktu node
- `GET /v1/admin/providers/proxmox/cpu-models` — model CPU QEMU (`?arch=x86_64` default, `?node=pve-jkt` opsional)

Storage & backup:

- `GET /v1/admin/providers/proxmox/storages/:storage/content` — query `?node=pve-jkt` wajib
- `DELETE /v1/admin/providers/proxmox/storages/:storage/content` **[admin only]** — query `?node=&volume=` wajib (202)
- `GET /v1/admin/providers/proxmox/storages/:storage/file-restore` — query `?node=&volume=&path=` wajib (browser arsip backup)
- `GET /v1/admin/providers/proxmox/backup-jobs`
- `POST /v1/admin/providers/proxmox/backup-jobs` **[admin only]** (201)
- `PUT /v1/admin/providers/proxmox/backup-jobs/:job_id` **[admin only]**
- `DELETE /v1/admin/providers/proxmox/backup-jobs/:job_id` **[admin only]**
- `POST /v1/admin/providers/proxmox/backup-jobs/:job_id/run` **[admin only]** (202)

HA & cluster:

- `GET /v1/admin/providers/proxmox/ha-resources` — filter `?type=` opsional
- `POST /v1/admin/providers/proxmox/ha-resources` **[admin only]** (201)
- `DELETE /v1/admin/providers/proxmox/ha-resources` **[admin only]** — query `?sid=` wajib
- `POST /v1/admin/providers/proxmox/ha/arm` **[admin only]**
- `POST /v1/admin/providers/proxmox/ha/disarm` **[admin only]** — body `{mode}` ∈ `freeze|ignore`
- `GET /v1/admin/providers/proxmox/cluster/log` — `?max=N` (default 100)
- `GET /v1/admin/providers/proxmox/cluster/tasks`
- `GET /v1/admin/providers/proxmox/cluster-storages`
- `POST /v1/admin/providers/proxmox/cluster-storages` **[admin only]** — body `{storage, type, ...}` (201)
- `PUT /v1/admin/providers/proxmox/cluster-storages/:name` **[admin only]**
- `DELETE /v1/admin/providers/proxmox/cluster-storages/:name` **[admin only]** (202)

Firewall / pools / SDN / Ceph:

- `GET /v1/admin/providers/proxmox/fw-groups`
- `POST /v1/admin/providers/proxmox/fw-groups` **[admin only]** (201)
- `DELETE /v1/admin/providers/proxmox/fw-groups` **[admin only]** — query `?name=` wajib
- `GET /v1/admin/providers/proxmox/fw-groups/:group/rules`
- `POST /v1/admin/providers/proxmox/fw-groups/:group/rules` **[admin only]** (201)
- `DELETE /v1/admin/providers/proxmox/fw-groups/:group/rules/:pos` **[admin only]**
- `GET /v1/admin/providers/proxmox/firewall-rules`
- `POST /v1/admin/providers/proxmox/firewall-rules` **[admin only]** (201)
- `DELETE /v1/admin/providers/proxmox/firewall-rules/:pos` **[admin only]**
- `GET /v1/admin/providers/proxmox/pools`
- `POST /v1/admin/providers/proxmox/pools` **[admin only]** (201)
- `PUT /v1/admin/providers/proxmox/pools/:pool_id` **[admin only]**
- `DELETE /v1/admin/providers/proxmox/pools/:pool_id` **[admin only]**
- `PUT /v1/admin/providers/proxmox/pools/:pool_id/members` **[admin only]** — body `{vms, storages, comment?, delete?}`
- `GET /v1/admin/providers/proxmox/ceph-status`
- `GET /v1/admin/providers/proxmox/sdn/zones`
- `GET /v1/admin/providers/proxmox/sdn/vnets`

Ops generik (infra, provider-agnostic tapi contoh proxmox):

- `GET /v1/admin/instances` [`infra` — NOC+admin]
- `GET /v1/admin/instances/:instance_id` [`infra`]
- `GET /v1/admin/jobs/:job_id` [`infra`]
- `POST /v1/admin/instances/:instance_id/suspend` [`infra`]
- `POST /v1/admin/instances/:instance_id/unsuspend` [`infra`]
- `POST /v1/admin/instances/:instance_id/terminate` [`infra`]
- `GET /v1/admin/jobs` [`infra`]
- `POST /v1/admin/jobs/:job_id/retry` [`infra`]
- `POST /v1/admin/jobs/:job_id/cancel` [`infra`]
- `GET /v1/admin/orphans` [`infra`]
- `POST /v1/admin/orphans/:orphan_id/resolve` [`infra`]
- `GET /v1/admin/security-incidents` [`infra`]
- `POST /v1/admin/security-incidents/:incident_id/resolve` [`infra`]
- `GET /v1/admin/blocked-networks` [`infra`]
- `POST /v1/admin/blocked-networks` [`infra`]
- `DELETE /v1/admin/blocked-networks/:network_id` [`infra`]
- `GET /v1/admin/tickets` [`tickets` — NOC+admin] — queue staff
- `POST /v1/admin/tickets/:ticket_id/reply` [`tickets`]
- `POST /v1/admin/tickets/:ticket_id/reply/attachments` [`tickets`]
- `GET /v1/admin/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id` [`tickets`]
- `POST /v1/admin/tickets/:ticket_id/assign` [`tickets`]
- `POST /v1/admin/tickets/:ticket_id/close` [`tickets`]

## Admin — VMware (provider `vmware`, prefix `vmware`/`vc-`) — infra read (NOC) + mutate (admin) (2)

Khusus `kind=vmware`; non-vmware → `501`. Invarian `requireStaff("auto")` sama dengan Proxmox (GET infra, mutate admin). `perf` adalah endpoint netral provider (vmware + proxmox).

- `GET /v1/admin/providers/vmware/inventory` — inventaris vCenter (hosts: nama/cpu threads/memory bytes/power state, datastores: kapasitas/bebas bytes, clusters, resource pools); `provider_id` contoh `vmware`
- `GET /v1/admin/providers/vmware/perf` — query `?v=<ext_id>` wajib + `?timeframe=hour|day`; metrik tamu via `GuestMetrics` generik (vmware & proxmox)

> Endpoint `perf` yang sama juga tersedia sebagai `GET /v1/admin/providers/proxmox/perf` — didokumentasikan di sini sebagai VMware karena inventory adalah pembeda VMware; perf reuse cross-provider.

## Admin — Dokploy PaaS (provider `dokploy`, prefix `dokploy`) — admin only (4)

Provider `kind=dokploy` dikonfigurasi via `POST /v1/admin/providers` — `api_base_url` berisi URL server Dokploy tanpa sufiks `/api`, `api_key` berisi Dokploy API key; keduanya disimpan terenkripsi AES-GCM. `code`/`remote_id`/`slug` semua prefix `dokploy`.

- `{METHOD} /v1/dokploy/{tag.method}` [JWT/API-Key + `requireStaff("auto")` → platform_admin only] — proxy transparan ke server Dokploy; `POST/PUT/PATCH` meneruskan JSON body, `GET/DELETE` meneruskan query string, error upstream direlay apa adanya. Contoh `tag.method`: `application.create`, `compose.deploy`. Semua 597 operasi Dokploy v0.30.2 via satu rute ini — jangan bikin rute universal per-entity.
- `POST /v1/admin/dokploy/sync` [platform_admin only] — body `{"entity":"projects|servers|registries|sshkeys|certificates"}`; tarik upstream & upsert mirror DB (`by remote_id` prefix dokploy) + rekonsiliasi hapus; respons `{synced,failed,removed}`
- `GET /v1/admin/dokploy/db/:entity` [platform_admin only] — baca mirror lokal (`?limit=&offset=`); entity: `projects, environments, applications, composes, databases, domains, deployments, backups, servers, registries, sshkeys, certificates`
- `DELETE /v1/admin/dokploy/db/:entity/:remote_id` [platform_admin only] — hapus satu baris mirror lokal (`remote_id` prefix `dokploy`)

Total: ~322 (21 auth + 9 MFA + 6 API keys + 5 addresses + 8 profile/catalog + 4 org + 8 ssh/scripts + 1 pricing + 9 billing + 3 wallet + 3 subs + 20 instances + 26 pve-ext + 9 ISO + 29 network + 7 storage + 7 support + 5 notifications + 4 webhooks + 1 dashboard + 1 audit + 4 affiliate user + 28 admin umum + 5 onidel registry + 51 proxmox infra + 2 vmware + 4 dokploy + infra healthz/metrics tidak dihitung).

Catatan infrastruktur (di luar inventory, tidak dihitung): `GET /healthz`, `GET /readyz`, dan `GET /metrics` terdaftar langsung pada app root di `server.go` — dokumen ini belum memiliki section infrastruktur. Menu frontend lama yang universal (`/admin/providers` generik tanpa tabs per-kind, `/admin/instances` universal tanpa filter provider) **dihapus** — diganti menu/tab per-provider prefix di `Providers.tsx` (`Tabs` `all/onidel/proxmox/vmware/dokploy`), `nav.tsx` (admin/noc/finance terpisah), dan `routes.tsx` per-konsol.

