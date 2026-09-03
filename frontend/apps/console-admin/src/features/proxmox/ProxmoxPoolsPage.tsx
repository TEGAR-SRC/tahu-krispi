import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
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
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import type { PoolRow, PveClusterResource } from "@/features/admin/pages/providers/types"

export default function ProxmoxPoolsPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [pools, setPools] = useState<PoolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PoolRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PoolRow | null>(null)
  const [membersTarget, setMembersTarget] = useState<PoolRow | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => setReloadTick((v) => v + 1), [])

  useEffect(() => {
    if (!providerId) {
      setLoading(false)
      setError(new Error("Missing providerId"))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<PoolRow[]>(`${base}/pools`)
      .then((env) => {
        if (cancelled) return
        setPools(Array.isArray(env.data) ? env.data : [])
        setError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, base, reloadTick])

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
      <ProviderShell providerId={providerId} title="Pools" description="Resource pools for this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Pools"
      description="Proxmox resource pools — create, rename (comment), delete and manage VM/storage membership. GET is infra-readable (NOC), mutations require platform_admin."
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Create pool
        </Button>
      }
    >
      <SimpleDataTable<PoolRow>
        columns={[
          {
            key: "poolid",
            header: "Pool",
            render: (row) => <span className="font-mono text-sm font-medium">{row.poolid || "—"}</span>,
          },
          { key: "comment", header: "Comment", render: (row) => row.comment || "—" },
          {
            key: "members",
            header: "Members",
            render: (row) => {
              const members = row.members ?? []
              if (members.length === 0) return <span className="text-muted-foreground">empty</span>
              const guests = members.filter((m) => m.type === "qemu" || m.type === "lxc").length
              const storages = members.filter((m) => m.type === "storage").length
              return (
                <span className="flex flex-wrap gap-1">
                  {guests > 0 ? <Badge variant="outline">{guests} guest(s)</Badge> : null}
                  {storages > 0 ? <Badge variant="outline">{storages} storage(s)</Badge> : null}
                  {guests === 0 && storages === 0 ? <Badge variant="outline">{members.length} member(s)</Badge> : null}
                </span>
              )
            },
          },
          {
            key: "actions",
            header: "",
            className: "w-64 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={!row.poolid} onClick={() => setMembersTarget(row)}>
                  Members
                </Button>
                <Button variant="outline" size="sm" disabled={!row.poolid} onClick={() => setEditTarget(row)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" disabled={!row.poolid} onClick={() => setDeleteTarget(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={pools}
        loading={loading}
        error={error}
        getRowKey={(row) => String(row.poolid ?? Math.random())}
        emptyMessage="No resource pools defined on this Proxmox cluster."
        skeletonRows={3}
      />

      <CreatePoolDialog
        open={createOpen}
        busy={busy}
        onOpenChange={setCreateOpen}
        onSubmit={(body, done) =>
          void runAction(() => apiPost(`${base}/pools`, body), `Pool ${String(body.poolid)} created`, done)
        }
      />

      {editTarget?.poolid ? (
        <EditPoolDialog
          open
          target={editTarget}
          busy={busy}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSubmit={(comment, done) =>
            void runAction(
              () => apiPut(`${base}/pools/${encodeURIComponent(String(editTarget.poolid))}`, { comment }),
              `Pool ${editTarget.poolid} updated`,
              done,
            )
          }
        />
      ) : null}

      {membersTarget?.poolid ? (
        <MembersDialog
          open
          target={membersTarget}
          busy={busy}
          onOpenChange={(open) => !open && setMembersTarget(null)}
          onSubmit={(body, message, done) =>
            void runAction(
              () => apiPut(`${base}/pools/${encodeURIComponent(String(membersTarget.poolid))}/members`, body),
              message,
              done,
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete pool "${deleteTarget?.poolid}"?`}
        body="The pool disappears; its members keep running but lose the pool grouping."
        confirmLabel="Delete pool"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target?.poolid) return
          void runAction(
            () => apiDelete(`${base}/pools/${encodeURIComponent(String(target.poolid))}`),
            `Pool ${target.poolid} deleted`,
          )
        }}
      />
    </ProviderShell>
  )
}

interface PoolDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
}

function CreatePoolDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: PoolDialogProps & { onSubmit: (body: Record<string, unknown>, done: () => void) => void }) {
  const [poolid, setPoolid] = useState("")
  const [comment, setComment] = useState("")

  const submit = () => {
    if (!poolid.trim()) {
      toast.error("Pool id is required.")
      return
    }
    const body: Record<string, unknown> = { poolid: poolid.trim() }
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => {
      setPoolid("")
      setComment("")
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create pool</DialogTitle>
          <DialogDescription>PVE pool ids are short lowercase identifiers. POST /admin/proxmox/:id/pools</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="proxmox-pool-id">Pool id *</Label>
          <Input id="proxmox-pool-id" value={poolid} onChange={(e) => setPoolid(e.target.value)} placeholder="team-a" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="proxmox-pool-comment">Comment</Label>
          <Input id="proxmox-pool-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional description" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || poolid.trim() === ""} onClick={submit}>
            {busy ? "Creating…" : "Create pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditPoolDialog({
  open,
  busy,
  target,
  onOpenChange,
  onSubmit,
}: PoolDialogProps & { target: PoolRow; onSubmit: (comment: string, done: () => void) => void }) {
  const [comment, setComment] = useState(target.comment ?? "")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit pool {target.poolid}</DialogTitle>
          <DialogDescription>Only the comment can be updated. PUT /admin/proxmox/:id/pools/:pool_id</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="proxmox-pool-edit-comment">Comment</Label>
          <Input id="proxmox-pool-edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onSubmit(comment.trim(), () => onOpenChange(false))}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MembersDialog({
  open,
  busy,
  target,
  onOpenChange,
  onSubmit,
}: PoolDialogProps & {
  target: PoolRow
  onSubmit: (body: Record<string, unknown>, message: string, done: () => void) => void
}) {
  const [vms, setVms] = useState("")
  const [storages, setStorages] = useState("")
  const [removeMode, setRemoveMode] = useState(false)

  const guests = (target.members ?? []).filter((m) => m.type === "qemu" || m.type === "lxc")
  const poolStorages = (target.members ?? []).filter((m) => m.type === "storage")

  const submit = () => {
    if (vms.trim() === "" && storages.trim() === "") {
      toast.error("Provide at least one VMID or storage name.")
      return
    }
    onSubmit(
      { vms: vms.trim(), storages: storages.trim(), delete: removeMode },
      removeMode ? "Members removed" : "Members added",
      () => onOpenChange(false),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Members of pool {target.poolid}</DialogTitle>
          <DialogDescription>
            Comma lists are additions unless remove mode is enabled. PUT /admin/proxmox/:id/pools/:pool_id/members
          </DialogDescription>
        </DialogHeader>

        <MemberList heading="Guests in this pool" rows={guests} />
        <MemberList heading="Storages in this pool" rows={poolStorages} />

        <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="proxmox-pool-vms">VMIDs</Label>
            <Input
              id="proxmox-pool-vms"
              value={vms}
              onChange={(e) => setVms(e.target.value.replace(/[^0-9,\s]/g, ""))}
              placeholder="100,101"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proxmox-pool-storages">Storage names</Label>
            <Input
              id="proxmox-pool-storages"
              value={storages}
              onChange={(e) => setStorages(e.target.value)}
              placeholder="local-zfs,nfs-backup"
            />
          </div>
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={removeMode} onChange={(e) => setRemoveMode(e.target.checked)} />
          Remove mode (delete the listed members instead of adding)
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={busy} onClick={submit}>
            {removeMode ? "Remove members" : "Add members"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemberList({ heading, rows }: { heading: string; rows: PveClusterResource[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        {heading}: none yet.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{heading}</h4>
      <SimpleDataTable<PveClusterResource>
        columns={[
          { key: "vmid", header: "ID", render: (row) => (row.vmid != null ? String(row.vmid) : "—") },
          { key: "name", header: "Name", render: (row) => (row.name as string) || (row.storage as string) || "—" },
          { key: "node", header: "Node", render: (row) => (row.node as string) || "—" },
          { key: "status", header: "Status", render: (row) => (row.status as string) || "—" },
        ]}
        rows={rows}
        getRowKey={(row) => String((row.id as string) ?? `${row.type}-${row.vmid}-${row.storage}`)}
        skeletonRows={2}
      />
    </div>
  )
}
