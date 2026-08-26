import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Eye, EyeOff } from "lucide-react"
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
import { homePathFor, useAuth } from "@/lib/auth"

export default function LoginPage() {
  const { token, role, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in: send the user to their role's home.
  useEffect(() => {
    if (!loading && token && role) {
      navigate(homePathFor(role), { replace: true })
    }
  }, [loading, token, role, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const nextRole = await login(email, password)
      navigate(homePathFor(nextRole), { replace: true })
    } catch (cause) {
      setError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your Kilat Cloud account</CardDescription>
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
                    window.location.href = "/api/v1/auth/oauth/github"
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

              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                atau lanjutkan dengan email
              </FieldSeparator>

              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {error ? <ErrorBanner error={error} /> : null}
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
                    <div className="flex items-center justify-between">
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
                        tabIndex={-1}
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
