// Shared helpers for the platform-admin pages: API date/money formatting,
// status badges and a pagination bar. Kept local to src/features/admin/pages
// so the other role consoles stay untouched.
import { useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PagedMeta } from "@/lib/types"

const STATUS_TONES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  verified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  provisioning: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  investigating: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  queued: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  retry: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  waiting_customer: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  waiting_staff: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  open: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  suspended: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  unknown: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground",
  deleted: "bg-destructive/15 text-destructive",
}

/** Colored badge for any of the platform status enums. */
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-sm text-muted-foreground">—</span>
  const tone = STATUS_TONES[status]
  return (
    <Badge variant={tone ? "secondary" : "outline"} className={tone}>
      {status}
    </Badge>
  )
}

interface PaginationBarProps {
  meta?: PagedMeta & Record<string, unknown>
  onPageChange: (page: number) => void
  disabled?: boolean
}

/** Prev/next pager driven by the list endpoint's meta envelope. */
export function PaginationBar({ meta, onPageChange, disabled }: PaginationBarProps) {
  if (!meta) return null
  const page = meta.page
  const perPage = meta.per_page || 20
  const total = typeof meta.total === "number" ? meta.total : undefined
  const totalPages =
    total !== undefined ? Math.max(1, Math.ceil(total / perPage)) : undefined
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = total !== undefined ? Math.min(page * perPage, total) : undefined

  return (
    <div className="flex min-w-0 items-center justify-between gap-4 pt-1">
      <p className="text-xs text-muted-foreground">
        Page {page}
        {totalPages ? ` of ${totalPages}` : ""}
        {to !== undefined ? ` · showing ${from}–${to}` : ""}
        {total !== undefined ? ` of ${total}` : ""}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || (totalPages !== undefined && page >= totalPages)}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

interface DetailFieldProps {
  label: string
  children?: ReactNode
}

/** Label/value row used inside detail sheets and dialogs. */
export function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children ?? "—"}</dd>
    </div>
  )
}

/** Pretty-printed JSON block; falls back to the raw text when invalid. */
export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  let text: string
  if (typeof value === "string") {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      text = value
    }
  } else {
    try {
      text = JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
  }
  return (
    <pre
      className={`max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed ${className ?? ""}`}
    >
      {text}
    </pre>
  )
}

/** Small controlled text filter that only triggers a fetch on Enter/blur. */
export function SearchFilter({
  placeholder,
  value,
  onApply,
}: {
  placeholder: string
  value: string
  onApply: (applied: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      className="w-full sm:w-64"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onApply(draft.trim())
      }}
      onBlur={() => {
        if (draft.trim() !== value) onApply(draft.trim())
      }}
    />
  )
}
