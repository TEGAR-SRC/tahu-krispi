// NOC job detail: the full jobs row with a pretty-printed payload viewer and
// the two queue actions the infra area grants — retry and cancel.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatCard } from "@/components/shared/StatCard"
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BanIcon, Loader2Icon, RotateCwIcon } from "lucide-react"
import { StatusBadge, fmtDateTime, toastApiError } from "../lib"

interface JobDetailPayload {
  id: string
  queue: string
  job_type: string
  organization_id: string | null
  resource_type: string
  resource_id: string
  payload: unknown
  status: "queued" | "running" | "retry" | "success" | "failed" | "cancelled" | string
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

type PendingAction = "retry" | "cancel" | null

export default function NocJobDetailPage() {
  const jobId = useParams().jobId ?? ""

  const [job, setJob] = useState<JobDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [confirm, setConfirm] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const envelope = await apiGet<JobDetailPayload>(`/admin/jobs/${jobId}`)
      setJob(envelope.data)
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const runAction = useCallback(
    async (action: Exclude<PendingAction, null>) => {
      setBusy(true)
      try {
        await apiPost(`/admin/jobs/${jobId}/${action}`)
        toast.success(action === "retry" ? "Job requeued" : "Job cancelled")
        setConfirm(null)
        await load()
      } catch (cause) {
        toastApiError(cause, `Could not ${action} the job`)
      } finally {
        setBusy(false)
      }
    },
    [jobId, load],
  )

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <JobBreadcrumb label={null} />
        <ErrorBanner error={error} />
      </div>
    )
  }

  const canRetry = job !== null && job.status !== "running"
  const canCancel = job !== null && (job.status === "queued" || job.status === "retry")

  return (
    <div className="flex flex-col gap-6">
      <JobBreadcrumb label={job ? `${job.job_type} · ${job.id.slice(0, 8)}…` : null} />

      {loading && !job ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      ) : job ? (
        <>
          <PageHeader
            title={job.job_type}
            description={`${job.id} · queue ${job.queue}`}
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!canRetry || busy} onClick={() => setConfirm("retry")}>
                  {busy && confirm === "retry" ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
                  Retry
                </Button>
                <Button size="sm" variant="destructive" disabled={!canCancel || busy} onClick={() => setConfirm("cancel")}>
                  {busy && confirm === "cancel" ? <Loader2Icon className="animate-spin" /> : <BanIcon />}
                  Cancel
                </Button>
              </div>
            }
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Status" value={<StatusBadge status={job.status} />} hint={`attempt ${job.attempts} of ${job.max_attempts}`} />
            <StatCard label="Resource" value={
              job.resource_id && ["vm", "instance"].includes(job.resource_type) ? (
                <Link to={`/noc/instances/${job.resource_id}`} className="text-base underline-offset-4 hover:underline">
                  {job.related_instance_public_id || `${job.resource_id.slice(0, 8)}…`}
                </Link>
              ) : (
                job.resource_type || "—"
              )
            } hint={job.resource_type ? `type ${job.resource_type}` : undefined} />
            <StatCard label="Created" value={fmtDateTime(job.created_at)} hint={`updated ${fmtDateTime(job.updated_at)}`} />
            <StatCard label="Completed" value={fmtDateTime(job.completed_at)} hint={job.locked_by ? `locked by ${job.locked_by}` : "not locked"} />
          </div>

          {job.last_error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Last error</p>
              <p className="mt-1 break-all font-mono text-xs">{job.last_error}</p>
            </div>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Scheduling</h2>
            <dl className="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
              <dt className="text-muted-foreground">Run after</dt>
              <dd>{fmtDateTime(job.run_after)}</dd>
              <dt className="text-muted-foreground">Locked at</dt>
              <dd>{fmtDateTime(job.locked_at)}</dd>
              <dt className="text-muted-foreground">Organization</dt>
              <dd className="break-all">{job.organization_id ?? "—"}</dd>
            </dl>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Payload</h2>
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
              {JSON.stringify(job.payload ?? null, null, 2)}
            </pre>
          </section>
        </>
      ) : (
        <EmptyState message="Job not found." description={`No job matches ${jobId}.`} />
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "retry" ? "Retry this job?" : "Cancel this job?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "retry"
                ? "The job is reset to queued and picked up again by its worker."
                : "The queued job is marked cancelled and will never execute."}
              {job ? ` Job: ${job.job_type} (${job.queue}).` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "cancel" ? "destructive" : undefined}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                if (confirm) void runAction(confirm)
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function JobBreadcrumb({ label }: { label: string | null }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/noc/jobs">Jobs</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {label ? <BreadcrumbPage>{label}</BreadcrumbPage> : <Skeleton className="h-4 w-40" />}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
