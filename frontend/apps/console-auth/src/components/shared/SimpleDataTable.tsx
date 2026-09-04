import type { ReactNode } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "./EmptyState"
import { ErrorBanner } from "./ErrorBanner"
import { cn } from "@/lib/utils"

export interface SimpleColumn<T> {
  key: string
  header: ReactNode
  /** Custom cell renderer; defaults to `String(row[key])`. */
  render?: (row: T) => ReactNode
  className?: string
}

interface SimpleDataTableProps<T> {
  columns: Array<SimpleColumn<T>>
  rows: T[]
  loading?: boolean
  error?: unknown
  skeletonRows?: number
  emptyMessage?: string
  getRowKey?: (row: T, index: number) => string
  /** Enable a leading checkbox column for bulk selection. */
  selectable?: boolean
  /** Set of selected row keys (keyed by `getRowKey`). */
  selectedKeys?: Set<string>
  /** Called whenever the selection changes (only when `selectable`). */
  onSelectionChange?: (keys: Set<string>) => void
}

/** Minimal data table with loading skeletons, error banner and empty state. */
export function SimpleDataTable<T>({
  columns,
  rows,
  loading = false,
  error,
  skeletonRows = 5,
  emptyMessage = "No data yet.",
  getRowKey,
  selectable = false,
  selectedKeys,
  onSelectionChange,
}: SimpleDataTableProps<T>) {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeColumns = Array.isArray(columns) ? columns : []
  if (error) {
    return <ErrorBanner error={error} />
  }

  if (loading) {
    return (
      <div className="space-y-2" data-loading="true">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <span>Loading…</span>
        </div>
        {Array.from({ length: Math.max(skeletonRows, 1) }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex min-w-0 items-center gap-4">
            {safeColumns.map((column) => (
              <Skeleton key={column.key} className={cn("h-6 flex-1", column.className)} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (safeRows.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  const cellFor = (row: T, column: SimpleColumn<T>): ReactNode => {
    if (column.render) return column.render(row)
    const value = (row as Record<string, unknown>)[column.key]
    return value === undefined || value === null ? "—" : String(value)
  }

  const toggleRow = (key: string, checked: boolean) => {
    if (!onSelectionChange) return
    const next = new Set(selectedKeys ?? [])
    if (checked) next.add(key)
    else next.delete(key)
    onSelectionChange(next)
  }

  const allSelected =
    safeRows.length > 0 && safeRows.every((row, index) => (selectedKeys ?? new Set()).has(getRowKey ? getRowKey(row, index) : String(index)))

  const toggleAll = (checked: boolean) => {
    if (!onSelectionChange) return
    const next = new Set(selectedKeys ?? [])
    for (const [index, row] of safeRows.entries()) {
      const key = getRowKey ? getRowKey(row, index) : String(index)
      if (checked) next.add(key)
      else next.delete(key)
    }
    onSelectionChange(next)
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable ? (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all rows"
                  checked={allSelected}
                  onCheckedChange={(value) => toggleAll(value === true)}
                  disabled={rows.length === 0}
                />
              </TableHead>
            ) : null}
            {safeColumns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {safeRows.map((row, index) => {
            const key = getRowKey ? getRowKey(row, index) : String(index)
            const selected = (selectedKeys ?? new Set()).has(key)
            return (
              <TableRow key={key} data-selected={selected ? "true" : undefined}>
                {selectable ? (
                  <TableCell className="w-10">
                    <Checkbox
                      aria-label={`Select row ${index + 1}`}
                      checked={selected}
                      onCheckedChange={(value) => toggleRow(key, value === true)}
                    />
                  </TableCell>
                ) : null}
                {safeColumns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {cellFor(row, column)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
