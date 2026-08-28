import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Loader2Icon, RotateCwIcon, BanIcon } from "lucide-react"
import { type JobRow, StatusBadge } from "../lib"
import { fmtDateTime, toastApiError } from "../lib-utils"

const PER_PAGE = 20
const JOB_STATUSES = ["queued", "running", "retry", "success", "failed", "cancelled"] as const

export default function NocJobsPage() {
  const [rows, setRows] = useState<JobRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Filtering is done server-side via ?status=/?queue= so pagination stays correct.
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [queueQuery, setQueueQuery] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)

  const [actionJob, setActionJob] = useState<{ job: JobRow; op: "retry" | "cancel" } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(
    async (targetPage: number, silent = false) => {
      if (!silent) setLoading(true)
      try {
        const envelope = await apiGet<JobRow[]>("/admin/jobs", {
          query: {
            page: targetPage,
            per_page: PER_PAGE,
            ...(statusFilter !== "all" ? { status: statusFilter } : {}),
            ...(queueQuery.trim() ? { queue: queueQuery.trim() } : {}),
          },
        })
        setRows(envelope.data)
        setTotal(envelope.meta?.total ?? envelope.data.length)
        setPage(targetPage)
        setError(null)
      } catch (cause) {
        if (!silent) setError(cause)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [statusFilter, queueQuery],
  )

  // Reload from page 1 whenever the filters change (debounced for the queue input).
  useEffect(() => {
    const timer = setTimeout(() => void load(1), 300)
    return () => clearTimeout(timer)
  }, [load])

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!autoRefresh) return
    timerRef.current = setInterval(() => void load(page, true), 5000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh, page, load])

  const runAction = useCallback(
    async (job: JobRow, op: "retry" | "cancel") => {
      setBusyId(job.id)
      try {
        await apiPost(`/admin/jobs/${job.id}/${op}`)
        toast.success(
          op === "retry" ? `Job ${job.job_type} requeued` : `Job ${job.job_type} cancelled`,
        )
        setActionJob(null)
        await load(page, true)
      } catch (cause) {
        toastApiError(cause, `Could not ${op} job`)
      } finally {
        setBusyId(null)
      }
    },
    [load, page],
  )

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const columns: Array<SimpleColumn<JobRow>> = [
    {
      key: "job_type",
      header: "Job",
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/noc/jobs/${row.id}`}
            className="min-w-0 block truncate font-medium underline-offset-4 hover:underline"
          >
            {row.job_type}
          </Link>
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {row.resource_type ? `${row.resource_type} ${row.resource_id.slice(0, 8)}…` : row.id.slice(0, 8) + "…"}
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
      key: "last_error",
      header: "Last error",
      render: (row) =>
        row.last_error ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 block max-w-48 truncate text-xs text-destructive">
                  {row.last_error}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-80 break-words">{row.last_error}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          "—"
        ),
    },
    { key: "created_at", header: "Created", render: (row) => fmtDateTime(row.created_at) },
    {
      key: "completed_at",
      header: "Completed",
      render: (row) => fmtDateTime(row.completed_at),
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      render: (row) => {
        const busy = busyId === row.id
        const canRetry = row.status !== "running" && busyId === null
        const canCancel = (row.status === "queued" || row.status === "retry") && busyId === null
        return (
          <div className="flex justify-end gap-1">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Retry job ${row.job_type}`}
                    disabled={!canRetry}
                    onClick={() => setActionJob({ job: row, op: "retry" })}
                  >
                    {busy && actionJob?.op === "retry" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <RotateCwIcon />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {row.status === "running" ? "Cannot retry a running job" : "Requeue job"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancel job ${row.job_type}`}
                    disabled={!canCancel}
                    onClick={() => setActionJob({ job: row, op: "cancel" })}
                  >
                    {busy && actionJob?.op === "cancel" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <BanIcon />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {canCancel ? "Cancel queued job" : "Only queued jobs can be cancelled"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Background queue across provisioning, maintenance and email workers."
        actions={
          <div className="flex min-w-0 items-center gap-2">
            <Switch id="jobs-auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="jobs-auto-refresh" className="text-sm text-muted-foreground">
              Auto-refresh 5s
            </Label>
            <Button variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {JOB_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by queue…"
          value={queueQuery}
          onChange={(event) => setQueueQuery(event.target.value)}
          className="w-56"
        />
        <span className="text-sm text-muted-foreground">
          {rows.length} on this page · {total} total
        </span>
      </div>

      <SimpleDataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        skeletonRows={8}
        emptyMessage="No jobs match the current filters."
        getRowKey={(row) => row.id}
      />

      <div className="flex min-w-0 items-center justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => void load(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => void load(page + 1)}
        >
          Next
        </Button>
      </div>

      {/* Retry is reversible-ish but resets error state; cancel is final. Both confirm. */}
      <AlertDialog
        open={actionJob !== null}
        onOpenChange={(open) => !open && setActionJob(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionJob?.op === "retry" ? "Retry this job?" : "Cancel this job?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionJob?.op === "retry"
                ? `The job will be reset to queued and run again by its worker.`
                : `The queued job will be marked cancelled and never executed.`}
              {actionJob ? ` Job: ${actionJob.job.job_type} (${actionJob.job.queue}).` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (actionJob) void runAction(actionJob.job, actionJob.op)
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
