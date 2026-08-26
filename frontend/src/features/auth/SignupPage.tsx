import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { homePathFor, useAuth, type RegisterPayload } from "@/lib/auth"

// Common locales
const LOCALES = [
  { value: "id-ID", label: "Bahasa Indonesia" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "zh-CN", label: "中文 (简体)" },
  { value: "ja-JP", label: "日本語" },
]

// Common timezones for Indonesian & regional users
const TIMEZONES = [
  { value: "Asia/Jakarta", label: "WIB — Jakarta (UTC+7)" },
  { value: "Asia/Makassar", label: "WITA — Makassar (UTC+8)" },
  { value: "Asia/Jayapura", label: "WIT — Jayapura (UTC+9)" },
  { value: "Asia/Singapore", label: "SGT — Singapore (UTC+8)" },
  { value: "Asia/Kuala_Lumpur", label: "MYT — Kuala Lumpur (UTC+8)" },
  { value: "Asia/Bangkok", label: "ICT — Bangkok (UTC+7)" },
  { value: "Asia/Tokyo", label: "JST — Tokyo (UTC+9)" },
  { value: "UTC", label: "UTC" },
]

export default function SignupPage() {
  const { token, role, loading, register } = useAuth()
  const navigate = useNavigate()

  // --- form state -------------------------------------------------------
  const [fullName, setFullName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [locale, setLocale] = useState("id-ID")
  const [timezone, setTimezone] = useState("Asia/Jakarta")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false)

  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && token && role) {
      navigate(homePathFor(role), { replace: true })
    }
  }, [loading, token, role, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(new Error("Password dan konfirmasi password tidak cocok"))
      return
    }
    if (!agreedToTerms || !agreedToPrivacy) {
      setError(new Error("Anda harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi"))
      return
    }

    // Phone must follow E.164 if provided: +62...
    if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError(
        new Error('Format nomor telepon tidak valid. Gunakan format internasional, contoh: +62812345678'),
      )
      return
    }

    setSubmitting(true)
    try {
      const payload: RegisterPayload & {
        username?: string
        phone?: string
        locale?: string
        timezone?: string
      } = {
        email,
        password,
        full_name: fullName,
        terms_accepted: true,
        privacy_accepted: true,
      }
      // Only send optional fields when they are filled
      if (username.trim()) payload.username = username.trim()
      if (phone.trim()) payload.phone = phone.trim()
      if (locale) payload.locale = locale
      if (timezone) payload.timezone = timezone

      const nextRole = await register(payload)
      navigate(homePathFor(nextRole), { replace: true })
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Buat Akun Kilat Cloud</CardTitle>
            <CardDescription>
              Daftar sekarang dan mulai kelola infrastruktur cloud Anda
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {/* OAuth buttons */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = "/api/v1/auth/oauth/google"
                  }}
                >
                  <svg
                    className="size-4 shrink-0"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
                    />
                  </svg>
                  Google
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = "/api/v1/auth/oauth/github"
                  }}
                >
                  <svg
                    className="size-4 shrink-0"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                      fill="currentColor"
                    />
                  </svg>
                  GitHub
                </Button>
              </div>

              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                atau daftar dengan email
              </FieldSeparator>

              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error ? <ErrorBanner error={error} /> : null}

                  {/* Row 1: Nama Lengkap */}
                  <Field>
                    <FieldLabel htmlFor="signup-fullname">
                      Nama Lengkap <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id="signup-fullname"
                      type="text"
                      placeholder="Budi Santoso"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </Field>

                  {/* Row 2: Username */}
                  <Field>
                    <FieldLabel htmlFor="signup-username">Username</FieldLabel>
                    <Input
                      id="signup-username"
                      type="text"
                      placeholder="budi_santoso"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    <FieldDescription>
                      Opsional. 3–32 karakter, boleh huruf, angka, titik, atau underscore.
                    </FieldDescription>
                  </Field>

                  {/* Row 3: Email */}
                  <Field>
                    <FieldLabel htmlFor="signup-email">
                      Email <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="budi@example.com"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>

                  {/* Row 4: No. Telepon */}
                  <Field>
                    <FieldLabel htmlFor="signup-phone">Nomor Telepon</FieldLabel>
                    <Input
                      id="signup-phone"
                      type="tel"
                      placeholder="+62812345678"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <FieldDescription>
                      Opsional. Format internasional (contoh: +62812345678).
                    </FieldDescription>
                  </Field>

                  {/* Row 5: Locale & Timezone */}
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="signup-locale">Bahasa</FieldLabel>
                      <Select value={locale} onValueChange={setLocale}>
                        <SelectTrigger id="signup-locale">
                          <SelectValue placeholder="Pilih bahasa" />
                        </SelectTrigger>
                        <SelectContent>
                          {LOCALES.map((l) => (
                            <SelectItem key={l.value} value={l.value}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="signup-timezone">Zona Waktu</FieldLabel>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger id="signup-timezone">
                          <SelectValue placeholder="Pilih zona waktu" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {/* Row 6: Password */}
                  <Field>
                    <FieldLabel htmlFor="signup-password">
                      Password <span className="text-destructive">*</span>
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none"
                        onClick={() => setShowPassword((p) => !p)}
                        aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <FieldDescription>Minimal 8 karakter.</FieldDescription>
                  </Field>

                  {/* Row 7: Confirm Password */}
                  <Field>
                    <FieldLabel htmlFor="signup-confirm-password">
                      Konfirmasi Password <span className="text-destructive">*</span>
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id="signup-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none"
                        onClick={() => setShowConfirmPassword((p) => !p)}
                        aria-label={
                          showConfirmPassword
                            ? "Sembunyikan konfirmasi password"
                            : "Tampilkan konfirmasi password"
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </Field>

                  {/* Row 8: Terms & Privacy checkboxes */}
                  <Field>
                    <label className="flex items-start gap-2 text-sm leading-snug cursor-pointer">
                      <Checkbox
                        checked={agreedToTerms}
                        onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                      />
                      <span>
                        Saya menyetujui{" "}
                        <Link
                          to="/terms"
                          target="_blank"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          Syarat & Ketentuan
                        </Link>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm leading-snug cursor-pointer mt-2">
                      <Checkbox
                        checked={agreedToPrivacy}
                        onCheckedChange={(checked) => setAgreedToPrivacy(checked === true)}
                      />
                      <span>
                        Saya menyetujui{" "}
                        <Link
                          to="/privacy"
                          target="_blank"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          Kebijakan Privasi
                        </Link>
                      </span>
                    </label>
                  </Field>

                  {/* Submit */}
                  <Field>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitting || !agreedToTerms || !agreedToPrivacy}
                    >
                      {submitting ? <Spinner className="size-4" /> : null}
                      Buat Akun
                    </Button>
                    <FieldDescription className="text-center">
                      Sudah punya akun?{" "}
                      <Link to="/login" className="underline underline-offset-4">
                        Masuk
                      </Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </FieldGroup>
          </CardContent>
        </Card>
        <p className="px-6 text-center text-sm text-muted-foreground">
          Dengan membuat akun, Anda menyetujui{" "}
          <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
            Syarat & Ketentuan
          </Link>{" "}
          dan{" "}
          <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
            Kebijakan Privasi
          </Link>{" "}
          kami.
        </p>
      </div>
    </div>
  )
}
