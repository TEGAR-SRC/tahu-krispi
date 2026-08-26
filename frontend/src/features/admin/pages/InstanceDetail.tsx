// Admin instance detail: everything GET /v1/admin/instances/:instance_id
// returns plus a lifecycle action bar. Suspend/unsuspend/terminate/migrate
// enqueue jobs (202) and are each confirmed; clone/template/move-volume only
// apply to proxmox guests (501 otherwise, surfaced via toast).
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"
import { ConfirmDialog } from "./providers/shared"

interface InstanceJob {
  id: string
  queue: string
  job_type: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string
  created_at: string
  completed_at?: string
}

interface ProviderAction {
  id: string
  action: string
  status: string
  response_status_code: number
  last_error: string
  created_at: string
}

interface InstanceDetailPayload {
  id: string
  public_id: string
  name: string
  hostname: string
  status: string
  power_status: string
  organization_id: string
  organization?: {
    id: string
    public_id: string
    slug: string
    name: string
  } | null
  provider_id: string
  external_vm_id: string
  subscription_id: string | null
  pricing_mode: string
  billing_period: string
  currency: string
  recurring_amount: number
  vcpu: number
  ram_mb: number
  disk_gb: number
  additional_hdd_gb: number
  primary_ipv4: string
  primary_ipv6: string
  sync_status: string
  last_synced_at: string
  provisioned_at: string
  suspended_at: string
  termination_requested_at: string
  terminated_at: string
  created_at: string
  updated_at: string
  deleted_at: string
  subscription: {
    id: string
    public_id?: string
    status?: string
    recurring_amount?: number
    next_invoice_at?: string
  } | null
  provider_actions: ProviderAction[]
  jobs: InstanceJob[]
  child_counts: { snapshots: number; backups: number }
}

function DetailField({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children ?? "—"}</dd>
    </div>
  )
}

export default function AdminInstanceDetailPage() {
  const params = useParams()
  const instanceId = params.instanceId ?? ""

  const [detail, setDetail] = useState<InstanceDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Lifecycle confirmation targets.
  const [lifecycle, setLifecycle] = useState<
    "suspend" | "unsuspend" | "terminate" | "template" | null
  >(null)
  const [dialog, setDialog] = useState<"migrate" | "clone" | "move-volume" | null>(null)
  const [busy, setBusy] = useState(false)

  const [targetNode, setTargetNode] = useState("")
  const [cloneName, setCloneName] = useState("")
  const [volume, setVolume] = useState("")
  const [targetStorage, setTargetStorage] = useState("")

  const load = useCallback(() => {
    if (!instanceId) return
    setLoading(true)
    apiGet<InstanceDetailPayload>(`/admin/instances/${instanceId}`)
      .then(({ data }) => {
        setDetail(data)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [instanceId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  const postAction = async (
    pathSuffix: string,
    body: Record<string, unknown> | undefined,
    success: string,
  ) => {
    setBusy(true)
    try {
      await apiPost(`/admin/instances/${instanceId}/${pathSuffix}`, body)
      toast.success(success)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Request failed at the provider",
      )
    } finally {
      setBusy(false)
    }
  }

  if (!instanceId) {
    return <EmptyState message="Instance id missing." />
  }

  const lifecycleCopy =
    lifecycle === "suspend"
      ? {
          title: `Suspend "${detail?.name}"?`,
          body: "The instance is suspended at the provider and stops serving traffic (202).",
          confirm: "Suspend instance",
        }
      : lifecycle === "terminate"
        ? {
            title: `Force-terminate "${detail?.name}"?`,
            body: "Termination is requested immediately and cannot be undone once the job runs.",
            confirm: "Terminate instance",
          }
        : lifecycle === "template"
          ? {
              title: `Convert "${detail?.name}" to a PVE template?`,
              body: "The VM becomes a template synchronously; it can no longer be started as-is.",
              confirm: "Convert to template",
            }
          : {
              title: `Unsuspend "${detail?.name}"?`,
              body: "The instance reactivates and resumes normal operation.",
              confirm: "Unsuspend instance",
            }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/instances">Instances</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{detail?.name ?? `${instanceId.slice(0, 8)}…`}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && !detail ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : !detail ? (
        <EmptyState message="Instance not found." />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
                {detail.name}
                <StatusBadge status={detail.status} />
                {detail.power_status ? (
                  <span className="text-sm text-muted-foreground">{detail.power_status}</span>
                ) : null}
              </h1>
              <p className="font-mono text-sm text-muted-foreground">{detail.public_id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {detail.status === "suspended" ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setLifecycle("unsuspend")}>
                  Unsuspend…
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy || detail.status === "deleting"}
                  onClick={() => setLifecycle("suspend")}
                >
                  Suspend…
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || detail.status === "deleting" || detail.status === "deleted"}
                onClick={() => setLifecycle("terminate")}
              >
                Terminate…
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog("migrate")}>
                Migrate…
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog("clone")}>
                Clone…
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setLifecycle("template")}>
                To template…
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog("move-volume")}>
                Move volume…
              </Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compute</CardTitle>
                <CardDescription>Provisioned shape and network addresses.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <DetailField label="Specs">
                    {detail.vcpu} vCPU · {detail.ram_mb} MB RAM · {detail.disk_gb} GB
                    {detail.additional_hdd_gb > 0 ? ` +${detail.additional_hdd_gb} GB HDD` : ""}
                  </DetailField>
                  <DetailField label="Hostname">{detail.hostname || "—"}</DetailField>
                  <DetailField label="External ID">{detail.external_vm_id || "unmapped"}</DetailField>
                  <DetailField label="IPv4">{detail.primary_ipv4 || "—"}</DetailField>
                  <DetailField label="IPv6">{detail.primary_ipv6 || "—"}</DetailField>
                  <DetailField label="Provider">
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      to={`/admin/providers/${detail.provider_id}`}
                    >
                      {detail.provider_id.slice(0, 8)}…
                    </Link>
                  </DetailField>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Billing &amp; ownership</CardTitle>
                <CardDescription>Organization, plan pricing and subscription state.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <DetailField label="Organization">
                    {detail.organization ? (
                      <Link
                        className="text-primary underline-offset-4 hover:underline"
                        to={`/admin/organizations/${detail.organization.id}`}
                      >
                        {detail.organization.name || detail.organization.slug}
                      </Link>
                    ) : (
                      detail.organization_id
                    )}
                  </DetailField>
                  <DetailField label="Pricing">
                    {formatMoney(detail.recurring_amount, detail.currency)} / {detail.billing_period}
                  </DetailField>
                  <DetailField label="Mode">{detail.pricing_mode}</DetailField>
                  {detail.subscription ? (
                    <>
                      <DetailField label="Subscription">
                        <span className="font-mono text-xs">
                          {detail.subscription.public_id ?? detail.subscription.id}
                        </span>
                      </DetailField>
                      <DetailField label="Subscription status">
                        <StatusBadge status={detail.subscription.status ?? null} />
                      </DetailField>
                      <DetailField label="Next invoice">
                        {formatDateTime(detail.subscription.next_invoice_at)}
                      </DetailField>
                    </>
                  ) : (
                    <DetailField label="Subscription">none</DetailField>
                  )}
                  <DetailField label="Snapshots / backups">
                    {detail.child_counts.snapshots} / {detail.child_counts.backups}
                  </DetailField>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lifecycle timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <DetailField label="Created">{formatDateTime(detail.created_at)}</DetailField>
                <DetailField label="Provisioned">{formatDateTime(detail.provisioned_at)}</DetailField>
                <DetailField label="Sync">{detail.sync_status}</DetailField>
                <DetailField label="Last synced">{formatDateTime(detail.last_synced_at)}</DetailField>
                <DetailField label="Suspended at">{formatDateTime(detail.suspended_at)}</DetailField>
                <DetailField label="Termination requested">
                  {formatDateTime(detail.termination_requested_at)}
                </DetailField>
                <DetailField label="Terminated">{formatDateTime(detail.terminated_at)}</DetailField>
                <DetailField label="Deleted">{formatDateTime(detail.deleted_at)}</DetailField>
              </dl>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Recent jobs ({detail.jobs.length})
            </h2>
            <SimpleDataTable<InstanceJob>
              columns={[
                {
                  key: "job_type",
                  header: "Type",
                  render: (job) => (
                    <Link
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      to={`/admin/jobs/${job.id}`}
                    >
                      {job.job_type}
                    </Link>
                  ),
                },
                { key: "queue", header: "Queue", className: "hidden md:table-cell" },
                { key: "status", header: "Status", render: (job) => <StatusBadge status={job.status} /> },
                {
                  key: "attempts",
                  header: "Attempts",
                  render: (job) => `${job.attempts}/${job.max_attempts}`,
                },
                { key: "created_at", header: "Created", render: (job) => formatDateTime(job.created_at) },
                {
                  key: "completed_at",
                  header: "Completed",
                  className: "hidden lg:table-cell",
                  render: (job) => formatDateTime(job.completed_at),
                },
                {
                  key: "last_error",
                  header: "Last error",
                  className: "hidden max-w-56 truncate xl:table-cell",
                  render: (job) => job.last_error || "—",
                },
              ]}
              rows={detail.jobs}
              getRowKey={(job) => job.id}
              emptyMessage="No jobs recorded for this instance."
              skeletonRows={3}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Provider actions ({detail.provider_actions.length})
            </h2>
            <SimpleDataTable<ProviderAction>
              columns={[
                { key: "action", header: "Action" },
                { key: "status", header: "Status", render: (action) => <StatusBadge status={action.status} /> },
                { key: "response_status_code", header: "HTTP" },
                { key: "created_at", header: "When", render: (action) => formatDateTime(action.created_at) },
                {
                  key: "last_error",
                  header: "Last error",
                  className: "max-w-56 truncate",
                  render: (action) => action.last_error || "—",
                },
              ]}
              rows={detail.provider_actions}
              getRowKey={(action) => action.id}
              emptyMessage="No provider actions recorded."
              skeletonRows={3}
            />
          </section>
        </>
      )}

      {/* Lifecycle confirmations — suspend/unsuspend/terminate enqueue jobs;
          template converts synchronously (501 for non-proxmox guests). */}
      <ConfirmDialog
        open={lifecycle !== null}
        onOpenChange={(open) => !open && setLifecycle(null)}
        title={lifecycleCopy.title}
        body={lifecycleCopy.body}
        confirmLabel={lifecycleCopy.confirm}
        busy={busy}
        onConfirm={() => {
          const action = lifecycle
          setLifecycle(null)
          if (!action) return
          void postAction(action, undefined, `${action.replace("_", " ")} queued`)
        }}
      />

      {/* Migration requires an enabled region (= PVE node) of the provider. */}
      <Dialog open={dialog === "migrate"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Migrate to another node</DialogTitle>
            <DialogDescription>
              Only self-hosted proxmox instances migrate. The target must be an enabled region
              (PVE node) of this instance's provider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mig-target-node">Target node *</Label>
            <Input
              id="mig-target-node"
              value={targetNode}
              onChange={(event) => setTargetNode(event.target.value)}
              placeholder="e.g. pve-node-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || targetNode.trim() === ""}
              onClick={() => {
                const node = targetNode.trim()
                setDialog(null)
                setTargetNode("")
                if (!node) return
                void postAction(
                  "migrate",
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

      <Dialog open={dialog === "clone"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clone instance</DialogTitle>
            <DialogDescription>
              A full copy of this proxmox guest is enqueued under the given name (202).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="clone-name">New name *</Label>
            <Input
              id="clone-name"
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value.replace(/[^a-zA-Z0-9-]/g, ""))}
              placeholder="web-01-clone"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || cloneName.trim() === ""}
              onClick={() => {
                const name = cloneName.trim()
                setDialog(null)
                setCloneName("")
                if (!name) return
                void postAction("clone", { name }, `Clone "${name}" queued`)
              }}
            >
              Queue clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "move-volume"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move volume</DialogTitle>
            <DialogDescription>
              Synchronous move of one guest volume (PVE volume id such as
              local-lvm:vm-100-disk-0) to another cluster storage.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv-volume">Volume *</Label>
              <Input
                id="mv-volume"
                value={volume}
                onChange={(event) => setVolume(event.target.value)}
                placeholder="local-lvm:vm-100-disk-0"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-storage">Target storage *</Label>
              <Input
                id="mv-storage"
                value={targetStorage}
                onChange={(event) => setTargetStorage(event.target.value)}
                placeholder="nfs-backup"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || volume.trim() === "" || targetStorage.trim() === ""}
              onClick={() => {
                const vol = volume.trim()
                const storage = targetStorage.trim()
                setDialog(null)
                setVolume("")
                setTargetStorage("")
                if (!vol || !storage) return
                void postAction(
                  "move-volume",
                  { volume: vol, target_storage: storage },
                  `Moving ${vol} to ${storage}`,
                )
              }}
            >
              Move volume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
