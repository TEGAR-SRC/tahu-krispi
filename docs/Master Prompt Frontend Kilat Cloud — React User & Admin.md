# MASTER PROMPT FRONTEND — KILAT CLOUD

Anda adalah **Senior Frontend Engineer, React Architect, UI/UX Engineer, Cloud Dashboard Designer, Security Engineer, dan Design System Engineer**.

Tugas Anda adalah membangun frontend production-grade untuk **Kilat Cloud**, sebuah cloud/VPS platform yang terhubung dengan backend Go yang sudah tersedia.

Frontend WAJIB menggunakan **React**, bukan Next.js.

Terdapat dua aplikasi frontend terpisah:

```text
frontend/
├── user/
└── admin/
```

## `user/`

Untuk:

- customer
- developer
- organization member
- billing user
- customer cloud dashboard

## `admin/`

Untuk:

- super admin
- administrator
- NOC
- finance
- support
- security
- operator cloud

Kedua aplikasi harus tetap mempunyai:

- design language yang konsisten
- API contract yang sama
- error handling yang sama
- permission model yang sama
- authentication behavior yang sama
- reusable architecture yang konsisten

Tetapi:

```text
admin
```

dan:

```text
user
```

adalah aplikasi berbeda dan **tidak boleh tercampur routing-nya**.

---

# 1. TARGET

Bangun frontend lengkap untuk:

```text
Kilat Cloud User Console
Kilat Cloud Admin Console
```

yang dapat menangani:

- authentication
- registration
- email verification
- phone verification
- forgot password
- reset password
- MFA
- passkey
- sessions
- profile
- addresses
- organization
- team members
- RBAC
- API keys
- VPS fixed plan
- VPS custom builder
- pricing quote
- order
- checkout
- invoice
- payments
- wallet
- subscriptions
- VPS management
- VPC
- firewall
- firewall rule
- IP lists
- reserved IP
- SSH key
- startup script
- snapshots
- backups
- custom ISO
- measured boot
- BGP
- rDNS
- console/VNC
- object storage
- buckets
- notifications
- support tickets
- customer webhooks

serta seluruh fungsi admin yang berhubungan dengan sistem tersebut.

---

# 2. TEKNOLOGI UTAMA

Gunakan:

```text
React
TypeScript
Vite

Tailwind CSS
shadcn/ui

React Router

TanStack Query

React Hook Form
Zod

Zustand hanya jika benar-benar diperlukan

Lucide Icons

Recharts untuk chart jika diperlukan
```

Jangan menggunakan Redux tanpa alasan yang benar-benar kuat.

Server state harus dikelola menggunakan:

```text
TanStack Query
```

bukan ditumpuk semuanya ke global state.

---

# 3. STRUKTUR ROOT

Target:

```text
frontend/
│
├── user/
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── admin/
    ├── public/
    ├── src/
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts
```

Jangan mencampur:

```text
/admin
/user
```

dalam satu React Router besar jika requirement adalah dua aplikasi terpisah.

---

# 4. STRUKTUR INTERNAL

Masing-masing aplikasi mengikuti struktur modular.

Contoh:

```text
src/
├── app/
│   ├── router/
│   ├── providers/
│   ├── layouts/
│   └── config/
│
├── components/
│   ├── ui/
│   ├── common/
│   ├── forms/
│   ├── tables/
│   ├── dialogs/
│   ├── charts/
│   └── feedback/
│
├── features/
│
├── hooks/
│
├── lib/
│   ├── api/
│   ├── auth/
│   ├── query/
│   ├── validation/
│   ├── format/
│   └── storage/
│
├── types/
│
├── assets/
│
├── styles/
│
└── main.tsx
```

Jangan membuat seluruh halaman menjadi:

```text
src/pages/
```

lalu memasukkan semua logic ke sana.

Gunakan domain/feature architecture.

---

# 5. FEATURE ARCHITECTURE USER

Contoh:

```text
features/
├── auth/
├── profile/
├── security/
├── organizations/
├── api-keys/
├── catalog/
├── pricing/
├── instances/
├── networking/
├── firewalls/
├── ssh-keys/
├── reserved-ips/
├── snapshots/
├── backups/
├── startup-scripts/
├── custom-isos/
├── object-storage/
├── billing/
├── wallet/
├── invoices/
├── payments/
├── subscriptions/
├── notifications/
├── support/
└── webhooks/
```

Setiap feature dapat mempunyai:

```text
api/
components/
hooks/
schemas/
types/
utils/
pages/
```

jika memang diperlukan.

---

# 6. DILARANG DUPLIKASI

Sebelum membuat component baru, cek component yang sudah tersedia.

DILARANG mempunyai:

```text
Button.tsx
CustomButton.tsx
MainButton.tsx
PrimaryButton.tsx
ButtonNew.tsx
```

untuk fungsi yang sebenarnya sama.

Begitu juga:

```text
Modal
Dialog
ConfirmationModal
ConfirmDialog
DeletePopup
```

jika fungsi dasarnya sama.

Gunakan satu reusable component.

---

# 7. COMPONENT LAYERS

Gunakan tiga level component.

## UI primitive

Contoh:

```text
Button
Input
Textarea
Select
Dialog
Dropdown
Tabs
Tooltip
Badge
Card
Table
Skeleton
Avatar
Switch
Checkbox
Radio
```

## Shared application component

Contoh:

```text
DataTable
PageHeader
EmptyState
ErrorState
ConfirmDialog
CopyButton
StatusBadge
Money
DateTime
ResourceUsage
Pagination
SearchInput
FilterBar
CodeBlock
SecretReveal
```

## Domain component

Contoh:

```text
InstanceCard
InvoiceSummary
FirewallRuleEditor
VMResourceSelector
WalletBalance
SnapshotList
```

Jangan menaruh business-specific behavior ke UI primitive.

---

# 8. DESIGN STYLE

Gunakan tampilan:

```text
modern
minimal
professional
cloud infrastructure
developer oriented
clean
dense tetapi tidak sesak
```

Referensi feel:

```text
Vercel
Cloudflare
DigitalOcean
Hetzner Cloud
Linear
GitHub
```

Tetapi jangan menyalin persis brand mereka.

Gunakan identitas Kilat Cloud sendiri.

---

# 9. RESPONSIVE

Harus bekerja pada:

```text
desktop
laptop
tablet
mobile
```

User dashboard harus benar-benar usable di mobile.

Admin lebih desktop-oriented tetapi tetap responsive.

---

# 10. DARK MODE

Support:

```text
system
light
dark
```

Theme tidak boleh menyebabkan layout berubah.

Simpan preference dengan aman.

---

# 11. USER LAYOUT

Desktop:

```text
┌────────────────────────────────────────────┐
│ Topbar                                     │
├───────────────┬────────────────────────────┤
│ Sidebar       │                            │
│               │ Main Content               │
│               │                            │
│               │                            │
└───────────────┴────────────────────────────┘
```

Sidebar harus collapsible.

---

# 12. USER SIDEBAR

Struktur utama:

```text
Overview

Cloud
├── Instances
├── Snapshots
├── Backups
├── SSH Keys
└── Startup Scripts

Networking
├── VPC
├── Firewalls
├── IP Lists
├── Reserved IPs
└── Reverse DNS jika relevan dari instance

Storage
├── Object Storage
├── Buckets
└── Custom ISO

Billing
├── Overview
├── Wallet
├── Orders
├── Invoices
├── Payments
└── Subscriptions

Developer
├── API Keys
└── Webhooks

Account
├── Profile
├── Addresses
├── Organizations
├── Security
├── Sessions
└── Notifications

Support
└── Tickets
```

Jangan menampilkan menu yang user tidak mempunyai permission.

---

# 13. ORGANIZATION SWITCHER

Di bagian atas sidebar/topbar harus ada:

```text
Organization Switcher
```

Contoh:

```text
Personal Workspace
PT Example Indonesia
School Project
```

Ketika organization berganti:

```text
invalidate organization scoped queries
↓
update active organization
↓
refetch resources
```

Jangan menampilkan instance organization lama setelah switch.

---

# 14. AUTHENTICATION PAGES

Buat:

```text
/login
/register

/verify-email
/verify-phone

/forgot-password
/reset-password

/mfa
/passkey

/oauth/callback jika digunakan
```

Layout auth sederhana dan bersih.

---

# 15. REGISTER FORM

Field minimal:

```text
Full Name
Email
Phone
Password
Confirm Password
Accept Terms
Accept Privacy Policy
```

Phone menggunakan country picker.

Indonesia:

```text
+62
```

Input:

```text
085712345678
```

boleh diterima frontend tetapi dikirim dalam format normalisasi backend:

```text
+6285712345678
```

Namun backend tetap source of truth untuk normalisasi/validation.

---

# 16. PASSWORD FIELD

Buat reusable:

```text
PasswordInput
```

Support:

```text
show/hide
password requirement
Caps Lock warning
autocomplete
password manager compatibility
```

Jangan memblokir paste password.

Password manager harus tetap bekerja.

---

# 17. LOGIN

Flow:

```text
email/username
password
↓
POST auth
↓
MFA required?
├── no → dashboard
└── yes → MFA challenge
```

Tampilkan generic invalid credential.

Jangan:

```text
Email ditemukan, password salah.
```

karena membocorkan keberadaan akun.

---

# 18. AUTH SESSION

Frontend tidak boleh memperlakukan:

```text
localStorage.access_token
```

sebagai desain keamanan default tanpa mempertimbangkan backend architecture.

Jika backend menggunakan secure HttpOnly cookie, gunakan itu.

Frontend hanya menggunakan auth state yang diperlukan.

Jangan menyimpan password, refresh token, OTP, atau secret di localStorage.

---

# 19. ROUTE GUARD

Buat:

```text
GuestRoute
AuthenticatedRoute
VerifiedRoute
PermissionRoute
AdminRoute
```

Tetapi frontend permission hanya UX layer.

Backend tetap wajib melakukan authorization.

---

# 20. PROFILE

Page:

```text
/account/profile
```

Tampilkan:

```text
Avatar
Full Name
Display Name
Email
Email Verification Status
Phone
Phone Verification Status
Company jika ada
Timezone
Language
Member Since
Last Login
```

Email/phone tidak diubah langsung dari form profile biasa.

Gunakan dedicated change flow.

---

# 21. EMAIL CHANGE

UI:

```text
Current Email
New Email
Confirm
```

Setelah request:

```text
Verification sent
```

Tampilkan:

```text
pending email
expires at
resend
cancel
```

Jangan mengubah UI primary email sebagai selesai sebelum backend mengonfirmasi verification complete.

---

# 22. PHONE CHANGE

Flow yang sama:

```text
new phone
↓
send OTP
↓
OTP form
↓
verified
↓
reload profile
```

Tampilkan error:

```text
PHONE_ALREADY_EXISTS
```

secara user-friendly.

---

# 23. ADDRESSES

Page:

```text
/account/addresses
```

Support multiple address:

```text
Home
Billing
Legal
Company
Other
```

Indonesia form:

```text
Recipient Name
Company Name

Country
Province
City / Regency
District / Kecamatan
Subdistrict / Kelurahan

RT
RW

Postal Code

Address Line 1
Address Line 2

Phone optional
```

Support:

```text
set default
edit
delete
```

Billing address selection dipakai saat checkout.

---

# 24. PROFILE COMPLETION

Dashboard dapat menampilkan:

```text
Complete your profile
75%
```

Checklist:

```text
✓ Email verified
✓ Phone verified
✓ Full name
○ Billing address
```

Gunakan response backend.

Jangan menduplikasi formula profile completion berbeda di frontend.

---

# 25. SECURITY PAGE

Route:

```text
/account/security
```

Sections:

```text
Password
Two-Factor Authentication
Passkeys
Recovery Codes
Sessions
API Security
Recent Security Activity
```

---

# 26. CHANGE PASSWORD

Modal/page:

```text
Current Password
New Password
Confirm New Password
```

Setelah sukses:

```text
Password changed
Other sessions may have been signed out
```

Frontend wajib clear sensitive field setelah submit.

---

# 27. MFA

TOTP setup UI:

```text
1. Scan QR
2. Save recovery codes
3. Enter verification code
4. Enable
```

Recovery code hanya tampil pada saat diberikan backend.

Support:

```text
copy
download text optional
print optional
```

Berikan warning bahwa code tidak dapat dilihat lagi.

---

# 28. PASSKEY

Security page:

```text
Passkeys
```

List:

```text
MacBook Pro
Chrome
Added Aug 24
Last used ...
```

Actions:

```text
Add Passkey
Rename
Remove
```

Gunakan WebAuthn API browser.

---

# 29. SESSION MANAGEMENT

Page/list:

```text
Current Session

MacBook Pro
Chrome
Jakarta
IP
Last Active
```

Actions:

```text
Revoke
Revoke all other sessions
```

Current session diberi badge.

---

# 30. API KEYS

Page:

```text
/developer/api-keys
```

Columns:

```text
Name
Prefix
Scopes
Created
Last Used
Expires
Status
```

Create dialog:

```text
Name
Expiration
Allowed IPs
Scopes
```

Setelah create:

```text
API key secret
```

hanya tampil sekali.

UI WAJIB memberi warning:

```text
Copy this API key now. You will not be able to see it again.
```

Actions:

```text
Rotate
Revoke
Delete
```

---

# 31. DASHBOARD USER

Route:

```text
/dashboard
```

Cards:

```text
Active Instances
Monthly Spending
Outstanding Invoice
Wallet Balance
```

Sections:

```text
Resource Overview
Recent Instances
Recent Activity
Upcoming Invoice
Notifications
Service Status
```

Jangan memenuhi dashboard dengan chart yang tidak berguna.

---

# 32. INSTANCE LIST

Route:

```text
/cloud/instances
```

Table:

```text
Name
Status
Region
IPv4
CPU
RAM
Disk
Plan
Billing
Created
Actions
```

Support:

```text
search
filter status
filter region
sort
pagination
```

Status badge konsisten.

---

# 33. CREATE INSTANCE

Gunakan wizard.

```text
Step 1 Region
Step 2 Plan / Custom
Step 3 OS
Step 4 Networking
Step 5 Authentication
Step 6 Advanced
Step 7 Review
Step 8 Payment
```

---

# 34. REGION SELECTOR

Card:

```text
Jakarta
Indonesia
Available

Singapore
Available

...
```

Jika unavailable:

```text
Sold Out
Maintenance
Coming Soon
```

Jangan biarkan user memilih region unavailable.

---

# 35. FIXED PLAN SELECTOR

Tampilkan:

```text
MICRO

1 vCPU
2 GB RAM
20 GB NVMe
1 TB Traffic

Rp xxx / month
```

Plan card support:

```text
monthly
quarterly
semiannual
annual
```

jika backend menyediakan billing period tersebut.

---

# 36. CUSTOM VPS BUILDER

Ini fitur utama.

UI dua kolom desktop:

```text
┌────────────────────────────┬─────────────────────┐
│ Resource Builder           │ Price Summary       │
│                            │                     │
│ CPU                        │ CPU       Rp...     │
│ RAM                        │ RAM       Rp...     │
│ NVMe                       │ Disk      Rp...     │
│ HDD                        │ IPv4      Rp...     │
│ Bandwidth                  │ Discount  Rp...     │
│ IPv4                       │ Tax       Rp...     │
│ Backup                     │                     │
│                            │ TOTAL     Rp...     │
└────────────────────────────┴─────────────────────┘
```

Resource controls dapat berupa:

```text
slider + numeric input
```

tetapi harus mengikuti backend:

```text
min
max
step
```

Jangan hardcode batas resource.

---

# 37. CUSTOM PRICING

Setiap perubahan resource jangan dihitung final hanya oleh frontend.

Gunakan backend:

```text
POST /api/v1/pricing/quote
```

Gunakan debounce.

Contoh:

```text
CPU berubah
↓
500ms debounce
↓
pricing quote
↓
update summary
```

Frontend boleh menampilkan instant estimate sementara jika dibutuhkan, tetapi angka final harus dari backend.

---

# 38. PRICE QUOTE

Summary:

```text
4 vCPU                   Rp140.000
8 GB RAM                 Rp96.000
100 GB NVMe              Rp80.000
IPv4                     Rp20.000
Bandwidth                Rp...
--------------------------------
Subtotal                 Rp...
Discount                 -Rp...
Tax                      Rp...
--------------------------------
Total                    Rp...
```

Tampilkan:

```text
Quote valid until ...
```

Jika quote expired:

```text
Refresh Price
```

---

# 39. OS SELECTOR

Tampilkan OS:

```text
Ubuntu
Debian
Rocky Linux
AlmaLinux
Windows jika tersedia
Custom ISO
Snapshot
```

Data berasal dari backend/provider sync.

Jangan hardcode OS availability.

---

# 40. SSH AUTH

User dapat:

```text
Select existing SSH key
Add new SSH key
```

Jika password VM diberikan provider:

- jangan simpan permanen di state
- tampilkan sesuai backend policy
- clear dari UI state setelah tidak diperlukan

Lebih utamakan SSH key.

---

# 41. NETWORK CONFIG CREATE VM

Support:

```text
IPv4
IPv6
VPC
Firewall Group
Reserved IP jika applicable
```

Advanced:

```text
Disable outgoing SSH blocking
Startup Script
Measured Boot
```

hanya jika backend/provider mendukung.

---

# 42. REVIEW ORDER

Sebelum checkout:

```text
Region
Configuration
OS
Networking
Authentication
Billing Period
Price
Discount
Tax
Total
```

Checkbox:

```text
I understand this resource will incur charges.
```

Jangan mempercayai price dari frontend ketika submit.

Kirim quote ID.

---

# 43. INSTANCE DETAIL

Route:

```text
/cloud/instances/:id
```

Header:

```text
VM Name
Status
Region
Public IP
Actions
```

Tabs:

```text
Overview
Metrics
Networking
Snapshots
Backups
Console
Activity
Settings
```

---

# 44. INSTANCE OVERVIEW

Tampilkan:

```text
Status

vCPU
RAM
Storage

IPv4
IPv6

OS
Region
Hostname
Created At

Billing
Renewal Date

Provider details hanya jika memang boleh customer lihat
```

Biasanya jangan expose internal provider name jika Kilat Cloud ingin provider abstraction penuh.

---

# 45. INSTANCE ACTION MENU

Actions:

```text
Stop
Reboot
Rename
Open Console
Create Snapshot
Restore
Reinstall jika backend mendukung
Delete / Terminate
```

Destructive action wajib confirmation.

Terminate dialog harus menampilkan:

```text
Instance akan dihapus.
Data mungkin tidak dapat dipulihkan.
```

Optional type instance name confirmation.

---

# 46. OPERATION STATE

Saat action asynchronous:

```text
Reboot requested
Provisioning
Stopping
Creating snapshot
Restoring
Terminating
```

Jangan disable seluruh UI tanpa alasan.

Gunakan optimistic UI hanya ketika aman.

Cloud resource status harus mengikuti server.

---

# 47. CONSOLE

Tab:

```text
Console
```

Backend memberikan session/token/url.

Jangan expose credential provider permanen.

Console session harus:

```text
short-lived
```

UI:

```text
Open Web Console
```

bisa iframe/window berdasarkan backend.

---

# 48. METRICS

Jika backend menyediakan:

```text
CPU Usage
RAM Usage
Network In
Network Out
Disk
```

Tampilkan chart.

Support:

```text
1h
6h
24h
7d
30d
```

Jangan generate metric palsu kalau backend belum menyediakan.

---

# 49. SNAPSHOTS

Route atau instance tab:

```text
Snapshots
```

Columns:

```text
Name
Size
Status
Created
Actions
```

Actions:

```text
Create
Restore
Delete
Download jika tersedia
```

Restore harus confirmation.

---

# 50. BACKUPS

Tampilkan:

```text
Backup Date
Size
Status
Retention
Actions
```

Actions:

```text
Restore
Download jika supported
```

Signed download URL tidak boleh disimpan permanen di frontend.

Request URL ketika dibutuhkan.

---

# 51. SSH KEYS PAGE

Route:

```text
/cloud/ssh-keys
```

Columns:

```text
Name
Fingerprint
Created
Used By
```

Create:

```text
Name
Public Key
```

Validate format frontend sebagai UX.

Backend tetap final validator.

---

# 52. VPC

Route:

```text
/network/vpcs
```

List:

```text
Name
Region
CIDR
VM Count
Status
Created
```

Detail:

```text
Overview
Attached Instances
Configuration
Activity
```

Create/edit/delete sesuai backend capability.

---

# 53. FIREWALLS

Route:

```text
/network/firewalls
```

Firewall detail:

```text
Rules
Attached Resources
Settings
```

Rule editor:

```text
Direction
Protocol
Port / Range
Source/Destination
IP/CIDR/IP List
Description
```

Support protocol sesuai backend/provider.

Jangan hardcode rule limit jika backend memberikan limit.

---

# 54. FIREWALL RULE UX

Tampilkan seperti:

```text
INBOUND

TCP
22
103.1.2.3/32
SSH Office

ALLOW
```

Gunakan readable representation.

Tetap sediakan advanced editor.

---

# 55. IP LISTS

Route:

```text
/network/ip-lists
```

IP list:

```text
Office Network
├── 103.1.1.0/24
├── 2001:db8::/64
└── ...
```

Support:

```text
create
edit
delete
add entry
remove entry
```

Tampilkan quota jika backend mengirim quota.

---

# 56. RESERVED IP

Route:

```text
/network/reserved-ips
```

Columns:

```text
IP Address
Type
Region
Name
Attached Instance
Status
Created
```

Actions:

```text
Create
Attach
Detach
Convert
Rename jika supported
Delete
```

Disable action berdasarkan current state.

---

# 57. REVERSE DNS

Dapat diletakkan pada:

```text
Instance → Networking → Reverse DNS
```

Tampilkan:

```text
IP
PTR Hostname
Status
```

Actions:

```text
Set PTR
Edit PTR
Delete PTR
```

Tambahkan helper text bahwa hostname mungkin harus resolve kembali ke IP sesuai aturan provider.

---

# 58. BGP

Jika backend mengizinkan BGP untuk account/resource tertentu:

```text
Instance → Networking → BGP
```

Tampilkan:

```text
Status
ASN
Peer details jika boleh
```

Actions:

```text
Enable
Disable
```

Jangan tampilkan menu untuk user yang tidak berhak.

---

# 59. STARTUP SCRIPTS

Route:

```text
/cloud/startup-scripts
```

Editor:

```text
Name
Description
Script
```

Gunakan code editor sederhana atau textarea monospace.

Tampilkan limit provider yang dikirim backend.

---

# 60. CUSTOM ISO

Route:

```text
/storage/custom-isos
```

Create:

```text
Name
URL
```

Status:

```text
Downloading
Ready
Failed
```

Jangan menganggap URL valid hanya dari frontend.

Backend tetap melakukan SSRF/security validation.

---

# 61. MEASURED BOOT

Hanya tampil jika supported.

Page/tab:

```text
Measured Boot Images
```

Support:

```text
list
upload/create
attach
detach
delete
```

Berikan warning karena ini fitur advanced.

---

# 62. OBJECT STORAGE

Route:

```text
/storage/object-storage
```

Tampilkan service:

```text
Name
Region
Status
Usage
Buckets
Created
```

Detail:

```text
Overview
Buckets
Credentials
Usage
Settings
```

---

# 63. BUCKETS

Tampilkan:

```text
Bucket Name
Created
Access
Usage
Actions
```

Create dialog:

```text
Bucket Name
```

Jika provider memiliki naming requirements, tampilkan validation.

---

# 64. STORAGE ACCESS KEY

Credentials bersifat sensitif.

Saat create/show:

```text
Access Key
Secret Key
```

Gunakan:

```text
Copy
```

Secret hanya tampil sesuai backend behavior.

Jangan menyimpan secret di localStorage.

---

# 65. BILLING OVERVIEW

Route:

```text
/billing
```

Cards:

```text
Current Monthly Spend
Next Invoice
Outstanding Balance
Wallet Balance
```

Sections:

```text
Subscriptions
Recent Invoices
Recent Payments
Usage
```

---

# 66. WALLET

Route:

```text
/billing/wallet
```

Tampilkan:

```text
Available Balance
Pending
```

Transactions:

```text
Date
Type
Reference
Amount
Status
Balance impact
```

Top Up button jika backend/payment menyediakan.

---

# 67. ORDERS

Route:

```text
/billing/orders
```

Columns:

```text
Order Number
Description
Amount
Status
Created
```

Detail:

```text
items
pricing snapshot
payment
provisioning state
```

---

# 68. INVOICES

Route:

```text
/billing/invoices
```

Columns:

```text
Invoice
Issued
Due
Total
Status
```

Status:

```text
Draft
Open
Paid
Past Due
Cancelled
Refunded jika backend support
```

Actions:

```text
View
Pay
Download PDF
```

---

# 69. INVOICE DETAIL

Display:

```text
Kilat Cloud
Invoice Number

Customer
Billing Address

Items

Subtotal
Discount
Tax
Total

Payment Status
```

Gunakan invoice snapshot dari backend.

Jangan mengambil current address user untuk mengubah historical invoice.

---

# 70. PAYMENTS

Route:

```text
/billing/payments
```

Tampilkan:

```text
Payment ID
Invoice
Method
Amount
Status
Date
```

Jangan expose raw gateway payload.

---

# 71. SUBSCRIPTIONS

Route:

```text
/billing/subscriptions
```

Columns:

```text
Service
Plan
Billing Cycle
Amount
Next Invoice
Status
```

Actions jika supported:

```text
Cancel at period end
Cancel
Change plan
```

Jangan mengimplementasikan action yang backend belum menyediakan.

---

# 72. NOTIFICATIONS

Bell pada topbar.

Dropdown:

```text
latest notifications
```

Page:

```text
/account/notifications
```

Support:

```text
read
mark all read
filter
preferences
```

---

# 73. SUPPORT

Route:

```text
/support
```

Ticket list:

```text
ID
Subject
Category
Priority
Status
Last Updated
```

Create:

```text
Subject
Category
Related Resource
Message
Attachments
```

Attachments upload ke backend/R2 flow.

---

# 74. TICKET DETAIL

Layout:

```text
Conversation
Ticket metadata
Related resource
Attachments
```

Differentiate:

```text
customer
support agent
system
```

messages.

---

# 75. CUSTOMER WEBHOOK

Route:

```text
/developer/webhooks
```

Create:

```text
Name
Endpoint URL
Events
```

Events contoh:

```text
instance.created
instance.updated
instance.deleted

invoice.created
invoice.paid

payment.succeeded
payment.failed
```

Gunakan daftar event dari backend.

Secret hanya tampil sekali jika backend demikian.

---

# 76. ACTIVITY LOG

Customer dapat mempunyai:

```text
/activity
```

Tampilkan event penting:

```text
Instance created
Password changed
API key created
Invoice paid
IP attached
Snapshot restored
```

Jangan expose internal audit metadata yang sensitif.

---

# ADMIN APPLICATION

---

# 77. ADMIN LOGIN

Admin menggunakan:

```text
admin/
```

dengan login sendiri.

Tetap menggunakan backend auth yang sama jika backend mendesain demikian.

Admin route harus require:

```text
authenticated
verified
admin permission
```

Bukan hanya route `/admin`.

---

# 78. ADMIN LAYOUT

Sidebar utama:

```text
Overview

Customers
├── Users
├── Organizations
└── Verification

Cloud
├── Instances
├── Regions
├── Providers
├── Provider Accounts
├── VPCs
├── Reserved IPs
└── Object Storage

Products
├── Products
├── Plans
├── Pricing
├── Custom Resource Rates
├── Coupons
└── Promotions

Billing
├── Orders
├── Invoices
├── Payments
├── Wallet Transactions
└── Subscriptions

Operations
├── Jobs
├── Provider Actions
├── Reconciliation
└── Orphan Resources

Support
├── Tickets
└── Notifications

Security
├── Audit Logs
├── Security Events
├── Sessions
└── Blocked Networks

System
├── Feature Flags
├── Settings
└── System Health
```

Menu berdasarkan permission.

---

# 79. ADMIN DASHBOARD

Cards:

```text
Users
Active Instances
Revenue
Outstanding Invoice
Provider Health
Failed Jobs
Open Tickets
```

Charts jika berguna:

```text
Revenue
New customers
Provisioning
Instance growth
Provider failures
```

Operations section:

```text
Failed Jobs
Provider Errors
Payment Errors
Recent Security Events
```

---

# 80. ADMIN USERS

Route:

```text
/users
```

Columns:

```text
User
Email
Phone
Verification
Status
Organization
Joined
Last Seen
```

Filters:

```text
status
email verification
phone verification
date
organization
```

---

# 81. ADMIN USER DETAIL

Tabs:

```text
Overview
Profile
Addresses
Organizations
Instances
Billing
Security
API Keys
Sessions
Support
Audit
```

Admin must not see raw password/API secret.

Actions permission-controlled:

```text
Suspend
Unsuspend
Force Password Reset
Revoke Sessions
Verify manually jika policy allows
```

Danger actions confirmation mandatory.

---

# 82. ADMIN ORGANIZATIONS

Columns:

```text
Name
Type
Owner
Members
Instances
Spend
Status
Created
```

Detail:

```text
members
resources
billing
provider mapping
audit
```

---

# 83. ADMIN PROVIDERS

Provider cards:

```text
Onidel
Healthy
Latency
Last Sync
```

Detail:

```text
Overview
Accounts
Regions
Resources
Sync
Errors
Metrics
```

Do not expose raw credential.

---

# 84. PROVIDER ACCOUNT

Admin sees:

```text
Name
Provider
Status
Endpoint
Team mapping
Last Sync
```

Credential:

```text
••••••••
```

Actions:

```text
Update Secret
Test Connection
Disable
Enable
```

Secret field write-only.

---

# 85. REGIONS ADMIN

Route:

```text
/cloud/regions
```

Columns:

```text
Name
Code
Provider
Status
Currency
Availability
```

Admin can:

```text
enable selling
disable selling
maintenance
sold out
```

Provider availability dan customer-sale availability dapat berbeda.

---

# 86. PRODUCTS

Admin:

```text
Products
```

Contoh:

```text
Cloud VPS
Object Storage
Backup
Reserved IP
```

Fields:

```text
name
slug
type
status
description
```

---

# 87. PLANS

Plan manager.

Contoh:

```text
MICRO
STARTER
STANDARD
ENTERPRISE
```

Set:

```text
CPU
RAM
NVMe
HDD
Bandwidth
IPv4
IPv6
Backup
```

Dan region availability.

---

# 88. CUSTOM RESOURCE RATES

Ini harus mempunyai editor bagus.

Table:

```text
Region
Resource
Unit
Customer Price
Provider Cost
Min
Max
Step
Currency
Billing Period
Active
```

Contoh:

```text
Jakarta
vCPU
1 CPU
Rp35.000
Rp20.000
1
24
1
IDR
Monthly
```

---

# 89. PRICING PREVIEW ADMIN

Admin bisa test:

```text
4 CPU
8GB RAM
100GB NVMe
1 IPv4
```

dan melihat:

```text
Provider Cost
Customer Price
Margin
Margin %
```

tanpa membuat order.

---

# 90. COUPONS

Admin dapat:

```text
create
activate
disable
expire
```

Fields:

```text
code
type
value
minimum purchase
maximum discount
usage limit
per user limit
start
end
products
plans
regions
```

---

# 91. ADMIN ORDERS

Columns:

```text
Order
Customer
Service
Total
Payment
Provisioning
Created
```

Detail:

```text
quote
items
invoice
payment
job
provider action
instance
audit
```

Satu halaman harus memudahkan tracing order end-to-end.

---

# 92. ADMIN INVOICE

Actions dengan permission:

```text
View
Download
Mark manually only if backend policy allows
Void
Refund related workflow
```

Manual financial action wajib:

```text
reason
confirmation
audit
```

---

# 93. ADMIN PAYMENT

Detail:

```text
Gateway
Reference
Amount
Status
Webhook Events
Timeline
```

Jangan expose sensitive payment credential.

---

# 94. ADMIN INSTANCE

Admin instance table:

```text
Instance
Customer
Organization
Provider
Region
External ID
Status
Plan
Created
```

Admin detail:

```text
Customer View
Provider
Provider Actions
Networking
Billing
Jobs
Audit
Raw sanitized provider metadata
```

---

# 95. ADMIN INSTANCE ACTIONS

Permission-controlled:

```text
Sync
Stop
Reboot
Suspend
Unsuspend
Terminate
```

Danger actions:

```text
reason required
confirmation
audit
```

---

# 96. PROVIDER ACTIONS

Operations page:

```text
Operation
Resource
Provider
Status
Attempts
Duration
Started
```

Filters:

```text
failed
pending
provider
operation
resource
date
```

Detail:

```text
timeline
sanitized request metadata
sanitized response/error
request ID
job
resource
```

No secrets.

---

# 97. JOB MONITOR

Route:

```text
/operations/jobs
```

Columns:

```text
Job
Type
Resource
Status
Attempt
Run At
Last Error
```

Actions if backend supports:

```text
Retry
Cancel
```

Do not fake retry client-side.

---

# 98. RECONCILIATION

Dashboard:

```text
Provider
Last Run
Matched
Drifted
Orphaned
Failed
```

Detail:

```text
resource
internal state
provider state
difference
```

Admin can inspect.

Don't automatically show destructive reconcile action unless backend supports safe workflow.

---

# 99. ORPHAN RESOURCE

Page:

```text
Orphan Provider Resources
```

Display:

```text
Provider
External ID
Type
Detected
Metadata
```

Actions only according to backend:

```text
Ignore
Link
Investigate
```

Do not provide one-click destroy casually.

---

# 100. SUPPORT ADMIN

Ticket inbox:

```text
New
Open
Waiting Customer
Waiting Internal
Resolved
Closed
```

Filters:

```text
priority
category
assignee
customer
```

Ticket interface seperti support desk.

---

# 101. AUDIT LOG ADMIN

Table:

```text
Time
Actor
Action
Resource
IP
Request ID
```

Detail:

```text
safe before
safe after
metadata
```

Never show:

```text
password
token
OTP
provider secret
```

---

# 102. SECURITY ADMIN

Dashboard:

```text
Failed Logins
Locked Accounts
Suspicious API Activity
Rate Limited Requests
Blocked Networks
Security Events
```

Filtering and investigation UI.

---

# 103. FEATURE FLAGS

Page:

```text
Feature
Environment
Status
Updated
```

Danger confirmation when changing critical feature.

Frontend must use backend feature flag result.

---

# API CLIENT ARCHITECTURE

---

# 104. SATU API CLIENT STANDARD

Jangan menggunakan:

```text
fetch()
axios()
customFetch()
apiRequest()
```

acak di setiap feature.

Buat satu HTTP layer.

Contoh:

```text
lib/api/
├── client.ts
├── errors.ts
├── types.ts
└── interceptors.ts
```

Feature hanya memakai wrapper.

---

# 105. BASE URL

Environment:

```text
VITE_API_BASE_URL
```

Contoh:

```text
https://api.kilat-cloud.com/api/v1
```

Jangan hardcode production URL.

---

# 106. API ERRORS

Backend response:

```json
{
  "error": {
    "code": "PHONE_ALREADY_EXISTS",
    "message": "..."
  },
  "request_id": "req_x"
}
```

Frontend harus mempunyai:

```text
ApiError
```

dengan:

```text
code
message
fields
requestId
httpStatus
```

---

# 107. ERROR MAPPING

Central mapping:

```text
INVALID_CREDENTIALS
→ Email/username atau password salah.

EMAIL_ALREADY_EXISTS
→ Email sudah digunakan.

PHONE_ALREADY_EXISTS
→ Nomor telepon sudah digunakan.

QUOTE_EXPIRED
→ Harga sudah kedaluwarsa. Silakan perbarui.

INSUFFICIENT_BALANCE
→ Saldo tidak mencukupi.

PROVIDER_UNAVAILABLE
→ Layanan cloud sedang mengalami gangguan.

INSTANCE_INVALID_STATE
→ Tindakan tidak dapat dilakukan pada kondisi instance saat ini.
```

Jangan setiap page membuat interpretasi error sendiri.

---

# 108. REQUEST ID

Jika backend memberikan:

```text
request_id
```

tampilkan pada error detail/support:

```text
Reference: req_ABC123
```

Memudahkan support.

---

# 109. TANSTACK QUERY

Gunakan query key factory.

Contoh:

```text
['me']

['organizations']
['organization', id]

['instances', organizationId, filters]
['instance', id]

['invoices', organizationId]
```

Jangan membuat random query key.

---

# 110. CACHE INVALIDATION

Contoh setelah:

```text
Create Instance
```

invalidate:

```text
instances
dashboard summary
orders jika relevan
```

Setelah payment:

```text
invoice
payments
wallet
orders
```

Jangan `invalidateQueries()` seluruh aplikasi setiap mutation.

---

# 111. FORM VALIDATION

Gunakan:

```text
React Hook Form
Zod
```

Client validation untuk UX.

Server validation tetap authority.

Jika backend mengirim field errors:

```json
{
  "fields": {
    "email": "..."
  }
}
```

map ke form field.

---

# 112. NUMBER FORMATTING

Buat helper:

```text
formatCurrency()
formatBytes()
formatBandwidth()
formatDate()
formatRelativeTime()
formatIPAddress()
```

Jangan ulang:

```text
new Intl.NumberFormat(...)
```

di 40 component.

---

# 113. MONEY

Jangan menggunakan:

```text
parseFloat
```

sembarangan untuk financial calculation.

Frontend hanya memformat angka yang diberikan backend.

Final calculation backend.

---

# 114. DATE/TIME

Backend gunakan timestamp ISO.

Frontend tampilkan berdasarkan timezone user.

Tooltip dapat menunjukkan timezone.

Contoh:

```text
24 Aug 2026, 07:30 WIB
```

---

# 115. LOADING STATE

Gunakan skeleton untuk:

```text
dashboard
tables
detail pages
cards
```

Jangan seluruh page hanya spinner.

---

# 116. EMPTY STATE

Setiap list harus mempunyai empty state.

Contoh Instance:

```text
No instances yet

Deploy your first cloud server.
[Create Instance]
```

Jangan tampilkan table kosong tanpa penjelasan.

---

# 117. ERROR STATE

Network error:

```text
Unable to load instances.

Reference: req_xxx

[Retry]
```

Tidak boleh blank screen.

---

# 118. NOT FOUND

Route/resource:

```text
404
```

Jika resource tidak ditemukan atau user tidak mempunyai access, ikuti backend semantics.

Jangan membocorkan resource organisasi lain.

---

# 119. CONFIRMATION

Reusable:

```text
ConfirmDialog
```

Level:

```text
normal
warning
danger
```

Danger:

```text
Terminate VPS
Delete Firewall
Delete Snapshot
Revoke API Key
```

---

# 120. TOASTS

Gunakan toast untuk:

```text
success
minor errors
background event
```

Jangan menggunakan toast untuk critical detail yang harus dibaca lama.

---

# 121. ACCESSIBILITY

Wajib:

```text
keyboard navigation
focus state
ARIA
proper label
color contrast
dialog focus trapping
screen reader friendly
```

Jangan membuat clickable `<div>` tanpa semantics.

---

# 122. SECURITY FRONTEND

Frontend tidak boleh:

```text
store password
store OTP
store provider secrets
store secret key in localStorage
log access token
console.log API response sensitif
trust role from localStorage
```

Permission berasal dari backend session/current-user response.

---

# 123. XSS

Hindari:

```text
dangerouslySetInnerHTML
```

kecuali benar-benar diperlukan dan sanitized.

Startup scripts/code ditampilkan sebagai text, bukan HTML.

---

# 124. SECRET DISPLAY COMPONENT

Buat:

```text
SecretDisplay
```

Behavior:

```text
hidden by default
copy
one-time secret warning
clear from state after navigation
```

Untuk:

```text
API key
object storage secret
recovery codes
```

---

# 125. ROUTING USER

Target contoh:

```text
/
/login
/register

/dashboard

/cloud/instances
/cloud/instances/new
/cloud/instances/:id

/cloud/snapshots
/cloud/backups
/cloud/ssh-keys
/cloud/startup-scripts

/network/vpcs
/network/firewalls
/network/ip-lists
/network/reserved-ips

/storage/object-storage
/storage/custom-isos

/billing
/billing/orders
/billing/invoices
/billing/invoices/:id
/billing/payments
/billing/wallet
/billing/subscriptions

/developer/api-keys
/developer/webhooks

/account/profile
/account/addresses
/account/security
/account/sessions
/account/organizations
/account/notifications

/support
/support/:id
```

---

# 126. ROUTING ADMIN

Contoh:

```text
/dashboard

/users
/users/:id

/organizations
/organizations/:id

/cloud/instances
/cloud/instances/:id

/cloud/providers
/cloud/providers/:id

/cloud/regions

/products
/plans
/pricing
/coupons

/billing/orders
/billing/invoices
/billing/payments
/billing/wallet

/operations/jobs
/operations/provider-actions
/operations/reconciliation
/operations/orphans

/support/tickets

/security/audit
/security/events

/system/features
/system/settings
/system/health
```

---

# 127. NAVIGATION PERMISSION

Menu definition sebaiknya data-driven:

```ts
{
  title: 'Invoices',
  path: '/billing/invoices',
  permission: 'billing.read'
}
```

Jika tidak punya permission:

```text
hide menu
```

Tetapi direct URL tetap dicek route guard dan backend.

---

# 128. USER PERMISSION

Backend dapat mengirim:

```text
permissions: [
  "instance.read",
  "instance.create",
  "billing.read"
]
```

Buat:

```text
usePermission()
<Can />
```

Contoh:

```tsx
<Can permission="instance.create">
  <Button>Create Instance</Button>
</Can>
```

Jangan hardcode role sebanyak mungkin.

---

# 129. ADMIN PERMISSION

Contoh:

```text
users.read
users.write

billing.read
billing.adjust

providers.read
providers.write

instances.read
instances.manage

support.read
support.write

security.read
```

UI mengikuti permission.

---

# 130. REALTIME / POLLING

Untuk provisioning:

```text
pending
provisioning
```

gunakan controlled polling.

Contoh:

```text
5s
```

selama resource transitional.

Saat:

```text
active
failed
terminated
```

stop aggressive polling.

Jika backend menyediakan SSE/WebSocket nanti, dapat digunakan.

Jangan polling seluruh dashboard setiap 1 detik seperti manusia sedang mencoba DDoS API miliknya sendiri.

---

# 131. TABLE SYSTEM

Buat reusable `DataTable`.

Support:

```text
loading
empty
pagination
sorting
filter
selection optional
responsive
```

Jangan copy-paste table logic ke semua halaman.

---

# 132. URL SEARCH PARAMS

Filter list harus tersimpan pada URL jika sesuai.

Contoh:

```text
/instances?status=active&region=id-jkt-1
```

Supaya:

```text
refresh
share
back/forward
```

tetap bekerja.

---

# 133. SEARCH

Gunakan debounce.

Jangan request API setiap satu karakter jika tidak perlu.

---

# 134. PAGE HEADER

Reusable:

```text
PageHeader
```

Props:

```text
title
description
breadcrumbs
actions
```

Contoh:

```text
Instances

Manage your cloud compute instances.

[Create Instance]
```

---

# 135. STATUS COMPONENT

Satu `StatusBadge`.

Mapping:

```text
active
pending
provisioning
stopped
suspended
failed
terminated

paid
open
past_due

healthy
degraded
offline
```

Jangan setiap page membuat warna sendiri.

---

# 136. ICON STANDARD

Gunakan Lucide.

Jangan mencampur:

```text
Heroicons
FontAwesome
Material Icons
Lucide
```

dalam satu aplikasi.

---

# 137. PERFORMANCE

Gunakan:

```text
route lazy loading
code splitting
React.lazy jika relevan
memo hanya jika memang dibutuhkan
virtualization untuk list sangat besar
```

Jangan premature memo semuanya.

---

# 138. BUNDLE

Pisahkan heavy dependencies.

Chart/code editor hanya dimuat pada route yang membutuhkan.

---

# 139. TYPESCRIPT

Dilarang menggunakan:

```ts
any
```

tanpa alasan.

Gunakan generated/manual API types yang jelas.

---

# 140. OPENAPI CLIENT

Jika backend Kilat Cloud sudah mempunyai OpenAPI:

prioritaskan menghasilkan typed API client dari **OpenAPI Kilat Cloud**, bukan OpenAPI Onidel.

Frontend tidak boleh berkomunikasi langsung dengan:

```text
api.cloud.onidel.com
```

Semua lewat:

```text
Kilat Cloud Go Backend
```

---

# 141. NO DIRECT PROVIDER API

DILARANG:

```text
Browser
↓
Onidel
```

Harus:

```text
Browser
↓
Kilat Backend
↓
Onidel
```

Onidel API credential tidak boleh berada di frontend.

---

# 142. ENV

User:

```text
VITE_API_BASE_URL
VITE_APP_NAME
VITE_APP_ENV
```

Admin:

```text
VITE_API_BASE_URL
VITE_APP_NAME
VITE_APP_ENV
```

Jangan masukkan secret ke:

```text
VITE_*
```

karena Vite environment variable akan masuk browser bundle.

---

# 143. TESTING

Gunakan:

```text
Vitest
React Testing Library
Playwright
```

Minimal test:

```text
login
register
email verification
phone verification

organization switching

fixed plan checkout
custom VPS pricing

instance provision flow
instance action

API key create/revoke

invoice payment

address form

permission guard

admin user access
admin provider management
```

---

# 144. E2E

Critical E2E:

```text
Register
↓
Verify
↓
Login
↓
Complete Profile
↓
Create Organization
↓
Create VPS
↓
Quote
↓
Checkout
↓
Payment mock
↓
Provision
↓
Open Instance
```

Admin:

```text
Login
↓
Find customer
↓
View order
↓
View instance
↓
View provider action
```

---

# 145. MOCK DATA

Mock hanya untuk development/testing.

Production frontend tidak boleh diam-diam fallback ke fake data jika API gagal.

Jika API gagal:

```text
show error
```

bukan membuat seolah-olah sistem sehat.

---

# 146. DESIGN SYSTEM CONSISTENCY

Gunakan token untuk:

```text
spacing
radius
font size
border
background
muted
danger
warning
success
```

Jangan menulis arbitrary value di setiap component.

---

# 147. USER VS ADMIN DESIGN

User Console:

```text
clean
easy
customer friendly
developer friendly
```

Admin Console:

```text
denser
operational
data-heavy
high information visibility
```

Tetapi typography dan base design tetap satu keluarga Kilat Cloud.

---

# 148. MOBILE USER

Pada mobile sidebar berubah menjadi drawer.

Critical pages mobile-friendly:

```text
dashboard
instance list
instance detail
invoice
wallet
support
profile
notifications
```

Custom VM builder boleh menggunakan stacked layout.

---

# 149. MOBILE ADMIN

Admin tetap dapat digunakan mobile untuk:

```text
view status
ticket
basic investigation
```

Tetapi operasi kompleks boleh lebih optimal desktop.

---

# 150. COMMAND PALETTE

Tambahkan command palette jika sesuai.

Contoh:

```text
⌘ K
```

Search:

```text
Instances
Invoices
Users admin
Pages
Actions
```

Jangan expose action tanpa permission.

---

# 151. GLOBAL SEARCH ADMIN

Admin global search:

```text
User
Email
Organization
Instance ID
Invoice
Order
IP Address
```

Gunakan backend search endpoint.

Jangan download seluruh database lalu search client-side.

---

# 152. BREADCRUMBS

Contoh:

```text
Cloud
>
Instances
>
vm_abcd123
```

Reusable component.

---

# 153. UNSAVED CHANGES

Form besar:

```text
pricing
provider
firewall
profile
```

harus warning jika user meninggalkan page dengan perubahan belum disimpan jika memang relevan.

---

# 154. DESTRUCTIVE UI

Gunakan warna danger hanya untuk destructive action.

Jangan semua tombol admin merah sehingga merah kehilangan arti.

---

# 155. COPY UX

IP, UUID, API prefix, hostname:

```text
203.0.113.1 [copy]
```

Gunakan reusable CopyButton.

---

# 156. IP DISPLAY

IPv6 panjang harus:

```text
truncate visual
```

tetapi full value tersedia pada:

```text
tooltip
copy
```

---

# 157. SENSITIVE VALUES

Mask:

```text
API key
secret key
TOTP
provider credential
```

IP address bukan otomatis secret.

---

# 158. AUDIT FRONTEND IMPLEMENTATION

Sebelum coding:

buat laporan:

```text
A. Existing frontend files
B. Existing components
C. Existing routes
D. Existing hooks
E. Existing API clients
F. Existing schemas/types
G. Duplicate components
H. Duplicate pages
I. Missing features
J. Dead code
K. Backend endpoint coverage
L. Migration/refactor plan
```

Jangan langsung overwrite project.

---

# 159. BACKEND COVERAGE MATRIX

Buat matrix:

```text
Backend Endpoint
→ User/Admin
→ Page
→ Hook
→ Query/Mutation
→ Permission
→ Implemented
```

Contoh:

```text
GET /instances
→ User
→ InstanceList
→ useInstances
→ query
→ instances.read
→ yes
```

Semua backend endpoint harus mempunyai keputusan eksplisit:

```text
UI
background only
admin only
not exposed
```

---

# 160. JANGAN DUPLIKASI BACKEND DOMAIN

Gunakan nama backend.

Jika backend menggunakan:

```text
instances
```

jangan frontend berubah menjadi:

```text
servers
vpsMachines
virtualServers
```

secara acak.

Display text boleh "VPS", tetapi internal domain harus konsisten.

---

# 161. ERROR BOUNDARY

Tambahkan React error boundary.

Unexpected frontend crash:

```text
Something went wrong.
Reference...
Reload
```

Jangan blank white screen.

---

# 162. OFFLINE / NETWORK

Jika browser offline:

tampilkan:

```text
You appear to be offline.
```

Jangan memproses destructive operation.

---

# 163. MAINTENANCE

Jika backend/service maintenance:

tampilkan status contextual.

Misalnya provider region maintenance:

```text
Region temporarily unavailable for new deployments.
Existing servers remain accessible.
```

berdasarkan backend response.

---

# 164. FEATURE AVAILABILITY

Capability provider berbeda.

Jangan menganggap setiap instance support:

```text
BGP
Measured Boot
Custom ISO
IPv6
Reserved IP
```

Backend harus mengirim capabilities.

UI hanya menampilkan feature jika available.

---

# 165. INSTANCE CAPABILITIES

Ideal response:

```text
capabilities: {
  snapshot: true,
  backup_restore: true,
  bgp: false,
  measured_boot: true,
  rdns: true
}
```

Frontend mengikuti.

Jangan hardcode berdasarkan provider name.

---

# 166. ADMIN CAPABILITIES

Admin provider detail dapat memperlihatkan capabilities.

Tetapi customer tetap melihat abstractions Kilat Cloud.

---

# 167. ACCESS DENIED

403 page:

```text
You don't have permission to access this page.
```

Jangan cuma redirect diam-diam ke dashboard karena user akan bingung seperti biasa ketika software memutuskan informasi bukan kebutuhan manusia.

---

# 168. BILLING SAFETY

Saat checkout:

double click tombol bayar/order tidak boleh membuat duplicate.

UI:

```text
disable submit while request processing
```

Backend idempotency tetap final protection.

Gunakan idempotency key untuk mutation penting jika backend contract mendukung.

---

# 169. MUTATION REQUEST ID

Untuk create order/provision action:

generate/forward idempotency identifier sesuai backend contract.

Jangan generate ulang ketika retry request yang sama.

---

# 170. ACTIVITY TIMELINE

Resource detail seperti VM/order dapat menggunakan:

```text
Timeline
```

Contoh:

```text
07:10 Order paid
07:10 Provision queued
07:11 Provision started
07:12 IP assigned
07:12 Instance active
```

Sangat berguna untuk support.

---

# 171. ADMIN TRACE

Admin harus dapat mengikuti:

```text
User
→ Quote
→ Order
→ Invoice
→ Payment
→ Job
→ Provider Action
→ Instance
```

dari satu order.

Tambahkan internal links antar-resource.

---

# 172. SKELETON IMPLEMENTATION ORDER

Kerjakan berurutan.

## Phase 1

Audit project existing.

## Phase 2

Setup:

```text
user/
admin/
```

## Phase 3

Design system.

## Phase 4

API client.

## Phase 5

Auth.

## Phase 6

User/profile/security.

## Phase 7

Organizations/RBAC.

## Phase 8

Catalog + pricing.

## Phase 9

Create VM wizard.

## Phase 10

Instances.

## Phase 11

Networking.

## Phase 12

Snapshot/backup/storage.

## Phase 13

Billing.

## Phase 14

Developer/API key/webhook.

## Phase 15

Support/notification.

## Phase 16

Admin base.

## Phase 17

Admin customer management.

## Phase 18

Admin cloud operations.

## Phase 19

Admin products/pricing.

## Phase 20

Admin billing.

## Phase 21

Admin jobs/reconciliation/security.

## Phase 22

Responsive/accessibility.

## Phase 23

Tests.

## Phase 24

Performance/hardening.

---

# 173. SETIAP PHASE

Untuk setiap phase:

1. Periksa implementasi existing.
2. Jangan duplicate.
3. Sebutkan file yang berubah.
4. Implementasikan.
5. Run TypeScript check.
6. Run lint.
7. Run tests.
8. Perbaiki error.
9. Baru lanjut.

---

# 174. WAJIB RUN

Untuk masing-masing aplikasi:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Jika package manager project memakai:

```text
pnpm
```

gunakan pnpm secara konsisten.

Jangan campur npm/pnpm/yarn lock file.

---

# 175. NO PLACEHOLDER CRITICAL

Jangan tinggalkan:

```text
TODO: implement login
TODO: fetch VPS
TODO: implement payment
TODO: admin permission
```

untuk fitur yang sedang dikerjakan.

Jangan membuat tombol:

```text
Delete
```

yang tidak melakukan apa-apa.

Jika backend belum support:

disable/hide dan jelaskan dalam audit.

---

# 176. NO FAKE SUCCESS

Dilarang:

```text
try {
  ...
} catch {
  toast.success("Success")
}
```

UI sukses hanya setelah backend mengonfirmasi sukses.

---

# 177. FRONTEND TIDAK MENENTUKAN BUSINESS RULE

Frontend boleh membantu validation.

Tetapi authority berada pada backend untuk:

```text
price
discount
tax
availability
quota
resource ownership
permission
status transition
payment
wallet
provider capability
```

---

# 178. OUTPUT YANG SAYA INGINKAN DARI CODING AGENT

Sebelum coding, berikan:

## 1. Audit

```text
existing structure
duplicate components
duplicate routes
backend coverage
missing frontend features
```

## 2. Proposed architecture

```text
user/
admin/
```

beserta feature tree.

## 3. Implementation matrix

Backend → Frontend.

## 4. Implementasi aktual

Bukan hanya proposal.

## 5. Testing result

Tampilkan:

```text
typecheck
lint
test
build
```

## 6. Remaining gaps

Hanya gap yang benar-benar tergantung backend/missing requirement.

---

# 179. DEFINITION OF DONE USER

User frontend dianggap selesai jika:

- Register bekerja.
- Login bekerja.
- Email verification bekerja.
- Phone verification bekerja.
- Forgot/reset password bekerja.
- MFA/passkey UI bekerja.
- Session manager bekerja.
- Profile bekerja.
- Email change bekerja.
- Phone change bekerja.
- Address bekerja.
- Organization switch bekerja.
- RBAC UI bekerja.
- API keys bekerja.
- Dashboard bekerja.
- Fixed plan order bekerja.
- Custom VPS builder bekerja.
- Quote bekerja.
- Checkout bekerja.
- Instance list bekerja.
- Instance detail bekerja.
- Instance actions bekerja.
- Console bekerja.
- VPC bekerja.
- Firewall bekerja.
- IP List bekerja.
- Reserved IP bekerja.
- rDNS bekerja.
- SSH key bekerja.
- Snapshot bekerja.
- Backup bekerja.
- Startup script bekerja.
- Custom ISO bekerja.
- Object storage bekerja.
- Wallet bekerja.
- Orders bekerja.
- Invoice bekerja.
- Payment bekerja.
- Subscription bekerja.
- Notification bekerja.
- Support bekerja.
- Webhook bekerja.
- Permission bekerja.
- Responsive bekerja.
- Dark/light mode bekerja.
- Loading/error/empty state lengkap.
- Build tanpa error.

---

# 180. DEFINITION OF DONE ADMIN

Admin selesai jika:

- Admin auth/permission bekerja.
- Dashboard bekerja.
- User management bekerja.
- Organization management bekerja.
- Provider management bekerja.
- Region management bekerja.
- Product management bekerja.
- Plan management bekerja.
- Custom pricing management bekerja.
- Coupon bekerja.
- Order inspection bekerja.
- Invoice management bekerja.
- Payment inspection bekerja.
- Instance operations bekerja.
- Provider actions bekerja.
- Job monitor bekerja.
- Reconciliation bekerja.
- Orphan resource inspection bekerja.
- Support bekerja.
- Audit log bekerja.
- Security events bekerja.
- Feature flags bekerja.
- System health bekerja.
- Tidak ada secret bocor.
- Semua critical admin actions mempunyai confirmation + audit.
- Build tanpa error.

---

# 181. TARGET AKHIR

Arsitektur akhir:

```text
                    CUSTOMER
                       │
                       ▼
              ┌─────────────────┐
              │ React User App  │
              └────────┬────────┘
                       │
                       │
                  HTTPS API
                       │
                       ▼
              ┌─────────────────┐
              │ Go Backend API  │
              └────────┬────────┘
                       │
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
     PostgreSQL      Redis          R2/S3
          │
          ▼
     Worker / Jobs
          │
          ▼
   Provider Abstraction
          │
          ▼
        Onidel


                    OPERATOR
                       │
                       ▼
             ┌──────────────────┐
             │ React Admin App  │
             └────────┬─────────┘
                      │
                      ▼
               Go Backend API
```

`user/` dan `admin/` **tidak pernah memanggil Onidel secara langsung**.

Semua komunikasi provider melewati backend Go.

Frontend tidak boleh memiliki:

```text
ONIDEL_API_KEY
R2_SECRET_KEY
DATABASE_URL
JWT_PRIVATE_KEY
PAYMENT_SECRET
SMTP_PASSWORD
```

---

# 182. PRINSIP TERAKHIR

Prioritaskan:

```text
Consistency
No duplication
Security
Reusable components
Strong typing
Backend contract compliance
Good UX
Clear resource states
Good error handling
Permission-aware UI
Responsive design
Maintainability
Performance
Accessibility
```

Jangan membangun frontend sebagai kumpulan halaman yang kebetulan bisa berpindah route.

Bangun sebagai **cloud management console yang terstruktur**, dengan dua aplikasi React:

```text
user/
admin/
```

yang sepenuhnya mengikuti domain dan flow backend Kilat Cloud.

User console harus cukup sederhana untuk customer biasa tetapi tetap kuat untuk developer.

Admin console harus memberi operator kemampuan mengelola, memantau, menelusuri, dan menyelesaikan masalah dari:

```text
User
↓
Order
↓
Invoice
↓
Payment
↓
Provisioning Job
↓
Provider Action
↓
Cloud Resource
```

tanpa membuat data ganda, logic ganda, komponen ganda, API client ganda, atau sumber kebenaran yang saling bertentangan.





---
title: Components
description: Here you can find all the components available in the library. We are working on adding more components.
---

## New Components

- [Questionnaire](https://ui.shadcn.com/docs/components/questionnaire): A multi-step questionnaire with single-choice, multiple-choice, freeform, and skippable questions.

## All Components

- [Accordion](https://ui.shadcn.com/docs/components/accordion): A vertically stacked set of interactive headings that each reveal a section of content.
- [Alert](https://ui.shadcn.com/docs/components/alert): Displays a callout for user attention.
- [Alert Dialog](https://ui.shadcn.com/docs/components/alert-dialog): A modal dialog that interrupts the user with important content and expects a response.
- [Aspect Ratio](https://ui.shadcn.com/docs/components/aspect-ratio): Displays content within a desired ratio.
- [Attachment](https://ui.shadcn.com/docs/components/attachment): Displays a file or image attachment with media, metadata, upload state, and actions.
- [Avatar](https://ui.shadcn.com/docs/components/avatar): An image element with a fallback for representing the user.
- [Badge](https://ui.shadcn.com/docs/components/badge): Displays a badge or a component that looks like a badge.
- [Breadcrumb](https://ui.shadcn.com/docs/components/breadcrumb): Displays the path to the current resource using a hierarchy of links.
- [Bubble](https://ui.shadcn.com/docs/components/bubble): Displays conversational content in a message bubble. Supports variants, alignment, grouping, reactions, and collapsible content.
- [Button](https://ui.shadcn.com/docs/components/button): Displays a button or a component that looks like a button.
- [Button Group](https://ui.shadcn.com/docs/components/button-group): A container that groups related buttons together with consistent styling.
- [Calendar](https://ui.shadcn.com/docs/components/calendar): A calendar component that allows users to select a date or a range of dates.
- [Card](https://ui.shadcn.com/docs/components/card): Displays a card with header, content, and footer.
- [Carousel](https://ui.shadcn.com/docs/components/carousel): A carousel with motion and swipe built using Embla.
- [Chart](https://ui.shadcn.com/docs/components/chart): Beautiful charts. Built using Recharts. Copy and paste into your apps.
- [Checkbox](https://ui.shadcn.com/docs/components/checkbox): A control that allows the user to toggle between checked and not checked.
- [Collapsible](https://ui.shadcn.com/docs/components/collapsible): An interactive component which expands/collapses a panel.
- [Combobox](https://ui.shadcn.com/docs/components/combobox): Autocomplete input with a list of suggestions.
- [Command](https://ui.shadcn.com/docs/components/command): Command menu for search and quick actions.
- [Context Menu](https://ui.shadcn.com/docs/components/context-menu): Displays a menu of actions triggered by a right click.
- [Data Table](https://ui.shadcn.com/docs/components/data-table): Powerful table and datagrids built using TanStack Table.
- [Date Picker](https://ui.shadcn.com/docs/components/date-picker): A date picker component with range and presets.
- [Dialog](https://ui.shadcn.com/docs/components/dialog): A window overlaid on either the primary window or another dialog window, rendering the content underneath inert.
- [Direction](https://ui.shadcn.com/docs/components/direction): A provider component that sets the text direction for your application.
- [Drawer](https://ui.shadcn.com/docs/components/drawer): A drawer component for React.
- [Dropdown Menu](https://ui.shadcn.com/docs/components/dropdown-menu): Displays a menu to the user — such as a set of actions or functions — triggered by a button.
- [Empty](https://ui.shadcn.com/docs/components/empty): Use the Empty component to display an empty state.
- [Field](https://ui.shadcn.com/docs/components/field): Combine labels, controls, and help text to compose accessible form fields and grouped inputs.
- [Hover Card](https://ui.shadcn.com/docs/components/hover-card): For sighted users to preview content available behind a link.
- [Input](https://ui.shadcn.com/docs/components/input): A text input component for forms and user data entry with built-in styling and accessibility features.
- [Input Group](https://ui.shadcn.com/docs/components/input-group): Add addons, buttons, and helper content to inputs.
- [Input OTP](https://ui.shadcn.com/docs/components/input-otp): Accessible one-time password component with copy-paste functionality.
- [Item](https://ui.shadcn.com/docs/components/item): A versatile component for displaying content with media, title, description, and actions.
- [Kbd](https://ui.shadcn.com/docs/components/kbd): Used to display textual user input from keyboard.
- [Label](https://ui.shadcn.com/docs/components/label): Renders an accessible label associated with controls.
- [Marker](https://ui.shadcn.com/docs/components/marker): Displays an inline status, system note, bordered row, or labeled separator in a conversation.
- [Menubar](https://ui.shadcn.com/docs/components/menubar): A visually persistent menu common in desktop applications that provides quick access to a consistent set of commands.
- [Message](https://ui.shadcn.com/docs/components/message): Displays a message in a conversation, with optional avatar, header, footer, and alignment.
- [Message Scroller](https://ui.shadcn.com/docs/components/message-scroller): A chat scroll container that anchors turns, opens saved transcripts, follows streamed responses, loads history without jumping, and jumps to any message.
- [Native Select](https://ui.shadcn.com/docs/components/native-select): A styled native HTML select element with consistent design system integration.
- [Navigation Menu](https://ui.shadcn.com/docs/components/navigation-menu): A collection of links for navigating websites.
- [Pagination](https://ui.shadcn.com/docs/components/pagination): Pagination with page navigation, next and previous links.
- [Popover](https://ui.shadcn.com/docs/components/popover): Displays rich content in a portal, triggered by a button.
- [Progress](https://ui.shadcn.com/docs/components/progress): Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.
- [Questionnaire](https://ui.shadcn.com/docs/components/questionnaire): A multi-step questionnaire with single-choice, multiple-choice, freeform, and skippable questions.
- [Radio Group](https://ui.shadcn.com/docs/components/radio-group): A set of checkable buttons—known as radio buttons—where no more than one of the buttons can be checked at a time.
- [Resizable](https://ui.shadcn.com/docs/components/resizable): Accessible resizable panel groups and layouts with keyboard support.
- [Scroll Area](https://ui.shadcn.com/docs/components/scroll-area): Augments native scroll functionality for custom, cross-browser styling.
- [Select](https://ui.shadcn.com/docs/components/select): Displays a list of options for the user to pick from—triggered by a button.
- [Separator](https://ui.shadcn.com/docs/components/separator): Visually or semantically separates content.
- [Sheet](https://ui.shadcn.com/docs/components/sheet): Extends the Dialog component to display content that complements the main content of the screen.
- [Sidebar](https://ui.shadcn.com/docs/components/sidebar): A composable, themeable and customizable sidebar component.
- [Skeleton](https://ui.shadcn.com/docs/components/skeleton): Use to show a placeholder while content is loading.
- [Slider](https://ui.shadcn.com/docs/components/slider): An input where the user selects a value from within a given range.
- [Spinner](https://ui.shadcn.com/docs/components/spinner): An indicator that can be used to show a loading state.
- [Switch](https://ui.shadcn.com/docs/components/switch): A control that allows the user to toggle between checked and not checked.
- [Table](https://ui.shadcn.com/docs/components/table): A responsive table component.
- [Tabs](https://ui.shadcn.com/docs/components/tabs): A set of layered sections of content—known as tab panels—that are displayed one at a time.
- [Textarea](https://ui.shadcn.com/docs/components/textarea): Displays a form textarea or a component that looks like a textarea.
- [Toast](https://ui.shadcn.com/docs/components/toast): A succinct message that is displayed temporarily.
- [Toggle](https://ui.shadcn.com/docs/components/toggle): A two-state button that can be either on or off.
- [Toggle Group](https://ui.shadcn.com/docs/components/toggle-group): A set of two-state buttons that can be toggled on or off.
- [Tooltip](https://ui.shadcn.com/docs/components/tooltip): A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.
- [Typography](https://ui.shadcn.com/docs/components/typography): Styles for headings, paragraphs, lists, etc.

---

Can't find what you need? Try the [registry directory](/docs/directory) for community-maintained components.
---
title: Installation
description: How to install dependencies and structure your app.
---

<Callout className="mb-6 border-emerald-600 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-900">

**Recommended for new projects:** Use [shadcn/create](/create) to build your preset visually and generate the right setup command for your framework.

</Callout>

Choose the setup that matches your starting point.

<div className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-6">
  <LinkedCard
    href="#use-create"
    className="items-start gap-1 p-6 text-sm md:p-6"
  >
    <div className="font-medium">Use shadcn/create</div>
    <div className="leading-relaxed text-muted-foreground">
      Build your preset visually and generate a setup command.
    </div>
  </LinkedCard>
  <LinkedCard href="#use-cli" className="items-start gap-1 p-6 text-sm md:p-6">
    <div className="font-medium">Use the CLI</div>
    <div className="leading-relaxed text-muted-foreground">
      Scaffold a supported template directly from the terminal.
    </div>
  </LinkedCard>
  <LinkedCard
    href="#existing-project"
    className="items-start gap-1 p-6 text-sm md:p-6"
  >
    <div className="font-medium">Existing Project</div>
    <div className="leading-relaxed text-muted-foreground">
      Add shadcn/ui to an app you already created.
    </div>
  </LinkedCard>
</div>

<div id="use-create" className="scroll-mt-24" />
## Use shadcn/create

Build your preset visually, preview your choices, and generate a framework-specific setup command.

<Button asChild size="sm">
  <Link
    href="/create"
    target="_blank"
    rel="noopener noreferrer"
    className="mt-6 no-underline!"
  >
    Open shadcn/create
  </Link>
</Button>

Available for Next.js, Vite, Laravel, React Router, Astro, and TanStack Start.

<div id="use-cli" className="scroll-mt-24" />
## Use the CLI

Use the CLI to scaffold a new project directly from the terminal:

```bash
npx shadcn@latest init -t [framework]
```

Supported templates: `next`, `vite`, `start`, `react-router`, and `astro`.

For Laravel, create the app first with `laravel new`, then run `npx shadcn@latest init`.

<div id="existing-project" className="scroll-mt-24" />
## Existing Project

Each framework guide includes an `Existing Project` section with the manual setup steps for that framework.

Pick your framework below and follow that path.

## Choose Your Framework

For Laravel, start with `laravel new` before using `shadcn/create` or `shadcn init`.

<div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6">
  <LinkedCard href="/docs/installation/next">
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10"
      fill="currentColor"
    >
      <title>Next.js</title>
      <path d="M11.5725 0c-.1763 0-.3098.0013-.3584.0067-.0516.0053-.2159.021-.3636.0328-3.4088.3073-6.6017 2.1463-8.624 4.9728C1.1004 6.584.3802 8.3666.1082 10.255c-.0962.659-.108.8537-.108 1.7474s.012 1.0884.108 1.7476c.652 4.506 3.8591 8.2919 8.2087 9.6945.7789.2511 1.6.4223 2.5337.5255.3636.04 1.9354.04 2.299 0 1.6117-.1783 2.9772-.577 4.3237-1.2643.2065-.1056.2464-.1337.2183-.1573-.0188-.0139-.8987-1.1938-1.9543-2.62l-1.919-2.592-2.4047-3.5583c-1.3231-1.9564-2.4117-3.556-2.4211-3.556-.0094-.0026-.0187 1.5787-.0235 3.509-.0067 3.3802-.0093 3.5162-.0516 3.596-.061.115-.108.1618-.2064.2134-.075.0374-.1408.0445-.495.0445h-.406l-.1078-.068a.4383.4383 0 01-.1572-.1712l-.0493-.1056.0053-4.703.0067-4.7054.0726-.0915c.0376-.0493.1174-.1125.1736-.143.0962-.047.1338-.0517.5396-.0517.4787 0 .5584.0187.6827.1547.0353.0377 1.3373 1.9987 2.895 4.3608a10760.433 10760.433 0 004.7344 7.1706l1.9002 2.8782.096-.0633c.8518-.5536 1.7525-1.3418 2.4657-2.1627 1.5179-1.7429 2.4963-3.868 2.8247-6.134.0961-.6591.1078-.854.1078-1.7475 0-.8937-.012-1.0884-.1078-1.7476-.6522-4.506-3.8592-8.2919-8.2087-9.6945-.7672-.2487-1.5836-.42-2.4985-.5232-.169-.0176-1.0835-.0366-1.6123-.037zm4.0685 7.217c.3473 0 .4082.0053.4857.047.1127.0562.204.1642.237.2767.0186.061.0234 1.3653.0186 4.3044l-.0067 4.2175-.7436-1.14-.7461-1.14v-3.066c0-1.982.0093-3.0963.0234-3.1502.0375-.1313.1196-.2346.2323-.2955.0961-.0494.1313-.054.4997-.054z" />
    </svg>
    <p className="mt-2 font-medium">Next.js</p>
  </LinkedCard>
  <LinkedCard href="/docs/installation/vite">
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10"
      fill="currentColor"
    >
      <title>Vite</title>
      <path d="m8.286 10.578.512-8.657a.306.306 0 0 1 .247-.282L17.377.006a.306.306 0 0 1 .353.385l-1.558 5.403a.306.306 0 0 0 .352.385l2.388-.46a.306.306 0 0 1 .332.438l-6.79 13.55-.123.19a.294.294 0 0 1-.252.14c-.177 0-.35-.152-.305-.369l1.095-5.301a.306.306 0 0 0-.388-.355l-1.433.435a.306.306 0 0 1-.389-.354l.69-3.375a.306.306 0 0 0-.37-.36l-2.32.536a.306.306 0 0 1-.374-.316zm14.976-7.926L17.284 3.74l-.544 1.887 2.077-.4a.8.8 0 0 1 .84.369.8.8 0 0 1 .034.783L12.9 19.93l-.013.025-.015.023-.122.19a.801.801 0 0 1-.672.37.826.826 0 0 1-.634-.302.8.8 0 0 1-.16-.67l1.029-4.981-1.12.34a.81.81 0 0 1-.86-.262.802.802 0 0 1-.165-.67l.63-3.08-2.027.468a.808.808 0 0 1-.768-.233.81.81 0 0 1-.217-.6l.389-6.57-7.44-1.33a.612.612 0 0 0-.64.906L11.58 23.691a.612.612 0 0 0 1.066-.004l11.26-20.135a.612.612 0 0 0-.644-.9z" />
    </svg>
    <p className="mt-2 font-medium">Vite</p>
  </LinkedCard>

<LinkedCard href="/docs/installation/tanstack">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="h-10 w-10"
    fill="currentColor"
  >
    <path d="M6.93 13.688a.343.343 0 0 1 .468.132l.063.106c.48.851.98 1.66 1.5 2.426a35.65 35.65 0 0 0 2.074 2.742.345.345 0 0 1-.039.484l-.074.066c-2.543 2.223-4.191 2.665-4.953 1.333-.746-1.305-.477-3.672.808-7.11a.344.344 0 0 1 .153-.18ZM17.75 16.3a.34.34 0 0 1 .395.27l.02.1c.628 3.286.187 4.93-1.325 4.93-1.48 0-3.36-1.402-5.649-4.203a.327.327 0 0 1-.074-.222c0-.188.156-.34.344-.34h.121a32.984 32.984 0 0 0 2.809-.098c1.07-.086 2.191-.23 3.359-.437zm.871-6.977a.353.353 0 0 1 .445-.21l.102.034c3.262 1.11 4.504 2.332 3.719 3.664-.766 1.305-2.993 2.254-6.684 2.848a.362.362 0 0 1-.238-.047.343.343 0 0 1-.125-.476l.062-.106a34.07 34.07 0 0 0 1.367-2.523c.477-.989.93-2.051 1.352-3.184zM7.797 8.34a.362.362 0 0 1 .238.047.343.343 0 0 1 .125.476l-.062.106a34.088 34.088 0 0 0-1.367 2.523c-.477.988-.93 2.051-1.352 3.184a.353.353 0 0 1-.445.21l-.102-.034C1.57 13.742.328 12.52 1.113 11.188 1.88 9.883 4.106 8.934 7.797 8.34Zm5.281-3.984c2.543-2.223 4.192-2.664 4.953-1.332.746 1.304.477 3.671-.808 7.109a.344.344 0 0 1-.153.18.343.343 0 0 1-.468-.133l-.063-.106a34.64 34.64 0 0 0-1.5-2.426 35.65 35.65 0 0 0-2.074-2.742.345.345 0 0 1 .039-.484ZM7.285 2.274c1.48 0 3.364 1.402 5.649 4.203a.349.349 0 0 1 .078.218.348.348 0 0 1-.348.344l-.117-.004a34.584 34.584 0 0 0-2.809.102 35.54 35.54 0 0 0-3.363.437.343.343 0 0 1-.394-.273l-.02-.098c-.629-3.285-.188-4.93 1.324-4.93Zm2.871 5.812h3.688a.638.638 0 0 1 .55.316l1.848 3.22a.644.644 0 0 1 0 .628l-1.847 3.223a.638.638 0 0 1-.551.316h-3.688a.627.627 0 0 1-.547-.316L7.758 12.25a.644.644 0 0 1 0-.629L9.61 8.402a.627.627 0 0 1 .546-.316Zm3.23.793a.638.638 0 0 1 .552.316l1.39 2.426a.644.644 0 0 1 0 .629l-1.39 2.43a.638.638 0 0 1-.551.316h-2.774a.627.627 0 0 1-.546-.316l-1.395-2.43a.644.644 0 0 1 0-.629l1.395-2.426a.627.627 0 0 1 .546-.316Zm-.491.867h-1.79a.624.624 0 0 0-.546.316l-.899 1.56a.644.644 0 0 0 0 .628l.899 1.563a.632.632 0 0 0 .547.316h1.789a.632.632 0 0 0 .547-.316l.898-1.563a.644.644 0 0 0 0-.629l-.898-1.558a.624.624 0 0 0-.547-.317Zm-.477.828c.227 0 .438.121.547.317l.422.73a.625.625 0 0 1 0 .629l-.422.734a.627.627 0 0 1-.547.317h-.836a.632.632 0 0 1-.547-.317l-.422-.734a.625.625 0 0 1 0-.629l.422-.73a.632.632 0 0 1 .547-.317zm-.418.817a.548.548 0 0 0-.473.273.547.547 0 0 0 0 .547.544.544 0 0 0 .473.27.544.544 0 0 0 .473-.27.547.547 0 0 0 0-.547.548.548 0 0 0-.473-.273Zm-4.422.546h.98M18.98 7.75c.391-1.895.477-3.344.223-4.398-.148-.63-.422-1.137-.84-1.508-.441-.39-1-.582-1.625-.582-1.035 0-2.12.472-3.281 1.367a14.9 14.9 0 0 0-1.473 1.316 1.206 1.206 0 0 0-.136-.144c-1.446-1.285-2.66-2.082-3.7-2.39-.617-.184-1.195-.2-1.722-.024-.559.187-1.004.574-1.317 1.117-.515.894-.652 2.074-.46 3.527.078.59.214 1.235.402 1.934a1.119 1.119 0 0 0-.215.047C3.008 8.62 1.71 9.269.926 10.015c-.465.442-.77.938-.883 1.481-.113.578 0 1.156.312 1.7.516.894 1.465 1.597 2.817 2.155.543.223 1.156.426 1.844.61a1.023 1.023 0 0 0-.07.226c-.391 1.891-.477 3.344-.223 4.395.148.629.425 1.14.84 1.508.44.39 1 .582 1.625.582 1.035 0 2.12-.473 3.28-1.364.477-.37.973-.816 1.489-1.336a1.2 1.2 0 0 0 .195.227c1.446 1.285 2.66 2.082 3.7 2.39.617.184 1.195.2 1.722.024.559-.187 1.004-.574 1.317-1.117.515-.894.652-2.074.46-3.527a14.941 14.941 0 0 0-.425-2.012 1.225 1.225 0 0 0 .238-.047c1.828-.61 3.125-1.258 3.91-2.004.465-.441.77-.937.883-1.48.113-.578 0-1.157-.313-1.7-.515-.894-1.464-1.597-2.816-2.156a14.576 14.576 0 0 0-1.906-.625.865.865 0 0 0 .059-.195z" />
  </svg>
  <p className="mt-2 font-medium">TanStack Start</p>
</LinkedCard>
<LinkedCard href="/docs/installation/laravel">
  <svg
    role="img"
    viewBox="0 0 62 65"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10"
  >
    <path d="M61.8548 14.6253C61.8778 14.7102 61.8895 14.7978 61.8897 14.8858V28.5615C61.8898 28.737 61.8434 28.9095 61.7554 29.0614C61.6675 29.2132 61.5409 29.3392 61.3887 29.4265L49.9104 36.0351V49.1337C49.9104 49.4902 49.7209 49.8192 49.4118 49.9987L25.4519 63.7916C25.3971 63.8227 25.3372 63.8427 25.2774 63.8639C25.255 63.8714 25.2338 63.8851 25.2101 63.8913C25.0426 63.9354 24.8666 63.9354 24.6991 63.8913C24.6716 63.8838 24.6467 63.8689 24.6205 63.8589C24.5657 63.8389 24.5084 63.8215 24.456 63.7916L0.501061 49.9987C0.348882 49.9113 0.222437 49.7853 0.134469 49.6334C0.0465019 49.4816 0.000120578 49.3092 0 49.1337L0 8.10652C0 8.01678 0.0124642 7.92953 0.0348998 7.84477C0.0423783 7.8161 0.0598282 7.78993 0.0697995 7.76126C0.0884958 7.70891 0.105946 7.65531 0.133367 7.6067C0.152063 7.5743 0.179485 7.54812 0.20192 7.51821C0.230588 7.47832 0.256763 7.43719 0.290416 7.40229C0.319084 7.37362 0.356476 7.35243 0.388883 7.32751C0.425029 7.29759 0.457436 7.26518 0.498568 7.2415L12.4779 0.345059C12.6296 0.257786 12.8015 0.211853 12.9765 0.211853C13.1515 0.211853 13.3234 0.257786 13.475 0.345059L25.4531 7.2415H25.4556C25.4955 7.26643 25.5292 7.29759 25.5653 7.32626C25.5977 7.35119 25.6339 7.37362 25.6625 7.40104C25.6974 7.43719 25.7224 7.47832 25.7523 7.51821C25.7735 7.54812 25.8021 7.5743 25.8196 7.6067C25.8483 7.65656 25.8645 7.70891 25.8844 7.76126C25.8944 7.78993 25.9118 7.8161 25.9193 7.84602C25.9423 7.93096 25.954 8.01853 25.9542 8.10652V33.7317L35.9355 27.9844V14.8846C35.9355 14.7973 35.948 14.7088 35.9704 14.6253C35.9792 14.5954 35.9954 14.5692 36.0053 14.5405C36.0253 14.4882 36.0427 14.4346 36.0702 14.386C36.0888 14.3536 36.1163 14.3274 36.1375 14.2975C36.1674 14.2576 36.1923 14.2165 36.2272 14.1816C36.2559 14.1529 36.292 14.1317 36.3244 14.1068C36.3618 14.0769 36.3942 14.0445 36.4341 14.0208L48.4147 7.12434C48.5663 7.03694 48.7383 6.99094 48.9133 6.99094C49.0883 6.99094 49.2602 7.03694 49.4118 7.12434L61.3899 14.0208C61.4323 14.0457 61.4647 14.0769 61.5021 14.1055C61.5333 14.1305 61.5694 14.1529 61.5981 14.1803C61.633 14.2165 61.6579 14.2576 61.6878 14.2975C61.7103 14.3274 61.7377 14.3536 61.7551 14.386C61.7838 14.4346 61.8 14.4882 61.8199 14.5405C61.8312 14.5692 61.8474 14.5954 61.8548 14.6253ZM59.893 27.9844V16.6121L55.7013 19.0252L49.9104 22.3593V33.7317L59.8942 27.9844H59.893ZM47.9149 48.5566V37.1768L42.2187 40.4299L25.953 49.7133V61.2003L47.9149 48.5566ZM1.99677 9.83281V48.5566L23.9562 61.199V49.7145L12.4841 43.2219L12.4804 43.2194L12.4754 43.2169C12.4368 43.1945 12.4044 43.1621 12.3682 43.1347C12.3371 43.1097 12.3009 43.0898 12.2735 43.0624L12.271 43.0586C12.2386 43.0275 12.2162 42.9888 12.1887 42.9539C12.1638 42.9203 12.1339 42.8916 12.114 42.8567L12.1127 42.853C12.0903 42.8156 12.0766 42.7707 12.0604 42.7283C12.0442 42.6909 12.023 42.656 12.013 42.6161C12.0005 42.5688 11.998 42.5177 11.9931 42.4691C11.9881 42.4317 11.9781 42.3943 11.9781 42.3569V15.5801L6.18848 12.2446L1.99677 9.83281ZM12.9777 2.36177L2.99764 8.10652L12.9752 13.8513L22.9541 8.10527L12.9752 2.36177H12.9777ZM18.1678 38.2138L23.9574 34.8809V9.83281L19.7657 12.2459L13.9749 15.5801V40.6281L18.1678 38.2138ZM48.9133 9.14105L38.9344 14.8858L48.9133 20.6305L58.8909 14.8846L48.9133 9.14105ZM47.9149 22.3593L42.124 19.0252L37.9323 16.6121V27.9844L43.7219 31.3174L47.9149 33.7317V22.3593ZM24.9533 47.987L39.59 39.631L46.9065 35.4555L36.9352 29.7145L25.4544 36.3242L14.9907 42.3482L24.9533 47.987Z" />
  </svg>
  <p className="mt-2 font-medium">Laravel</p>
</LinkedCard>
<LinkedCard href="/docs/installation/react-router">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className="h-10 w-10"
    fill="currentColor"
  >
    <path d="M12.118 5.466a2.306 2.306 0 0 0-.623.08c-.278.067-.702.332-.953.583-.41.423-.49.609-.662 1.469-.08.423.41 1.43.847 1.734.45.317 1.085.502 2.065.608 1.429.16 1.84.636 1.84 2.197 0 1.377-.385 1.747-1.96 1.906-1.707.172-2.58.834-2.765 2.117-.106.781.41 1.76 1.125 2.091 1.627.768 3.15-.198 3.467-2.196.211-1.284.622-1.642 1.998-1.747 1.588-.133 2.409-.675 2.713-1.787.278-1.02-.304-2.157-1.297-2.554-.264-.106-.873-.238-1.35-.291-1.495-.16-1.879-.424-2.038-1.39-.225-1.337-.317-1.562-.794-2.09a2.174 2.174 0 0 0-1.613-.73zm-4.785 4.36a2.145 2.145 0 0 0-.497.048c-1.469.318-2.17 2.051-1.35 3.295 1.178 1.774 3.944.953 3.97-1.177.012-1.193-.98-2.143-2.123-2.166zM2.089 14.19a2.22 2.22 0 0 0-.427.052c-2.158.476-2.237 3.626-.106 4.182.53.145.582.145 1.111.013 1.191-.318 1.866-1.456 1.549-2.607-.278-1.02-1.144-1.664-2.127-1.64zm19.824.008c-.233.002-.477.058-.784.162-1.39.477-1.866 2.092-.98 3.336.557.794 1.96 1.058 2.82.516 1.416-.874 1.363-3.057-.093-3.746-.38-.186-.663-.271-.963-.268z" />
  </svg>
  <p className="mt-2 font-medium">React Router</p>
</LinkedCard>
<LinkedCard href="/docs/installation/astro">
  <svg
    role="img"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="h-10 w-10"
    fill="currentColor"
  >
    <title>Astro</title>
    <path
      d="M16.074 16.86C15.354 17.476 13.917 17.895 12.262 17.895C10.23 17.895 8.527 17.263 8.075 16.412C7.914 16.9 7.877 17.458 7.877 17.814C7.877 17.814 7.771 19.564 8.988 20.782C8.988 20.15 9.501 19.637 10.133 19.637C11.216 19.637 11.215 20.582 11.214 21.349V21.418C11.214 22.582 11.925 23.579 12.937 24C12.7812 23.6794 12.7005 23.3275 12.701 22.971C12.701 21.861 13.353 21.448 14.111 20.968C14.713 20.585 15.383 20.161 15.844 19.308C16.0926 18.8493 16.2225 18.3357 16.222 17.814C16.2221 17.4903 16.1722 17.1685 16.074 16.86ZM15.551 0.6C15.747 0.844 15.847 1.172 16.047 1.829L20.415 16.176C18.7743 15.3246 17.0134 14.7284 15.193 14.408L12.35 4.8C12.3273 4.72337 12.2803 4.65616 12.2162 4.60844C12.152 4.56072 12.0742 4.53505 11.9943 4.53528C11.9143 4.5355 11.8366 4.56161 11.7727 4.60969C11.7089 4.65777 11.6623 4.72524 11.64 4.802L8.83 14.405C7.00149 14.724 5.23264 15.3213 3.585 16.176L7.974 1.827C8.174 1.171 8.274 0.843 8.471 0.6C8.64406 0.385433 8.86922 0.218799 9.125 0.116C9.415 0 9.757 0 10.443 0H13.578C14.264 0 14.608 0 14.898 0.117C15.1529 0.219851 15.3783 0.386105 15.551 0.6Z"
      fill="currentColor"
    />
  </svg>
  <p className="mt-2 font-medium">Astro</p>
</LinkedCard>
  <LinkedCard href="/docs/installation/manual">
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10"
      fill="currentColor"
    >
      <title>React</title>
      <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z" />
    </svg>
    <p className="mt-2 font-medium">Manual</p>
  </LinkedCard>
</div>
---
title: Theming
description: Using CSS variables and theme tokens.
---

<Callout>

Want to build your theme visually? Use [shadcn/create](/create) to preview colors, radius, fonts, and icons, then generate a preset for your project.

</Callout>

We use and recommend CSS variables for theming.

This gives you semantic theme tokens like `background`, `foreground`, and `primary` that components use by default. Override those tokens in your CSS to change the look of your app without rewriting component classes.

```tsx /bg-background/ /text-foreground/
<div className="bg-background text-foreground" />
```

To use CSS variables for theming, set `tailwind.cssVariables` to `true` in your `components.json` file. This is the default.

```json {8} title="components.json" showLineNumbers
{
  "style": "base-nova",
  "rsc": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  }
}
```

Tailwind maps these tokens into utilities like `bg-background`, `text-foreground`, `border-border`, and `ring-ring`.

Dark mode works by overriding the same tokens inside a `.dark` selector. See the [dark mode docs](/docs/dark-mode/next) for adding a theme provider and toggling the `.dark` class.

## Token Convention

We use semantic background and foreground pairs. The base token controls the surface color and the `-foreground` token controls the text and icon color that sits on that surface.

<Callout className="mt-4">

The background suffix is omitted for the surface token. For example, `primary` pairs with `primary-foreground`.

</Callout>

Given the following CSS variables:

```css
--primary: oklch(0.205 0 0);
--primary-foreground: oklch(0.985 0 0);
```

The `background` color of the following component will be `var(--primary)` and the `foreground` color will be `var(--primary-foreground)`.

```tsx
<div className="bg-primary text-primary-foreground">Hello</div>
```

## Theme Tokens

These tokens live in your CSS file under `:root` and `.dark`.

| Token                                            | What it controls                                       | Used by                                                                      |
| ------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `background` / `foreground`                      | The default app background and text color.             | The page shell, page sections, and default text.                             |
| `card` / `card-foreground`                       | Elevated surfaces and the content inside them.         | `Card`, dashboard panels, settings panels.                                   |
| `popover` / `popover-foreground`                 | Floating surfaces and the content inside them.         | `Popover`, `DropdownMenu`, `ContextMenu`, and other overlays.                |
| `primary` / `primary-foreground`                 | High-emphasis actions and brand surfaces.              | Default `Button`, selected states, badges, and active accents.               |
| `secondary` / `secondary-foreground`             | Lower-emphasis filled actions and supporting surfaces. | Secondary buttons, secondary badges, and supporting UI.                      |
| `muted` / `muted-foreground`                     | Subtle surfaces and lower-emphasis content.            | Descriptions, placeholders, empty states, helper text, and subdued surfaces. |
| `accent` / `accent-foreground`                   | Interactive hover, focus, and active surfaces.         | Ghost buttons, menu highlight states, hovered rows, and selected items.      |
| `destructive`                                    | Destructive actions and error emphasis.                | Destructive buttons, invalid states, and destructive menu items.             |
| `border`                                         | Default borders and separators.                        | Cards, menus, tables, separators, and layout dividers.                       |
| `input`                                          | Form control borders and input surface treatment.      | `Input`, `Textarea`, `Select`, and outline-style controls.                   |
| `ring`                                           | Focus rings and outlines.                              | Buttons, inputs, checkboxes, menus, and other focusable controls.            |
| `chart-1` ... `chart-5`                          | The default chart palette.                             | Charts and chart-driven dashboard blocks.                                    |
| `sidebar` / `sidebar-foreground`                 | The base sidebar surface and default sidebar text.     | The `Sidebar` container and its default content.                             |
| `sidebar-primary` / `sidebar-primary-foreground` | High-emphasis actions inside the sidebar.              | Active items, icon tiles, badges, and sidebar CTAs.                          |
| `sidebar-accent` / `sidebar-accent-foreground`   | Hover and selected states inside the sidebar.          | Sidebar menu hover states, open items, and interactive rows.                 |
| `sidebar-border`                                 | Sidebar-specific borders and separators.               | Sidebar headers, groups, and internal dividers.                              |
| `sidebar-ring`                                   | Sidebar-specific focus rings.                          | Focused controls inside the sidebar.                                         |
| `radius`                                         | The base corner radius scale.                          | Cards, inputs, buttons, popovers, and the derived `radius-*` tokens.         |

<Callout className="mt-4">

The chart tokens are covered in more detail in the [Chart theming docs](/docs/components/chart#theming).

</Callout>

## Radius Scale

`--radius` is the base radius token for your theme.

We derive a small radius scale from it so components can use consistent corner sizes while still sharing a single source of truth.

```css title="app/globals.css" showLineNumbers
@theme inline {
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}
```

This means:

- `radius-lg` is the base value.
- Smaller radii scale down from `--radius`.
- Larger radii scale up from `--radius`.
- Changing `--radius` updates the entire radius scale.

## Adding New Tokens

To add a new token, define it under `:root` and `.dark`, then expose it to Tailwind with `@theme inline`.

```css title="app/globals.css" showLineNumbers
:root {
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
}

.dark {
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
}

@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

You can now use `bg-warning` and `text-warning-foreground` in your components.

```tsx /bg-warning/ /text-warning-foreground/
<div className="bg-warning text-warning-foreground" />
```

## Base Colors

`tailwind.baseColor` controls the default token values generated for your project when you run `init` or use a preset.

The available base colors are: **Neutral**, **Stone**, **Zinc**, **Mauve**, **Olive**, **Mist**, and **Taupe**.

## Default Theme CSS

The following is the full default `neutral` theme scaffold. Copy it into your global CSS file and adjust the tokens as needed.

<CodeCollapsibleWrapper>

```css showLineNumbers title="app/globals.css"
@import "tailwindcss";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

</CodeCollapsibleWrapper>

## Without CSS Variables

If you do not want to use CSS variables, the CLI can generate components with inline Tailwind color utilities instead.

```bash
npx shadcn@latest init --no-css-variables
```

This sets `tailwind.cssVariables` to `false` in your `components.json` file.

```tsx /bg-zinc-950/ /text-zinc-50/ /dark:bg-white/ /dark:text-zinc-950/
<div className="bg-zinc-950 text-zinc-50 dark:bg-white dark:text-zinc-950" />
```

<Callout className="mt-4">

This is an installation-time choice. To switch an existing project, delete and re-install your components.

</Callout>
---
title: Skills
description: Give your AI assistant deep knowledge of shadcn/ui components, patterns, and best practices.
---

Skills give AI assistants like Claude Code project-aware context about shadcn/ui. When installed, your AI assistant knows how to find, install, compose, and customize components using the correct APIs and patterns for your project.

For example, you can ask your AI assistant to:

- _"Add a login form with email and password fields."_
- _"Create a settings page with a form for updating profile information."_
- _"Build a dashboard with a sidebar, stats cards, and a data table."_
- _"Switch to --preset [CODE]"_
- _"Can you add a hero from @tailark?"_

The skill reads your project's `components.json` and provides the assistant with your framework, aliases, installed components, icon library, and base library so it can generate correct code on the first try.

---

## Install

```bash
npx skills add shadcn/ui
```

This installs the shadcn skill into your project. Once installed, your AI assistant automatically loads it when working with shadcn/ui components.

Learn more about skills at [skills.sh](https://skills.sh).

---

## What's Included

The skill provides your AI assistant with the following knowledge:

### Project Context

On every interaction, the skill runs `shadcn info --json` to get your project's configuration: framework, Tailwind version, aliases, base library (`base`, `radix`, or `aria`), icon library, installed components, and resolved file paths.

### CLI Commands

Full reference for all CLI commands: `init`, `add`, `search`, `view`, `docs`, `diff`, `info`, and `build`. Includes flags, dry-run mode, smart merge workflows, presets, and templates.

### Theming and Customization

How CSS variables, OKLCH colors, dark mode, custom colors, border radius, and component variants work. Includes guidance for both Tailwind v3 and v4.

### Registry Authoring

How to build and publish custom component registries: `registry.json` format, item types, file objects, dependencies, CSS variables, building, hosting, and user configuration.

### MCP Server

Setup and tools for the shadcn MCP server, which lets AI assistants search, browse, and install components from registries.

---

## How It Works

1. **Project detection** — The skill activates when it finds a `components.json` file in your project.
2. **Context injection** — It runs `shadcn info --json` to read your project configuration and injects the result into the assistant's context.
3. **Pattern enforcement** — The assistant follows shadcn/ui composition rules: using `FieldGroup` for forms, `ToggleGroup` for option sets, semantic colors, and correct base-specific APIs.
4. **Component discovery** — The assistant uses `shadcn docs`, `shadcn search`, or MCP tools to find components and their documentation before generating code.

## Learn More

- [CLI](/docs/cli) — Full CLI command reference
- [MCP Server](/docs/mcp) — Connect the MCP server for registry access
- [Theming](/docs/theming) — CSS variables and customization
- [Registry](/docs/registry) — Building and publishing custom registries
- [skills.sh](https://skills.sh) — Learn more about AI skills
npx shadcn@latest add signup-03npx shadcn@latest add login-03npx shadcn@latest add sidebar-08