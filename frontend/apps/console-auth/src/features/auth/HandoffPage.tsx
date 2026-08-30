// Post-sign-in handoff. The auth console resolves the caller's role and then
// bounces them to their console, passing the session through the URL fragment
// in the exact shape each console's /oauth/callback already parses:
//   #access_token=...&refresh_token=...
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { consoleUrlFor, useAuth } from "@/lib/auth"

export default function HandoffPage() {
  const { token, role, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    if (loading) return

    if (!token || !role) {
      setError("You are not signed in.")
      return
    }

    const origin = consoleUrlFor(role)
    if (!origin || origin.startsWith("/")) {
      setError("Could not determine your console.")
      return
    }

    fired.current = true
    let fragment = `access_token=${encodeURIComponent(token)}`
    try {
      const refreshToken = localStorage.getItem("kc_refresh_token")
      if (refreshToken) fragment += `&refresh_token=${encodeURIComponent(refreshToken)}`
    } catch {
      // ignore storage errors
    }

    window.location.assign(`${origin}/oauth/callback#${fragment}`)
  }, [token, role, loading])

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
