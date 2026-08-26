// ISO detail: live download/registration progress with polling while
// processing, retry of failed registrations and delete. Attachment to
// instances lives on the instance pages.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatBytes, formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface IsoView {
  id?: string
  external_id?: string
  name: string
  filename?: string
  description?: string
  source_url?: string
  size_bytes: number
  status: string
  register_status?: string
  progress_percent?: number
  is_system?: boolean
  created_at?: string
}

// States where the provider pipeline is still moving — poll for progress.
const PROCESSING_STATUSES = new Set(["pending", "processing", "uploading", "registering"])

export default function CustomerIsoDetailPage() {
  const { isoId } = useParams()
  const navigate = useNavigate()
  const { orgId } = useOrg()
  const [iso, setIso] = useState<IsoView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [retrying, setRetrying] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Polling bookkeeping; stop after ~10 minutes to avoid endless timers.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0)

  const load = useCallback(async () => {
    if (!orgId || !isoId) return
    try {
      const { data } = await apiGet<IsoView>(`/isos/${isoId}`, { headers: orgHeaders(orgId) })
      setIso(data)
      setError(null)
    } catch (cause) {
      setError(cause)
    }
  }, [orgId, isoId])

  useEffect(() => {
    if (!orgId || !isoId) return
    const t = setTimeout(() => void load().finally(() => setLoading(false)), 0)
    return () => clearTimeout(t)
  }, [load, orgId, isoId])

  const processing =
    iso !== null &&
    (PROCESSING_STATUSES.has(iso.status.toLowerCase()) ||
      (typeof iso.progress_percent === "number" && iso.progress_percent < 100)) &&
    iso.register_status !== "failed" &&
    iso.register_status !== "removed"

  useEffect(() => {
    if (!processing || !isoId) return
    pollTimer.current = setInterval(() => {
      elapsedRef.current += 5
      if (elapsedRef.current >= 600 && pollTimer.current) {
        clearInterval(pollTimer.current)
        return
      }
      void load()
    }, 5000)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [processing, isoId, load])

  const retry = async () => {
    if (!isoId) return
    setRetrying(true)
    try {
      await apiPost(`/isos/${isoId}/retry`, {}, { headers: orgHeaders(orgId) })
      toast.success("Registration retry queued")
      setTimeout(() => void load(), 2000)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  const runDelete = async () => {
    if (!isoId) return
    setDeleting(true)
    try {
      await apiDelete(`/isos/${isoId}`, { headers: orgHeaders(orgId) })
      toast.success("ISO deleted")
      navigate("/app/iso")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete ISO")
      setDeleting(false)
    }
  }

  if (!loading && error && !iso) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/app/iso">ISO images</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{isoId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <ErrorBanner error={error} />
        <Button variant="outline" className="w-fit" onClick={() => navigate("/app/iso")}>
          <ArrowLeftIcon /> Back to ISO images
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/iso">ISO images</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{iso?.name ?? isoId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={iso?.name ?? "ISO image"}
        description={
          iso?.filename && iso.filename !== iso.name ? iso.filename : undefined
        }
        actions={
          <>
            {iso && (iso.register_status === "failed" || iso.register_status === "uploaded" || iso.register_status === "registering") ? (
              <Button variant="outline" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Retry registration
              </Button>
            ) : null}
            {iso ? (
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={iso.is_system === true}
                title={iso.is_system ? "System images cannot be deleted" : undefined}
              >
                <Trash2Icon /> Delete
              </Button>
            ) : null}
          </>
        }
      />

      <ErrorBanner error={error} />

      {loading && !iso ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : iso ? (
        <Card>
          <CardContent className="space-y-4 px-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={iso.status} />
              {iso.register_status && iso.register_status !== iso.status ? (
                <StatusBadge status={iso.register_status} />
              ) : null}
              {iso.is_system ? <StatusBadge status="system" /> : null}
            </div>

            {/* Download / registration progress while processing */}
            {processing ? (
              <div className="space-y-1">
                <Progress value={Math.max(0, Math.min(100, iso.progress_percent ?? 0))} />
                <p className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                  <Loader2Icon className="size-3 animate-spin" />
                  {typeof iso.progress_percent === "number"
                    ? `${iso.progress_percent}% — refreshing every 5 s`
                    : "working — refreshing every 5 s"}
                </p>
              </div>
            ) : null}

            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Size">{formatBytes(iso.size_bytes)}</Detail>
              <Detail label="Created">{formatDateTime(iso.created_at)}</Detail>
              <Detail label="Provider ID">
                <span className="font-mono text-xs break-all">{iso.external_id || "—"}</span>
              </Detail>
              <Detail label="Source">
                {iso.source_url ? (
                  <a
                    href={iso.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-64 items-center gap-1 truncate underline"
                  >
                    <span className="truncate font-mono text-xs">{iso.source_url}</span>
                    <ExternalLinkIcon className="size-3 shrink-0" />
                  </a>
                ) : (
                  "Uploaded file"
                )}
              </Detail>
              <Detail label="Internal ID">
                <span className="font-mono text-xs break-all">{iso.id ?? "—"}</span>
              </Detail>
            </dl>

            {/* Measured-boot attachment is managed per instance; nothing to
                read here — the API exposes no attachment info on the ISO row. */}
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{iso?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The ISO is removed from storage and detached from any provider team. Instances already
              using it are not affected retroactively. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {deleting ? <Loader2Icon className="animate-spin" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}
