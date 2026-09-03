// Infra loader hook + small formatters shared by the provider detail sub-pages
// (Nodes, Storages, SDN, Ceph, …). Kept in a plain .ts so the react-refresh
// rule only sees components in ./shared.tsx.
import { useEffect, useMemo, useState } from "react"
import { apiGet } from "@/lib/api"

export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: unknown
}

/**
 * Generic GET loader; `path === null` means idle (no request). Query objects
 * are compared by value so call sites can pass fresh literals.
 */
export function useInfraGet<T>(
  path: string | null,
  query?: Record<string, string | number | boolean | null | undefined>,
  opts?: { intervalMs?: number },
): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  })
  const [tick, setTick] = useState(0)
  const queryKey = useMemo(() => JSON.stringify(query ?? null), [query])
  const intervalMs = opts?.intervalMs
  useEffect(() => {
    if (!path) {
      const t = setTimeout(() => setState({ data: null, loading: false, error: null }), 0)
      return () => clearTimeout(t)
    }
    let cancelled = false
    apiGet<T>(path, {
      query:
        queryKey === "null"
          ? undefined
          : (JSON.parse(queryKey) as Record<
              string,
              string | number | boolean | null | undefined
            >),
    })
      .then((envelope) => {
        if (!cancelled) setState({ data: envelope.data, loading: false, error: null })
      })
      .catch((cause) => {
        if (!cancelled) setState({ data: null, loading: false, error: cause })
      })
    return () => {
      cancelled = true
    }
  }, [path, tick, queryKey])
  useEffect(() => {
    if (!path || !intervalMs || intervalMs <= 0) return
    const id = setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => clearInterval(id)
  }, [path, queryKey, intervalMs])
  return { ...state, reload: () => setTick((value) => value + 1) }
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

/** Human-readable byte size ("1.5 GB"); "—" for null/NaN inputs. */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** Seconds → compact humanized uptime ("3d 4h", "12m"); "—" when absent. */
export function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** 0..1 fraction → percent string with one decimal; "—" otherwise. */
export function formatPercent(fraction?: number | null): string {
  if (fraction === undefined || fraction === null || Number.isNaN(fraction)) {
    return "—"
  }
  return `${(fraction * 100).toFixed(1)}%`
}
