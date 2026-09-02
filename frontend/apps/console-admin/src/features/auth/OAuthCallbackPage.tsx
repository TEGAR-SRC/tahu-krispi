import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { apiPost } from "@/lib/api"
import { homePathFor, useAuth } from "@/lib/auth"

export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const { loginMFA } = useAuth()
  const [searchParams] = useSearchParams()
  const code = searchParams.get("code")
  const mfaRequired = searchParams.get("mfa_required") === "1"
  const preauthToken = searchParams.get("preauth_token")
  const error = searchParams.get("error")

  const [mfaCode, setMfaCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<unknown>(null)
  const [done, setDone] = useState(false)

  // Code handoff (OAuth success): exchange code -> session cookie, then handoff
  useEffect(() => {
    if (error) return
    if (mfaRequired) return
    if (!code || done) return
    setDone(true)
    ;(async () => {
      try {
        await apiPost("/auth/handoff/exchange", { code })
        // Clean URL
        window.history.replaceState({}, "", window.location.pathname)
        window.location.href = "/admin"
      } catch {
        toast.error("Login failed — code expired or invalid")
      }
    })()
  }, [code, mfaRequired, error, done])

  const handleMFA = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!preauthToken) return
    setLocalError(null)
    setSubmitting(true)
    try {
      const role = await loginMFA(preauthToken, mfaCode)
      toast.success("MFA verified")
      window.history.replaceState({}, "", window.location.pathname)
      navigate(homePathFor(role), { replace: true })
    } catch (cause) {
      setLocalError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    const msg =
      error === "oauth_not_configured"
        ? "OAuth belum dikonfigurasi — set GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID di backend .env"
        : error === "oauth_invalid_state"
          ? "State tidak valid atau kadaluarsa — coba lagi"
          : error === "oauth_no_email"
            ? "Provider tidak mengembalikan email — coba provider lain"
            : `OAuth gagal: ${error}`
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle>OAuth gagal</CardTitle>
            <CardDescription>{msg}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <Link to="/login">Kembali ke login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (mfaRequired && preauthToken) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4 sm:p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Verifikasi 2 langkah</CardTitle>
              <CardDescription>Masukkan kode 6 digit dari aplikasi autentikator Anda</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleMFA}>
                <FieldGroup>
                  {localError ? <ErrorBanner error={localError} /> : null}
                  <Field>
                    <FieldLabel htmlFor="oauth-mfa">Kode OTP</FieldLabel>
                    <Input
                      id="oauth-mfa"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      required
                      maxLength={6}
                      autoFocus
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                    />
                  </Field>
                  <Field>
                    <Button type="submit" className="w-full" disabled={submitting || mfaCode.length !== 6}>
                      {submitting ? <Spinner className="size-4" /> : null}
                      Verifikasi
                    </Button>
                    <FieldDescription className="text-center">
                      <Link to="/login" className="underline underline-offset-4">
                        Kembali ke login
                      </Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Menyelesaikan login…</CardTitle>
          <CardDescription>Mohon tunggu, sedang memproses OAuth</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Spinner className="size-6" />
        </CardContent>
      </Card>
    </div>
  )
}
