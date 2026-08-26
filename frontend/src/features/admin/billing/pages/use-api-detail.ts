// Single-resource fetch hook shared by the admin billing DETAIL pages.
// Kept in a plain .ts so the react-refresh rule only sees components in
// ./detailShared.tsx.
import { useCallback, useEffect, useState } from "react"
import { apiGet } from "@/lib/api"

export interface ApiDetail<T> {
  data: T | null
  loading: boolean
  error: unknown
  reload: () => void
}

/** Fetches one resource for a detail page; re-fetches when `path` or the
 * serialized headers change (e.g. X-Organization-ID for wallet reads). */
export function useApiDetail<T>(
  path: string | null,
  headers: Record<string, string> = {},
): ApiDetail<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  // Only the serialized form goes into the effect deps so an inline literal
  // header object does not retrigger the fetch every render.
  const headerKey = JSON.stringify(headers)

  useEffect(() => {
    if (!path) {
      const t = setTimeout(() => {
        setLoading(false)
        setError(new Error("No identifier in route."))
      }, 0)
      return () => clearTimeout(t)
    }
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<T>(path, { headers: JSON.parse(headerKey) as Record<string, string> })
        .then((envelope) => {
          if (cancelled) return
          setData(envelope.data)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setError(cause)
          setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [path, headerKey, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, loading, error, reload }
}
