import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Loader2Icon, EyeIcon, PowerOffIcon, PowerIcon, ArrowLeftRightIcon, Trash2Icon } from "lucide-react"
import {
  type InstanceDetail,
  type InstanceRow,
  StatusBadge,
  fmtDateTime,
  formatMoney,
  previewValue,
  toastApiError,
} from "../lib"

const PER_PAGE = 20
const INSTANCE_STATES = [
  "active",
  "provisioning",
  "suspended",
  "stopped",
  "failed",
  "pending",
  "deleting",
] as const

type Operation = "suspend" | "unsuspend" | "terminate" | "migrate" | null

export default function NocInstancesPage() {
  const [rows, setRows] = useState<InstanceRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Server-side ?status= currently answers 500 on this backend build, so
  // state/org filtering runs client-side over the fetched page.
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [orgQuery, setOrgQuery] = useState("")

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)

  const [pendingOp, setPendingOp] = useState<Operation>(null)
  const [confirmTerminate, setConfirmTerminate] = useState(false)
  const [targetNode, setTargetNode] = useState("")

  const load = useCallback(async (targetPage: number) => {
    setLoading(true)
    try {
      const envelope = await apiGet<InstanceRow[]>("/admin/instances", {
        query: { page: targetPage, per_page: PER_PAGE },
      })
      setRows(envelope.data)
      setTotal(envelope.meta?.total ?? envelope.data.length)
      setPage(targetPage)
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(1)
  }, [load])

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetail(null)
    setDetailError(null)
    setTargetNode("")
    setDetailLoading(true)
    try {
      const envelope = await apiGet<InstanceDetail>(`/admin/instances/${id}`)
      setDetail(envelope.data)
    } catch (cause) {
      setDetailError(cause)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const runOperation = useCallback(
    async (op: Exclude<Operation, null>) => {
      if (!detail) return
      setPendingOp(op)
      try {
        if (op === "suspend") {
          await apiPost(`/admin/instances/${detail.id}/suspend`)
          toast.success(`Suspend queued for ${detail.name}`)
        } else if (op === "unsuspend") {
          await apiPost(`/admin/instances/${detail.id}/unsuspend`)
          toast.success(`Unsuspend queued for ${detail.name}`)
        } else if (op === "terminate") {
          await apiPost(`/admin/instances/${detail.id}/terminate`)
          toast.success(`Termination requested for ${detail.name}`)
          setConfirmTerminate(false)
        } else if (op === "migrate") {
          await apiPost(`/admin/instances/${detail.id}/migrate`, { target_node: targetNode.trim() })
          toast.success(`Migration to ${targetNode.trim()} queued for ${detail.name}`)
        }
        await Promise.all([load(page), openDetail(detail.id)])
      } catch (cause) {
        toastApiError(cause, `Could not ${op} instance`)
      } finally {
        setPendingOp(null)
      }
    },
    [detail, targetNode, load, page],
  )

  const filtered = rows.filter((row) => {
    if (statusFilter !== "all" && row.status.toLowerCase() !== statusFilter) return false
    if (orgQuery && !`${row.org_slug} ${row.org_public_id}`.toLowerCase().includes(orgQuery.toLowerCase()))
      return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const columns: Array<SimpleColumn<InstanceRow>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.public_id}</p>
        </div>
      ),
    },
    { key: "org_slug", header: "Organization" },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "power_status",
      header: "Power",
      render: (row) => (row.power_status ? <Badge variant="outline">{row.power_status}</Badge> : "—"),
    },
    {
      key: "resources",
      header: "vCPU / RAM / Disk",
      render: (row) => `${row.vcpu} vCPU · ${row.ram_mb} MB · ${row.disk_gb} GB`,
    },
    { key: "created_at", header: "Created", render: (row) => fmtDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Inspect ${row.name}`}
          onClick={() => void openDetail(row.id)}
        >
          <EyeIcon />
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Fleet inventory and lifecycle operations."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {INSTANCE_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by organization…"
          value={orgQuery}
          onChange={(event) => setOrgQuery(event.target.value)}
          className="w-64"
        />
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {rows.length} shown · {total} total
        </span>
      </div>

      <SimpleDataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        error={error}
        skeletonRows={8}
        emptyMessage="No instances match the current filters."
        getRowKey={(row) => row.id}
      />

      <div className="flex items-center justify-end gap-3">
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

      {/* ---- Detail dialog ---- */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Instance detail</DialogTitle>
            <DialogDescription>
              {detail ? `${detail.name} · ${detail.public_id}` : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Loading instance…
            </div>
          ) : detailError ? (
            <p className="text-destructive text-sm">
              Failed to load instance:{" "}
              {detailError instanceof Error ? detailError.message : "request failed"}
            </p>
          ) : detail ? (
            <div className="space-y-5">
              <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <InfoLine label="Status" value={<StatusBadge status={detail.status} />} />
                <InfoLine
                  label="Power"
                  value={detail.power_status ? <Badge variant="outline">{detail.power_status}</Badge> : "—"}
                />
                <InfoLine label="Organization" value={`${detail.organization?.slug ?? detail.org_slug} (${detail.organization?.name ?? "—"})`} />
                <InfoLine label="Hostname" value={previewValue(detail.hostname)} />
                <InfoLine label="Provider" value={detail.provider_id} />
                <InfoLine label="Region" value={previewValue(detail.region_id)} />
                <InfoLine label="Primary IPv4" value={previewValue(detail.primary_ipv4)} />
                <InfoLine label="Primary IPv6" value={previewValue(detail.primary_ipv6)} />
                <InfoLine
                  label="Recurring amount"
                  value={formatMoney(detail.recurring_amount, detail.currency)}
                />
                <InfoLine label="Billing" value={`${detail.pricing_mode} · ${detail.billing_period}`} />
                <InfoLine label="Sync status" value={detail.sync_status || "—"} />
                <InfoLine label="Last synced" value={fmtDateTime(detail.last_synced_at)} />
                <InfoLine label="Created" value={fmtDateTime(detail.created_at)} />
                <InfoLine label="Updated" value={fmtDateTime(detail.updated_at)} />
                <InfoLine
                  label="Snapshots / backups"
                  value={
                    detail.child_counts
                      ? `${detail.child_counts.snapshots ?? 0} / ${detail.child_counts.backups ?? 0}`
                      : "—"
                  }
                />
                <InfoLine label="Auto backup" value={detail.auto_backup_enabled ? "enabled" : "disabled"} />
              </section>

              {detail.provider_actions && detail.provider_actions.length > 0 ? (
                <section className="space-y-2">
                  <p className="text-sm font-medium">Provider actions</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.provider_actions.map((action) => (
                      <Badge key={action} variant="secondary">
                        {action}
                      </Badge>
                    ))}
                  </div>
                </section>
              ) : null}

              <Separator />

              <section className="space-y-3">
                <p className="text-sm font-medium">Operations</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      pendingOp !== null ||
                      ["suspended", "deleting", "deleted"].includes(detail.status)
                    }
                    onClick={() => void runOperation("suspend")}
                  >
                    {pendingOp === "suspend" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <PowerOffIcon />
                    )}
                    Suspend
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingOp !== null || detail.status !== "suspended"}
                    onClick={() => void runOperation("unsuspend")}
                  >
                    {pendingOp === "unsuspend" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <PowerIcon />
                    )}
                    Unsuspend
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pendingOp !== null || ["deleting", "deleted"].includes(detail.status)}
                    onClick={() => setConfirmTerminate(true)}
                  >
                    <Trash2Icon /> Terminate…
                  </Button>
                </div>

                <div className="rounded-md border p-3">
                  <Label htmlFor="migrate-target" className="text-sm font-medium">
                    Migrate to node
                  </Label>
                  <p className="mt-1 mb-2 text-xs text-muted-foreground">
                    Cross-node migration is only accepted for self-hosted Proxmox instances; the
                    backend rejects other kinds with a clear error.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="migrate-target"
                      placeholder="target node name"
                      value={targetNode}
                      onChange={(event) => setTargetNode(event.target.value)}
                      className="max-w-56"
                    />
                    <Button
                      size="sm"
                      disabled={pendingOp !== null || targetNode.trim() === ""}
                      onClick={() => void runOperation("migrate")}
                    >
                      {pendingOp === "migrate" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <ArrowLeftRightIcon />
                      )}
                      Queue migration
                    </Button>
                  </div>
                </div>
              </section>

              {detail.jobs && detail.jobs.length > 0 ? (
                <section className="space-y-2">
                  <p className="text-sm font-medium">Recent jobs</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {detail.jobs.slice(0, 5).map((job) => (
                      <li key={job.id} className="flex items-center gap-2">
                        <StatusBadge status={job.status} />
                        <span>{job.job_type}</span>
                        <span>·</span>
                        <span>{fmtDateTime(job.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ---- Terminate confirmation ---- */}
      <AlertDialog open={confirmTerminate} onOpenChange={setConfirmTerminate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force terminate instance?</AlertDialogTitle>
            <AlertDialogDescription>
              This requests termination of {detail?.name ?? "the instance"} and enqueues a
              destructive job. The action cannot be undone from the console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingOp === "terminate"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingOp === "terminate"}
              onClick={(event) => {
                event.preventDefault()
                void runOperation("terminate")
              }}
            >
              {pendingOp === "terminate" ? (
                <Loader2Icon className="animate-spin" />
              ) : null}
              Request termination
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  )
}
