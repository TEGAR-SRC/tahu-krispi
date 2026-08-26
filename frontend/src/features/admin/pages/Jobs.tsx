// Platform-admin job queue: filter by status/queue, optional 5s auto-refresh,
// retry/cancel actions and a detail dialog with the raw payload JSON.
import { useCallback, useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  DetailField,
  JsonBlock,
  PaginationBar,
  SearchFilter,
  StatusBadge,
  formatDateTime,
} from "./shared"

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

interface AdminJobDetail extends AdminJobRow {
  payload: unknown
  locked_at: string
  updated_at: string
  related_instance_public_id: string
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

  const [detail, setDetail] = useState<AdminJobDetail | null>(null)
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
    void load(false)
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const handle = window.setInterval(() => void load(true), AUTO_REFRESH_MS)
    return () => window.clearInterval(handle)
  }, [autoRefresh, load])

  // Keep an open detail dialog in sync while auto-refresh is running.
  useEffect(() => {
    if (!autoRefresh || !detail) return
    const id = detail.id
    const handle = window.setInterval(() => {
      apiGet<AdminJobDetail>(`/admin/jobs/${id}`)
        .then(({ data }) => setDetail(data))
        .catch(() => {
          // Row may disappear; leave the stale detail on screen.
        })
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(handle)
  }, [autoRefresh, detail])

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
          <SelectTrigger className="w-[170px]">
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

      <SimpleDataTable<AdminJobRow>
        columns={[
          {
            key: "id",
            header: "Job",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.job_type}</p>
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

      {/* Job detail with payload JSON. */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.job_type}</DialogTitle>
                <DialogDescription>
                  Queue {detail.queue} ·{" "}
                  <span className="font-mono">{detail.id}</span>
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <DetailField label="Status">
                  <StatusBadge status={detail.status} />
                </DetailField>
                <DetailField label="Attempts">
                  {detail.attempts}/{detail.max_attempts}
                </DetailField>
                <DetailField label="Locked by">{detail.locked_by || "—"}</DetailField>
                <DetailField label="Resource">
                  {detail.resource_type || "—"}
                  {detail.resource_id ? ` · ${detail.resource_id.slice(0, 8)}…` : ""}
                </DetailField>
                {detail.related_instance_public_id ? (
                  <DetailField label="Related instance">
                    <span className="font-mono text-xs">
                      {detail.related_instance_public_id}
                    </span>
                  </DetailField>
                ) : null}
                <DetailField label="Run after">
                  {formatDateTime(detail.run_after)}
                </DetailField>
                <DetailField label="Created">{formatDateTime(detail.created_at)}</DetailField>
                <DetailField label="Completed">
                  {formatDateTime(detail.completed_at)}
                </DetailField>
              </dl>
              {detail.last_error ? (
                <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                  <p className="font-semibold">Last error</p>
                  <p className="mt-1 break-all whitespace-pre-wrap">{detail.last_error}</p>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>Payload</Label>
                <JsonBlock value={detail.payload} />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

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
