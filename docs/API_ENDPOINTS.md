# Kilat Cloud — API Endpoint Inventory

Role: PUBLIC (tanpa auth) · CUSTOMER [JWT] · CUSTOMER+ORG [JWT atau X-API-Key + X-Organization-ID, RBAC per-scope] · ADMIN/STAFF [platform_admin, finance, noc — area diatur middleware requireStaff].


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
- `GET /v1/regions` [JWT/API-Key]
- `GET /v1/plans` [JWT/API-Key]
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

- `POST /v1/pricing/quote` [JWT/API-Key]

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

Catatan untuk instance dengan `service_kind=container` (LXC): start/stop/reboot, serial-console (`POST /instances/:id/serial-console`), metrics (`GET /instances/:id/metrics`), dan snapshot dijalankan lewat rute yang sama dan otomatis diteruskan ke cabang kontainer provider; fitur VM-only — pause, hibernate, reset, vnc, agent/* — menjawab `501` dari provider tanpa blokir manual di API.

- `GET /v1/instances` [JWT/API-Key]
- `GET /v1/instances/:id` [JWT/API-Key]
- `POST /v1/instances` [JWT/API-Key]
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

## Affiliate / referral program (77)

- `GET /v1/me/affiliate` [JWT]
- `POST /v1/me/affiliate/code` [JWT]
- `POST /v1/me/affiliate/withdraw` [JWT]
- `POST /v1/affiliate/track/:code` [JWT/API-Key]
- `GET /v1/admin/users` [ADMIN]
- `PATCH /v1/admin/users/:user_id/limits` [ADMIN]
- `GET /v1/admin/affiliate/settings` [ADMIN]
- `PUT /v1/admin/affiliate/settings` [ADMIN]
- `GET /v1/admin/affiliate/earnings` [ADMIN]
- `POST /v1/admin/affiliate/earnings/:earning_id/reverse` [ADMIN]
- `POST /v1/admin/users/:user_id/suspend` [ADMIN]
- `POST /v1/admin/users/:user_id/activate` [ADMIN]
- `POST /v1/admin/users/:user_id/grant-admin` [ADMIN]
- `GET /v1/admin/organizations` [ADMIN]
- `POST /v1/admin/organizations/:org_id/suspend` [ADMIN]
- `PUT /v1/admin/organizations/:org_id/provider-account` [ADMIN]
- `GET /v1/admin/providers` [ADMIN]
- `POST /v1/admin/providers` [ADMIN]
- `POST /v1/admin/providers/:provider_id/sync` [ADMIN]
- `DELETE /v1/admin/providers/:provider_id` [ADMIN] — hanya platform admin; 409 bila provider masih direferensikan instances/regions/provider_accounts (nonaktifkan via POST /v1/admin/providers dengan enabled=false)
- `GET /v1/admin/providers/:provider_id/cluster` [ADMIN] — NOC/platform admin; daftar node + inventaris resource cluster PVE
- `GET /v1/admin/providers/:provider_id/nodes/:node/storages` [ADMIN] — NOC/platform admin; storage yang terlihat dari satu node
- `GET /v1/admin/providers/:provider_id/nodes/:node/tasks` [ADMIN] — NOC/platform admin; task berjalan + arsip pada satu node
- `GET /v1/admin/products` [ADMIN]
- `POST /v1/admin/products` [ADMIN]
- `GET /v1/admin/plans` [ADMIN]
- `POST /v1/admin/plans` [ADMIN]
- `PATCH /v1/admin/products/:product_id` [ADMIN]
- `GET /v1/admin/storage-backends` [ADMIN]
- `PUT /v1/admin/storage-backends/:code` [ADMIN]
- `DELETE /v1/admin/storage-backends/:code` [ADMIN]
- `POST /v1/admin/plans/:plan_id/prices` [ADMIN]
- `GET /v1/admin/custom-rates` [ADMIN]
- `POST /v1/admin/custom-rates` [ADMIN]
- `GET /v1/admin/regions` [ADMIN]
- `POST /v1/admin/regions` [ADMIN]
- `GET /v1/admin/coupons` [ADMIN]
- `POST /v1/admin/coupons` [ADMIN]
- `DELETE /v1/admin/coupons/:coupon_id` [ADMIN]
- `GET /v1/admin/feature-flags/:key` [ADMIN]
- `PUT /v1/admin/feature-flags/:key` [ADMIN]
- `GET /v1/admin/app-settings/:key` [ADMIN]
- `PUT /v1/admin/app-settings/:key` [ADMIN]
- `GET /v1/admin/orders` [ADMIN]
- `GET /v1/admin/orders/:order_id` [ADMIN]
- `GET /v1/admin/invoices/:invoice_id` [ADMIN]
- `GET /v1/admin/coupons/:coupon_id` [ADMIN]
- `POST /v1/admin/orders/:order_id/void` [ADMIN]
- `GET /v1/admin/invoices` [ADMIN]
- `POST /v1/admin/invoices/:invoice_id/void` [ADMIN]
- `GET /v1/admin/payments` [ADMIN]
- `GET /v1/admin/finance/summary` [ADMIN] — ringkasan keuangan periode N hari via query `?days=N` (default 30, clamp maks. 365); finance/platform admin
- `POST /v1/admin/wallets/:org_id/adjust` [ADMIN]
- `GET /v1/admin/instances` [ADMIN]
- `GET /v1/admin/instances/:instance_id` [ADMIN]
- `GET /v1/admin/jobs/:job_id` [ADMIN]
- `POST /v1/admin/instances/:instance_id/suspend` [ADMIN]
- `POST /v1/admin/instances/:instance_id/unsuspend` [ADMIN]
- `POST /v1/admin/instances/:instance_id/terminate` [ADMIN]
- `POST /v1/admin/instances/:instance_id/migrate` [ADMIN] — NOC/platform admin; body `{target_node}`; meng-enqueue job migrasi (202), 501 untuk instance non-proxmox
- `GET /v1/admin/jobs` [ADMIN]
- `POST /v1/admin/jobs/:job_id/retry` [ADMIN]
- `POST /v1/admin/jobs/:job_id/cancel` [ADMIN]
- `GET /v1/admin/orphans` [ADMIN]
- `POST /v1/admin/orphans/:orphan_id/resolve` [ADMIN]
- `GET /v1/admin/security-incidents` [ADMIN]
- `POST /v1/admin/security-incidents/:incident_id/resolve` [ADMIN]
- `GET /v1/admin/blocked-networks` [ADMIN]
- `POST /v1/admin/blocked-networks` [ADMIN]
- `DELETE /v1/admin/blocked-networks/:network_id` [ADMIN]
- `GET /v1/admin/tickets` [ADMIN]
- `POST /v1/admin/tickets/:ticket_id/reply` [ADMIN]
- `POST /v1/admin/tickets/:ticket_id/reply/attachments` [ADMIN]
- `GET /v1/admin/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id` [ADMIN]
- `POST /v1/admin/tickets/:ticket_id/assign` [ADMIN]
- `POST /v1/admin/tickets/:ticket_id/close` [ADMIN]
- `GET /v1/admin/audit-logs` [ADMIN]

## Admin — Provider instances & infrastructure operations (51)

Semua rute di bawah ini memakai `requireStaff("auto")`: GET pada `/providers` dan seluruh rute `/instances` masuk area infra (NOC/platform admin), sementara mutasi pada `/providers` platform admin saja. Inventaris infrastruktur (`inventory`) khusus provider vmware; `perf` bersifat netral provider (vmware + proxmox).

- `POST /v1/admin/instances/:instance_id/clone` [ADMIN] — NOC/platform admin; body `{name}`; meng-enqueue job clone (202), 501 untuk instance non-proxmox
- `POST /v1/admin/instances/:instance_id/template` [ADMIN] — NOC/platform admin; konversi sinkron VM → template PVE, 501 non-proxmox
- `POST /v1/admin/instances/:instance_id/move-volume` [ADMIN] — NOC/platform admin; body `{volume, target_storage}`; operasi sinkron
- `GET /v1/admin/providers/:provider_id/inventory` [ADMIN] — NOC/platform admin; inventaris infrastruktur vCenter utk provider kind=vmware (hosts: nama/cpu threads/memory bytes/power state, datastores: kapasitas/bebas bytes, clusters, resource pools); non-vmware → 501
- `GET /v1/admin/providers/:provider_id/perf` [ADMIN] — NOC/platform admin; query `?v=<ext_id>` wajib + `?timeframe=` ∈ `hour|day`; metrik tamu via GuestMetrics interface umum tanpa type assert (bekerja untuk vmware & proxmox sekaligus)
- `GET /v1/admin/providers/:provider_id/nodes/:node/detail` [ADMIN] — NOC/platform admin; status detail satu node PVE
- `GET /v1/admin/providers/:provider_id/nodes/:node/disks` [ADMIN] — NOC/platform admin; inventaris disk node
- `GET /v1/admin/providers/:provider_id/nodes/:node/certs` [ADMIN] — NOC/platform admin; sertifikat node
- `POST /v1/admin/providers/:provider_id/nodes/:node/command` [ADMIN] — platform admin saja; body `{command}` ∈ `reboot|shutdown|wakeonlan` (202)
- `POST /v1/admin/providers/:provider_id/nodes/:node/backup` [ADMIN] — platform admin saja; vzdump ad-hoc, body `{vmid, storage, mode?}` (202)
- `GET /v1/admin/providers/:provider_id/storages/:storage/content` [ADMIN] — NOC/platform admin; query `?node=` wajib
- `DELETE /v1/admin/providers/:provider_id/storages/:storage/content` [ADMIN] — platform admin saja; query `?node=&volume=` wajib (202)
- `GET /v1/admin/providers/:provider_id/storages/:storage/file-restore` [ADMIN] — NOC/platform admin; query `?node=&volume=&path=` wajib; telusur isi arsip backup (file-restore browser)
- `GET /v1/admin/providers/:provider_id/backup-jobs` [ADMIN] — NOC/platform admin
- `POST /v1/admin/providers/:provider_id/backup-jobs` [ADMIN] — platform admin saja; buat job backup terjadwal (201)
- `PUT /v1/admin/providers/:provider_id/backup-jobs/:job_id` [ADMIN] — platform admin saja
- `DELETE /v1/admin/providers/:provider_id/backup-jobs/:job_id` [ADMIN] — platform admin saja
- `POST /v1/admin/providers/:provider_id/backup-jobs/:job_id/run` [ADMIN] — platform admin saja; jalankan job backup terjadwal seketika (202)
- `GET /v1/admin/providers/:provider_id/ha-resources` [ADMIN] — NOC/platform admin; filter opsional `?type=`
- `POST /v1/admin/providers/:provider_id/ha-resources` [ADMIN] — platform admin saja; body `{sid, ...}` (201)
- `DELETE /v1/admin/providers/:provider_id/ha-resources` [ADMIN] — platform admin saja; query `?sid=` wajib, `?purge=true` opsional
- `POST /v1/admin/providers/:provider_id/ha/arm` [ADMIN] — platform admin saja; arm watchdog HA cluster (`{status:"armed"}`)
- `POST /v1/admin/providers/:provider_id/ha/disarm` [ADMIN] — platform admin saja; body `{mode}` ∈ `freeze|ignore`
- `GET /v1/admin/providers/:provider_id/cluster/log` [ADMIN] — NOC/platform admin; query `?max=N` (default 100)
- `GET /v1/admin/providers/:provider_id/cluster/tasks` [ADMIN] — NOC/platform admin
- `GET /v1/admin/providers/:provider_id/containers` [ADMIN] — NOC/platform admin; inventaris kontainer LXC seluruh cluster, filter opsional `?node=`
- `GET /v1/admin/providers/:provider_id/fw-groups` [ADMIN] — NOC/platform admin; security group firewall PVE
- `POST /v1/admin/providers/:provider_id/fw-groups` [ADMIN] — platform admin saja; body `{group, ...}` (201)
- `DELETE /v1/admin/providers/:provider_id/fw-groups` [ADMIN] — platform admin saja; query `?name=` wajib
- `GET /v1/admin/providers/:provider_id/fw-groups/:group/rules` [ADMIN] — NOC/platform admin
- `POST /v1/admin/providers/:provider_id/fw-groups/:group/rules` [ADMIN] — platform admin saja (201)
- `DELETE /v1/admin/providers/:provider_id/fw-groups/:group/rules/:pos` [ADMIN] — platform admin saja
- `GET /v1/admin/providers/:provider_id/firewall-rules` [ADMIN] — NOC/platform admin; rule firewall level cluster
- `POST /v1/admin/providers/:provider_id/firewall-rules` [ADMIN] — platform admin saja (201)
- `DELETE /v1/admin/providers/:provider_id/firewall-rules/:pos` [ADMIN] — platform admin saja
- `GET /v1/admin/providers/:provider_id/pools` [ADMIN] — NOC/platform admin
- `POST /v1/admin/providers/:provider_id/pools` [ADMIN] — platform admin saja; body `{poolid, comment?}` (201)
- `PUT /v1/admin/providers/:provider_id/pools/:pool_id` [ADMIN] — platform admin saja; body `{comment}`
- `DELETE /v1/admin/providers/:provider_id/pools/:pool_id` [ADMIN] — platform admin saja
- `PUT /v1/admin/providers/:provider_id/pools/:pool_id/members` [ADMIN] — platform admin saja; body `{vms, storages, comment?, delete?}` (daftar VMID/storage bergaya PVE)
- `GET /v1/admin/providers/:provider_id/ceph-status` [ADMIN] — NOC/platform admin
- `GET /v1/admin/providers/:provider_id/sdn/zones` [ADMIN] — NOC/platform admin
- `GET /v1/admin/providers/:provider_id/sdn/vnets` [ADMIN] — NOC/platform admin
- `GET /v1/admin/providers/:provider_id/cluster-storages` [ADMIN] — NOC/platform admin; inventaris storage level cluster
- `POST /v1/admin/providers/:provider_id/cluster-storages` [ADMIN] — platform admin saja; body JSON bebas dengan kunci `storage` + `type` wajib (201, task async)
- `PUT /v1/admin/providers/:provider_id/cluster-storages/:name` [ADMIN] — platform admin saja; body subset opsi apa pun (200, task)
- `DELETE /v1/admin/providers/:provider_id/cluster-storages/:name` [ADMIN] — platform admin saja (202, task)
- `GET /v1/admin/providers/:provider_id/nodes/:node/dns` [ADMIN] — NOC/platform admin
- `PUT /v1/admin/providers/:provider_id/nodes/:node/dns` [ADMIN] — platform admin saja; body `{search}` wajib + `{dns1?, dns2?, dns3?}` opsional
- `GET /v1/admin/providers/:provider_id/nodes/:node/time` [ADMIN] — NOC/platform admin; jam & zona waktu node
- `GET /v1/admin/providers/:provider_id/cpu-models` [ADMIN] — NOC/platform admin; model CPU QEMU tamu, query `?arch=` (default `x86_64`), `?node=` opsional

## Dokploy PaaS integration (4)

Provider kind `dokploy` dikonfigurasi via `POST /v1/admin/providers` — `api_base_url` berisi URL server Dokploy tanpa sufiks `/api`, `api_key` berisi Dokploy API key; keduanya disimpan terenkripsi AES-GCM. Seluruh 597 operasi API Dokploy v0.30.2 tersedia melalui SATU rute proxy universal berikut.

- `{METHOD} /v1/dokploy/{tag.method}` [JWT/API-Key] — proxy transparan ke server Dokploy; POST/PUT/PATCH meneruskan JSON body, GET/DELETE meneruskan query string, error upstream direlay apa adanya
- `POST /v1/admin/dokploy/sync` [ADMIN] — body `{"entity":"projects|servers|registries|sshkeys|certificates"}`; tarik daftar upstream & upsert mirror DB (by remote_id) + rekonsiliasi hapus baris yang tak ada lagi upstream; respons `{synced,failed,removed}`
- `GET /v1/admin/dokploy/db/:entity` [ADMIN] — baca mirror lokal (`?limit=&offset=`); entity: projects, environments, applications, composes, databases, domains, deployments, backups, servers, registries, sshkeys, certificates
- `DELETE /v1/admin/dokploy/db/:entity/:remote_id` [ADMIN] — hapus satu baris mirror lokal

Total: 318

Catatan infrastruktur (di luar inventory, tidak dihitung): `GET /healthz`, `GET /readyz`, dan `GET /metrics` terdaftar langsung pada app root di server.go — dokumen ini belum memiliki section infrastruktur.
