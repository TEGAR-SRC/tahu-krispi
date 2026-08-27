import type { ReactNode } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
}: SimpleDataTableProps<T>) {
  if (error) {
    return <ErrorBanner error={error} />
  }

  if (loading) {
    return (
      <div className="space-y-2" data-loading="true">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          <span>Loading…</span>
        </div>
        {Array.from({ length: Math.max(skeletonRows, 1) }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4">
            {columns.map((column) => (
              <Skeleton key={column.key} className={cn("h-6 flex-1", column.className)} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />
  }

  const cellFor = (row: T, column: SimpleColumn<T>): ReactNode => {
    if (column.render) return column.render(row)
    const value = (row as Record<string, unknown>)[column.key]
    return value === undefined || value === null ? "—" : String(value)
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={getRowKey ? getRowKey(row, index) : index}>
              {columns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {cellFor(row, column)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
