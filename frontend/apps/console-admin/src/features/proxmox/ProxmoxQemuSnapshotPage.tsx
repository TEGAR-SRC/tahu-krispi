import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface SnapshotRow {
  name?: string
  snapname?: string
  description?: string
  desc?: string
  snaptime?: number
  vmstate?: number | boolean
  parent?: string
  digest?: string
  running?: number | boolean
  [key: string]: unknown
}

function snapshotName(row: SnapshotRow): string {
  return String(row.name ?? row.snapname ?? "")
}

function snapshotDesc(row: SnapshotRow): string {
  return String(row.description ?? row.desc ?? "")
}

function formatSnaptime(value?: number): string {
  if (value === undefined || value === null || value === 0) return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return "—"
  return new Date(n * 1000).toLocaleString()
}

export default function ProxmoxQemuSnapshotPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validVmid = /^\d+$/.test(trimmedVmid)
  const validNode = trimmedNode.length > 0

  const base =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/snapshot`
      : null

  const state = useInfraGet<SnapshotRow[]>(base, undefined, { intervalMs: 5000 })
  const rows = (state.data ?? []) as SnapshotRow[]

  const [createOpen, setCreateOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<SnapshotRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SnapshotRow | null>(null)
  const [busy, setBusy] = useState(false)

  const runAction = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      state.reload()
      done?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU snapshots"
        description="Per-node QEMU snapshots — POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot (create), GET (list, 5s poll), DELETE /:snapname and POST /rollback."
      >
        <p className="text-sm text-destructive">
          Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot.
        </p>
      </ProviderShell>
    )
  }

  if (!validVmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title={`Snapshots — ${trimmedNode}/${trimmedVmid}`}
        description={`Snapshots for QEMU ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot (infra-readable, 5s poll).`}
      >
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`Snapshots — ${trimmedNode}/${trimmedVmid}`}
      description={`QEMU snapshots on ${trimmedNode} / VM ${trimmedVmid} — list, create, rollback and delete. GET infra-readable (NOC), mutations platform_admin only. Polled every 5s via useInfraGet.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={state.loading} onClick={() => state.reload()}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create snapshot
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Endpoints: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot</span> ·{" "}
          <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot</span>{" "}
          {"{ snapname, description? }"} ·{" "}
          <span className="font-mono">DELETE /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/:snapname</span> ·{" "}
          <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/rollback</span>{" "}
          {"{ snapname }"} and{" "}
          <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/:snapname/rollback</span>
        </p>

        <SimpleDataTable<SnapshotRow>
          columns={[
            {
              key: "name",
              header: "Snapshot",
              render: (row) => <span className="font-mono text-sm font-medium">{snapshotName(row) || "—"}</span>,
            },
            {
              key: "description",
              header: "Description",
              className: "hidden md:table-cell max-w-64 truncate",
              render: (row) => snapshotDesc(row) || "—",
            },
            {
              key: "snaptime",
              header: "Created",
              className: "hidden lg:table-cell",
              render: (row) => formatSnaptime(row.snaptime as number | undefined),
            },
            {
              key: "vmstate",
              header: "VM state",
              className: "hidden xl:table-cell",
              render: (row) => {
                const v = row.vmstate
                if (v === 1 || v === true) return <Badge variant="secondary">with RAM</Badge>
                if (v === 0 || v === false) return <Badge variant="outline">disk only</Badge>
                return <span className="text-muted-foreground">—</span>
              },
            },
            {
              key: "parent",
              header: "Parent",
              className: "hidden xl:table-cell",
              render: (row) => (row.parent ? <span className="font-mono text-xs">{String(row.parent)}</span> : "—"),
            },
            {
              key: "actions",
              header: "",
              className: "w-48 text-right",
              render: (row) => {
                const name = snapshotName(row)
                return (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={!name} onClick={() => setRestoreTarget(row)}>
                      Restore
                    </Button>
                    <Button variant="destructive" size="sm" disabled={!name} onClick={() => setDeleteTarget(row)}>
                      Delete
                    </Button>
                  </div>
                )
              },
            },
          ]}
          rows={rows.filter((r) => snapshotName(r) !== "current")}
          loading={state.loading}
          error={state.error}
          getRowKey={(row) => String(snapshotName(row) || Math.random())}
          emptyMessage={`No snapshots for ${trimmedNode}/${trimmedVmid} — snapshots named "current" (live state) are hidden.`}
          skeletonRows={4}
        />

        <p className="text-xs text-muted-foreground">
          PVE notes: <span className="font-mono">current</span> is a pseudo-snapshot pointing at live state and is never a rollback
          target. Rollback stops the VM automatically; the handler restarts it so the guest returns to the captured state. Polling
          uses <span className="font-mono">useInfraGet(..., &#123; intervalMs: 5000 &#125;)</span>.
        </p>
      </div>

      <CreateSnapshotDialog
        open={createOpen}
        busy={busy}
        node={trimmedNode}
        vmid={trimmedVmid}
        onOpenChange={setCreateOpen}
        onSubmit={(body, done) =>
          void runAction(() => apiPost(`${base}`, body), `Snapshot ${String(body.snapname)} created`, done)
        }
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={`Restore VM ${trimmedVmid} on ${trimmedNode} to "${restoreTarget ? snapshotName(restoreTarget) : ""}"?`}
        body="PVE rolls the VM back to this snapshot and the handler restarts the guest. Any changes after the snapshot are lost. The VM is stopped as part of the rollback."
        confirmLabel="Restore snapshot"
        busy={busy}
        onConfirm={() => {
          const target = restoreTarget
          setRestoreTarget(null)
          const snapname = target ? snapshotName(target) : ""
          if (!snapname) return
          void runAction(
            () => apiPost(`${base}/rollback`, { snapname }),
            `VM ${trimmedVmid} restored to ${snapname}`,
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete snapshot "${deleteTarget ? snapshotName(deleteTarget) : ""}" on ${trimmedNode}/${trimmedVmid}?`}
        body="The snapshot is removed from the disk chain. This cannot be undone."
        confirmLabel="Delete snapshot"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          const snapname = target ? snapshotName(target) : ""
          if (!snapname) return
          void runAction(
            () => apiDelete(`${base}/${encodeURIComponent(snapname)}`),
            `Snapshot ${snapname} deleted`,
          )
        }}
      />
    </ProviderShell>
  )
}

interface CreateDialogProps {
  open: boolean
  busy: boolean
  node: string
  vmid: string
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

function CreateSnapshotDialog({ open, busy, node, vmid, onOpenChange, onSubmit }: CreateDialogProps) {
  const [snapname, setSnapname] = useState("")
  const [description, setDescription] = useState("")

  const submit = () => {
    const name = snapname.trim()
    if (!name) {
      toast.error("Snapshot name is required.")
      return
    }
    if (name === "current") {
      toast.error('"current" is reserved by PVE.')
      return
    }
    const body: Record<string, unknown> = { snapname: name }
    if (description.trim()) body.description = description.trim()
    onSubmit(body, () => {
      setSnapname("")
      setDescription("")
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Create snapshot — {node}/{vmid}
          </DialogTitle>
          <DialogDescription>
            POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot — {"{ snapname, description? }"}. Node and VMID are taken
            from the route; name must not be &ldquo;current&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="qemu-snap-name">Snapshot name *</Label>
          <Input
            id="qemu-snap-name"
            value={snapname}
            onChange={(e) => setSnapname(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
            placeholder="pre-upgrade"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">Allowed: letters, digits, dot, underscore, hyphen. Max 40.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qemu-snap-desc">Description</Label>
          <Textarea
            id="qemu-snap-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — e.g. before kernel upgrade"
            rows={3}
            maxLength={512}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || snapname.trim() === ""} onClick={submit}>
            {busy ? "Creating…" : "Create snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
