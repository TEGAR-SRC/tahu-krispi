// Non-component helpers extracted from RawResourceTable.tsx so that file only
// exports components (react-refresh/only-export-components).
import { useEffect, useState } from "react"
import { apiGet } from "@/lib/api"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { previewValue } from "../lib-utils"

export type RawRow = Record<string, unknown>

interface UseRawResourceOptions {
  query?: Record<string, string | number | boolean>
  enabled?: boolean
}

export interface RawResourceState {
  data: unknown
  loading: boolean
  error: unknown
  reload: () => void
}

/** Fetches an arbitrary GET endpoint and exposes its raw `data` payload. */
export function useRawResource(
  path: string,
  { query, enabled = true }: UseRawResourceOptions = {},
): RawResourceState {
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  const queryString = JSON.stringify(query ?? {})

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiGet<unknown>(path, {
      query: JSON.parse(queryString) as Record<string, string | number | boolean>,
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
  }, [path, queryString, enabled, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}

/** Derives display columns from the first row's primitive fields. */
export function autoColumns(rows: RawRow[]): Array<SimpleColumn<RawRow>> {
  const first = rows[0]
  if (!first) return []
  let keys = Object.keys(first).filter((key) => {
    const value = first[key]
    return (
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    )
  })
  if (keys.length === 0) keys = Object.keys(first)
  return keys.slice(0, 8).map((key) => ({
    key,
    header: key.replace(/_/g, " "),
    render: (row: RawRow) => previewValue(row[key]),
  }))
}
