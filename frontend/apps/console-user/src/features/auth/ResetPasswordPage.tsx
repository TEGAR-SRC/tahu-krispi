import { useMemo, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Spinner } from "@/components/ui/spinner"
import { apiPost } from "@/lib/api"

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const initialToken = useMemo(() => params.get("token") ?? params.get("t") ?? "", [params])
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError(new Error("Passwords do not match"))
      return
    }
    if (password.length < 10) {
      setError(new Error("Password must be at least 10 characters"))
      return
    }
    setSubmitting(true)
    try {
      await apiPost("/auth/password/reset", { token, new_password: password })
      setDone(true)
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
            <CardTitle className="text-xl">Choose a new password</CardTitle>
            <CardDescription>Use the token from your reset email to set a new password.</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <FieldGroup>
                <FieldDescription className="rounded-md border bg-muted/40 p-3 text-center">
                  Your password has been reset.
                </FieldDescription>
                <FieldDescription className="text-center">
                  <Link to="/login" className="underline underline-offset-4">
                    Sign in
                  </Link>
                </FieldDescription>
              </FieldGroup>
            ) : (
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error ? <ErrorBanner error={error} /> : null}
                  <Field>
                    <FieldLabel htmlFor="reset-token">Reset token</FieldLabel>
                    <Input
                      id="reset-token"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      autoComplete="one-time-code"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reset-password">New password</FieldLabel>
                    <Input
                      id="reset-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={10}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reset-confirm-password">Confirm password</FieldLabel>
                    <Input
                      id="reset-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={10}
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <FieldDescription>Must be at least 10 characters long.</FieldDescription>
                  </Field>
                  <Field>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <Spinner className="size-4" /> : null}
                      Reset password
                    </Button>
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
