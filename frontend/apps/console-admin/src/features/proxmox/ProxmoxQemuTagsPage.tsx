import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type TagsResponse = {
  node?: string
  vmid?: number
  tags?: string[]
  raw?: string
}

type TagRow = { tag: string; idx: number }

export default function ProxmoxQemuTagsPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const path =
    providerId && node && vmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/tags`
      : null
  const state = useInfraGet<TagsResponse>(path, undefined, { intervalMs: 5000 })
  const tags: string[] = Array.isArray((state.data as TagsResponse | null)?.tags) ? ((state.data as TagsResponse).tags as string[]) : []
  const raw: string = (state.data as TagsResponse | null)?.raw ?? ""
  const rows: TagRow[] = useMemo(() => tags.map((tag, idx) => ({ tag, idx })), [tags])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  if (!providerId || !node || !vmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU tags"
        description="Per-VM QEMU tags — live from PVE /nodes/{node}/qemu/{vmid}/config tags (polled every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags.</p>
      </ProviderShell>
    )
  }

  const onEdit = () => {
    setDraft(tags.join("; "))
    setOpen(true)
  }

  const save = async () => {
    if (!path) return
    const input = draft.trim()
    const parsed: string[] = input
      ? input
          .split(";")
          .flatMap((p) => p.split(","))
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    if (parsed.length > 32) {
      toast.error("at most 32 tags are allowed")
      return
    }
    for (const t of parsed) if (t.length > 64) { toast.error(`tag "${t.slice(0, 20)}" exceeds 64 characters`); return }
    setSaving(true)
    try {
      await apiPut(path, { tags: parsed })
      toast.success(parsed.length === 0 ? "Tags cleared" : `Tags updated (${parsed.length})`)
      setOpen(false)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update tags")
    } finally {
      setSaving(false)
    }
  }

  const removeOne = async (tag: string) => {
    if (!path) return
    const next = tags.filter((t) => t !== tag)
    setSaving(true)
    try {
      await apiPut(path, { tags: next })
      toast.success(`Tag "${tag}" removed`)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update tags")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU tags — ${node}/${vmid}`}
      description={`Live tags for VM ${vmid} on node ${node}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags (polled every 5s, infra-readable). PUT requires platform_admin.`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>
          <Button size="sm" onClick={onEdit}>Edit tags</Button>
        </div>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}

      <div className="rounded-md border p-3 text-sm">
        <div className="text-xs text-muted-foreground">Raw PVE tags string (semicolon-joined)</div>
        <div className="mt-1 font-mono text-xs break-all">{raw ? raw : <span className="text-muted-foreground">— no tags —</span>}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.length === 0 ? <span className="text-xs text-muted-foreground">No tags assigned.</span> : tags.map((t) => <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>)}
        </div>
      </div>

      <SimpleDataTable<TagRow>
        columns={[
          { key: "tag", header: "Tag", render: (r) => <span className="font-mono text-sm font-medium">{r.tag}</span> },
          { key: "idx", header: "#", className: "w-16", render: (r) => <span className="text-xs text-muted-foreground">{r.idx + 1}</span> },
          {
            key: "actions",
            header: "",
            className: "w-28 text-right",
            render: (r) => (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => void removeOne(r.tag)}>Remove</Button>
            ),
          },
        ]}
        rows={rows}
        loading={state.loading}
        error={null}
        getRowKey={(r) => r.tag}
        emptyMessage={state.loading ? "Loading tags…" : "No tags — add one via Edit tags."}
        skeletonRows={4}
      />
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags</span> · requireStaff infra (NOC + platform_admin) · proxmox murni (proxmoxAdapterFor) · 5s poll ·
        <span className="font-mono"> PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags {"{tags:string[]}"}</span> · platform_admin only
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit QEMU tags — {node}/{vmid}</DialogTitle>
            <DialogDescription>
              PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags — {"{tags:string[]}"} — also accepts a single ";" or "," separated string. Max 32 tags, each ≤64 chars. PVE stores as ";"-joined config.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-tags">Tags — semicolon or comma separated</Label>
            <Input id="qemu-tags" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="prod; web; tier-1" className="font-mono" />
            <p className="text-xs text-muted-foreground">Leave empty to clear all tags. Example: prod; web; tier-1</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save tags"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
