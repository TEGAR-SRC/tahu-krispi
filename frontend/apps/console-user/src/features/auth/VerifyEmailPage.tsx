import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, apiPost } from "@/lib/api"
import { homePathFor, useAuth } from "@/lib/auth"

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { token: sessionToken, role } = useAuth()
  const emailToken = useMemo(() => params.get("token") ?? params.get("t") ?? "", [params])
  const queryEmail = useMemo(() => params.get("email") ?? "", [params])
  const [error, setError] = useState<unknown>(null)
  const [verifying, setVerifying] = useState(Boolean(emailToken))
  const [verified, setVerified] = useState(false)
  const [resending, setResending] = useState(false)
  const [emailInput, setEmailInput] = useState(queryEmail)

  useEffect(() => {
    let cancelled = false
    if (!emailToken) return
    apiPost("/auth/email/verify", { token: emailToken })
      .then(() => {
        if (!cancelled) setVerified(true)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setVerifying(false)
      })
    return () => {
      cancelled = true
    }
  }, [emailToken])

  const resend = async () => {
    setError(null)
    setResending(true)
    try {
      if (sessionToken) {
        await apiPost("/auth/email/resend")
      } else {
        const targetEmail = emailInput.trim() || queryEmail.trim()
        if (!targetEmail) {
          toast.error("Masukkan email untuk kirim ulang verifikasi")
          setResending(false)
          return
        }
        await apiPost("/auth/email/resend-public", { email: targetEmail })
      }
      toast.success("Email verifikasi dikirim — cek inbox & spam (otomatis setelah daftar)")
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "CONFLICT") {
        toast.success("Email sudah terverifikasi — silakan login")
        setError(null)
        return
      }
      setError(cause)
    } finally {
      setResending(false)
    }
  }

  const goHome = () => {
    navigate(role ? homePathFor(role) : "/login", { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Verify your email</CardTitle>
            <CardDescription>
              Buka link verifikasi dari email kamu. Email otomatis dikirim setelah pendaftaran — cek inbox & spam.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {error ? <ErrorBanner error={error} /> : null}
              {verifying ? (
                <FieldDescription className="flex min-w-0 items-center justify-center gap-2 rounded-md border bg-muted/40 p-3">
                  <Spinner className="size-4" /> Verifying email…
                </FieldDescription>
              ) : verified ? (
                <>
                  <FieldDescription className="rounded-md border bg-muted/40 p-3 text-center">
                    Your email address has been verified.
                  </FieldDescription>
                  <Button onClick={goHome}>Continue</Button>
                </>
              ) : (
                <>
                  <FieldDescription className="rounded-md border bg-muted/40 p-3 text-center">
                    Tidak ada token verifikasi di URL. Masukkan email kamu untuk kirim ulang, atau buka link dari inbox.
                  </FieldDescription>
                  {!sessionToken ? (
                    <Field>
                      <FieldLabel htmlFor="resend-email">Email</FieldLabel>
                      <Input
                        id="resend-email"
                        type="email"
                        placeholder="m@example.com"
                        autoComplete="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                      />
                    </Field>
                  ) : null}
                  <Button onClick={() => void resend()} disabled={resending}>
                    {resending ? <Spinner className="size-4" /> : null}
                    Kirim ulang email verifikasi
                  </Button>
                  {!sessionToken ? (
                    <FieldDescription className="text-center">
                      Sudah verifikasi? <Link to="/login" className="underline underline-offset-4">Masuk</Link>
                    </FieldDescription>
                  ) : null}
                </>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
