// Generic fetch-and-render helpers for provider drill-down endpoints. The
// upstream PVE/vCenter payloads are heterogeneous, so columns are derived
// from the first row's primitive fields instead of hardcoded schemas.
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  autoColumns,
  useRawResource,
  type RawRow,
} from "./rawResourceUtils"
import { previewValue } from "../lib-utils"

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
      <dl className="grid w-full max-w-full min-w-0 grid-cols-[minmax(10rem,1fr)_2fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
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
