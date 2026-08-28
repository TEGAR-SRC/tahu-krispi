import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Back button */}
        <Button variant="ghost" size="sm" asChild className="mb-8 -ml-2">
          <Link to="/signup">
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        </Button>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl mb-2">Kebijakan Privasi</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Terakhir diperbarui: Agustus 2025
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">1. Pendahuluan</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kilat Cloud ("kami", "kita", atau "perusahaan") berkomitmen untuk melindungi privasi Anda.
              Kebijakan Privasi ini menjelaskan bagaimana kami mengumpulkan, menggunakan, menyimpan, dan
              melindungi informasi pribadi Anda saat Anda menggunakan platform dan layanan kami.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">2. Informasi yang Kami Kumpulkan</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Kami mengumpulkan berbagai jenis informasi untuk menyediakan dan meningkatkan Layanan kami:
            </p>
            <h3 className="font-medium mt-4 mb-2">a. Informasi yang Anda Berikan</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Nama lengkap dan nama pengguna (username)</li>
              <li>Alamat email dan nomor telepon</li>
              <li>Informasi profil (nama perusahaan, negara, kode pajak)</li>
              <li>Informasi pembayaran dan billing</li>
              <li>Konten yang Anda unggah atau kirimkan (tiket, lampiran)</li>
            </ul>
            <h3 className="font-medium mt-4 mb-2">b. Informasi yang Dikumpulkan Otomatis</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Alamat IP dan informasi perangkat</li>
              <li>Log aktivitas dan penggunaan platform</li>
              <li>Data performa dan diagnostik</li>
              <li>Cookies dan teknologi pelacakan serupa</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">3. Bagaimana Kami Menggunakan Informasi</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Informasi yang kami kumpulkan digunakan untuk:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Menyediakan, mengoperasikan, dan memelihara Layanan</li>
              <li>Memproses transaksi dan billing</li>
              <li>Mengirimkan notifikasi terkait akun dan layanan</li>
              <li>Merespons permintaan dukungan dan tiket</li>
              <li>Mencegah penipuan dan meningkatkan keamanan</li>
              <li>Mematuhi kewajiban hukum dan regulasi</li>
              <li>Menganalisis dan meningkatkan performa platform</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">4. Berbagi Informasi</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Kami tidak menjual informasi pribadi Anda. Kami dapat berbagi informasi Anda dengan:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Penyedia layanan pihak ketiga</strong>: untuk operasional (pembayaran, email,
                infrastruktur cloud)
              </li>
              <li>
                <strong>Mitra bisnis</strong>: sesuai dengan persetujuan Anda (mis. program afiliasi)
              </li>
              <li>
                <strong>Otoritas hukum</strong>: jika diwajibkan oleh hukum yang berlaku
              </li>
              <li>
                <strong>Penerus bisnis</strong>: dalam hal merger, akuisisi, atau penjualan aset
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">5. Keamanan Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami menerapkan langkah-langkah keamanan teknis dan organisasional yang sesuai untuk melindungi
              informasi Anda, termasuk:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Enkripsi data saat transit (TLS/HTTPS) dan saat disimpan</li>
              <li>Hashing password menggunakan algoritma Argon2id</li>
              <li>Enkripsi AES-256-GCM untuk kredensial sensitif</li>
              <li>Kontrol akses berbasis peran (RBAC) yang ketat</li>
              <li>Audit log untuk semua aksi administratif</li>
              <li>Pemantauan keamanan berkelanjutan</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">6. Retensi Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami menyimpan informasi pribadi Anda selama akun Anda aktif atau selama diperlukan untuk
              menyediakan Layanan. Setelah penghapusan akun, kami dapat menyimpan data tertentu untuk jangka
              waktu yang diperlukan sesuai kewajiban hukum atau untuk menyelesaikan sengketa yang masih
              berjalan.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">7. Hak-Hak Anda</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Sesuai dengan peraturan perlindungan data yang berlaku, Anda memiliki hak untuk:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Akses</strong>: Mendapatkan salinan data pribadi yang kami miliki tentang Anda
              </li>
              <li>
                <strong>Koreksi</strong>: Memperbarui atau memperbaiki data yang tidak akurat
              </li>
              <li>
                <strong>Penghapusan</strong>: Meminta penghapusan data pribadi Anda
              </li>
              <li>
                <strong>Portabilitas</strong>: Menerima data Anda dalam format yang dapat dibaca mesin
              </li>
              <li>
                <strong>Keberatan</strong>: Menolak pemrosesan data untuk tujuan tertentu
              </li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Untuk menggunakan hak-hak ini, silakan hubungi kami melalui tiket dukungan atau email
              privacy@kilat.cloud.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">8. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami menggunakan cookies dan teknologi serupa untuk menyimpan preferensi sesi, melacak
              penggunaan platform, dan meningkatkan pengalaman pengguna. Anda dapat mengatur browser untuk
              menolak cookies, namun hal ini dapat mempengaruhi fungsionalitas platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">9. Transfer Data Internasional</h2>
            <p className="text-muted-foreground leading-relaxed">
              Infrastruktur kami dapat berada di berbagai lokasi. Dengan menggunakan Layanan, Anda menyetujui
              transfer data Anda ke lokasi-lokasi tersebut. Kami memastikan perlindungan yang memadai untuk
              semua transfer data internasional sesuai dengan hukum yang berlaku.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">10. Perubahan Kebijakan</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Kami akan memberitahu Anda
              tentang perubahan material melalui email atau notifikasi di platform. Tanggal "terakhir
              diperbarui" di bagian atas dokumen ini akan diperbarui setiap kali ada perubahan.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">11. Hubungi Kami</h2>
            <p className="text-muted-foreground leading-relaxed">
              Jika Anda memiliki pertanyaan atau kekhawatiran tentang Kebijakan Privasi ini atau cara kami
              menangani data Anda, hubungi kami:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Email: privacy@kilat.cloud</li>
              <li>Tiket dukungan melalui dashboard akun Anda</li>
            </ul>
          </section>
        </div>

        {/* Bottom nav */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            Lihat juga:{" "}
            <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
              Syarat & Ketentuan
            </Link>
          </p>
          <Button asChild>
            <Link to="/signup">Daftar Sekarang</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
