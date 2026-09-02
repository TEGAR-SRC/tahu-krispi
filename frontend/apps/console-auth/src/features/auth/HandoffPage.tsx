// Post-sign-in handoff. Creates a short-lived single-use code on the
// auth API host and redirects to the target console with ?code=.
// The target console exchanges the code for a session cookie — no token in URL.
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { consoleUrlFor, useAuth } from "@/lib/auth"
import { apiPost } from "@/lib/api"

export default function HandoffPage() {
  const { role, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    if (loading) return

    if (!role) {
      setError("You are not signed in.")
      return
    }

    const origin = consoleUrlFor(role)
    if (!origin || origin.startsWith("/")) {
      setError("Could not determine your console.")
      return
    }

    fired.current = true
    ;(async () => {
      try {
        const { data } = await apiPost<{ code: string }>("/auth/handoff", {})
        const code = (data as { code: string }).code
        window.location.assign(`${origin}/oauth/callback?code=${encodeURIComponent(code)}`)
      } catch {
        setError("Failed to create handoff. Please try logging in again.")
      }
    })()
  }, [role, loading])

  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{error}</p>
        <Button asChild variant="outline">
          <Link to="/login">Back to login</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <Spinner className="size-6" />
      <p className="text-muted-foreground">Redirecting to your console…</p>
    </div>
  )
}
