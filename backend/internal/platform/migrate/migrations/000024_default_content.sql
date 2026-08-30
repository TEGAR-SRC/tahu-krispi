-- 000024_default_content.sql
-- Default seed content so the public landing page, documentation site and blog
-- are not empty on a fresh deploy. Idempotent: uses ON CONFLICT DO NOTHING and
-- guard clauses so re-running never duplicates. Edit freely in the staff
-- console (admin/NOC -> Landing/Docs/Blog) or re-seed by deleting rows.
--
-- Landing section keys are constrained by the backend to:
--   hero, features, pricing, testimonials, faq, blog, banner
-- The frontend (console-landing) renders these in the order the rows appear.

-- ======================================================================
-- LANDING SECTIONS (public GET /landing)
-- ======================================================================

INSERT INTO landing_sections (section_key, title, subtitle, body, media_url, data, sort_order, published)
SELECT v.section_key, v.title, v.subtitle, v.body, v.media_url, v.data::jsonb, v.sort_order, v.published FROM (VALUES

  -- ------------------------------------------------------------------ HERO
  ('hero', 'Cloud untuk Indonesia',
   'Kelola server virtual, container, dan object storage dari satu konsol yang cepat, aman, dan terjangkau.',
   'Provisioning instan, billing transparan, dan dukungan multi-provider - semua yang kamu butuhkan untuk membangun dan menskalakan infrastruktur, tanpa kerumitan.',
   '',
   '{"items":[]}', 10, true),

  -- -------------------------------------------------------------- FEATURES
  ('features', 'Fitur Unggulan', 'Semua yang kamu butuhkan untuk menjalankan dan menskalakan infrastruktur.',
   'Desain untuk developer dan tim platform, dengan fokus pada kecepatan, keamanan, dan transparansi.',
   '',
   '{"items":[
     {"title":"Provisioning Instan","description":"VM dan LXC online dalam hitungan detik dari beberapa penyedia."},
     {"title":"Multi-Provider","description":"Proxmox, VMware, dan Docker PaaS di belakang satu API yang konsisten."},
     {"title":"Billing Transparan","description":"Penagihan per jam hingga tahunan dengan wallet dan invoice yang jelas."},
     {"title":"Keamanan MFA","description":"TOTP, passkey, dan recovery code untuk melindungi akun kamu."},
     {"title":"Snapshot & Backup","description":"Jaga data kamu dengan snapshot cepat dan cadangan terjadwal."},
     {"title":"Object Storage","description":"Simpan aset S3-compatible yang aman, scalable, dan mudah diakses."},
     {"title":"Resize Fleksibel","description":"Ubah spesifikasi kapan saja sesuai kebijakan penyedia."},
     {"title":"Jaringan & Firewall","description":"Kelola VPC, firewall, reserved IP, dan rDNS dari satu panel."},
     {"title":"API & Otomasi","description":"API key dengan scope terbatas untuk integrasi dan IaC."}
   ]}', 20, true),

  -- -------------------------------------------------------------- PRICING
  ('pricing', 'Harga Sederhana', 'Bayar sesuai pemakaian, tanpa biaya tersembunyi.',
   'Mengisi wallet, pilih spesifikasi, dan mulai - dengan biaya yang jelas dari awal.',
   '',
   '{"items":[
     {"title":"Starter","description":"1 vCPU, 1 GB RAM, 20 GB disk - cocok untuk proyek kecil dan belajar."},
     {"title":"Standard","description":"2 vCPU, 4 GB RAM, 40 GB disk - pilihan populer untuk produksi."},
     {"title":"Professional","description":"4 vCPU, 8 GB RAM, 80 GB disk - untuk workload yang lebih berat."},
     {"title":"Enterprise","description":"Spesifikasi khusus, storage dedicated, dan prioritas dukungan - hubungi tim kami."}
   ]}', 30, true),

  -- --------------------------------------------------------- TESTIMONIALS
  ('testimonials', 'Kata Mereka', 'Dipercaya oleh tim developer dan startup di Indonesia.',
   '',
   '',
   '{"items":[
     {"text":"Provisioning cepat dan panelnya sangat intuitif.","description":"Startup Tech, Jakarta"},
     {"text":"Multi-provider memudahkan kami memindahkan workload tanpa vendor lock-in.","description":"Agen Software, Bandung"},
     {"text":"Billing transparan dan dukungan yang responsif.","description":"Freelancer Infra, Surabaya"},
     {"text":"Resize tanpa downtime membuat operasional kami jauh lebih luwes.","description":"Agency Digital, Yogyakarta"},
     {"text":"MFA dan API key yang aman memudahkan tim kami bekerja.","description":"SaaS Team, Tangerang"}
   ]}', 40, true),

  -- ----------------------------------------------------------------- FAQ
  ('faq', 'Pertanyaan Umum', 'Jawaban cepat untuk pertanyaan yang paling sering diajukan.',
   '',
   '',
   '{"items":[
     {"q":"Bagaimana cara memulai?","a":"Daftar di console, verifikasi email, isi wallet, lalu buat instance pertamamu dalam hitungan menit."},
     {"q":"Bisakah saya upgrade spesifikasi?","a":"Ya, resize didukung sesuai kebijakan penyedia untuk tiap instance, dan biasanya tanpa downtime."},
     {"q":"Bagaimana billing bekerja?","a":"Kami menagih per siklus (per jam hingga tahunan) lewat wallet yang bisa diisi via pembayaran online."},
     {"q":"Apakah data saya aman?","a":"Kami menggunakan enkripsi, MFA, passkey, dan snapshot/backup untuk melindungi data kamu."},
     {"q":"Apakah saya bisa menggunakan lebih dari satu penyedia?","a":"Ya, Kilat Cloud mendukung Proxmox, VMware, dan Docker PaaS sekaligus di belakang satu API."},
     {"q":"Apa yang terjadi jika saldo wallet habis?","a":"Instance dapat dihentikan otomatis saat invoice overdue. Isi ulang saldo untuk mengaktifkannya kembali."},
     {"q":"Apakah tersedia dukungan teknis?","a":"Ya, tim kami siap membantu melalui tiket dukungan dari console, dengan prioritas untuk pengguna Enterprise."},
     {"q":"Bagaimana cara mengakses log instance?","a":"Buka halaman instance di console dan gunakan bagian log atau konsol web."}
   ]}', 50, true),

  -- ---------------------------------------------------------------- BLOG
  ('blog', 'Dari Blog', 'Kabar terbaru dan panduan dari tim Kilat Cloud.',
   'Tutorial, tips keamanan, dan pembaruan platform.',
   '',
   '{"items":[
     {"title":"Selamat Datang di Kilat Cloud","description":"Platform cloud Indonesia untuk VPS, container, dan object storage."},
     {"title":"Tips Mengelola Instance untuk Pemula","description":"Power action, resize, snapshot, dan backup yang benar."},
     {"title":"Amankan Akun dengan MFA dan Passkey","description":"Autentikasi dua faktor untuk melindungi akses kamu."},
     {"title":"Multi-Provider di Kilat Cloud","description":"Cara memindahkan workload tanpa vendor lock-in."},
     {"title":"Memahami Billing dan Wallet","description":"Top-up, invoice, dan kupon dijelaskan secara sederhana."}
   ]}', 60, true),

  -- --------------------------------------------------------------- BANNER
  ('banner', 'Siap memulai?', 'Daftar sekarang dan kelola infrastrukturmu dari satu tempat.',
   'Gratis untuk mulai - verifikasi email dan buat instance pertamamu hari ini.',
   '',
   '{"items":[]}', 70, true)

) AS v(section_key, title, subtitle, body, media_url, data, sort_order, published)
WHERE NOT EXISTS (SELECT 1 FROM landing_sections);

-- ======================================================================
-- DOCS (public GET /docs)
-- ======================================================================

INSERT INTO docs (slug, title, description, content, sort_order, published)
VALUES
  ('getting-started', 'Memulai',
   'Panduan pertama kali: daftar, verifikasi, isi wallet, dan buat instance.',
   E'# Memulai Kilat Cloud\n\nSelamat datang di Kilat Cloud. Panduan ini membawa kamu dari akun kosong sampai instance pertama yang berjalan.\n\n## 1. Buat akun\n\n1. Buka konsol dan daftar dengan alamat email.\n2. Verifikasi email melalui tautan yang dikirim ke inbox kamu.\n3. Lengkapi profil dan atur preferensi zona waktu.\n\n## 2. Isi wallet\n\nSebelum membuat instance berbayar, isi saldo wallet melalui menu **Wallet**. Kamu bisa top-up dengan pembayaran online dan saldo akan langsung masuk.\n\n## 3. Buat instance\n\n1. Buka menu **Instances**.\n2. Klik **Buat Instance**.\n3. Pilih template, spesifikasi (vCPU/RAM/disk), dan penyedia.\n4. Klik **Buat**. Instance online dalam hitungan detik.\n\n## 4. Akses instance\n\nGunakan kredensial SSH yang ditampilkan, atau buka konsol web langsung dari panel instance.\n\n## Selanjutnya\n\n- Baca [Mengelola Instance](#instances) untuk lifecycle lengkap.\n- Baca [Billing & Wallet](#billing) untuk memahami tagihan.\n- Aktifkan [MFA](#security) untuk mengamankan akun kamu.',
   10, true),

  ('instances', 'Mengelola Instance',
   'Lifecycle VM dan LXC: start, stop, reboot, reset, resize, snapshot, dan backup.',
   E'# Mengelola Instance\n\nSetiap instance memiliki lifecycle yang bisa kamu kendalikan penuh dari console.\n\n## Power actions\n\nDari halaman instance kamu bisa melakukan:\n\n- **Start** - menyalakan instance.\n- **Stop** - mematikan instance.\n- **Reboot** - restart lunak.\n- **Reset** - paksa restart (khusus jika instance tidak merespons).\n\n## Resize\n\nUbah spesifikasi (vCPU/RAM/disk) sesuai kebijakan penyedia. Perubahan akan tercermin pada tagihan sejak siklus berikutnya.\n\n## Snapshot\n\n- **Snapshot** adalah salinan point-in-time yang cepat untuk pemulihan.\n- Buat sebelum melakukan perubahan besar pada instance.\n\n## Backup\n\n- **Backup** adalah cadangan untuk pemulihan bencana.\n- Aktifkan jadwal backup rutin agar data selalu aman.\n\n## Log & Konsol\n\nBuka bagian **Log** atau gunakan **Konsol Web** untuk melihat aktivitas dan mengakses instance secara langsung.\n\n> Snapshot dan backup dapat di-download lewat URL singkat yang aman, atau dipulihkan ke instance lain.',
   20, true),

  ('billing', 'Billing & Wallet',
   'Cara mengisi wallet, memahami invoice, status tagihan, dan kupon diskon.',
   E'# Billing & Wallet\n\nKilat Cloud menggunakan sistem wallet dan invoice untuk menagih penggunaan secara transparan.\n\n## Wallet\n\n- Isi saldo melalui top-up online di menu **Wallet**.\n- Saldo digunakan untuk membayar invoice secara otomatis.\n- Lihat riwayat transaksi untuk memantau pengeluaran.\n\n## Invoice\n\nSetiap penggunaan ditagih sebagai invoice dengan rincian lengkap:\n\n- **Unpaid** - menunggu pembayaran.\n- **Paid** - sudah terbayar.\n- **Overdue** - melewati jatuh tempo.\n\n> Pastikan saldo cukup untuk menghindari instance dihentikan otomatis saat invoice overdue.\n\n## Kupon\n\nMasukkan kode kupon saat checkout untuk mendapatkan diskon subtotal. Promo kadang dibatasi oleh durasi berlaku.\n\n## Memeriksa saldo\n\nBuka menu **Wallet** di konsol untuk melihat saldo, invoice, dan riwayat transaksi dalam satu tampilan.',
   30, true),

  ('security', 'Keamanan Akun',
   'MFA, passkey, recovery code, API keys, dan praktik terbaik keamanan.',
   E'# Keamanan Akun\n\nKeamanan akun adalah lapisan pertama pertahanan kamu. Kilat Cloud menyediakan beberapa mekanisme.\n\n## Aktifkan MFA\n\nAktifkan autentikasi dua faktor (TOTP) untuk lapisan keamanan tambahan:\n\n1. Buka menu **Keamanan**.\n2. Pilih **Aktifkan MFA**.\n3. Scan kode QR dengan aplikasi autentikator.\n4. Masukkan kode 6 digit untuk konfirmasi.\n\n## Passkey\n\nDaftarkan passkey untuk masuk tanpa kata sandi menggunakan perangkat tepercaya (biometrik atau kunci keamanan).\n\n## Recovery code\n\nSimpan recovery code di tempat aman. Gunakan hanya jika kamu kehilangan akses ke aplikasi autentikator.\n\n## API keys\n\nBuat API key dengan scope terbatas untuk integrasi otomatis:\n\n- Gunakan scope terkecil yang dibutuhkan.\n- Rotasi secara berkala.\n- Jangan pernah membagikan API key.\n\n## Ubah kata sandi\n\nGanti kata sandi secara berkala dan gunakan passphrase yang kuat (minimal 10 karakter).\n\n> Selalu gunakan API key dengan scope terkecil yang dibutuhkan dan aktifkan MFA untuk semua akun penting.',
   40, true),

  ('network', 'Jaringan & Firewall',
   'VPC, firewall rules, reserved IP, dan konfigurasi rDNS.',
   E'# Jaringan & Firewall\n\nKendalikan lalu lintas jaringan dan perlindungan instance kamu sepenuhnya.\n\n## Firewall\n\nKelola aturan inbound dan outbound untuk melindungi instance:\n\n- Batasi akses hanya ke port yang dibutuhkan.\n- Gunakan whitelist alamat IP.\n- Terapkan aturan segera dan aman.\n\n## Reserved IP\n\n- Pesan alamat IP statis.\n- Lekatkan ke instance dan lepas kapan saja.\n- Ideal untuk endpoint yang alamatnya tidak boleh berubah.\n\n## VPC\n\nIsolasi instance dalam jaringan pribadi untuk workload yang saling berkomunikasi secara internal.\n\n## rDNS & BGP\n\n- Konfigurasi reverse DNS (rDNS) agar alamat IP terverifikasi.\n- Ajukan sesi BGP untuk kebutuhan routing lanjutan.\n\n> Terapkan prinsip least-privilege pada firewall: hanya buka port yang benar-benar kamu perlukan.',
   50, true),

  ('storage', 'Object Storage',
   'Kelola bucket, upload file, dan akses aset S3-compatible.',
   E'# Object Storage\n\nObject storage adalah solusi untuk menyimpan file, media, dan aset secara aman dan scalable.\n\n## Bucket\n\n- Buat bucket untuk mengelompokkan aset.\n- Setel kebijakan akses publik atau privat per bucket.\n\n## Upload & Kelola\n\n- Upload file langsung dari console atau via API S3-compatible.\n- Hapus, ganti, dan kelola metadata file.\n\n## URL & Akses\n\n- Dapatkan URL singkat untuk berbagi atau melayani aset.\n- Kontrol umur URL dan aksesnya.\n\n> Gunakan kebijakan akses paling ketat yang diperlukan untuk menghindari data publik yang tidak disengaja.',
   60, true),

  ('containers', 'Container & PaaS',
   'Deploy aplikasi sebagai container dengan integrasi Docker PaaS.',
   E'# Container & PaaS\n\nDeploy aplikasi kamu sebagai container tanpa perlu mengelola infrastruktur dasar.\n\n## Deploy container\n\n- Buat container dari image yang tersedia.\n- Atur resource limits dan kebijakan restart.\n- Ekspos port dengan aman.\n\n## Docker PaaS\n\nGunakan dukungan Docker PaaS untuk integrasi build dan deploy yang lebih mulus.\n\n## Monitoring\n\nPantau status, log, dan metrik container dari console untuk menjaga keandalan.\n\n> Selalu batasi resource container dan gunakan image yang terpercaya.',
   70, true),

  ('dns', 'DNS & Domain',
   'Kelola DNS record, subdomain, dan integrasi dengan domain kamu.',
   E'# DNS & Domain\n\nArahkan domain kamu ke instance atau layanan Kilat Cloud dengan mudah.\n\n## DNS records\n\n- Kelola A, AAAA, CNAME, MX, dan TXT records.\n- Update secara instan dari console.\n\n## Subdomain\n\nBuat subdomain untuk memisahkan layanan dan aplikasi.\n\n## Integrasi\n\nHubungkan domain yang sudah kamu miliki ke reserved IP atau load balancer.\n\n> Pastikan set TTL yang wajar saat berpindah layanan untuk meminimalkan downtime.',
   80, true),

  ('monitoring', 'Monitoring & Log',
   'Pantau kesehatan instance, metrik, dan log aktivitas.',
   E'# Monitoring & Log\n\nAwasi kesehatan dan performa infrastruktur kamu dari satu tempat.\n\n## Metrik\n\nLihat grafik penggunaan CPU, RAM, disk, dan jaringan untuk tiap instance.\n\n## Log\n\nAkses log aplikasi dan sistem untuk debugging dan audit.\n\n## Alerta\n\nKonfigurasikan notifikasi agar kamu tahu saat terjadi anomali atau batas tercapai.\n\n> Pantau metrik secara rutin dan pasang alert untuk resource yang kritis.',
   90, true),

  ('organizations', 'Organisasi & Tim',
   'Kelola anggota, role, dan izin dalam satu organisasi.',
   E'# Organisasi & Tim\n\nKelola akses tim kamu dalam satu organisasi dengan kontrol granular.\n\n## Anggota & role\n\n- Undang anggota ke organisasi.\n- Tetapkan role dan izin yang sesuai (viewer, operator, admin).\n- Cabut akses kapan saja.\n\n## Kolaborasi\n\nBagikan resource seperti instance dan storage antar anggota dengan kebijakan yang jelas.\n\n## Audit\n\nTinjau log aktivitas untuk melihat siapa melakukan apa.\n\n> Terapkan prinsip least-privilege saat memberi role ke anggota tim.',
   100, true),

  ('faq', 'FAQ Teknis',
   'Jawaban atas pertanyaan umum penggunaan platform.',
   E'# FAQ Teknis\n\nKumpulan jawaban atas pertanyaan yang paling sering ditanyakan.\n\n## Bagaimana cara reset kata sandi?\n\nGunakan alur *forgot password* di halaman login. Tautan reset akan dikirim ke email kamu.\n\n## Kenapa instance saya berstatus stopped?\n\nCek saldo wallet - instance dapat dihentikan otomatis saat invoice overdue. Isi ulang saldo untuk mengaktifkannya kembali.\n\n## Bagaimana cara mengakses log?\n\nBuka halaman instance dan lihat bagian log, atau gunakan konsol web.\n\n## Bisakah saya memindahkan instance antar penyedia?\n\nDengan snapshot dan backup, kamu bisa memulihkan data ke instance lain, termasuk di penyedia yang berbeda.\n\n## Apakah data saya bisa dipulihkan setelah dihapus?\n\nTergantung kebijakan penyedia dan snapshot yang ada. Selalu aktifkan backup rutin untuk data penting.\n\n## Bagaimana cara menghubungi dukungan?\n\nBuka menu **Dukungan** di console dan buat tiket. Pengguna Enterprise mendapat prioritas.',
   110, true)

ON CONFLICT (slug) DO NOTHING;

-- ======================================================================
-- BLOG (public GET /blog)
-- ======================================================================

INSERT INTO blog_posts (slug, title, excerpt, cover_image, author_name, content, tags, sort_order, published, published_at)
VALUES
  ('welcome-to-kilat-cloud', 'Selamat Datang di Kilat Cloud',
   'Platform cloud Indonesia untuk VPS, container, dan object storage - dari satu konsol.',
   '', 'Tim Kilat Cloud',
   E'# Selamat Datang di Kilat Cloud\n\nKami hadir untuk memudahkan tim dan developer mengelola infrastruktur dari satu tempat.\n\n## Apa yang kami tawarkan\n\n- VPS dan container dengan provisioning instan\n- Dukungan multi-provider (Proxmox, VMware, Docker PaaS)\n- Billing transparan dengan wallet dan invoice\n- Keamanan MFA dan passkey\n- Object storage S3-compatible\n\n## Mulai\n\nDaftar di [console](https://console.kilat-cloud.com/signup), verifikasi email, dan buat instance pertamamu hari ini.',
   ARRAY['pengumuman','perkenalan'], 10, true, now()),

  ('mengelola-instance', 'Tips Mengelola Instance untuk Pemula',
   'Panduan singkat power action, resize, snapshot, dan backup di Kilat Cloud.',
   '', 'Tim Kilat Cloud',
   E'# Tips Mengelola Instance\n\nMulai dengan memahami lifecycle dasar sebuah instance.\n\n## Power actions\n\nGunakan tombol start/stop/reboot untuk kontrol harian. Gunakan reset hanya saat instance tidak merespons.\n\n## Resize\n\nUbah spesifikasi sesuai kebutuhan. Pastikan kamu memahami dampaknya pada tagihan sebelum resize.\n\n## Snapshot sebelum perubahan\n\nSelalu buat snapshot sebelum upgrade besar atau perubahan konfigurasi penting.\n\n## Backup rutin\n\nAktifkan backup terjadwal agar data selalu aman dari kegagalan.\n\n## Pantau penggunaan\n\nCek metrik dan resource limits untuk menghindari kejutan biaya dan menjaga performa.',
   ARRAY['tutorial','instance'], 20, true, now()),

  ('keamanan-akun', 'Amankan Akun dengan MFA dan Passkey',
   'Lindungi akun dari akses tidak sah dengan autentikasi dua faktor.',
   '', 'Tim Kilat Cloud',
   E'# Amankan Akun\n\nKeamanan dimulai dari akun. Aktifkan lapisan proteksi tambahan.\n\n## Aktifkan TOTP\n\nGunakan aplikasi autentikator untuk kode 6 digit yang berubah setiap beberapa detik.\n\n## Daftarkan passkey\n\nMasuk tanpa kata sandi dengan perangkat tepercaya dan biometrik.\n\n## Simpan recovery code\n\nSimpan di tempat aman untuk berjaga-jaga jika kehilangan akses autentikator.\n\n## Rotasi API key\n\nPutar API key secara berkala dan gunakan scope minimal untuk tiap integrasi.\n\n## Gunakan kata sandi kuat\n\nGunakan passphrase minimal 10 karakter dan jangan gunakan ulang kata sandi.',
   ARRAY['keamanan','tutorial'], 30, true, now()),

  ('multi-provider', 'Multi-Provider di Kilat Cloud',
   'Kelola Proxmox, VMware, dan Docker PaaS sekaligus tanpa vendor lock-in.',
   '', 'Tim Kilat Cloud',
   E'# Multi-Provider di Kilat Cloud\n\nSalah satu keunggulan Kilat Cloud adalah dukungan multi-provider di belakang satu API.\n\n## Mengapa multi-provider?\n\n- Hindari vendor lock-in\n- Distribusikan workload sesuai kebutuhan\n- Fleksibilitas untuk migrasi\n\n## Penyedia yang didukung\n\n- **Proxmox** - virtualisasi VM dan LXC\n- **VMware** - lingkungan enterprise\n- **Docker PaaS** - deploy aplikasi sebagai container\n\n## Memindahkan workload\n\nGunakan snapshot dan backup untuk memulihkan data ke instance lain, termasuk di penyedia berbeda.\n\n> Multi-provider berarti kamu punya kebebasan, bukan tambahan kerumitan.',
   ARRAY['fitur','infrastruktur'], 40, true, now()),

  ('memahami-billing', 'Memahami Billing dan Wallet',
   'Top-up, invoice, status tagihan, dan kupon dijelaskan secara sederhana.',
   '', 'Tim Kilat Cloud',
   E'# Memahami Billing dan Wallet\n\nBilling yang transparan adalah salah satu prioritas kami.\n\n## Wallet\n\nIsi saldo lewat top-up online. Saldo membayar invoice secara otomatis.\n\n## Siklus tagihan\n\nKamu bisa memilih penagihan per jam, harian, hingga tahunan sesuai kebutuhan.\n\n## Invoice\n\nSetiap penggunaan menjadi invoice dengan rincian lengkap: unpaid, paid, atau overdue.\n\n## Kupon\n\nMasukkan kode kupon saat checkout untuk diskon subtotal.\n\n## Hindari downtime\n\nJaga saldo tetap cukup agar instance tidak dihentikan otomatis saat invoice overdue.',
   ARRAY['billing','panduan'], 50, true, now())

ON CONFLICT (slug) DO NOTHING;
