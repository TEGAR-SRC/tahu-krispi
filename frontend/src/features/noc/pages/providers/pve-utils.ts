// Non-component helpers extracted from pve.tsx so that file only exports
// components + types (react-refresh/only-export-components).
import { useEffect, useState } from "react"
import { apiGet } from "@/lib/api"

// ---- Typed fetch hook ----------------------------------------------------------

interface TypedQuery {
  [key: string]: string | number | boolean | null | undefined
}

/** Fetches one NOC-readable endpoint into a typed payload, reload-able. */
export function useTyped<T>(
  path: string,
  opts?: { query?: TypedQuery; enabled?: boolean },
): { data: T | null; loading: boolean; error: unknown; reload: () => void } {
  const queryKey = JSON.stringify(opts?.query ?? {})
  const enabled = opts?.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiGet<T>(path, {
      query: JSON.parse(queryKey) as Record<string, string | number | boolean>,
    })
      .then((envelope) => {
        if (!cancelled) setData(envelope.data)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, queryKey, enabled, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}

// ---- Provider row ------------------------------------------------------------

export interface NocProvider {
  id: string
  code: string
  name: string
  kind: "onidel" | "proxmox" | "vmware" | "dokploy" | "xcpng" | "hyperv" | "custom"
  api_base_url: string
  enabled: boolean
  health_status: string
  has_credentials: boolean
  created_at: string
}

/** Resolves one provider row through GET /admin/providers (no single GET). */
export function useNocProvider(providerId: string | undefined): {
  provider: NocProvider | null
  loading: boolean
  error: unknown
} {
  const [provider, setProvider] = useState<NocProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    apiGet<NocProvider[]>("/admin/providers")
      .then((envelope) => {
        if (cancelled) return
        setProvider(envelope.data.find((row) => row.id === providerId) ?? null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  return { provider, loading, error }
}

// ---- Formatting ------------------------------------------------------------------

export function fmtUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function fmtEpoch(seconds?: number | string | null): string {
  const n = typeof seconds === "string" ? Number(seconds) : seconds
  if (!n || n <= 0 || Number.isNaN(n)) return "—"
  return new Date(n * 1000).toLocaleString()
}

/** Renders a 0..1 fraction as a percentage, tolerating missing values. */
export function fmtFraction(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return `${Math.round(value * 100)}%`
}

/** Coerces PVE IntOrBool columns (true/1/"1") to a display value. */
export function flagLabel(value: boolean | number | string | undefined, on = "yes", off = "no"): string {
  return value === true || value === 1 || value === "1" ? on : off
}
