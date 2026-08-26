// Platform-admin job queue: filter by status/queue, optional 5s auto-refresh,
// retry/cancel actions and navigation into the dedicated job detail page.
// Queues seen in the loaded rows are also surfaced as quick-links to the
// per-queue boards (/admin/jobs/queue/:queue).
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, SearchFilter, StatusBadge } from "./shared"
import { formatDateTime } from "./format"

interface AdminJobRow {
  id: string
  queue: string
  job_type: string
  organization_id: string | null
  resource_type: string
  resource_id: string
  status: string
  attempts: number
  max_attempts: number
  run_after: string
  locked_by: string
  last_error: string
  created_at: string
  completed_at: string
}

const JOB_STATUSES = ["queued", "running", "retry", "success", "failed", "cancelled"]
const PER_PAGE = 20
const AUTO_REFRESH_MS = 5000

export default function AdminJobsPage() {
  const [rows, setRows] = useState<AdminJobRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [queue, setQueue] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const [cancelTarget, setCancelTarget] = useState<AdminJobRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(
    (silent: boolean) => {
      if (!silent) setLoading(true)
      return apiGet<AdminJobRow[]>("/admin/jobs", {
        query: {
          page,
          per_page: PER_PAGE,
          status: status === "all" ? null : status,
          queue: queue || null,
        },
      })
        .then((envelope) => {
          setRows(envelope.data)
          setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
          setError(null)
        })
        .catch((cause) => {
          setError(cause)
        })
        .finally(() => {
          setLoading(false)
        })
    },
    [page, status, queue],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(false), 0)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const handle = window.setInterval(() => void load(true), AUTO_REFRESH_MS)
    return () => window.clearInterval(handle)
  }, [autoRefresh, load])

  // Queues observed in the currently loaded rows drive the quick-link chips.
  const queues = useMemo(
    () => [...new Set(rows.map((row) => row.queue).filter(Boolean))].sort(),
    [rows],
  )

  const runAction = async (
    job: AdminJobRow,
    action: "retry" | "cancel",
    confirm = false,
  ) => {
    if (confirm) {
      setCancelTarget(job)
      return
    }
    setBusyId(job.id)
    try {
      await apiPost(`/admin/jobs/${job.id}/${action}`)
      toast.success(action === "retry" ? "Job re-queued" : "Job cancelled")
      await load(true)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Background job queue across all workers."
        actions={
          <div className="flex items-center gap-2">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} id="jobs-auto-refresh" />
            <Label htmlFor="jobs-auto-refresh" className="text-sm text-muted-foreground">
              Auto-refresh 5s
            </Label>
            <Button variant="outline" size="sm" onClick={() => void load(false)}>
              <RefreshCwIcon /> Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-42.5">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {JOB_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchFilter
          placeholder="Queue name (e.g. email)…"
          value={queue}
          onApply={(applied) => {
            setQueue(applied)
            setPage(1)
          }}
        />
      </div>

      {queues.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Queue boards:</span>
          {queues.map((name) => (
            <Badge key={name} variant="secondary" asChild>
              <Link
                to={`/admin/jobs/queue/${encodeURIComponent(name)}`}
                className="capitalize hover:bg-secondary/80"
              >
                {name}
              </Link>
            </Badge>
          ))}
        </div>
      ) : null}

      <SimpleDataTable<AdminJobRow>
        columns={[
          {
            key: "id",
            header: "Job",
            render: (row) => (
              <div className="min-w-0">
                <Link
                  to={`/admin/jobs/${row.id}`}
                  className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {row.job_type}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.id.slice(0, 8)}…
                </p>
              </div>
            ),
          },
          { key: "queue", header: "Queue" },
          { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "attempts",
            header: "Attempts",
            render: (row) => `${row.attempts}/${row.max_attempts}`,
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "completed_at",
            header: "Completed",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.completed_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-40 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                {row.status !== "running" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      void runAction(row, "retry")
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
                {row.status === "queued" || row.status === "retry" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      void runAction(row, "cancel", true)
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No jobs match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.job_type} ({cancelTarget?.id.slice(0, 8)}…) will be marked
              cancelled and never executed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep job</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = cancelTarget
                setCancelTarget(null)
                if (target) void runAction(target, "cancel")
              }}
            >
              Cancel job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
