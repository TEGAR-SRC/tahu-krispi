import { useCallback, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { PageHeader } from "@/components/shared/PageHeader"
import { Button } from "@/components/ui/button"
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
import { PaginationBar, StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime } from "@/features/admin/pages/format"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface OnidelInstanceRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  name: string
  status: string
  power_status: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  suspended_at: string
  termination_requested_at: string
  created_at: string
}

const RESOURCE_STATUSES = [
  "draft",
  "pending",
  "provisioning",
  "active",
  "stopped",
  "suspended",
  "deleting",
  "deleted",
  "failed",
  "unknown",
] as const

const PER_PAGE = 20

type PendingAction = { id: string; kind: "suspend" | "unsuspend" | "terminate" } | null

export default function OnidelInstancesPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [pending, setPending] = useState<PendingAction>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const providerFilter = providerId || "onidel"

  // Per-provider realtime: GET /admin/onidel/:id/instances polled every 5s via useInfraGet.
  // Falls back to /admin/instances?provider=onidel when no :id (global view).
  const query = useMemo(
    () => ({
      page,
      per_page: PER_PAGE,
      status: status === "all" ? null : status,
      ...(providerId ? {} : { provider: providerFilter }),
    }),
    [page, status, providerId, providerFilter],
  )
  const infraPath = providerId ? `/admin/onidel/${providerId}/instances` : "/admin/instances"
  const infra = useInfraGet<OnidelInstanceRow[]>(
    infraPath,
    query as Record<string, string | number | boolean | null | undefined>,
    { intervalMs: 5000 },
  )
  const rows = Array.isArray(infra.data) ? infra.data : []
  const meta = infra.meta as import("@/lib/types").PagedMeta & Record<string, unknown> | undefined
  const loading = infra.loading
  const error = infra.error
  const load = useCallback(async () => {
    infra.reload()
  }, [infra])

  const runAction = useCallback(
    async (id: string, kind: "suspend" | "unsuspend" | "terminate") => {
      setBusyId(id)
      try {
        await apiPost(`/admin/instances/${id}/${kind}`)
        toast.success(
          kind === "suspend"
            ? "Suspend queued"
            : kind === "unsuspend"
              ? "Unsuspend queued"
              : "Termination requested",
        )
        await load()
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      } finally {
        setBusyId(null)
        setPending(null)
      }
    },
    [load],
  )

  const confirmCopy = useMemo(() => {
    if (!pending) return { title: "", description: "", confirm: "" }
    const row = rows.find((r) => r.id === pending.id)
    const name = row?.name ?? pending.id.slice(0, 8)
    if (pending.kind === "suspend") {
      return {
        title: `Suspend "${name}"?`,
        description: "The instance will be suspended at the provider and stop serving traffic. A suspend_instance job is enqueued (202).",
        confirm: "Suspend",
      }
    }
    if (pending.kind === "unsuspend") {
      return {
        title: `Unsuspend "${name}"?`,
        description: "The instance will be reactivated and resume normal operation.",
        confirm: "Unsuspend",
      }
    }
    return {
      title: `Force-terminate "${name}"?`,
      description: "Termination is requested immediately and cannot be undone once the job runs.",
      confirm: "Terminate",
    }
  }, [pending, rows])

  const table = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RESOURCE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Provider filter: <span className="font-mono font-medium">{providerFilter}</span> · GET /admin/instances?provider={providerFilter}
        </span>
      </div>

      <SimpleDataTable<OnidelInstanceRow>
        columns={[
          {
            key: "name",
            header: "Instance",
            render: (row) => (
              <div className="min-w-0">
                <p className="min-w-0 truncate font-medium">{row.name}</p>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.public_id}</p>
              </div>
            ),
          },
          {
            key: "org_slug",
            header: "Organization",
            className: "hidden md:table-cell",
            render: (row) => <span className="text-muted-foreground">{row.org_slug}</span>,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge status={row.status} />
                {row.power_status ? <span className="text-xs text-muted-foreground">{row.power_status}</span> : null}
              </div>
            ),
          },
          {
            key: "vcpu",
            header: "Specs",
            render: (row) => (
              <span className="whitespace-nowrap text-sm tabular-nums">
                {row.vcpu} vCPU · {(row.ram_mb / 1024).toFixed(row.ram_mb % 1024 === 0 ? 0 : 1)} GB · {row.disk_gb} GB
              </span>
            ),
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden lg:table-cell",
            render: (row) => <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>,
          },
          {
            key: "actions",
            header: "",
            className: "w-64 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/admin/instances/${row.id}`}>Detail</Link>
                </Button>
                {row.status === "suspended" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => setPending({ id: row.id, kind: "unsuspend" })}
                  >
                    Unsuspend
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id || row.status === "deleting" || row.status === "deleted"}
                    onClick={() => setPending({ id: row.id, kind: "suspend" })}
                  >
                    Suspend
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busyId === row.id || row.status === "deleting" || row.status === "deleted"}
                  onClick={() => setPending({ id: row.id, kind: "terminate" })}
                >
                  Terminate
                </Button>
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No Onidel instances match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              className={
                pending?.kind === "terminate"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                if (!pending) return
                void runAction(pending.id, pending.kind)
              }}
            >
              {busyId ? "Working…" : confirmCopy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  if (providerId) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Onidel instances"
        description="Instances filtered by this Onidel provider (GET /admin/instances?provider=onidel or provider id). Admin can suspend / unsuspend / terminate; NOC read-only via infra."
      >
        {table}
      </ProviderShell>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Onidel instances"
        description="Every customer instance on Onidel providers — filtered via GET /admin/instances?provider=onidel. Admin can suspend / unsuspend / terminate."
      />
      {table}
    </div>
  )
}
