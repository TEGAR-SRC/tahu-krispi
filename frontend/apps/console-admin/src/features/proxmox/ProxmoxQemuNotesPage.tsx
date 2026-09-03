import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type NotesEnvelope = {
  notes?: string
  description?: string
  node?: string
  vmid?: number | string
  [k: string]: unknown
}

type NoteRow = {
  key: string
  value: string
}

export default function ProxmoxQemuNotesPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{
    providerId: string
    node: string
    vmid: string
  }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validNode = trimmedNode.length > 0
  const validVmid = /^\d+$/.test(trimmedVmid)

  const path =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/notes`
      : null

  const state = useInfraGet<NotesEnvelope>(path, undefined, { intervalMs: 5000 })
  const rawNotes = useMemo(() => {
    const d = state.data as NotesEnvelope | null
    if (!d || typeof d !== "object") return ""
    if (typeof d.notes === "string") return d.notes
    if (typeof d.description === "string") return d.description
    return ""
  }, [state.data])

  const rows: NoteRow[] = useMemo(() => [{ key: "notes", value: rawNotes }], [rawNotes])

  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const openEdit = () => {
    setDraft(rawNotes)
    setEditOpen(true)
  }

  const save = async () => {
    if (!path) return
    setSaving(true)
    try {
      await apiPut(path, { notes: draft })
      toast.success("QEMU notes updated")
      setEditOpen(false)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update notes")
    } finally {
      setSaving(false)
    }
  }

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU notes"
        description="Per-VM QEMU notes (PVE description) — live from PVE /nodes/{node}/qemu/{vmid}/config description, polled every 5s."
      >
        <p className="text-sm text-destructive">
          Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes.
        </p>
      </ProviderShell>
    )
  }

  if (!validVmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title={`QEMU notes — ${trimmedNode}/${trimmedVmid}`}
        description={`QEMU notes for VM ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes (infra-readable, 5s poll).`}
      >
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU notes — ${trimmedNode}/${trimmedVmid}`}
      description={`QEMU notes (PVE description) for VM ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes (polled every 5s, infra-readable). PUT requires platform_admin.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={state.loading} onClick={() => state.reload()}>
            Refresh
          </Button>
          <Button size="sm" onClick={openEdit}>
            Edit notes
          </Button>
        </div>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}

      <p className="text-xs text-muted-foreground">
        Endpoints:{" "}
        <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes</span> ·{" "}
        <span className="font-mono">PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes</span>{" "}
        {"{ notes }"} (description alias accepted) — notes maps to PVE QEMU <span className="font-mono">description</span> via{" "}
        <span className="font-mono">PUT /nodes/{"{node}"}/qemu/{"{vmid}"}/config</span>. GET infra, PUT platform_admin, proxmox murni (proxmoxAdapterFor). Polled every 5s.
      </p>

      <SimpleDataTable<NoteRow>
        columns={[
          {
            key: "key",
            header: "Field",
            className: "w-32",
            render: (r) => <span className="font-mono text-sm font-medium">{r.key}</span>,
          },
          {
            key: "value",
            header: "Value",
            render: (r) => (
              <span className="max-w-[44rem] whitespace-pre-wrap break-words font-mono text-xs">
                {r.value ? r.value : <span className="text-muted-foreground">— (empty)</span>}
              </span>
            ),
          },
        ]}
        rows={rows}
        loading={state.loading}
        error={null}
        getRowKey={(r) => r.key}
        emptyMessage={state.loading ? "Loading notes…" : "No notes — description is empty."}
        skeletonRows={2}
      />

      <div className="rounded-md border p-3">
        <p className="text-xs font-medium">Live notes preview</p>
        {rawNotes ? (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs">
            {rawNotes}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No notes set. Click Edit notes to add a description.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Tip: notes are stored as PVE <span className="font-mono">description</span>. Clearing the textarea and saving sends{" "}
          <span className="font-mono">{`{ notes: "" }`}</span> which clears the description.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes</span> ·{" "}
        <span className="font-mono">PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes</span> · requireStaff infra (GET) / platform_admin (PUT) · proxmox murni (proxmoxAdapterFor) · 5s poll
      </p>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit QEMU notes</DialogTitle>
            <DialogDescription>
              PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes — {"{ notes }"} — mapped to PVE description on{" "}
              <span className="font-mono">/nodes/{trimmedNode}/qemu/{trimmedVmid}/config</span>. Empty clears the description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-notes">Notes *</Label>
            <Textarea
              id="qemu-notes"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Free-form notes for this VM (supports Markdown in Proxmox UI)"
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Send empty string to clear notes.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save notes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
