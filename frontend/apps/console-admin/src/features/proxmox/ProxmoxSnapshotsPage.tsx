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

export default function ProxmoxSnapshotsPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [vmid, setVmid] = useState("")
  const trimmedVmid = vmid.trim()
  const vmidQuery = trimmedVmid ? { vmid: trimmedVmid } : undefined
  const snapshotsPath = providerId && trimmedVmid ? `${base}/snapshots` : null

  const snapshotsState = useInfraGet<SnapshotRow[]>(snapshotsPath, vmidQuery, { intervalMs: 5000 })
  const rows = (snapshotsState.data ?? []) as SnapshotRow[]
  const loading = snapshotsState.loading
  const error = snapshotsState.error
  const reload = snapshotsState.reload

  const [createOpen, setCreateOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<SnapshotRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SnapshotRow | null>(null)
  const [busy, setBusy] = useState(false)

  const runAction = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reload()
      done?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Snapshots" description="VM snapshots per VMID on this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  const validVmid = /^\d+$/.test(trimmedVmid)

  return (
    <ProviderShell
      providerId={providerId}
      title="Snapshots"
      description="Proxmox VM snapshots per VMID — list, create, rollback and delete. Snapshots are internal (live inside the guest disk chain) so PVE exposes no downloadable snapshot object. GET is infra-readable (NOC), mutations require platform_admin. Polled every 5s."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!trimmedVmid || !validVmid} onClick={() => reload()}>
            Refresh
          </Button>
          <Button size="sm" disabled={!trimmedVmid || !validVmid} onClick={() => setCreateOpen(true)}>
            Create snapshot
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="proxmox-snap-vmid">VMID *</Label>
          <Input
            id="proxmox-snap-vmid"
            value={vmid}
            onChange={(e) => setVmid(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="101"
            inputMode="numeric"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Numeric QEMU VMID whose snapshots are managed. Endpoints:{" "}
            <span className="font-mono">GET /admin/proxmox/:id/snapshots?vmid=</span> ·{" "}
            <span className="font-mono">POST /admin/proxmox/:id/snapshots</span> ·{" "}
            <span className="font-mono">POST /admin/proxmox/:id/snapshots/rollback</span> ·{" "}
            <span className="font-mono">DELETE /admin/proxmox/:id/snapshots?vmid=&snapname=</span>
          </p>
          {trimmedVmid && !validVmid ? <p className="text-xs text-destructive">VMID must be a positive integer.</p> : null}
        </div>

        {!trimmedVmid ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Enter a VMID above to list its snapshots. The table polls every 5s via <span className="font-mono">useInfraGet</span> with{" "}
            <span className="font-mono">intervalMs: 5000</span>.
          </p>
        ) : !validVmid ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Fix the VMID to load snapshots.</p>
        ) : (
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
            loading={loading}
            error={error}
            getRowKey={(row) => String(snapshotName(row) || Math.random())}
            emptyMessage={`No snapshots for VM ${trimmedVmid} — snapshots named "current" (live state) are hidden.`}
            skeletonRows={4}
          />
        )}

        <p className="text-xs text-muted-foreground">
          PVE notes: <span className="font-mono">current</span> is a pseudo-snapshot pointing at live state and is never listed as
          rollback target. Rollback stops the VM automatically; the handler restarts it so the guest returns to the captured state.
        </p>
      </div>

      <CreateSnapshotDialog
        open={createOpen}
        busy={busy}
        vmid={trimmedVmid}
        onOpenChange={setCreateOpen}
        onSubmit={(body, done) =>
          void runAction(() => apiPost(`${base}/snapshots`, body), `Snapshot ${String(body.snapname)} created`, done)
        }
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={`Restore VM ${trimmedVmid} to "${restoreTarget ? snapshotName(restoreTarget) : ""}"?`}
        body="PVE rolls the VM back to this snapshot and the handler restarts the guest. Any changes after the snapshot are lost. The VM is stopped as part of the rollback."
        confirmLabel="Restore snapshot"
        busy={busy}
        onConfirm={() => {
          const target = restoreTarget
          setRestoreTarget(null)
          const snapname = target ? snapshotName(target) : ""
          if (!snapname || !validVmid) return
          void runAction(
            () => apiPost(`${base}/snapshots/rollback`, { vmid: Number(trimmedVmid), snapname }),
            `VM ${trimmedVmid} restored to ${snapname}`,
          )
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete snapshot "${deleteTarget ? snapshotName(deleteTarget) : ""}" on VM ${trimmedVmid}?`}
        body="The snapshot is removed from the disk chain. This cannot be undone."
        confirmLabel="Delete snapshot"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          const snapname = target ? snapshotName(target) : ""
          if (!snapname || !validVmid) return
          void runAction(
            () => apiDelete(`${base}/snapshots/${encodeURIComponent(snapname)}`, { query: { vmid: trimmedVmid } }),
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
  vmid: string
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

function CreateSnapshotDialog({ open, busy, vmid, onOpenChange, onSubmit }: CreateDialogProps) {
  const [snapname, setSnapname] = useState("")
  const [description, setDescription] = useState("")

  const submit = () => {
    const name = snapname.trim()
    if (!vmid || !/^\d+$/.test(vmid)) {
      toast.error("VMID is required.")
      return
    }
    if (!name) {
      toast.error("Snapshot name is required.")
      return
    }
    if (name === "current") {
      toast.error('"current" is reserved by PVE.')
      return
    }
    const body: Record<string, unknown> = { vmid: Number(vmid), snapname: name }
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
          <DialogTitle>Create snapshot on VM {vmid || "—"}</DialogTitle>
          <DialogDescription>
            POST /admin/proxmox/:id/snapshots — {"{ vmid, snapname, description? }"}. VMID-scoped; name must not be
            &ldquo;current&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="proxmox-snap-name">Snapshot name *</Label>
          <Input
            id="proxmox-snap-name"
            value={snapname}
            onChange={(e) => setSnapname(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
            placeholder="pre-upgrade"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">Allowed: letters, digits, dot, underscore, hyphen. Max 40.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proxmox-snap-desc">Description</Label>
          <Textarea
            id="proxmox-snap-desc"
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
          <Button disabled={busy || snapname.trim() === "" || !vmid} onClick={submit}>
            {busy ? "Creating…" : "Create snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
