/* eslint-disable react-refresh/only-export-components */
// Helpers shared by the admin billing pages: money/date formatting, status
// badges, a pagination control and a paged-list fetch hook. Kept local to the
// billing feature because src/components/shared only carries generic blocks.
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiGet, type ApiEnvelope } from "@/lib/api"
import type { PagedMeta } from "@/lib/types"

// ---- Formatting -------------------------------------------------------------

/** Formats an API money amount; currency comes from the API field when present. */
export function formatMoney(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const amount = typeof value === "string" ? Number(value) : value
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—"
  const code = (currency ?? "IDR").trim().toUpperCase() || "IDR"
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "IDR" ? 0 : 2,
    }).format(amount)
  } catch {
    return `${code} ${amount.toLocaleString()}`
  }
}

/** Backend timestamps arrive as "2026-08-25 11:07:10.591051+07"; normalize
 * them enough for `Date` to parse across browsers. */
function parseApiDate(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Humanizes an API timestamp; renders an em dash for blank/unparseable values. */
export function formatDateTime(value?: string | null): string {
  if (!value) return "—"
  const date = parseApiDate(value)
  return date ? date.toLocaleString() : "—"
}

// ---- Status badge -----------------------------------------------------------

const POSITIVE_STATUSES = new Set([
  "paid",
  "completed",
  "active",
  "approved",
  "enabled",
  "credit",
])
const WARNING_STATUSES = new Set([
  "pending",
  "pending_payment",
  "processing",
  "draft",
  "unpaid",
  "expired",
])

function variantFor(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (POSITIVE_STATUSES.has(status)) return "default"
  if (WARNING_STATUSES.has(status)) return "secondary"
  if (
    [
      "failed",
      "cancelled",
      "void",
      "reversed",
      "refunded",
      "partially_refunded",
      "overdue",
    ].includes(status)
  ) {
    return "destructive"
  }
  return "outline"
}

export function StatusBadge({ status }: { status?: string | null }) {
  const label = (status ?? "").trim()
  if (!label) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant={variantFor(label)} className="capitalize">
      {label.replace(/_/g, " ")}
    </Badge>
  )
}

// ---- Pagination control -------------------------------------------------------

interface PagerProps {
  page: number
  meta: PagedMeta | null
  onPage: (page: number) => void
  disabled?: boolean
}

/** Prev/next pager driven by the API's `meta` envelope. */
export function Pager({ page, meta, onPage, disabled = false }: PagerProps) {
  const total = meta?.total
  const perPage = meta?.per_page ?? 20
  const lastPage =
    typeof total === "number" ? Math.max(1, Math.ceil(total / perPage)) : null
  const rangeLabel =
    typeof total === "number" && total > 0
      ? `Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} of ${total}`
      : typeof total === "number"
        ? "0 results"
        : `Page ${page}`

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{rangeLabel}</p>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || (lastPage !== null && page >= lastPage)}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

// ---- Paged list hook ----------------------------------------------------------

export interface PagedList<T> {
  rows: T[]
  meta: PagedMeta | null
  loading: boolean
  error: unknown
  page: number
  setPage: (page: number) => void
  reload: () => void
}

type QueryValue = string | number | boolean | undefined

/**
 * Fetches one paginated admin listing. The query object is serialized so
 * callers can pass inline literals without re-triggering the effect.
 */
export function usePagedList<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  perPage = 20,
): PagedList<T> {
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<T[]>([])
  const [meta, setMeta] = useState<PagedMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const queryKey = JSON.stringify(query)

  useEffect(() => {
    let cancelled = false
    // Deferred to a microtask so no state is set synchronously in the effect.
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<T[]>(path, {
        query: {
          ...(JSON.parse(queryKey) as Record<string, QueryValue>),
          page,
          per_page: perPage,
        },
      })
        .then((envelope: ApiEnvelope<T[]>) => {
          if (cancelled) return
          setRows(Array.isArray(envelope.data) ? envelope.data : [])
          setMeta(envelope.meta ?? null)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setRows([])
          setMeta(null)
          setError(cause)
          setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [path, queryKey, page, perPage, reloadTick])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  return { rows, meta, loading, error, page, setPage, reload }
}
