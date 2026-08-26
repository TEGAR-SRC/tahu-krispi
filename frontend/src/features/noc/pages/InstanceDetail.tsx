// NOC instance detail: the full record plus every lifecycle operation the
// backend grants the infra area (suspend/unsuspend/terminate/migrate/clone/
// template/move-volume). All of them pass permission checks for the NOC role;
// non-Proxmox instances answer clean 501 errors from the backend instead.
import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatCard } from "@/components/shared/StatCard"
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
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Loader2Icon } from "lucide-react"
import type { InstanceDetail as InstanceRowDetail } from "../lib"
import { StatusBadge } from "../lib"
import { fmtDateTime, formatMoney, toastApiError } from "../lib-utils"

/**
 * The live GET /admin/instances/:id payload carries more columns than the
 * list-row subset in ../lib; these were verified against the running backend.
 */
type InstanceDetailPayload = InstanceRowDetail & {
  external_vm_id: string
  additional_hdd_gb: number
  provision_started_at: string
  provisioned_at: string
  terminated_at: string
  deleted_at: string
}

interface ProviderActionRow {
  id: string
  action: string
  status: string
  attempt_count: number
  response_status_code: number
  last_error: string
  created_at: string
}

type PendingDialog = "suspend" | "terminate" | "template" | "move-volume" | null

export default function NocInstanceDetailPage() {
  const instanceId = useParams().instanceId ?? ""

  const [detail, setDetail] = useState<InstanceDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [dialog, setDialog] = useState<PendingDialog>(null)
  const [busyOp, setBusyOp] = useState<string | null>(null)
  const [targetNode, setTargetNode] = useState("")
  const [cloneName, setCloneName] = useState("")
  const [volume, setVolume] = useState("")
  const [targetStorage, setTargetStorage] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const envelope = await apiGet<InstanceDetailPayload>(`/admin/instances/${instanceId}`)
      setDetail(envelope.data)
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const runOp = useCallback(
    async (
      op: "suspend" | "unsuspend" | "terminate" | "template" | "migrate" | "clone",
      body?: Record<string, string>,
    ) => {
      setBusyOp(op)
      const labels: Record<typeof op, string> = {
        suspend: "Suspend",
        unsuspend: "Unsuspend",
        terminate: "Termination",
        template: "Template conversion",
        migrate: "Migration",
        clone: "Clone",
      }
      try {
        const envelope = await apiPost<{ job_id?: string }>(
          `/admin/instances/${instanceId}/${op}`,
          body ?? {},
        )
        toast.success(
          envelope.data?.job_id
            ? `${labels[op]} queued as job ${String(envelope.data.job_id).slice(0, 8)}…`
            : `${labels[op]} completed`,
        )
        setDialog(null)
        await load()
      } catch (cause) {
        toastApiError(cause, `Could not ${op.replace("-", " ")}`)
      } finally {
        setBusyOp(null)
      }
    },
    [instanceId, load],
  )

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <InstanceBreadcrumb name={null} />
        <ErrorBanner error={error} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <InstanceBreadcrumb name={detail?.name ?? null} />

      {loading && !detail ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      ) : detail ? (
        <>
          <PageHeader
            title={detail.name}
            description={`${detail.public_id} · ${detail.organization?.name ?? detail.org_slug ?? "—"} · created ${fmtDateTime(detail.created_at)}${detail.deleted_at ? " · DELETED" : ""}`}
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Status" value={<StatusBadge status={detail.status} />} hint={detail.power_status ? `power: ${detail.power_status}` : "power not reported"} />
            <StatCard label="Resources" value={`${detail.vcpu} vCPU · ${detail.ram_mb} MB`} hint={`${detail.disk_gb} GB disk${detail.additional_hdd_gb ? ` + ${detail.additional_hdd_gb} GB extra` : ""}`} />
            <StatCard label="Billing" value={formatMoney(detail.recurring_amount, detail.currency)} hint={`${detail.pricing_mode} · ${detail.billing_period}`} />
            <StatCard label="Sync" value={<StatusBadge status={detail.sync_status || "unknown"} />} hint={`last synced ${fmtDateTime(detail.last_synced_at)}`} />
          </div>

          {/* ---- Lifecycle operations ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Operations</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busyOp !== null || ["suspended", "deleting", "deleted"].includes(detail.status)} onClick={() => setDialog("suspend")}>
                Suspend…
              </Button>
              <Button size="sm" variant="outline" disabled={busyOp !== null || detail.status !== "suspended"} onClick={() => void runOp("unsuspend")}>
                {busyOp === "unsuspend" ? <Loader2Icon className="animate-spin" /> : null}
                Unsuspend
              </Button>
              <Button size="sm" variant="destructive" disabled={busyOp !== null || ["deleting", "deleted"].includes(detail.status)} onClick={() => setDialog("terminate")}>
                Terminate…
              </Button>
            </div>
            <Separator />
            <div className="grid gap-4 md:grid-cols-3">
              <form
                className="space-y-2 rounded-md border p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!targetNode.trim()) return
                  void runOp("migrate", { target_node: targetNode.trim() })
                }}
              >
                <Label htmlFor="migrate-node" className="text-sm">Migrate</Label>
                <p className="text-xs text-muted-foreground">
                  Live-migrates a self-hosted Proxmox guest to another node; other providers answer 501.
                </p>
                <Input id="migrate-node" placeholder="target node name" value={targetNode} onChange={(event) => setTargetNode(event.target.value)} />
                <Button size="sm" type="submit" disabled={busyOp !== null || !targetNode.trim()}>
                  {busyOp === "migrate" ? <Loader2Icon className="animate-spin" /> : null}
                  Queue migration
                </Button>
              </form>

              <form
                className="space-y-2 rounded-md border p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!cloneName.trim()) return
                  void runOp("clone", { name: cloneName.trim() })
                }}
              >
                <Label htmlFor="clone-name" className="text-sm">Clone</Label>
                <p className="text-xs text-muted-foreground">
                  Enqueues a clone job producing a new Proxmox guest from this one.
                </p>
                <Input id="clone-name" placeholder="new instance name" value={cloneName} onChange={(event) => setCloneName(event.target.value)} />
                <Button size="sm" type="submit" disabled={busyOp !== null || !cloneName.trim()}>
                  {busyOp === "clone" ? <Loader2Icon className="animate-spin" /> : null}
                  Queue clone
                </Button>
              </form>

              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Disk &amp; template</p>
                <p className="text-xs text-muted-foreground">
                  Convert to PVE template (synchronous, effectively final) or move a volume to
                  another storage (synchronous detach/attach).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busyOp !== null} onClick={() => setDialog("template")}>
                    To template…
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyOp !== null} onClick={() => setDialog("move-volume")}>
                    Move volume…
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* ---- Facts ---- */}
          <section className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <FactLine label="Hostname" value={detail.hostname || "—"} />
            <FactLine label="Organization" value={detail.organization ? `${detail.organization.name} (${detail.organization.slug})` : "—"} />
            <FactLine label="Provider" value={
              <Link to={`/noc/providers/${detail.provider_id}`} className="underline-offset-4 hover:underline">
                {detail.provider_id}
              </Link>
            } />
            <FactLine label="External VM ID" value={detail.external_vm_id || "—"} />
            <FactLine label="Region" value={detail.region_id ?? "—"} />
            <FactLine label="Primary IPv4 / IPv6" value={[detail.primary_ipv4, detail.primary_ipv6].filter(Boolean).join(" · ") || "—"} />
            <FactLine label="Subscription" value={detail.subscription ? `${detail.subscription.public_id} · ${detail.subscription.status}` : "none"} />
            <FactLine label="Snapshots / backups" value={detail.child_counts ? `${detail.child_counts.snapshots} / ${detail.child_counts.backups}` : "—"} />
            <FactLine label="Auto backup" value={detail.auto_backup_enabled ? "enabled" : "disabled"} />
            <FactLine label="Provisioned" value={`${fmtDateTime(detail.provision_started_at)} → ${fmtDateTime(detail.provisioned_at)}`} />
            <FactLine label="Suspended at" value={fmtDateTime(detail.suspended_at)} />
            <FactLine label="Terminated" value={fmtDateTime(detail.terminated_at)} />
          </section>

          {/* ---- Recent provider actions ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Recent provider actions</h2>
            <SimpleDataTable<ProviderActionRow>
              columns={[
                { key: "action", header: "Action", render: (row) => <span className="font-mono text-xs">{row.action}</span> },
                { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
                { key: "attempt_count", header: "Attempts", render: (row) => row.attempt_count },
                { key: "response_status_code", header: "HTTP", render: (row) => row.response_status_code || "—" },
                { key: "last_error", header: "Last error", render: (row) => <span className="block max-w-md truncate text-xs text-destructive">{row.last_error || "—"}</span> },
                { key: "created_at", header: "Created", render: (row) => fmtDateTime(row.created_at), className: "whitespace-nowrap" },
              ]}
              rows={(detail.provider_actions ?? []) as unknown as ProviderActionRow[]}
              loading={false}
              skeletonRows={3}
              emptyMessage="No provider actions recorded."
              getRowKey={(row) => row.id}
            />
          </section>

          {/* ---- Recent jobs ---- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Recent jobs</h2>
            <SimpleDataTable
              columns={[
                { key: "job_type", header: "Job", render: (row) => String(row.job_type) },
                { key: "status", header: "Status", render: (row) => <StatusBadge status={String(row.status)} /> },
                { key: "attempts", header: "Attempts", render: (row) => `${row.attempts}/${row.max_attempts}` },
                { key: "created_at", header: "Created", render: (row) => fmtDateTime(String(row.created_at)) },
                {
                  key: "open",
                  header: "",
                  className: "w-20 text-right",
                  render: (row) => (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/noc/jobs/${row.id}`}>Open</Link>
                    </Button>
                  ),
                },
              ]}
              rows={(detail.jobs ?? []) as unknown as Array<Record<string, unknown>>}
              loading={false}
              skeletonRows={3}
              emptyMessage="No jobs reference this instance."
              getRowKey={(row) => String(row.id)}
            />
          </section>
        </>
      ) : (
        <EmptyState message="Instance not found." description={`No instance matches ${instanceId}.`} />
      )}

      {/* ---- Confirmations ---- */}
      <AlertDialog open={dialog === "suspend"} onOpenChange={(open) => !open && setDialog(null)}>
        <ConfirmFrame title={`Suspend ${detail?.name ?? "instance"}?`} description="The guest will be suspended on its provider and the customer loses access until unsuspended." confirmLabel="Suspend instance" pending={busyOp === "suspend"} onConfirm={() => void runOp("suspend")} />
      </AlertDialog>

      <AlertDialog open={dialog === "terminate"} onOpenChange={(open) => !open && setDialog(null)}>
        <ConfirmFrame
          destructive
          title={`Terminate ${detail?.name ?? "instance"}?`}
          description="This requests termination and enqueues a destructive job. The action cannot be undone from the console."
          confirmLabel="Request termination"
          pending={busyOp === "terminate"}
          onConfirm={() => void runOp("terminate")}
        />
      </AlertDialog>

      <AlertDialog open={dialog === "template"} onOpenChange={(open) => !open && setDialog(null)}>
        <ConfirmFrame
          destructive
          title="Convert to template?"
          description="The Proxmox VM is converted into a template synchronously. Converting back into a bootable guest afterwards is not supported from this console."
          confirmLabel="Convert to template"
          pending={busyOp === "template"}
          onConfirm={() => void runOp("template")}
        />
      </AlertDialog>

      <AlertDialog open={dialog === "move-volume"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move volume to another storage?</AlertDialogTitle>
            <AlertDialogDescription>
              The disk is detached from the guest and re-attached on the target storage. The
              operation runs synchronously against the provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input placeholder="volume, e.g. scsi0 or local-lvm:vm-101-disk-0" value={volume} onChange={(event) => setVolume(event.target.value)} />
            <Input placeholder="target storage, e.g. local-zfs" value={targetStorage} onChange={(event) => setTargetStorage(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!volume.trim() || !targetStorage.trim() || busyOp !== null}
              onClick={(event) => {
                event.preventDefault()
                void runMoveVolume()
              }}
            >
              {busyOp === "move-volume" ? <Loader2Icon className="animate-spin" /> : null}
              Move volume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  async function runMoveVolume() {
    setBusyOp("move-volume")
    try {
      await apiPost(`/admin/instances/${instanceId}/move-volume`, {
        volume: volume.trim(),
        target_storage: targetStorage.trim(),
      })
      toast.success("Volume moved")
      setDialog(null)
      setVolume("")
      setTargetStorage("")
      await load()
    } catch (cause) {
      toastApiError(cause, "Could not move the volume")
    } finally {
      setBusyOp(null)
    }
  }
}

function ConfirmFrame({
  title,
  description,
  confirmLabel,
  pending,
  destructive,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant={destructive ? "destructive" : undefined}
          disabled={pending}
          onClick={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : null}
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

function InstanceBreadcrumb({ name }: { name: string | null }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/noc/instances">Instances</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {name ? <BreadcrumbPage>{name}</BreadcrumbPage> : <Skeleton className="h-4 w-28" />}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function FactLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col border-b py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  )
}
