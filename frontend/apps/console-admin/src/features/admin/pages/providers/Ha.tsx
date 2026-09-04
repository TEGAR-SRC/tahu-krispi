// High-availability console: HA-managed guests (with type filter), add/edit/delete
// resource and watchdog arm/disarm. Polls every 5s via useInfraGet (infra-readable, proxmox murni). All mutations are platform-admin-only and
// confirmed; disarm requires an explicit freeze|ignore mode.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, apiPut, ApiError } from "@/lib/api"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusBadge } from "../shared"
import { ConfirmDialog, ProviderShell } from "./shared"
import { useInfraGet } from "./infra"
import type { HAResource } from "./types"

const RESOURCE_TYPES = ["vm", "ct"]

export default function ProviderHaPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = `/admin/proxmox/${providerId}`

  const [typeFilter, setTypeFilter] = useState("all")
  const resources = useInfraGet<HAResource[]>(
    providerId ? `${base}/ha-resources` : null,
    { type: typeFilter === "all" ? null : typeFilter },
    { intervalMs: 5000 },
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<HAResource | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ sid: string; purge: boolean } | null>(null)
  const [disarmOpen, setDisarmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const runAction = async (
    action: () => Promise<unknown>,
    success: string,
    done?: () => void,
  ) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      resources.reload()
      done?.()
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="HA resources"
      description="Guests managed by the cluster's high-availability stack and the CRM watchdog. Polls every 5s (infra, proxmox murni via proxmoxAdapterFor)."
      actions={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void runAction(() => apiPost(`${base}/ha/arm`), "Watchdog armed")}>
            Arm watchdog
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDisarmOpen(true)}>
            Disarm…
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add resource…
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {RESOURCE_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable<HAResource>
        columns={[
          {
            key: "sid",
            header: "SID",
            render: (row) => <span className="font-mono text-sm">{row.sid || "—"}</span>,
          },
          {
            key: "type",
            header: "Type",
            render: (row) => <Badge variant="outline">{row.type || row.sid?.split(":")[0]}</Badge>,
          },
          {
            key: "state",
            header: "State",
            render: (row) => <StatusBadge status={row.state ?? null} />,
          },
          {
            key: "group",
            header: "Group",
            className: "hidden md:table-cell",
            render: (row) => row.group || "—",
          },
          {
            key: "limits",
            header: "Restart / relocate",
            className: "hidden lg:table-cell",
            render: (row) => `${row.max_restart ?? 1} / ${row.max_relocate ?? 1}`,
          },
          {
            key: "comment",
            header: "Comment",
            className: "hidden xl:table-cell max-w-64 truncate",
            render: (row) => row.comment || "—",
          },
          {
            key: "actions",
            header: "",
            className: "w-44 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={!row.sid} onClick={() => setEditTarget(row)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" disabled={!row.sid} onClick={() => setDeleteTarget({ sid: String(row.sid), purge: false })}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={resources.data ?? []}
        loading={resources.loading}
        error={resources.error}
        getRowKey={(row) => String(row.sid ?? "?")}
        emptyMessage="No HA resources registered."
        skeletonRows={4}
      />
      <p className="text-xs text-muted-foreground">Endpoints: <span className="font-mono">GET /admin/proxmox/:id/ha-resources?type=</span> · <span className="font-mono">POST /admin/proxmox/:id/ha-resources</span> · <span className="font-mono">PUT /admin/proxmox/:id/ha-resources/:sid</span> · <span className="font-mono">DELETE /admin/proxmox/:id/ha-resources?sid=</span> · poll 5s · <span className="font-mono">proxmoxAdapterFor</span> 501 expect proxmox</p>

      <AddResourceDialog
        open={addOpen}
        busy={busy}
        onOpenChange={setAddOpen}
        onSubmit={(body, done) =>
          void runAction(() => apiPost(`${base}/ha-resources`, body), `HA resource ${String(body.sid)} added`, done)
        }
      />
      {editTarget?.sid ? (
        <EditResourceDialog
          open
          target={editTarget}
          busy={busy}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSubmit={(body, done) =>
            void runAction(() => apiPut(`${base}/ha-resources/${encodeURIComponent(String(editTarget.sid))}`, body), `HA resource ${editTarget.sid} updated`, done)
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete HA resource "${deleteTarget?.sid}"?`}
        body="Removes the guest from HA management."
        confirmLabel="Delete resource"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target) return
          void runAction(
            () => apiDelete(`${base}/ha-resources`, { query: { sid: target.sid, purge: target.purge ? "true" : null } }),
            `HA resource ${target.sid} deleted`,
          )
        }}
      >
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <Checkbox
            checked={deleteTarget?.purge ?? false}
            onCheckedChange={(checked) =>
              setDeleteTarget((current) =>
                current ? { ...current, purge: checked === true } : current,
              )
            }
          />
          Also purge the resource from the config file
        </label>
      </ConfirmDialog>

      <DisarmDialog
        open={disarmOpen}
        busy={busy}
        onOpenChange={setDisarmOpen}
        onSubmit={(mode, done) => void runAction(() => apiPost(`${base}/ha/disarm`, { mode }), `Watchdog disarmed (${mode})`, done)}
      />
    </ProviderShell>
  )
}

interface AddResourceProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

function AddResourceDialog({ open, busy, onOpenChange, onSubmit }: AddResourceProps) {
  const [sid, setSid] = useState("")
  const [type, setType] = useState("vm")
  const [state, setState] = useState("started")
  const [group, setGroup] = useState("")
  const [maxRestart, setMaxRestart] = useState("1")
  const [maxRelocate, setMaxRelocate] = useState("1")
  const [comment, setComment] = useState("")

  const submit = () => {
    if (!sid.trim()) {
      toast.error("SID is required (e.g. vm:100).")
      return
    }
    const body: Record<string, unknown> = {
      sid: sid.trim(),
      state,
    }
    if (type.trim()) body.type = type.trim()
    if (group.trim()) body.group = group.trim()
    if (maxRestart.trim()) body.max_restart = Number.parseInt(maxRestart, 10)
    if (maxRelocate.trim()) body.max_relocate = Number.parseInt(maxRelocate, 10)
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add HA resource</DialogTitle>
          <DialogDescription>SID format is vm:&lt;vmid&gt; or ct:&lt;ctid&gt;.</DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ha-sid">SID *</Label>
            <Input id="ha-sid" value={sid} onChange={(event) => setSid(event.target.value)} placeholder="vm:100" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ha-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-state">State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id="ha-state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["started", "stopped", "enabled", "disabled"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group">Group</Label>
            <Input id="ha-group" value={group} onChange={(event) => setGroup(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-restart">Max restarts</Label>
            <Input
              id="ha-restart"
              inputMode="numeric"
              value={maxRestart}
              onChange={(event) => setMaxRestart(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-relocate">Max relocations</Label>
            <Input
              id="ha-relocate"
              inputMode="numeric"
              value={maxRelocate}
              onChange={(event) => setMaxRelocate(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-comment">Comment</Label>
            <Input id="ha-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Add resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditResourceDialog({ open, busy, target, onOpenChange, onSubmit }: { open: boolean; busy: boolean; target: HAResource; onOpenChange: (open: boolean) => void; onSubmit: (body: Record<string, unknown>, done: () => void) => void }) {
  const [state, setState] = useState(String(target.state ?? "started"))
  const [group, setGroup] = useState(String(target.group ?? ""))
  const [maxRestart, setMaxRestart] = useState(String(target.max_restart ?? "1"))
  const [maxRelocate, setMaxRelocate] = useState(String(target.max_relocate ?? "1"))
  const [comment, setComment] = useState(String(target.comment ?? ""))
  const submit = () => {
    const body: Record<string, unknown> = { state }
    body.group = group.trim()
    if (maxRestart.trim()) body.max_restart = Number.parseInt(maxRestart, 10)
    if (maxRelocate.trim()) body.max_relocate = Number.parseInt(maxRelocate, 10)
    body.comment = comment.trim()
    if (target.digest) body.digest = target.digest
    onSubmit(body, () => onOpenChange(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit HA resource {String(target.sid)}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/ha-resources/:sid — proxmox murni (proxmoxAdapterFor), platform_admin only. SDK HAResourceUpdateOption.</DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5 sm:col-span-2"><Label>SID</Label><Input value={String(target.sid ?? "")} disabled className="font-mono" /></div>
          <div className="space-y-1.5"><Label htmlFor="ha-edit-state">State</Label><Select value={state} onValueChange={setState}><SelectTrigger id="ha-edit-state"><SelectValue /></SelectTrigger><SelectContent>{["started", "stopped", "enabled", "disabled", "ignored"].map((v) => (<SelectItem key={v} value={v}>{v}</SelectItem>))}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="ha-edit-group">Group</Label><Input id="ha-edit-group" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Optional" /></div>
          <div className="space-y-1.5"><Label htmlFor="ha-edit-restart">Max restarts</Label><Input id="ha-edit-restart" inputMode="numeric" value={maxRestart} onChange={(e) => setMaxRestart(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="space-y-1.5"><Label htmlFor="ha-edit-relocate">Max relocations</Label><Input id="ha-edit-relocate" inputMode="numeric" value={maxRelocate} onChange={(e) => setMaxRelocate(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ha-edit-comment">Comment</Label><Input id="ha-edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisarmDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (mode: string, done: () => void) => void
}) {
  const [mode, setMode] = useState("freeze")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Disarm the HA watchdog</DialogTitle>
          <DialogDescription>
            freeze pauses recovery decisions; ignore makes the manager stop watching entirely.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ha-disarm-mode">Mode *</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id="ha-disarm-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="freeze">freeze</SelectItem>
              <SelectItem value="ignore">ignore</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onSubmit(mode, () => onOpenChange(false))}>
            Disarm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
