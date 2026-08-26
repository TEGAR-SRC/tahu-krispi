// Platform-admin instance inventory: every instance across organizations with
// status filtering, a full detail dialog (provider actions, jobs, child
// counts) and admin lifecycle actions (suspend/unsuspend/terminate/migrate).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PagedMeta } from "@/lib/types"
import {
  DetailField,
  PaginationBar,
  StatusBadge,
  formatDateTime,
  formatMoney,
} from "./shared"

interface AdminInstanceRow {
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

interface InstanceDetail extends AdminInstanceRow {
  hostname: string
  provider_id: string
  external_vm_id: string
  pricing_mode: string
  billing_period: string
  currency: string
  recurring_amount: number
  additional_hdd_gb: number
  primary_ipv4: string
  primary_ipv6: string
  sync_status: string
  last_synced_at: string
  provisioned_at: string
  terminated_at: string
  deleted_at: string
  subscription: {
    id: string
    public_id: string
    status: string
    recurring_amount: number
    next_invoice_at: string
  } | null
  provider_actions: Array<{
    id: string
    action: string
    status: string
    response_status_code: number
    last_error: string
    created_at: string
  }>
  jobs: Array<{
    id: string
    queue: string
    job_type: string
    status: string
    attempts: number
    last_error: string
    created_at: string
  }>
  child_counts: { snapshots: number; backups: number }
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
]
const PER_PAGE = 20

type LifecycleAction = "suspend" | "unsuspend" | "terminate"

export default function AdminInstancesPage() {
  const [rows, setRows] = useState<AdminInstanceRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [targetNode, setTargetNode] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<AdminInstanceRow[]>("/admin/instances", {
      query: {
        page,
        per_page: PER_PAGE,
        status: status === "all" ? null : status,
      },
    })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, status, reloadTick])

  // Load / reload the open detail dialog (after mutations, reloadTick bumps).
  useEffect(() => {
    if (!detailId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    apiGet<InstanceDetail>(`/admin/instances/${detailId}`)
      .then(({ data }) => {
        if (!cancelled) {
          setDetail(data)
          setDetailError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) setDetailError(cause)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId, reloadTick])

  const postAction = async (path: string, body?: unknown, success?: string) => {
    setBusy(true)
    try {
      await apiPost(path, body)
      toast.success(success ?? "Action queued")
      setReloadTick((tick) => tick + 1)
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  const lifecycleCopy =
    lifecycle === "suspend"
      ? {
          title: `Suspend "${detail?.name}"?`,
          body: "The instance will be suspended at the provider and its services stop serving traffic.",
          confirm: "Suspend instance",
          destructive: true,
        }
      : lifecycle === "terminate"
        ? {
            title: `Force-terminate "${detail?.name}"?`,
            body: "Termination is requested immediately; this cannot be undone once the job runs.",
            confirm: "Terminate instance",
            destructive: true,
          }
        : {
            title: `Unsuspend "${detail?.name}"?`,
            body: "The instance will be reactivated and resume normal operation.",
            confirm: "Unsuspend instance",
            destructive: false,
          }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Every customer instance across all providers and organizations."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[180px]">
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
      </div>

      <SimpleDataTable<AdminInstanceRow>
        columns={[
          {
            key: "name",
            header: "Instance",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.public_id}
                </p>
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
              <div className="flex items-center gap-2">
                <StatusBadge status={row.status} />
                {row.power_status ? (
                  <span className="text-xs text-muted-foreground">{row.power_status}</span>
                ) : null}
              </div>
            ),
          },
          {
            key: "vcpu",
            header: "Specs",
            render: (row) => (
              <span className="whitespace-nowrap text-sm tabular-nums">
                {row.vcpu} vCPU · {(row.ram_mb / 1024).toFixed(row.ram_mb % 1024 === 0 ? 0 : 1)} GB ·{" "}
                {row.disk_gb} GB
              </span>
            ),
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
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  setLifecycle(null)
                  setMigrateOpen(false)
                  setTargetNode("")
                  setDetailError(null)
                  setDetail(null)
                  setDetailId(row.id)
                }}
              >
                Detail
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No instances match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <Dialog
        open={detail !== null || detailLoading || detailError !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null)
            setDetailError(null)
            setDetailId(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {detailError ? (
            <div className="space-y-3">
              <DialogHeader>
                <DialogTitle>Instance detail</DialogTitle>
              </DialogHeader>
              <ErrorBanner error={detailError} />
            </div>
          ) : !detail ? (
            <DialogHeader>
              <DialogTitle>Loading instance…</DialogTitle>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{detail.name}</DialogTitle>
                <DialogDescription>
                  <span className="font-mono">{detail.public_id}</span> · organization{" "}
                  {detail.org_slug}
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="jobs">Jobs ({detail.jobs.length})</TabsTrigger>
                  <TabsTrigger value="actions">
                    Provider actions ({detail.provider_actions.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 pt-2">
                  <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
                    <DetailField label="Status">
                      <StatusBadge status={detail.status} />
                    </DetailField>
                    <DetailField label="Power">{detail.power_status || "—"}</DetailField>
                    <DetailField label="Hostname">{detail.hostname || "—"}</DetailField>
                    <DetailField label="Specs">
                      {detail.vcpu} vCPU · {detail.ram_mb} MB RAM · {detail.disk_gb} GB disk
                    </DetailField>
                    <DetailField label="Price">
                      {formatMoney(detail.recurring_amount, detail.currency)} /{" "}
                      {detail.billing_period}
                    </DetailField>
                    <DetailField label="IPv4">{detail.primary_ipv4 || "—"}</DetailField>
                    <DetailField label="IPv6" >{detail.primary_ipv6 || "—"}</DetailField>
                    <DetailField label="Sync">{detail.sync_status}</DetailField>
                    <DetailField label="Snapshots / backups">
                      {detail.child_counts.snapshots} / {detail.child_counts.backups}
                    </DetailField>
                    <DetailField label="Provisioned">
                      {formatDateTime(detail.provisioned_at)}
                    </DetailField>
                    <DetailField label="Created">
                      {formatDateTime(detail.created_at)}
                    </DetailField>
                    <DetailField label="Deleted">
                      {formatDateTime(detail.deleted_at)}
                    </DetailField>
                    {detail.subscription ? (
                      <>
                        <DetailField label="Subscription">
                          <span className="font-mono text-xs">
                            {detail.subscription.public_id}
                          </span>
                        </DetailField>
                        <DetailField label="Subscription status">
                          <StatusBadge status={detail.subscription.status} />
                        </DetailField>
                        <DetailField label="Next invoice">
                          {formatDateTime(detail.subscription.next_invoice_at)}
                        </DetailField>
                      </>
                    ) : null}
                  </dl>

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    {detail.status !== "suspended" ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy || detail.status === "deleting"}
                        onClick={() => setLifecycle("suspend")}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => setLifecycle("unsuspend")}
                      >
                        Unsuspend
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy || detail.status === "deleting" || detail.status === "deleted"}
                      onClick={() => setLifecycle("terminate")}
                    >
                      Force terminate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setMigrateOpen(true)}
                    >
                      Migrate…
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="jobs" className="pt-2">
                  <SimpleDataTable
                    columns={[
                      { key: "job_type", header: "Type" },
                      { key: "queue", header: "Queue", className: "hidden md:table-cell" },
                      { key: "status", header: "Status", render: (j) => <StatusBadge status={j.status} /> },
                      { key: "attempts", header: "Attempts" },
                      {
                        key: "created_at",
                        header: "Created",
                        render: (j) => formatDateTime(j.created_at),
                      },
                      {
                        key: "last_error",
                        header: "Last error",
                        className: "max-w-48 truncate",
                        render: (j) => j.last_error || "—",
                      },
                    ]}
                    rows={detail.jobs}
                    getRowKey={(job) => job.id}
                    emptyMessage="No jobs recorded for this instance."
                  />
                </TabsContent>

                <TabsContent value="actions" className="pt-2">
                  <SimpleDataTable
                    columns={[
                      { key: "action", header: "Action" },
                      { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
                      { key: "response_status_code", header: "HTTP" },
                      {
                        key: "created_at",
                        header: "When",
                        render: (a) => formatDateTime(a.created_at),
                      },
                      {
                        key: "last_error",
                        header: "Last error",
                        className: "max-w-48 truncate",
                        render: (a) => a.last_error || "—",
                      },
                    ]}
                    rows={detail.provider_actions}
                    getRowKey={(action) => action.id}
                    emptyMessage="No provider actions recorded."
                  />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={lifecycle !== null}
        onOpenChange={(open) => !open && setLifecycle(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{lifecycleCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>{lifecycleCopy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={lifecycleCopy.destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""}
              onClick={async () => {
                const action = lifecycle
                const id = detail?.id
                setLifecycle(null)
                if (!action || !id) return
                await postAction(`/admin/instances/${id}/${action}`)
              }}
            >
              {lifecycleCopy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Migration targets an enabled region of a proxmox provider (the region
          code carries the PVE node name). Non-proxmox instances answer 501. */}
      <Dialog open={migrateOpen} onOpenChange={setMigrateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Migrate to another node</DialogTitle>
            <DialogDescription>
              Only self-hosted proxmox instances can migrate. The target must be an
              enabled region (PVE node) of the instance's provider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="migrate-target-node">Target node</Label>
            <Input
              id="migrate-target-node"
              placeholder="e.g. pve-node-2"
              value={targetNode}
              onChange={(event) => setTargetNode(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMigrateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || targetNode.trim() === "" || detail === null}
              onClick={async () => {
                const id = detail?.id
                const node = targetNode.trim()
                setMigrateOpen(false)
                if (!id) return
                await postAction(
                  `/admin/instances/${id}/migrate`,
                  { target_node: node },
                  `Migration to ${node} queued`,
                )
              }}
            >
              Queue migration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
