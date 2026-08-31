// Auth is hosted on its own subdomain (auth.kilat-cloud.com). The old consoles
// no longer render login/signup/verify/reset pages — they hard-redirect to the
// auth console, preserving any query string (e.g. ?next=, ?email=, ?token=).
import { useEffect } from "react"

const AUTH_BASE =
  (import.meta.env.VITE_AUTH_CONSOLE_URL as string) || "https://auth.kilat-cloud.com"

export function RedirectToAuth({ path = "" }: { path?: string }) {
  useEffect(() => {
    const target = `${AUTH_BASE}${path}${window.location.search}`
    window.location.replace(target)
  }, [path])
  return null
}
