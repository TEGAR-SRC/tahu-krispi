// Admin job detail: the whole jobs row, pretty-printed payload JSON and
// retry/cancel where the backend allows them (retry: anything not running;
// cancel: queued/retry only).
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DetailField, JsonBlock, StatusBadge } from "./shared"
import { formatDateTime } from "./format"
import { ConfirmDialog } from "./providers/shared"

interface JobDetailPayload {
  id: string
  queue: string
  job_type: string
  organization_id: string | null
  resource_type: string
  resource_id: string
  payload: unknown
  status: string
  attempts: number
  max_attempts: number
  run_after: string
  locked_by: string
  locked_at: string
  last_error: string
  created_at: string
  updated_at: string
  completed_at: string
  related_instance_public_id: string
}

export default function AdminJobDetailPage() {
  const params = useParams()
  const jobId = params.jobId ?? ""

  const [job, setJob] = useState<JobDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [retryOpen, setRetryOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!jobId) return
    setLoading(true)
    apiGet<JobDetailPayload>(`/admin/jobs/${jobId}`)
      .then(({ data }) => {
        setJob(data)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  const postAction = async (action: "retry" | "cancel", success: string) => {
    setBusy(true)
    try {
      await apiPost(`/admin/jobs/${jobId}/${action}`)
      toast.success(success)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  if (!jobId) {
    return <EmptyState message="Job id missing." />
  }

  const canRetry = job !== null && job.status !== "running" && job.status !== "queued"
  const canCancel = job?.status === "queued" || job?.status === "retry"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/jobs">Jobs</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {job ? job.job_type : `${jobId.slice(0, 8)}…`}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {job?.job_type ?? "Job"}
            {job ? <StatusBadge status={job.status} /> : null}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{jobId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!canRetry || busy} onClick={() => setRetryOpen(true)}>
            Retry
          </Button>
          <Button variant="destructive" size="sm" disabled={!canCancel || busy} onClick={() => setCancelOpen(true)}>
            Cancel
          </Button>
        </div>
      </div>

      {loading && !job ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : !job ? (
        <EmptyState message="Job not found." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Execution</CardTitle>
              <CardDescription>Queue placement and attempt bookkeeping.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <DetailField label="Queue">{job.queue}</DetailField>
                <DetailField label="Status">
                  <StatusBadge status={job.status} />
                </DetailField>
                <DetailField label="Attempts">
                  {job.attempts}/{job.max_attempts}
                </DetailField>
                <DetailField label="Locked by">{job.locked_by || "—"}</DetailField>
                <DetailField label="Run after">{formatDateTime(job.run_after)}</DetailField>
                <DetailField label="Locked at">{formatDateTime(job.locked_at)}</DetailField>
                <DetailField label="Created">{formatDateTime(job.created_at)}</DetailField>
                <DetailField label="Completed">{formatDateTime(job.completed_at)}</DetailField>
                <DetailField label="Resource">
                  {job.resource_type || "—"}
                  {job.resource_id ? ` · ${job.resource_id.slice(0, 8)}…` : ""}
                </DetailField>
                <DetailField label="Organization">
                  {job.organization_id ? `${job.organization_id.slice(0, 8)}…` : "—"}
                </DetailField>
                {job.related_instance_public_id ? (
                  <DetailField label="Related instance">
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      to={`/admin/instances`}
                    >
                      {job.related_instance_public_id}
                    </Link>
                  </DetailField>
                ) : null}
                <DetailField label="Updated">{formatDateTime(job.updated_at)}</DetailField>
              </dl>
              {job.last_error ? (
                <div className="mt-4 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                  <p className="font-semibold">Last error</p>
                  <p className="mt-1 break-all whitespace-pre-wrap">{job.last_error}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Payload</h2>
            <JsonBlock value={job.payload} />
          </section>
        </>
      )}

      <ConfirmDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        title={`Retry "${job?.job_type}"?`}
        body="The job is re-queued immediately with attempts and errors reset."
        confirmLabel="Retry job"
        destructive={false}
        busy={busy}
        onConfirm={() => {
          setRetryOpen(false)
          void postAction("retry", "Job re-queued")
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel "${job?.job_type}"?`}
        body="The job is marked cancelled and will never execute."
        confirmLabel="Cancel job"
        busy={busy}
        onConfirm={() => {
          setCancelOpen(false)
          void postAction("cancel", "Job cancelled")
        }}
      />
    </div>
  )
}
