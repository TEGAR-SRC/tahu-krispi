import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold tracking-tight mb-2">Syarat & Ketentuan</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Terakhir diperbarui: Agustus 2025
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">1. Penerimaan Syarat</h2>
            <p className="text-muted-foreground leading-relaxed">
              Dengan mengakses dan menggunakan layanan Kilat Cloud ("Layanan"), Anda menyetujui untuk terikat
              oleh Syarat dan Ketentuan ini ("Syarat"). Jika Anda tidak menyetujui Syarat ini, harap tidak
              menggunakan Layanan kami. Syarat ini berlaku bagi semua pengguna, pengunjung, dan pihak lain
              yang mengakses atau menggunakan Layanan.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">2. Deskripsi Layanan</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kilat Cloud menyediakan platform infrastruktur cloud multi-provider yang mencakup:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Virtual Machine (VM) dan container berbasis Proxmox VE</li>
              <li>Layanan virtualisasi berbasis VMware vSphere</li>
              <li>Platform-as-a-Service (PaaS) melalui Dokploy</li>
              <li>Pengelolaan billing, wallet, dan invoicing</li>
              <li>Layanan pendukung seperti ticketing dan notifikasi</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">3. Akun Pengguna</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Untuk menggunakan Layanan, Anda harus mendaftarkan akun dengan memberikan informasi yang akurat,
              lengkap, dan terkini. Anda bertanggung jawab atas:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Menjaga kerahasiaan kata sandi akun Anda</li>
              <li>Semua aktivitas yang terjadi di bawah akun Anda</li>
              <li>Segera memberitahu kami jika terjadi penggunaan tidak sah</li>
              <li>Memastikan bahwa Anda berusia minimal 18 tahun atau memiliki persetujuan orang tua/wali</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">4. Penggunaan yang Diizinkan</h2>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Anda setuju untuk tidak menggunakan Layanan untuk:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Melanggar hukum atau peraturan yang berlaku</li>
              <li>Menyebarkan konten ilegal, berbahaya, atau melanggar hak cipta</li>
              <li>Melakukan aktivitas penipuan atau kejahatan siber</li>
              <li>Mengganggu atau merusak infrastruktur Layanan</li>
              <li>Melakukan spam atau distribusi malware</li>
              <li>Menyalahgunakan sumber daya komputasi untuk aktivitas yang tidak sah</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">5. Pembayaran dan Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              Layanan Kilat Cloud menggunakan sistem billing berbasis penggunaan (hourly/monthly). Dengan
              menggunakan Layanan berbayar, Anda setuju untuk:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Membayar semua biaya yang timbul dari penggunaan Layanan</li>
              <li>Menjaga saldo wallet yang cukup untuk kelangsungan layanan</li>
              <li>Bertanggung jawab atas semua transaksi yang dilakukan dari akun Anda</li>
              <li>Tidak mengajukan chargeback yang tidak sah atau penipuan pembayaran</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">6. Batasan Tanggung Jawab</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kilat Cloud tidak bertanggung jawab atas kerugian tidak langsung, insidental, khusus, atau
              konsekuensial yang timbul dari penggunaan atau ketidakmampuan menggunakan Layanan, termasuk
              kehilangan data, kehilangan pendapatan, atau gangguan bisnis.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">7. Penghentian Layanan</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami berhak untuk menangguhkan atau menghentikan akun Anda dengan atau tanpa pemberitahuan
              sebelumnya jika Anda melanggar Syarat ini, melakukan penipuan, atau jika diperlukan untuk
              melindungi keamanan dan integritas Layanan kami.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">8. Perubahan Syarat</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kami berhak mengubah Syarat ini kapan saja. Kami akan memberitahu Anda melalui email atau
              notifikasi di platform tentang perubahan material. Penggunaan Layanan yang berkelanjutan setelah
              perubahan tersebut dianggap sebagai penerimaan Syarat yang baru.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">9. Hukum yang Berlaku</h2>
            <p className="text-muted-foreground leading-relaxed">
              Syarat ini diatur oleh dan ditafsirkan sesuai dengan hukum Republik Indonesia. Setiap sengketa
              yang timbul dari Syarat ini akan diselesaikan melalui musyawarah mufakat, dan jika tidak
              tercapai, melalui pengadilan yang berwenang di Indonesia.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">10. Kontak</h2>
            <p className="text-muted-foreground leading-relaxed">
              Jika Anda memiliki pertanyaan tentang Syarat ini, silakan hubungi kami melalui:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Email: legal@kilat.cloud</li>
              <li>Tiket dukungan melalui dashboard akun Anda</li>
            </ul>
          </section>
        </div>

        {/* Bottom nav */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            Lihat juga:{" "}
            <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
              Kebijakan Privasi
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
