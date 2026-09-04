import { useCallback, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { RefreshCwIcon } from "lucide-react"
import { apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { PaginationBar, StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime } from "@/features/admin/pages/format"
import type { PagedMeta } from "@/lib/types"

interface OnidelJobRow {
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

const JOB_STATUSES = ["queued", "running", "retry", "success", "failed", "cancelled"] as const
const PER_PAGE = 20

export default function OnidelJobsPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const baseQueue = "provider_sync"

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const infra = useInfraGet<OnidelJobRow[]>(
    "/admin/jobs",
    { page, per_page: PER_PAGE, status: status === "all" ? null : status, queue: baseQueue },
    { intervalMs: 5000 },
  )
  const rows = Array.isArray(infra.data) ? infra.data : []
  const meta = infra.meta as PagedMeta & Record<string, unknown> | undefined
  const loading = infra.loading
  const error = infra.error
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<OnidelJobRow | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmCancel, setBulkConfirmCancel] = useState(false)

  const bulk = useBulkSelection<OnidelJobRow>((row) => row.id)

  const load = useCallback((silent: boolean) => {
    void silent
    infra.reload()
    return Promise.resolve()
  }, [infra])

  const runAction = async (job: OnidelJobRow, action: "retry" | "cancel", confirm = false) => {
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

  const runBulkAction = useCallback(
    async (action: "retry" | "cancel") => {
      const targets = bulk.resolve(rows)
      if (targets.length === 0) return
      setBulkBusy(true)
      try {
        await Promise.all(targets.map((job) => apiPost(`/admin/jobs/${job.id}/${action}`)))
        toast.success(
          `${action === "retry" ? "Re-queued" : "Cancelled"} ${targets.length} job${targets.length === 1 ? "" : "s"}`,
        )
        await load(true)
        bulk.clear()
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      } finally {
        setBulkBusy(false)
      }
    },
    [bulk, rows, load],
  )

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel jobs"
      description="Jobs filtered to queue provider_sync — Onidel catalog sync, provisioning and reconciliation workers."
      actions={
        <div className="flex min-w-0 items-center gap-2">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} id="onidel-jobs-auto-refresh" />
          <Label htmlFor="onidel-jobs-auto-refresh" className="text-sm text-muted-foreground">
            Auto-refresh 5s
          </Label>
          <Button variant="outline" size="sm" onClick={() => void load(false)} disabled={loading}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
        </div>
      }
    >
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
        <span className="text-xs text-muted-foreground">
          Queue: <span className="font-mono font-medium">provider_sync</span> · {rows.length} on page
        </span>
      </div>

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkBusy}
        actions={[
          {
            key: "retry",
            label: "Retry selected",
            onClick: () => void runBulkAction("retry"),
          },
          {
            key: "cancel",
            label: "Cancel selected",
            destructive: true,
            onClick: () => setBulkConfirmCancel(true),
          },
        ]}
      />

      <SimpleDataTable<OnidelJobRow>
        columns={[
          {
            key: "job_type",
            header: "Job",
            render: (row) => (
              <div className="min-w-0">
                <Link
                  to={`/admin/jobs/${row.id}`}
                  className="min-w-0 block truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {row.job_type}
                </Link>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {row.id.slice(0, 8)}… · {row.resource_type || "—"} {row.resource_id ? row.resource_id.slice(0, 8) : ""}
                </p>
              </div>
            ),
          },
          { key: "queue", header: "Queue", render: (row) => <span className="font-mono text-xs">{row.queue}</span> },
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
            render: (row) => <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>,
          },
          {
            key: "completed_at",
            header: "Completed",
            className: "hidden xl:table-cell",
            render: (row) => <span className="text-muted-foreground">{formatDateTime(row.completed_at)}</span>,
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
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No provider_sync jobs match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.job_type} ({cancelTarget?.id.slice(0, 8)}…) will be marked cancelled and never executed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep job</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
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

      <AlertDialog open={bulkConfirmCancel} onOpenChange={setBulkConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {bulk.selectedKeys.size} selected job{bulk.selectedKeys.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>These jobs will be marked cancelled and never executed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep jobs</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={() => {
                setBulkConfirmCancel(false)
                void runBulkAction("cancel")
              }}
            >
              Cancel jobs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProviderShell>
  )
}
