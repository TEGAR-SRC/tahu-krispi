import { useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { apiPost } from "@/lib/api"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost("/auth/password/forgot", { email })
      setSent(true)
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>
              Enter your email and we&apos;ll send a reset link if the account exists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <FieldGroup>
                <FieldDescription className="rounded-md border bg-muted/40 p-3 text-center">
                  Check your inbox for a password reset link.
                </FieldDescription>
                <FieldDescription className="text-center">
                  <Link to="/login" className="underline underline-offset-4">
                    Back to login
                  </Link>
                </FieldDescription>
              </FieldGroup>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error ? <ErrorBanner error={error} /> : null}
                  <Field>
                    <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="m@example.com"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <Spinner className="size-4" /> : null}
                      Send reset link
                    </Button>
                    <FieldDescription className="text-center">
                      Remembered it?{" "}
                      <Link to="/login" className="underline underline-offset-4">
                        Sign in
                      </Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
