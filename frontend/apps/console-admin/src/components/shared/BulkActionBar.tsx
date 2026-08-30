import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Loader2Icon } from "lucide-react"

export interface BulkAction {
  key: string
  label: string
  /** Restrict to selected ids meeting a predicate (e.g. only pending rows). */
  disabledFor?: (keys: Set<string>, rows: unknown[]) => boolean
  /** Render a destructive-styled button when true. */
  destructive?: boolean
  variant?: "default" | "outline" | "destructive" | "ghost"
  onClick: () => void
}

interface BulkActionBarProps {
  selectedCount: number
  actions: BulkAction[]
  /** When true, all action buttons are disabled (e.g. while a request runs). */
  busy?: boolean
  children?: ReactNode
}

/**
 * Bar shown above/below a table when rows are selected. The caller owns the
 * selected-keys state (via `useBulkSelection`) and the per-action confirm +
 * API calls. Each action runs over the caller's resolved rows.
 */
export function BulkActionBar({ selectedCount, actions, busy = false, children }: BulkActionBarProps) {
  if (selectedCount === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium tabular-nums">
        {selectedCount} selected
      </span>
      <span className="h-4 w-px bg-border" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            size="sm"
            variant={action.variant ?? (action.destructive ? "destructive" : "default")}
            disabled={busy}
            onClick={action.onClick}
          >
            {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            {action.label}
          </Button>
        ))}
        {children}
      </div>
    </div>
  )
}

/**
 * Reusable bulk-selection state for a list page. `getRowKey` must match the
 * one passed to `SimpleDataTable`. Resolve the actual selected rows with
 * `selectedKeys` against your fetched `rows` array when firing an action.
 */
export function useBulkSelection<T>(getRowKey: (row: T, index: number) => string) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  return {
    getRowKey,
    selectedKeys,
    onSelectionChange: setSelectedKeys,
    /** Resolve the currently-selected rows in a given array order. */
    resolve: (rows: T[]) => rows.filter((row, index) => selectedKeys.has(getRowKey(row, index))),
    clear: () => setSelectedKeys(new Set()),
  }
}
