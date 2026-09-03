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

    fired.current = true
    ;(async () => {
      // Re-validate role server-side before handoff to avoid using a stale
      // localStorage role (e.g. demoted admin or stale customer value).
      let freshRole = role
      try {
        const { resolveRole } = await import("@/lib/auth")
        freshRole = await resolveRole()
      } catch {
        // if resolveRole throws (session expired) let outer catch handle it
      }
      // Customer accounts stay on the auth console — no handoff needed.
      // Previously this redirected to console.kilat-cloud.com which then
      // probes /admin/* on api-user (always 403) and loops back to auth.
      if (freshRole === "customer") {
        window.location.assign("/login?already=customer")
        return
      }
      const origin = consoleUrlFor(freshRole)
      if (!origin || origin.startsWith("/")) {
        setError("Could not determine your console.")
        return
      }
      try {
        const csrf = document.cookie.match(/(?:^|;\s*)kc_csrf=([^;]+)/)
        const headers: Record<string, string> = {}
        if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf[1])
        let code: string | null = null
        try {
          const { data } = await apiPost<{ code: string }>("/auth/handoff", {}, { headers })
          code = (data as { code: string }).code
        } catch (inner) {
          const innerMsg = inner instanceof Error ? inner.message : String(inner)
          if (innerMsg.includes("CSRF") || innerMsg.includes("csrf")) {
            throw new Error(
              "Backend belum di-deploy ulang. Jalankan di VPS: git pull && docker compose --env-file compose.env up -d --build api",
            )
          }
          throw inner
        }
        if (!code) throw new Error("empty code")
        window.location.assign(`${origin}/oauth/callback?code=${encodeURIComponent(code)}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Failed to create handoff: ${msg}. Please try logging in again.`)
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
