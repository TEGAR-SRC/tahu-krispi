import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { apiPost } from "@/lib/api"
import { homePathFor, useAuth } from "@/lib/auth"

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { token: sessionToken, role } = useAuth()
  const emailToken = useMemo(() => params.get("token") ?? params.get("t") ?? "", [params])
  const [error, setError] = useState<unknown>(null)
  const [verifying, setVerifying] = useState(Boolean(emailToken))
  const [verified, setVerified] = useState(false)
  const [resending, setResending] = useState(false)

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
      await apiPost("/auth/email/resend")
      toast.success("Verification email resent")
    } catch (cause) {
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
              Open your verification link, or resend the email from an active session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {error ? <ErrorBanner error={error} /> : null}
              {verifying ? (
                <FieldDescription className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 p-3">
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
                    No verification token was found in the URL. If you are signed in, request a fresh email.
                  </FieldDescription>
                  <Button onClick={() => void resend()} disabled={resending || !sessionToken}>
                    {resending ? <Spinner className="size-4" /> : null}
                    Resend verification email
                  </Button>
                  {!sessionToken ? (
                    <FieldDescription className="text-center">
                      <Link to="/login" className="underline underline-offset-4">
                        Sign in to resend
                      </Link>
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
