# MASTER PROMPT — KILAT CLOUD BACKEND

Anda adalah **Senior Backend Engineer, Database Architect, Cloud Platform Engineer, Security Engineer, dan DevOps Engineer**.

Tugas Anda adalah membangun backend **Kilat Cloud**, sebuah platform cloud/VPS yang dapat:

- Menjual VPS paket tetap.
- Menjual VPS custom berdasarkan CPU, RAM, storage, bandwidth, IPv4, IPv6, backup, snapshot, dan resource lain.
- Menjadi reseller/provider abstraction untuk **Onidel Cloud API**.
- Nantinya mendukung provider lain seperti Proxmox, VMware, XCP-ng, bare metal, atau cloud provider lain tanpa mengubah model bisnis inti.
- Memiliki sistem user, autentikasi, organization/team, billing, invoice, wallet, API key, audit log, support, notification, object storage, dan security yang lengkap.
- Menggunakan **Go** sebagai backend utama.
- Menggunakan **PostgreSQL** sebagai source of truth.
- Menggunakan **Redis** untuk cache, session, rate limit, lock, OTP, dan queue/ephemeral workload.
- Menggunakan **S3-compatible storage / Cloudflare R2** untuk object/file.
- Menggunakan **Argon2id** untuk password.
- Aman untuk penggunaan production.

---

# 1. FILE YANG WAJIB DIBACA TERLEBIH DAHULU

Sebelum menulis kode apa pun, baca sampai selesai:

1. `openapi(2).yaml`
   - Ini adalah OpenAPI Onidel Cloud.
   - Jangan mengarang endpoint Onidel.
   - Jangan mengarang request field atau response field yang tidak ada.
   - Jika suatu kemampuan tidak tersedia di OpenAPI, tandai sebagai fitur internal Kilat Cloud atau provider lain.

2. `kilat_cloud_schema_v2.sql`
   - Ini adalah database schema yang sudah dibuat.
   - Jangan membuat tabel baru sebelum mengecek apakah fungsi yang sama sudah ada.
   - Jangan membuat kolom duplikat dengan arti sama.
   - Jangan membuat dua source of truth.

Sebelum implementasi, lakukan:

```text
DATABASE AUDIT
↓
OPENAPI AUDIT
↓
DUPLICATION AUDIT
↓
MISSING FEATURE AUDIT
↓
MIGRATION PLAN
↓
IMPLEMENTATION
```

Jangan langsung coding.

---

# 2. PRINSIP UTAMA DATABASE

PostgreSQL adalah **source of truth utama**.

Redis bukan database utama.

R2/S3 bukan database relasional.

Pembagian harus:

```text
PostgreSQL
├── users
├── profile
├── addresses
├── organizations
├── RBAC
├── products
├── plans
├── prices
├── instances
├── networks
├── billing
├── invoices
├── payments
├── subscriptions
├── audit
├── provider mapping
└── metadata file

Redis
├── sessions
├── refresh state
├── OTP
├── cache
├── rate limits
├── locks
├── temporary tokens
└── ephemeral queue state

S3 / R2
├── avatars
├── invoice PDF
├── KYC documents
├── support attachments
├── exports
├── ISO if applicable
├── generated reports
└── other binary objects
```

Tidak boleh menyimpan file besar sebagai `BYTEA` PostgreSQL kecuali benar-benar diperlukan.

---

# 3. DATABASE HARUS BEBAS DUPLIKASI

Sebelum membuat tabel/kolom:

1. Cari apakah tabel serupa sudah ada.
2. Cari apakah field serupa sudah ada.
3. Tentukan satu source of truth.
4. Gunakan foreign key.
5. Jangan copy data yang bisa direlasikan.
6. JSONB hanya untuk metadata/provider payload yang benar-benar dinamis.
7. Jangan menjadikan JSONB tempat membuang struktur data yang sebenarnya relasional.

Contoh yang DILARANG:

```text
users.email
user_profiles.email
customers.email
billing_profiles.email
```

untuk email login yang sama.

Email utama user harus hanya mempunyai **satu source of truth**.

Contoh yang benar:

```text
users.email
```

Jika invoice membutuhkan snapshot email saat invoice dibuat:

```text
invoice_billing_snapshots.email
```

Snapshot tersebut memang historical data dan tidak dianggap duplikasi source of truth.

---

# 4. USER ACCOUNT MODEL

Tabel `users` menjadi sumber identitas autentikasi utama.

Minimal harus menangani:

```text
id
public_id
email
phone_e164
username

password_hash
password_algorithm
password_changed_at
password_version
force_password_change

email_status
email_verified_at

phone_status
phone_verified_at

account status

locale
timezone

signup_ip
signup_user_agent

last_login_at
last_login_ip
last_login_user_agent

last_seen_at

failed_login_count
locked_until

terms_accepted_at
privacy_accepted_at
marketing_consent_at

created_at
updated_at
deleted_at
```

Tambahkan field hanya jika benar-benar dibutuhkan.

---

# 5. EMAIL HARUS UNIQUE

Email harus:

- Dinormalisasi.
- Trim whitespace.
- Case-insensitive.
- Divalidasi syntax.
- Tidak boleh digunakan dua user.
- Dicek di database, bukan hanya aplikasi.

Gunakan `citext` atau normalisasi yang setara.

Harus ada UNIQUE constraint/index.

Contoh:

```text
User A:
user@gmail.com

User B:
USER@GMAIL.COM
```

Harus dianggap **email yang sama**.

Jangan bergantung pada pengecekan:

```go
SELECT ...
if not found {
    INSERT ...
}
```

saja karena race condition tetap mungkin terjadi.

Database constraint tetap wajib.

---

# 6. NOMOR HP HARUS UNIQUE

Gunakan format E.164.

Contoh:

```text
+6285712345678
```

Jangan simpan variasi:

```text
085712345678
6285712345678
+62 857 1234 5678
```

sebagai nomor berbeda.

Normalisasikan menjadi:

```text
+6285712345678
```

Nomor HP tidak boleh digunakan oleh dua akun.

Harus ada database-level UNIQUE constraint.

Jangan hanya cek dari Go.

Nomor yang sudah terasosiasi dengan akun tidak boleh diberikan ke user lain tanpa proses administrasi/policy yang eksplisit.

---

# 7. REGISTRASI USER

Flow:

```text
POST /auth/register
        ↓
normalize email
        ↓
normalize phone
        ↓
validate
        ↓
check obvious conflicts
        ↓
Argon2id password hash
        ↓
DB transaction
        ↓
INSERT user
        ↓
database UNIQUE constraint final protection
        ↓
create profile
        ↓
create personal organization/account jika digunakan
        ↓
send email OTP/link
        ↓
send phone OTP jika diwajibkan
        ↓
audit event
```

Status awal:

```text
pending
```

User baru tidak langsung dianggap verified.

---

# 8. ARGON2ID

Password wajib menggunakan **Argon2id**.

Gunakan salt random cryptographically secure per password.

Simpan hasil dalam format PHC lengkap:

```text
$argon2id$v=19$m=...,t=...,p=...$salt$hash
```

Jangan membuat:

```text
password
password_plaintext
password_encrypted
```

Tidak boleh menyimpan password asli.

Jangan menggunakan:

```text
MD5
SHA1
SHA256(password)
bcrypt jika Argon2id sudah dipilih
```

Gunakan Argon2id secara konsisten.

Parameter harus configurable.

Sediakan benchmark agar parameter dapat ditingkatkan kemudian.

---

# 9. PASSWORD CHANGE

Flow:

```text
authenticated user
↓
verify current password
↓
validate new password
↓
pastikan bukan password sama
↓
optional check password history
↓
generate Argon2id baru
↓
password_changed_at = NOW()
↓
password_version++
↓
revoke refresh/session lain sesuai policy
↓
audit log
↓
security notification
```

Simpan `password_history` jika schema sudah mendukung.

Jangan pernah menyimpan password lama dalam plaintext.

---

# 10. FORGOT PASSWORD

Flow:

```text
POST forgot-password
↓
generic response
↓
create random reset token
↓
store only hash token
↓
TTL
↓
email
↓
user opens reset
↓
verify token hash + expiry + unused
↓
set new Argon2id password
↓
password_version++
↓
invalidate token
↓
revoke sessions
↓
audit
```

Response tidak boleh membocorkan apakah email terdaftar.

---

# 11. EMAIL VERIFICATION

Sediakan:

```text
email verification
resend verification
verification rate limit
verification expiry
attempt limit
audit event
```

OTP/token yang disimpan di DB/Redis tidak boleh plaintext jika tidak perlu.

---

# 12. PHONE VERIFICATION

Flow:

```text
phone added
↓
normalize E.164
↓
ensure globally unique
↓
generate OTP
↓
store OTP hash / protected state
↓
send OTP
↓
verify
↓
phone_status = verified
↓
phone_verified_at = NOW()
```

OTP wajib:

- expiry
- attempts limit
- resend cooldown
- IP rate limit
- user rate limit

---

# 13. GANTI EMAIL

Jangan langsung mengubah `users.email`.

Gunakan `contact_change_requests`.

Flow:

```text
current authenticated user
↓
request new email
↓
normalize
↓
ensure new email not used
↓
reserve pending email
↓
send verification to new email
↓
optionally notify old email
↓
verify token
↓
transaction
↓
recheck UNIQUE
↓
update users.email
↓
email_verified_at
↓
invalidate request
↓
security audit
↓
notification
```

Harus aman dari race condition.

---

# 14. GANTI NOMOR HP

Gunakan flow serupa.

```text
request new phone
↓
normalize E.164
↓
check not owned/reserved
↓
OTP new number
↓
verify
↓
transaction
↓
recheck uniqueness
↓
update user
↓
phone_verified_at
↓
audit
```

Dua user tidak boleh mempunyai pending change ke nomor yang sama.

Buat unique reservation yang aman.

---

# 15. USER PROFILE

Pisahkan authentication identity dari profile.

`user_profiles` hanya menyimpan profile.

Contoh:

```text
user_id
full_name
display_name
company_name
date_of_birth jika dibutuhkan
country_code
tax_id jika memang personal
avatar_object_id
preferences
metadata seperlunya
created_at
updated_at
```

Jangan menyimpan ulang:

```text
email
phone
password
```

ke profile.

---

# 16. ADDRESS HARUS DINORMALISASI

Current schema harus diaudit.

Jika address masih langsung tertanam di `user_profiles`, lakukan migration menuju tabel:

```text
user_addresses
```

agar satu user dapat mempunyai:

```text
home
billing
legal
company
other
```

Struktur minimal:

```text
id
user_id
type
label

recipient_name
company_name

country_code
province
city_or_regency
district
subdistrict

postal_code

address_line1
address_line2

rt
rw

contact_phone_e164 optional

is_default
verified_at

created_at
updated_at
deleted_at
```

Untuk Indonesia struktur dapat merepresentasikan:

```text
Negara
Provinsi
Kabupaten/Kota
Kecamatan
Kelurahan/Desa
RT
RW
Kode Pos
Alamat lengkap/baris 1
Alamat tambahan/baris 2
```

Jangan menyimpan field alamat yang sama sekaligus di:

```text
user_profiles
user_addresses
```

Setelah migration, pilih `user_addresses` sebagai source of truth alamat.

Field alamat lama harus:

1. dimigrasikan,
2. dihentikan penggunaannya,
3. kemudian dihapus lewat migration aman bila sudah tidak diperlukan.

Bukan dibiarkan menjadi dua sumber data selamanya.

---

# 17. AVATAR DAN FILE PROFILE

Avatar jangan disimpan sebagai binary di users.

Flow:

```text
user requests upload
↓
backend validates MIME/size
↓
generate object key
↓
presigned upload atau backend upload
↓
S3/R2
↓
stored_objects
↓
user_profiles.avatar_object_id
```

Contoh object key:

```text
users/{user_uuid}/avatar/{uuid}.webp
```

Database menyimpan metadata.

Object berada di R2/S3.

---

# 18. OBJECT STORAGE INTERNAL

Gunakan:

```text
object_storage_backends
stored_objects
```

Driver minimal:

```text
s3
r2
minio
```

Metadata:

```text
backend
object_key
owner
purpose
visibility
filename
mime_type
size
etag
sha256
encryption
created_at
deleted_at
```

Credential R2/S3 **tidak boleh plaintext di database**.

Gunakan secret manager atau authenticated encryption.

---

# 19. API KEY USER

User dapat membuat API key sendiri.

Contoh endpoint:

```text
POST   /api/v1/api-keys
GET    /api/v1/api-keys
GET    /api/v1/api-keys/{id}
PATCH  /api/v1/api-keys/{id}
DELETE /api/v1/api-keys/{id}
POST   /api/v1/api-keys/{id}/rotate
```

API key harus mempunyai:

```text
id
public_id
owner
name
prefix
secret_hash
scopes
allowed_ips
status
expires_at
last_used_at
last_used_ip
created_at
revoked_at
```

Secret hanya diperlihatkan **sekali pada saat create/rotate**.

Database tidak boleh menyimpan raw API key.

Contoh scopes:

```text
profile.read

instances.read
instances.create
instances.update
instances.delete

snapshots.read
snapshots.create
snapshots.delete

backups.read
backups.restore

networks.read
networks.write

firewalls.read
firewalls.write

ssh_keys.read
ssh_keys.write

storage.read
storage.write

billing.read

api_keys.read
api_keys.write
```

Lakukan scope authorization di setiap endpoint.

---

# 20. SESSION DAN TOKEN

Access token harus short-lived.

Refresh/session state harus dapat direvoke.

Session mempunyai informasi:

```text
session_id
user_id
device
ip
user_agent
created_at
last_seen_at
expires_at
revoked_at
password_version
```

Redis dapat digunakan untuk hot session state.

PostgreSQL dapat menyimpan durable session/security metadata jika diperlukan.

Logout:

```text
revoke current session
```

Logout all:

```text
revoke all sessions
```

Password change:

```text
invalidate session berdasarkan password_version/policy
```

---

# 21. MFA

Dukung:

```text
TOTP
WebAuthn / Passkey
Recovery Codes
```

TOTP secret harus dienkripsi.

Recovery code simpan hash.

Sediakan:

```text
enable
verify
disable
regenerate recovery codes
list passkeys
remove passkey
```

Semua security event masuk audit log.

---

# 22. ORGANIZATION / TEAM

Satu user dapat mempunyai organization.

Model:

```text
organizations
organization_members
organization_invitations
roles
permissions
```

Role contoh:

```text
owner
admin
billing
developer
viewer
support
```

Jangan hardcode seluruh authorization hanya dengan:

```go
if user.Role == "admin"
```

Bangun RBAC yang jelas.

Resource cloud dimiliki organization, bukan sekadar user, agar bisa mendukung multi-user/team.

---

# 23. PROVIDER ABSTRACTION

Kilat Cloud tidak boleh bergantung langsung pada Onidel di business layer.

Gunakan:

```text
providers
provider_accounts
regions
instance_types
os_templates
```

Interface Go:

```go
type ComputeProvider interface {
    CreateInstance(...)
    GetInstance(...)
    ListInstances(...)
    UpdateInstance(...)
    DeleteInstance(...)
    StopInstance(...)
    RebootInstance(...)
    CreateSnapshot(...)
    RestoreSnapshot(...)
}
```

Buat adapter:

```text
internal/provider/onidel
```

Nanti dapat ditambahkan:

```text
internal/provider/proxmox
internal/provider/vmware
internal/provider/xcpng
```

Business logic tidak boleh mengetahui detail HTTP Onidel.

---

# 24. INTERNAL ID VS PROVIDER ID

Semua resource Kilat Cloud harus mempunyai internal UUID/public ID sendiri.

Contoh:

```text
instances.id
instances.public_id
```

Onidel ID disimpan:

```text
instances.external_vm_id
```

Jangan expose provider ID sebagai primary identity API publik Kilat Cloud.

Contoh:

```text
vm_abcd1234
```

adalah ID customer-facing.

Provider dapat mempunyai:

```text
dd9df8... Onidel UUID
105 Proxmox VMID
```

tanpa mengubah public API.

---

# 25. ONIDEL API

Baca seluruh `openapi(2).yaml`.

Implementasikan adapter untuk seluruh kemampuan yang tersedia.

Minimal petakan:

```text
Teams

SSH Keys

Virtual Machines

OS Templates

Instance Types

Instance Price

VPC

Firewall Groups

Firewall Rules

IP Lists

IP List Entries

Reserved IP

Startup Scripts

Snapshots

Backups

Custom ISO

Measured Boot Image

Object Storage

Buckets

Bucket Access Keys

BGP

VNC/noVNC

Reverse DNS
```

Jika OpenAPI menyediakan operasi tambahan, implementasikan juga.

Jangan mengurangi fitur hanya karena tidak ada pada daftar ini.

---

# 26. ONIDEL TEAM MAPPING

Kilat Cloud organization harus dapat dipetakan ke Onidel team.

Jangan menganggap:

```text
Kilat organization ID == Onidel team_id
```

Gunakan mapping provider.

Contoh:

```text
provider_teams
organization_id
provider_account_id
external_team_id
```

---

# 27. INSTANCE CATALOG

User dapat membeli melalui dua mode:

```text
FIXED PLAN
CUSTOM
```

## Fixed Plan

Contoh:

```text
Starter
2 vCPU
4 GB RAM
40 GB NVMe
2 TB bandwidth
1 IPv4
IPv6
Rp190.000 / bulan
```

Tables:

```text
products
plans
plan_regions
plan_prices
```

Plan dapat mempunyai harga berbeda berdasarkan:

```text
region
currency
billing period
provider
promotion
```

---

# 28. CUSTOM VPS BUILDER

User dapat memilih resource sendiri.

Resource dimensions minimal:

```text
vcpu
ram_mb
nvme_gb
hdd_gb
bandwidth_gb
ipv4
ipv6
backup_gb / backup slots
snapshot_gb / snapshot slots
network_rate_mbps
```

Jangan hardcode pricing di handler.

Gunakan:

```text
resource_dimensions
custom_resource_rates
```

Rate dapat berbeda berdasarkan:

```text
product
provider
region
instance type
currency
billing period
active date
```

Setiap resource rate memiliki:

```text
unit_price
provider_unit_cost
included_quantity
min_quantity
max_quantity
step_quantity
```

---

# 29. CUSTOM PRICING FORMULA

Contoh:

```text
CPU:
4 × Rp35.000

RAM:
8 GB × Rp12.000

NVMe:
100 GB × Rp800

IPv4:
1 × Rp20.000

Bandwidth:
4 TB × harga/unit

Subtotal
Discount
Tax
Setup Fee
Total
```

Semua breakdown harus disimpan pada `price_quotes`.

Jangan menghitung ulang historical order menggunakan harga terbaru.

Order harus mempunyai **price snapshot**.

---

# 30. PROVIDER COST DAN PROFIT

Simpan terpisah:

```text
customer_price
provider_cost
margin
```

Jangan menganggap harga Onidel = harga customer.

Pricing engine Kilat Cloud yang menentukan harga jual.

Provider price hanya cost/reference.

Untuk custom Onidel gunakan `/instance_price` sesuai OpenAPI bila diperlukan.

Simpan provider response yang relevan sebagai snapshot/debug metadata dengan hati-hati.

---

# 31. PRICE QUOTE

Sebelum order:

```text
POST /pricing/quote
```

Input:

```text
region
plan/custom
vcpu
ram
disk
hdd
bandwidth
IP
backup
billing period
currency
```

Backend:

```text
validate resource limits
↓
load active rates
↓
optionally request provider price
↓
calculate cost
↓
calculate sale price
↓
discount
↓
tax
↓
total
↓
store quote
↓
set expires_at
```

Frontend tidak boleh menentukan total final sendiri.

---

# 32. ORDER FLOW

```text
authenticated user
↓
verified requirements
↓
choose organization
↓
choose region/provider
↓
plan/custom configuration
↓
price quote
↓
create order
↓
order_items snapshot
↓
create invoice
↓
payment
↓
payment webhook
↓
invoice PAID
↓
subscription ACTIVE/PENDING_PROVISION
↓
enqueue provisioning
↓
worker
↓
Onidel
↓
instance ACTIVE
```

Gunakan DB transaction pada boundary penting.

---

# 33. PAYMENT WEBHOOK

Jangan provision VM langsung di HTTP payment callback.

Flow:

```text
payment provider webhook
↓
verify signature
↓
idempotency
↓
store raw event safely
↓
transaction
↓
update payment
↓
update invoice
↓
enqueue job/outbox
↓
return 2xx
```

Worker melakukan provisioning.

Webhook yang sama dikirim 10 kali tidak boleh membuat 10 VPS.

---

# 34. IDEMPOTENCY

Wajib digunakan untuk:

```text
create order
create payment
provision VM
terminate VM
create snapshot
restore
provider mutations
webhooks
wallet transactions
```

Gunakan idempotency key.

Database constraint tetap menjadi final protection.

---

# 35. VM PROVISIONING

Flow:

```text
order paid
↓
provision job
↓
distributed lock
↓
load immutable order configuration
↓
resolve provider
↓
resolve provider team
↓
resolve region
↓
resolve instance type
↓
resolve OS
↓
resolve SSH key
↓
resolve VPC
↓
resolve firewall
↓
startup script if selected
↓
call Onidel create VM
↓
store external_vm_id
↓
status provisioning
↓
poll/sync
↓
IP assigned
↓
ACTIVE
↓
notification
↓
audit
```

Jangan menganggap provider call berhasil hanya karena koneksi timeout.

Sebelum retry create, lakukan reconciliation/idempotency protection untuk mencegah double provision.

---

# 36. INSTANCE ACTION

Customer minimal dapat:

```text
view
rename/update supported settings
stop
reboot
terminate
open console
snapshot
restore snapshot
restore backup
manage networking
manage firewall
manage rDNS
manage BGP jika diizinkan
manage measured boot jika tersedia
```

Setiap mutating action:

```text
authorization
↓
resource ownership
↓
resource state validation
↓
idempotency
↓
provider action log
↓
provider call/job
↓
sync
↓
audit
```

---

# 37. PROVIDER ACTION LOG

Setiap provider mutation dicatat.

Minimal:

```text
provider
resource_type
resource_id
external_resource_id
operation
request correlation id
status
attempt_count
started_at
completed_at
error_code
error_message sanitized
response metadata
```

Jangan simpan provider secret/token di log.

---

# 38. RECONCILIATION

Buat worker berkala.

```text
Kilat Cloud DB
↕
provider reconciliation
↕
Onidel API
```

Periksa:

```text
VM
IP
VPC
firewall
snapshots
backups
object storage
reserved IP
provider status
```

Jika resource provider ada tetapi tidak ada internal mapping:

```text
orphan_provider_resources
```

Jangan otomatis destroy orphan.

Masuk review/reconciliation dahulu.

---

# 39. RESERVED IP

Support penuh sesuai Onidel:

```text
list
create
get
delete
convert primary VM IP
attach
detach
```

Simpan mapping internal/external.

Jangan detach primary IP jika provider melarang.

Tangani provider-specific error code.

---

# 40. REVERSE DNS

Sediakan:

```text
GET    /instances/{id}/rdns
POST   /instances/{id}/rdns
DELETE /instances/{id}/rdns/{ip}
```

Pastikan IP memang milik VM/user organization.

Provider mungkin mensyaratkan hostname/domain sudah resolve ke IP terlebih dahulu.

Return validation error yang jelas.

---

# 41. SSH KEYS

User/org dapat mengelola SSH key.

Simpan:

```text
name
public_key
fingerprint
created_by
provider mappings
created_at
```

Jangan pernah menerima private key untuk disimpan kecuali ada use case terpisah yang benar-benar aman.

Cegah key duplikat melalui fingerprint.

---

# 42. STARTUP SCRIPT

Support startup script.

Validasi limit provider.

Jika Onidel membatasi maksimum script per team, backend harus menghormati limit tersebut.

Script harus dimiliki organization.

Tambahkan size limit.

Audit perubahan script.

---

# 43. VPC

Support:

```text
list
create
get
update
delete
attach VM
detach VM jika provider/API mendukung melalui resource relation
```

Gunakan internal resource IDs + provider mappings.

---

# 44. FIREWALL

Support:

```text
firewall_groups
firewall_rules
ip_lists
ip_list_entries
```

Validasi:

```text
protocol
direction
ports
CIDR
IP version
duplicates
priority/order jika berlaku
```

Jangan membuat rule yang sama berkali-kali karena request retry.

---

# 45. SNAPSHOT DAN BACKUP

Pisahkan:

```text
snapshots
backups
```

Jangan digabung menjadi satu generic backup table jika lifecycle berbeda.

Support:

```text
list
create snapshot
delete snapshot
restore snapshot
list backup
restore backup
download link jika provider mendukung
```

Download link harus short-lived.

Jangan simpan permanent provider signed URL.

---

# 46. OBJECT STORAGE ONIDEL

Jangan campurkan:

```text
Kilat Cloud internal R2
```

dengan:

```text
customer Onidel Object Storage
```

Keduanya berbeda.

Internal R2 untuk aplikasi Kilat Cloud.

Provider object storage adalah produk customer.

Sediakan resource:

```text
object_storage_services
storage_buckets
storage_access_keys
```

Secret access key harus diperlakukan sebagai credential sensitif.

Jika secret hanya diberikan sekali, jangan expose lagi.

Encrypt secret yang memang harus direcover.

---

# 47. BILLING

Implementasikan:

```text
wallets
wallet_transactions

orders
order_items

invoices
invoice_items

payments
payment_events

subscriptions
subscription_usage_charges

coupons
coupon_redemptions
```

Gunakan currency dengan benar.

Jangan gunakan float untuk uang.

Gunakan:

```text
NUMERIC
```

di PostgreSQL dan decimal representation yang aman pada Go.

---

# 48. WALLET

Wallet menggunakan ledger.

Jangan hanya:

```text
UPDATE wallets SET balance = balance + ...
```

tanpa transaction record.

Setiap perubahan saldo:

```text
wallet_transactions
```

harus immutable/semi-immutable.

Jenis:

```text
topup
payment
refund
credit
debit
adjustment
promotion
```

Gunakan idempotency key.

---

# 49. INVOICE

Invoice harus menyimpan snapshot billing data.

Contoh:

```text
invoice number
customer name
email snapshot
company
billing address snapshot
tax information snapshot
line items
subtotal
discount
tax
total
currency
status
issued_at
due_at
paid_at
```

Perubahan profile setelah invoice terbit **tidak boleh mengubah invoice lama**.

PDF invoice disimpan di R2/S3.

Database menyimpan `stored_object_id`.

---

# 50. SUBSCRIPTION

Support lifecycle:

```text
pending
active
past_due
suspended
cancelled
expired
```

Simpan:

```text
current_period_start
current_period_end
next_invoice_at
grace_until
cancel_at_period_end
cancelled_at
```

Resource tidak langsung dihapus saat satu payment terlambat.

Gunakan grace period + suspension policy.

---

# 51. ADMIN

Pisahkan customer API dan admin authorization.

Admin dapat mengelola:

```text
users
organizations
verification
plans
custom prices
regions
providers
provider accounts
orders
invoices
payments
wallet adjustments
instances
suspension
abuse/security
support
coupons
feature flags
provider sync
jobs
audit logs
```

Semua tindakan admin sensitif masuk audit log.

---

# 52. SUPPORT TICKET

Support:

```text
tickets
messages
attachments
status
priority
category
assigned agent
```

Attachment menggunakan R2/S3.

Jangan menyimpan file langsung di ticket row.

---

# 53. NOTIFICATION

Support channel:

```text
email
SMS/WhatsApp jika nanti tersedia
in-app
webhook
```

Simpan preference.

Contoh notification:

```text
login baru
password berubah
email berubah
phone berubah
API key dibuat
API key direvoke
VM provisioned
VM suspended
invoice issued
invoice due
payment received
backup failed
security alert
```

---

# 54. WEBHOOK CUSTOMER

User/org dapat membuat webhook endpoint.

Simpan:

```text
URL
events
secret encrypted/hash strategy
status
created_at
last_success_at
failure_count
```

Delivery:

```text
delivery id
event id
attempt
HTTP status
response time
next_retry_at
status
```

Sign webhook menggunakan HMAC.

---

# 55. REDIS KEY DESIGN

Gunakan namespace konsisten.

Contoh:

```text
kc:session:{id}

kc:otp:email:{user_id}
kc:otp:phone:{user_id}

kc:ratelimit:login:ip:{ip}
kc:ratelimit:login:user:{user_id}
kc:ratelimit:register:{ip}
kc:ratelimit:apikey:{key_id}

kc:cache:plans
kc:cache:regions
kc:cache:instance-types
kc:cache:os-templates
kc:cache:instance:{id}

kc:lock:order:{id}
kc:lock:payment:{id}
kc:lock:instance:{id}
kc:lock:provision:{id}

kc:provider:onidel:ratelimit

kc:job:...
```

Setiap key harus mempunyai TTL bila sesuai.

Jangan meninggalkan cache selamanya tanpa invalidation strategy.

---

# 56. JOB SYSTEM

Job penting harus durable.

Jika Redis digunakan sebagai queue, pekerjaan kritikal tetap harus dapat dipulihkan.

Pertimbangkan pola:

```text
PostgreSQL jobs/outbox
↓
dispatcher
↓
Redis worker queue
↓
worker
↓
ack/update PostgreSQL
```

Job:

```text
provision_instance
sync_instance
terminate_instance
suspend_instance
unsuspend_instance

create_snapshot
restore_snapshot
restore_backup

provider_sync

send_email
send_notification

generate_invoice
generate_invoice_pdf

process_payment

deliver_webhook
```

Support:

```text
attempt_count
max_attempts
run_at
locked_at
locked_by
last_error
completed_at
dead_letter state
```

---

# 57. TRANSACTIONAL OUTBOX

Untuk event penting:

```text
payment paid
invoice paid
VM provision requested
password changed
user verified
```

gunakan transactional outbox.

Contoh:

```text
BEGIN

UPDATE invoice
INSERT payment event
INSERT outbox_event

COMMIT
```

Worker baru mengirim pekerjaan/event setelah commit.

Mencegah:

```text
DB berhasil
queue gagal
```

atau sebaliknya.

---

# 58. AUDIT LOG

Audit minimal menyimpan:

```text
actor_type
actor_user_id
organization_id
action
resource_type
resource_id
IP
user_agent
request_id
before safe metadata
after safe metadata
created_at
```

Jangan log:

```text
password
OTP
access token
refresh token
API secret
provider token
card data
TOTP secret
R2 secret
```

---

# 59. SECURITY

Implementasikan:

```text
Argon2id
MFA
session revoke
API key scopes
RBAC
rate limiting
CSRF jika cookie auth
CORS allowlist
security headers
request size limits
SQL parameterization
input validation
SSRF protection
signed upload
secret encryption
audit trail
idempotency
webhook signature verification
brute-force protection
account lock policy
```

Provider API endpoint/config jangan dapat diubah sembarang customer.

---

# 60. SSRF PROTECTION

Penting untuk custom ISO/download URL/webhook.

Block tujuan seperti:

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
link-local
metadata endpoints
internal service domains
```

kecuali explicit trusted internal use case.

Lakukan DNS resolution validation dan redirect validation.

---

# 61. REQUEST ID

Setiap API request mempunyai:

```text
X-Request-ID
```

Jika client tidak memberikan, generate.

Request ID masuk:

```text
logs
audit
provider_actions
errors
job correlation
```

Supaya satu provisioning dapat ditelusuri end-to-end.

---

# 62. STANDARD API RESPONSE

Gunakan format konsisten.

Success:

```json
{
  "data": {},
  "meta": {},
  "request_id": "req_..."
}
```

Error:

```json
{
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "Email already registered",
    "fields": {}
  },
  "request_id": "req_..."
}
```

Jangan mengirim raw database error/provider internal error ke user.

---

# 63. ERROR CODE

Gunakan stable application error code.

Contoh:

```text
VALIDATION_ERROR

EMAIL_ALREADY_EXISTS
PHONE_ALREADY_EXISTS
USERNAME_ALREADY_EXISTS

EMAIL_NOT_VERIFIED
PHONE_NOT_VERIFIED

INVALID_CREDENTIALS
ACCOUNT_LOCKED

FORBIDDEN
RESOURCE_NOT_FOUND

INSUFFICIENT_BALANCE
INVOICE_ALREADY_PAID

QUOTE_EXPIRED
PLAN_UNAVAILABLE
REGION_UNAVAILABLE
RESOURCE_LIMIT_EXCEEDED

PROVIDER_UNAVAILABLE
PROVIDER_RATE_LIMITED
PROVISION_FAILED

INSTANCE_INVALID_STATE

IDEMPOTENCY_CONFLICT
```

Map provider error ke internal error tanpa membocorkan detail sensitif.

---

# 64. GO PROJECT STRUCTURE

Gunakan modular architecture.

Contoh:

```text
cmd/
  api/
  worker/
  migrate/

internal/
  auth/
  user/
  iam/
  organization/

  catalog/
  pricing/

  compute/
  network/
  storage/

  billing/
  wallet/
  payment/
  subscription/

  provider/
    onidel/

  support/
  notification/
  webhook/
  audit/

  platform/
    postgres/
    redis/
    objectstorage/
    crypto/
    queue/
    mail/
    logger/
    config/
```

Jangan membuat satu:

```text
handlers/
services/
models/
```

yang berisi seluruh aplikasi tanpa domain separation.

---

# 65. GO LIBRARY

Prioritaskan library production-grade.

Contoh:

```text
Go
Fiber v3

pgx/v5
sqlc jika sesuai
PostgreSQL

Redis client production-grade

golang.org/x/crypto/argon2

S3-compatible SDK

structured logger

OpenTelemetry
Prometheus metrics
```

Jangan menambahkan dependency tanpa alasan.

---

# 66. CONFIGURATION

Semua konfigurasi dari environment/config system.

Contoh:

```text
APP_ENV
APP_PORT

DATABASE_URL

REDIS_URL

JWT_PRIVATE_KEY / signing config

ACCESS_TOKEN_TTL
REFRESH_TOKEN_TTL

ARGON2_MEMORY
ARGON2_ITERATIONS
ARGON2_PARALLELISM

ONIDEL_BASE_URL
ONIDEL_API_KEY

R2_ENDPOINT
R2_ACCESS_KEY
R2_SECRET_KEY
R2_BUCKET

SMTP...
PAYMENT...
```

Startup harus fail-fast jika secret wajib tidak tersedia.

---

# 67. SECRET MANAGEMENT

Provider credential, R2 secret, webhook secret, TOTP secret tidak boleh plaintext.

Gunakan salah satu:

```text
Vault
cloud secret manager
KMS
encrypted database secret menggunakan KEK/DEK
```

Jangan commit `.env` production.

Sediakan `.env.example` tanpa secret.

---

# 68. DATABASE MIGRATION

Jangan mengedit production schema manual.

Gunakan versioned migration:

```text
000001_initial
000002_user_addresses
000003_contact_uniqueness
...
```

Migration harus:

```text
deterministic
reviewable
transactional jika memungkinkan
backward-aware
```

Setelah semua migration, database kosong harus dapat dibangun dari nol tanpa error.

---

# 69. DATABASE INTEGRITY AUDIT WAJIB

Buat test/script yang memeriksa:

- Semua FK mengarah ke tabel valid.
- Tidak ada duplicate table.
- Tidak ada duplicate enum.
- Tidak ada duplicate index name.
- Tidak ada orphan relation.
- Tidak ada circular dependency yang merusak migration.
- Semua FK penting mempunyai index jika diperlukan.
- Semua timestamps konsisten.
- Semua soft-delete uniqueness dipikirkan.
- Semua monetary values bukan float.
- Semua provider external ID memiliki mapping yang tepat.
- Semua user unique identity terlindungi database constraint.

---

# 70. UNIQUE IDENTITY POLICY

Harus diputuskan dengan jelas dan konsisten.

Target:

```text
email tidak boleh dipakai dua akun
phone tidak boleh dipakai dua akun
username tidak boleh dipakai dua akun
```

Jangan mengandalkan soft-delete partial unique tanpa memikirkan account takeover/re-registration.

Jika bisnis mengharuskan email/phone tetap tidak dapat digunakan setelah account deletion, buat tombstone/reservation mechanism yang aman.

Contoh:

```text
identity_tombstones
type
normalized_hash/value sesuai security policy
released_at nullable
reason
created_at
```

Jika reuse diperbolehkan setelah retention period, implementasikan eksplisit.

Jangan membiarkan perilaku ini terjadi secara kebetulan karena partial index.

---

# 71. PROFILE COMPLETENESS

Backend harus dapat menghitung profile completion.

Contoh:

```text
email verified
phone verified
full name
billing address
country
avatar optional
company optional
tax information optional
```

Expose:

```text
profile_completion_percent
missing_requirements[]
```

Jangan menyimpan percentage sebagai source of truth jika dapat dihitung.

---

# 72. CUSTOMER DASHBOARD DATA

Sediakan endpoint agregasi efisien untuk dashboard:

```text
active instances
pending instances
monthly spend
outstanding invoices
wallet balance
bandwidth/usage
recent activity
notifications
tickets
```

Jangan frontend menembak 30 endpoint hanya untuk membuka satu dashboard kalau backend dapat menyediakan dashboard summary.

---

# 73. SEARCH/FILTER/PAGINATION

Semua list besar support:

```text
cursor pagination atau pagination konsisten
search
status filter
region filter
provider filter jika admin
created date
sort
```

Tetapkan maksimum page size.

Jangan mengembalikan seluruh database.

---

# 74. SOFT DELETE

Gunakan soft delete hanya jika memang diperlukan.

Resource financial/audit tidak boleh benar-benar hilang sembarangan.

User-visible deleted resources dapat menggunakan:

```text
deleted_at
```

Tetapi provider termination dan internal deletion adalah konsep berbeda.

Contoh VM:

```text
termination_requested_at
terminated_at
deleted_at
```

Jangan menyamakan:

```text
customer hide
provider destroyed
billing ended
```

---

# 75. DOMAIN/DNS MODULE

Kilat Cloud nantinya dapat mempunyai modul domain/DNS.

Jangan menganggap ini fitur Onidel kecuali ada di OpenAPI.

Buat sebagai platform/provider abstraction terpisah jika diimplementasikan:

```text
dns_zones
dns_records
dns_providers
domain_registrations
```

Gunakan Cloudflare/PowerDNS/provider adapter jika nanti dibutuhkan.

Jangan mencampurkan reverse DNS VM dengan authoritative DNS domain.

`rDNS/PTR` dan `DNS zone` adalah hal berbeda.

---

# 76. OBSERVABILITY

Tambahkan:

```text
structured logs
metrics
distributed tracing
health checks
readiness checks
provider latency metrics
job metrics
payment metrics
provisioning metrics
```

Minimal endpoints internal:

```text
/healthz
/readyz
/metrics
```

Jangan expose `/metrics` ke public internet tanpa proteksi.

---

# 77. HEALTH CHECK

Readiness harus mengecek dependency penting secara masuk akal:

```text
Postgres
Redis
critical configuration
```

Jangan menjadikan Onidel outage otomatis membuat seluruh API customer dianggap mati jika endpoint non-provider masih bisa bekerja.

---

# 78. TESTING

Wajib ada:

## Unit Tests

```text
pricing
password
normalization
permission
provider mapping
state machines
```

## Integration Tests

```text
PostgreSQL
Redis
repositories
transactions
auth
billing
idempotency
```

## Provider Tests

Mock Onidel responses:

```text
200
201
204
400
401
403
404
409 jika relevan
422
429 jika terjadi
500
503
timeout
connection reset
malformed response
```

## Concurrency Tests

Wajib test:

```text
2 registration email sama bersamaan
2 registration phone sama bersamaan
2 payment webhook bersamaan
2 provisioning request bersamaan
2 wallet debit bersamaan
2 contact change ke nomor sama
```

Expected result: tidak ada duplicate.

---

# 79. ONIDEL RESILIENCE

HTTP client provider wajib mempunyai:

```text
timeout
connection pooling
context cancellation
bounded retries
retry only safe/idempotent operation
exponential backoff
jitter
rate limit awareness
circuit breaker jika diperlukan
structured error mapping
```

Jangan retry `POST create VM` secara buta.

---

# 80. PROVIDER SYNC STATE

Simpan:

```text
sync_status
last_synced_at
provider_payload metadata
provider action state
```

Tetapi internal customer state tetap dikelola dengan state machine.

Jangan setiap frontend request langsung memanggil Onidel.

Gunakan database/cache sebagai normal read path dan sync provider sesuai kebutuhan.

---

# 81. CACHE POLICY

Setiap cache harus memiliki:

```text
key
TTL
invalidation
fallback
```

Contoh:

```text
plans → 5m
regions → 5m
instance_types → 5m
OS templates → 5m
instance detail → short TTL
```

Data billing sensitif tidak boleh mengandalkan stale cache untuk transaksi.

---

# 82. DATABASE QUERY PERFORMANCE

Tambahkan index berdasarkan query nyata.

Prioritas:

```text
users email
users phone
users username

organization_members

instances organization/status
instances provider/external id
instances public id

orders organization/status
invoices organization/status/due date
payments provider/reference

subscriptions next_invoice_at/status

jobs status/run_at

audit actor/time
notifications user/read/time
tickets organization/status
```

Jangan membuat index pada setiap kolom tanpa alasan.

---

# 83. PERSONAL VS BUSINESS ACCOUNT

Support:

```text
personal
business
```

Jika business:

```text
organization legal name
company address
tax information
billing contact
members
```

Jangan memindahkan seluruh company data ke `users`.

Company adalah organization/business entity.

---

# 84. KYC OPTIONAL MODULE

Jika diperlukan di kemudian hari:

```text
user_documents
organization_documents
verification_cases
```

File berada di R2/S3.

DB menyimpan metadata/status.

Jangan mewajibkan KYC jika business requirement belum menentukannya.

Design agar bisa ditambahkan tanpa merusak user schema.

---

# 85. DATA PRIVACY

PII:

```text
email
phone
address
IP
tax identity
documents
```

harus:

```text
access controlled
excluded dari debug logs
masked di admin UI jika role tidak berhak
retention-aware
audited
```

Backup juga harus diproteksi.

---

# 86. ADMIN PROVIDER CREDENTIALS

Admin dapat mengelola provider configuration tetapi API response tidak boleh mengembalikan secret asli.

Contoh:

```text
API key: oni_************abc
```

Update secret bersifat write-only.

---

# 87. PUBLIC ID

Gunakan public IDs:

```text
usr_
org_
vm_
inv_
ord_
pay_
key_
tkt_
```

Tetap gunakan UUID sebagai internal PK jika itu schema pilihan.

Jangan menggunakan sequential integer internal sebagai public identifier sensitif.

---

# 88. STATE MACHINE

Resource penting harus mempunyai valid state transition.

VM contoh:

```text
pending
→ provisioning
→ active

active
→ stopping
→ stopped

active
→ suspended

active/stopped/suspended
→ terminating
→ terminated
```

Invalid:

```text
terminated → active
```

tanpa explicit restore/reprovision semantics.

Billing/subscription/payment juga harus state machine, bukan update status bebas.

---

# 89. AUDIT SEBELUM IMPLEMENTASI

Output pertama Anda harus berupa audit:

```text
A. Existing tables
B. Existing enums
C. Existing constraints
D. Existing indexes
E. Existing provider resource mappings
F. Missing fields
G. Duplicate/redundant fields
H. Tables that should be added
I. Tables that should NOT be added
J. Migration changes
K. Security issues
L. OpenAPI coverage matrix
```

Buat coverage matrix:

```text
Onidel Operation
→ Internal Service
→ DB Table
→ Job?
→ User Endpoint
→ Admin Endpoint
→ Implemented?
```

Pastikan setiap operasi OpenAPI punya keputusan eksplisit.

---

# 90. JANGAN DUPLIKASI TABEL YANG SUDAH ADA

Sebelum membuat misalnya:

```text
vm_instances
```

cek apakah sudah ada:

```text
instances
```

Jika ada, gunakan `instances`.

Sebelum membuat:

```text
customers
```

cek apakah konsepnya sudah diwakili:

```text
users + organizations
```

Sebelum membuat:

```text
vps_plans
```

cek:

```text
products + plans
```

Sebelum membuat:

```text
files
```

cek:

```text
stored_objects
```

Sebelum membuat:

```text
customer_api_keys
```

cek:

```text
api_keys
```

Sebelum membuat:

```text
transactions
```

tentukan apakah maksudnya:

```text
wallet_transactions
payments
payment_events
```

Jangan menciptakan generic table yang menabrak domain table yang sudah jelas.

---

# 91. TIDAK BOLEH ADA TODO KRITIKAL

Jangan menghasilkan backend dengan:

```text
TODO implement auth
TODO validate payment
TODO call provider
TODO authorization
TODO transaction
```

untuk fitur inti.

Jika suatu fitur belum dapat dibuat karena OpenAPI tidak mendukung, tulis:

```text
NOT SUPPORTED BY CURRENT ONIDEL OPENAPI
```

dan buat interface/stub yang tidak berpura-pura sukses.

---

# 92. API CUSTOMER MINIMAL

Implementasikan kelompok API:

```text
/auth
/users/me
/profile
/addresses
/security
/sessions
/mfa
/api-keys

/organizations
/members

/catalog
/plans
/regions
/pricing/quote

/instances
/ssh-keys
/vpcs
/firewalls
/ip-lists
/reserved-ips
/snapshots
/backups
/startup-scripts
/custom-isos
/object-storage

/orders
/invoices
/payments
/wallet
/subscriptions

/notifications
/support
/webhooks
```

Gunakan version:

```text
/api/v1/...
```

---

# 93. ADMIN API MINIMAL

```text
/api/v1/admin/users
/api/v1/admin/organizations

/api/v1/admin/providers
/api/v1/admin/provider-accounts
/api/v1/admin/regions

/api/v1/admin/products
/api/v1/admin/plans
/api/v1/admin/pricing

/api/v1/admin/orders
/api/v1/admin/invoices
/api/v1/admin/payments

/api/v1/admin/instances

/api/v1/admin/jobs
/api/v1/admin/provider-actions
/api/v1/admin/reconciliation

/api/v1/admin/support
/api/v1/admin/audit
/api/v1/admin/security
```

Admin tetap melewati authorization policy.

---

# 94. OPENAPI KILAT CLOUD

Setelah API dibuat, generate/maintain OpenAPI untuk **Kilat Cloud API sendiri**.

Jangan expose schema Onidel langsung ke customer.

Kilat API menjadi kontrak customer.

Provider Onidel hanya implementation detail.

---

# 95. FLOW AKHIR

Target architecture:

```text
                     CUSTOMER
                         │
                         ▼
               ┌──────────────────┐
               │ Kilat Cloud API  │
               │ Go + Fiber       │
               └────────┬─────────┘
                        │
       ┌────────────────┼─────────────────┐
       │                │                 │
       ▼                ▼                 ▼
 PostgreSQL           Redis             R2/S3
 Source of Truth      Cache/OTP         Files
 Ledger               Session           Avatar
 Billing              Locks             Invoice
 Resources            Queue             Documents
       │
       ▼
 Transactional Outbox
       │
       ▼
       Worker
       │
       ▼
 Provider Interface
       │
       ├───────────────┐
       ▼               ▼
    Onidel          Provider lain
       │
       ▼
 VM / Network / Storage
```

---

# 96. IMPLEMENTATION ORDER

Kerjakan berurutan.

## Phase 1
Database audit + migration.

## Phase 2
Config + PostgreSQL + Redis + logging.

## Phase 3
User + register + login + verification.

## Phase 4
Profile + address + security + sessions.

## Phase 5
Organizations + RBAC.

## Phase 6
API keys.

## Phase 7
Onidel HTTP client + provider abstraction.

## Phase 8
Catalog + regions + instance type + OS sync.

## Phase 9
Fixed pricing + custom pricing + quote.

## Phase 10
Orders + invoice + wallet + payments.

## Phase 11
Provisioning jobs + VM lifecycle.

## Phase 12
Networking + firewall + reserved IP + rDNS.

## Phase 13
Snapshot + backup + startup script + ISO + measured boot.

## Phase 14
Object storage product.

## Phase 15
Notifications + support + customer webhook.

## Phase 16
Admin API.

## Phase 17
Reconciliation + monitoring + hardening.

## Phase 18
Tests + load tests + security audit.

Jangan melompat ke VM provisioning sebelum auth, database integrity, transaction, pricing, dan order lifecycle benar.

---

# 97. DEFINITION OF DONE

Project belum selesai hanya karena:

```text
go build
```

berhasil.

Selesai jika:

- Migration dari database kosong berhasil.
- Migration tidak menghasilkan duplicate object.
- Semua FK valid.
- Email tidak dapat duplicate.
- Phone tidak dapat duplicate.
- Username tidak dapat duplicate.
- Pending contact change aman dari duplicate.
- Argon2id benar.
- Email verification bekerja.
- Phone verification bekerja.
- Password reset bekerja.
- Password change merevoke session sesuai policy.
- MFA bekerja.
- API key scopes bekerja.
- Address terstruktur dan tidak duplicate dengan profile.
- R2/S3 upload bekerja.
- Organization/RBAC bekerja.
- Fixed plan bekerja.
- Custom pricing bekerja.
- Price quote immutable/historical.
- Orders bekerja.
- Invoice bekerja.
- Payment webhook idempotent.
- Wallet ledger konsisten.
- Provisioning tidak menghasilkan double VM.
- Onidel mapping benar.
- VM lifecycle bekerja.
- VPC/firewall/IP list bekerja.
- Reserved IP bekerja.
- rDNS bekerja.
- Snapshot/backup bekerja.
- Startup script bekerja.
- Object storage bekerja.
- Provider outage tidak merusak database state.
- Reconciliation bekerja.
- Audit log tersedia.
- Customer tidak dapat mengakses resource organization lain.
- Admin actions diaudit.
- Secrets tidak muncul di log.
- Unit/integration/concurrency tests lulus.
- `go test ./...` lulus.
- `go vet ./...` lulus.
- formatter/linter lulus.
- API mempunyai OpenAPI/documentation.

---

# 98. ATURAN TERAKHIR

Jangan hanya memberi teori.

Setelah audit, implementasikan benar-benar.

Untuk setiap phase:

1. Tampilkan apa yang ditemukan.
2. Sebutkan file yang akan diubah.
3. Buat migration bila database berubah.
4. Implementasikan kode.
5. Tambahkan test.
6. Jalankan test.
7. Perbaiki error.
8. Baru lanjut phase berikutnya.

Jangan menghapus fitur/schema valid tanpa alasan.

Jangan mengubah nama konsep secara sembarangan.

Jangan membuat duplicate source of truth.

Jangan mengarang kemampuan Onidel.

Jika OpenAPI dan database berbeda, jelaskan perbedaannya dan buat migration/adapter yang aman.

Prioritaskan:

```text
data integrity
security
idempotency
consistency
provider abstraction
maintainability
observability
```

daripada sekadar membuat endpoint cepat selesai.

Target akhirnya adalah **backend cloud production-grade yang dapat menjual VPS fixed package maupun custom resource, terhubung penuh dengan kemampuan Onidel yang tersedia, namun tetap independen sehingga provider dapat diganti atau ditambah di kemudian hari tanpa merombak keseluruhan platform.**