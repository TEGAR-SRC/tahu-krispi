// Shared plumbing for the Dokploy "app" parity section (mirrors the upstream
// dashboard). All upstream calls go through the universal backend proxy
// {METHOD} /api/v1/dokploy/{tag.op}; responses are relayed WITHOUT the
// platform envelope, so we use raw fetch like DokployHub's explorer.
import { useCallback, useEffect, useState } from "react"
import { API_BASE, getToken } from "@/lib/api"

export interface UpstreamError {
  status: number
  message: string
  body?: string
}

/** Calls the universal Dokploy proxy. Returns parsed JSON or throws UpstreamError. */
export async function dokploy<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  opPath: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${API_BASE}/dokploy/${opPath}`, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    // non-JSON body (e.g. plain text config) — pass through as string
    parsed = text
  }
  if (!response.ok) {
    let message = `Upstream ${response.status}`
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      if (typeof record.message === "string") message = record.message
      else if (Array.isArray(record.message)) message = record.message.join("; ")
    } else if (typeof parsed === "string" && parsed) {
      message = parsed.slice(0, 300)
    }
    throw {
      status: response.status,
      message,
      body: typeof parsed === "string" ? parsed : JSON.stringify(parsed),
    } satisfies UpstreamError
  }
  return parsed as T
}

/** Simple upstream loader: refetch by bumping `nonce`. */
export function useUpstream<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: UpstreamError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<UpstreamError | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    loader()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      })
      .catch((cause: UpstreamError) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}

export function toErrorMessage(error: unknown): string {
  const err = error as UpstreamError
  if (err && typeof err.status === "number") return `${err.status}: ${err.message}`
  return error instanceof Error ? error.message : "Unexpected error"
}
