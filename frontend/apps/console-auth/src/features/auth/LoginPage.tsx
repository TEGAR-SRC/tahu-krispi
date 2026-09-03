import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Eye, EyeOff, FingerprintIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, apiPost, API_BASE } from "@/lib/api"
import { homePathFor, useAuth } from "@/lib/auth"
// ---- WebAuthn helpers --------------------------------------------------------

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
  const binary = atob(padded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

type PasskeyLoginResult =
  | { mfa_required: true; preauth_token: string; user_id: string }
  | { mfa_required?: false; access_token: string; refresh_token: string }

async function passkeyLogin(): Promise<PasskeyLoginResult> {
  if (typeof window.PublicKeyCredential === "undefined") {
    throw new Error("Browser Anda tidak mendukung passkey")
  }

  // 1. Begin
  const { data } = await apiPost<{
    options: Record<string, unknown>
    handle: string
  }>("/auth/passkey/begin-login")

  const opts = (data.options.publicKey ?? data.options) as Record<string, unknown>
  const assertionOptions: PublicKeyCredentialRequestOptions = {
    challenge: b64urlToBytes(String(opts.challenge)),
    timeout: typeof opts.timeout === "number" ? opts.timeout : 60000,
    rpId: String(opts.rpId ?? opts.rpID ?? undefined),
    userVerification: "preferred",
  }

  // 2. Ceremony
  const cred = (await navigator.credentials.get({
    publicKey: assertionOptions,
  })) as PublicKeyCredential | null
  if (!cred) throw new Error("Passkey login dibatalkan")

  const response = cred.response as AuthenticatorAssertionResponse

  // 3. Complete — may return mfa_required when TOTP is enabled (no bypass)
  const { data: result } = await apiPost<PasskeyLoginResult>("/auth/passkey/login", {
    handle: data.handle,
    credential: {
      id: cred.id,
      rawId: bytesToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bytesToB64url(response.clientDataJSON),
        authenticatorData: bytesToB64url(response.authenticatorData),
        signature: bytesToB64url(response.signature),
        userHandle: response.userHandle ? bytesToB64url(response.userHandle) : undefined,
      },
    },
  })
  return result as PasskeyLoginResult
}

export default function LoginPage() {
  const { token, role, loading, login, loginMFA } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const oauthError = searchParams.get("error")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  // Second-factor step state: set once the backend answers mfa_required.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState("")
  const [resending, setResending] = useState(false)

  // Already signed in: send the user to their role's home.
  // For customer allow a single handoff traversal; guard ?already=customer to
  // prevent infinite handoff → login → handoff loop.
  useEffect(() => {
    if (!loading && token && role) {
      if (searchParams.get("already") === "customer") return
      if (role === "customer") {
        navigate("/handoff", { replace: true })
        return
      }
      navigate(homePathFor(role), { replace: true })
    }
  }, [loading, token, role, navigate, searchParams])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await login(email, password)
      if (result.mfaRequired) {
        // First factor passed — hold the preauth token and prompt for TOTP.
        setMfaToken(result.preauthToken)
      } else if (result.role === "customer" && searchParams.get("already") !== "customer") {
        navigate("/handoff", { replace: true })
      } else {
        navigate(homePathFor(result.role), { replace: true })
      }
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  const handleResendVerification = async () => {
    if (!email) {
      toast.error("Masukkan email terlebih dahulu")
      return
    }
    setResending(true)
    try {
      await apiPost("/auth/email/resend-public", { email })
      toast.success("Email verifikasi dikirim — cek inbox kamu (otomatis setelah daftar).")
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "CONFLICT") {
        toast.error("Email sudah terverifikasi, silakan login.")
      } else {
        toast.error(cause instanceof Error ? cause.message : "Gagal mengirim email verifikasi")
      }
    } finally {
      setResending(false)
    }
  }

  const handleMFASubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mfaToken) return
    setError(null)
    setSubmitting(true)
    try {
      const nextRole = await loginMFA(mfaToken, mfaCode)
      if (nextRole === "customer" && searchParams.get("already") !== "customer") {
        navigate("/handoff", { replace: true })
      } else {
        navigate(homePathFor(nextRole), { replace: true })
      }
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setError(null)
    setPasskeyBusy(true)
    try {
      const result = await passkeyLogin()
      // No bypass: if TOTP is enabled the passkey is only the first factor.
      if ("mfa_required" in result && result.mfa_required) {
        setMfaToken(result.preauth_token)
        toast.info("Passkey OK — masukkan kode TOTP")
        return
      }
      // Cookie session already set by POST /auth/passkey/login
      window.location.href = "/handoff"
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Passkey login failed")
    } finally {
      setPasskeyBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {mfaToken ? "Verifikasi 2 langkah" : "Welcome back"}
            </CardTitle>
            <CardDescription>
              {mfaToken
                ? "Masukkan kode 6 digit dari aplikasi autentikator Anda"
                : "Sign in to your Kilat Cloud account"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mfaToken ? (
              <form onSubmit={handleMFASubmit}>
                <FieldGroup>
                  {error ? <ErrorBanner error={error} /> : null}
                  <Field>
                    <FieldLabel htmlFor="mfa-code">Kode OTP</FieldLabel>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      required
                      maxLength={6}
                      autoFocus
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </Field>
                  <Field>
                    <Button type="submit" className="w-full" disabled={submitting || mfaCode.length !== 6}>
                      {submitting ? <Spinner className="size-4" /> : null}
                      Verifikasi
                    </Button>
                    <FieldDescription className="text-center">
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => {
                          setMfaToken(null)
                          setMfaCode("")
                          setError(null)
                        }}
                      >
                        Kembali ke login
                      </button>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            ) : (
              <FieldGroup>
                {oauthError ? (
                  <ErrorBanner
                    error={
                      oauthError === "oauth_not_configured"
                        ? "OAuth belum dikonfigurasi — hubungi admin untuk set GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID"
                        : oauthError === "oauth_invalid_state"
                          ? "Sesi OAuth kadaluarsa — coba lagi"
                          : oauthError === "oauth_access_denied"
                            ? "Anda membatalkan login — coba lagi atau pakai email/password"
                            : `OAuth gagal: ${oauthError}`
                    }
                  />
                ) : null}
                {/* OAuth buttons */}
                <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      window.location.href = `${API_BASE}/auth/oauth/google`
                    }}
                  >
                    {/* Google icon */}
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
                      window.location.href = `${API_BASE}/auth/oauth/github`
                    }}
                  >
                    {/* GitHub icon */}
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

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={passkeyBusy}
                  onClick={handlePasskeyLogin}
                >
                  {passkeyBusy ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <FingerprintIcon className="size-4" />
                  )}
                  Login dengan passkey
                </Button>

                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  atau lanjutkan dengan email
                </FieldSeparator>

                <form onSubmit={handleSubmit}>
                  <FieldGroup>
                    {error ? <ErrorBanner error={error} /> : null}
                    {error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED" ? (
                      <div className="rounded-md border bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                        <p className="font-medium">Email belum diverifikasi.</p>
                        <p className="mt-1 text-muted-foreground">
                          Email verifikasi otomatis dikirim setelah pendaftaran. Cek inbox & folder spam.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleResendVerification()}
                            disabled={resending || !email}
                          >
                            {resending ? <Spinner className="size-4" /> : null} Kirim ulang email verifikasi
                          </Button>
                          <Button type="button" variant="ghost" size="sm" asChild>
                            <Link to={`/verify-email?email=${encodeURIComponent(email)}`}>Buka halaman verifikasi</Link>
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {error instanceof ApiError &&
                    error.code === "INVALID_CREDENTIALS" &&
                    (error.message.includes("not registered") ||
                      JSON.stringify(error.details ?? "").includes("belum terdaftar")) ? (
                      <div className="rounded-md border bg-blue-50 p-3 text-sm dark:bg-blue-950/30">
                        <p className="font-medium">Akun belum terdaftar.</p>
                        <p className="mt-1 text-muted-foreground">
                          Email ini belum punya akun di Kilat Cloud. Silakan daftar dulu — data lama hilang setelah DB wipe 10:56 (sudah fix persistent volume).
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" size="sm" asChild>
                            <Link to={`/signup?email=${encodeURIComponent(email)}`}>Daftar sekarang</Link>
                          </Button>
                          <Button type="button" variant="ghost" size="sm" asChild>
                            <Link to="/signup">Ke halaman daftar</Link>
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <Field>
                      <FieldLabel htmlFor="login-email">Email</FieldLabel>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="m@example.com"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <div className="flex min-w-0 items-center justify-between">
                        <FieldLabel htmlFor="login-password">Password</FieldLabel>
                        <Link
                          to="/forgot-password"
                          className="text-sm underline-offset-4 hover:underline text-muted-foreground"
                        >
                          Lupa password?
                        </Link>
                      </div>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </Field>
                    <Field>
                      <Button type="submit" className="w-full" disabled={submitting}>
                        {submitting ? <Spinner className="size-4" /> : null}
                        Masuk
                      </Button>
                      <FieldDescription className="text-center">
                        Belum punya akun?{" "}
                        <Link to="/signup" className="underline underline-offset-4">
                          Daftar sekarang
                        </Link>
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </form>
              </FieldGroup>
            )}
          </CardContent>
        </Card>
        <p className="px-6 text-center text-sm text-muted-foreground">
          Dengan melanjutkan, Anda menyetujui{" "}
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
