// Generic fetch-and-render helpers for provider drill-down endpoints. The
// upstream PVE/vCenter payloads are heterogeneous, so columns are derived
// from the first row's primitive fields instead of hardcoded schemas.
import { useEffect, useState } from "react"
import { apiGet } from "@/lib/api"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { previewValue } from "../lib"

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

interface RawResourceTableProps {
  path: string
  query?: Record<string, string | number | boolean>
  enabled?: boolean
  emptyMessage?: string
}

/** Table (or key/value grid for object payloads) fed by a raw GET endpoint. */
export function RawResourceTable({
  path,
  query,
  enabled = true,
  emptyMessage = "No entries returned.",
}: RawResourceTableProps) {
  const { data, loading, error } = useRawResource(path, { query, enabled })
  return (
    <RawDataView data={data} loading={loading} error={error} emptyMessage={emptyMessage} />
  )
}

interface RawDataViewProps {
  data: unknown
  loading?: boolean
  error?: unknown
  emptyMessage?: string
}

/** Pure renderer for an already-fetched raw payload; no fetching of its own. */
export function RawDataView({ data, loading = false, error, emptyMessage = "No entries returned." }: RawDataViewProps) {
  if (error) return <ErrorBanner error={error} />

  if (error) return <ErrorBanner error={error} />
  if (loading) {
    return (
      <div className="space-y-2" data-loading="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
        <Skeleton className="h-6 w-4/6" />
      </div>
    )
  }

  if (Array.isArray(data)) {
    const rows = data.filter(
      (item): item is RawRow => typeof item === "object" && item !== null,
    )
    if (rows.length === 0) return <EmptyState message={emptyMessage} />
    return (
      <SimpleDataTable columns={autoColumns(rows)} rows={rows} getRowKey={(row, index) => String(row.id ?? index)} />
    )
  }

  if (typeof data === "object" && data !== null) {
    const entries = Object.entries(data as RawRow).filter(
      ([, value]) => typeof value !== "object",
    )
    if (entries.length === 0) return <EmptyState message={emptyMessage} />
    return (
      <dl className="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key.replace(/_/g, " ")}</dt>
            <dd className="break-all">{previewValue(value)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  if (typeof data === "string" && data.length > 0) {
    return <p className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">{data}</p>
  }

  return <EmptyState message={emptyMessage} />
}
