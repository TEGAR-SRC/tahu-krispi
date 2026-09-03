import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiDelete, apiPost } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type FirewallRule = Record<string, unknown> & { pos?: number; action?: string; type?: string; enable?: number }

type FirewallStatus = {
  node?: string
  vmid?: number
  rules?: FirewallRule[]
  options?: Record<string, unknown> | null
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v || "—"
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export default function ProxmoxQemuFirewallPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validNode = trimmedNode.length > 0
  const validVmid = /^\d+$/.test(trimmedVmid)

  const path =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/firewall`
      : null
  const state = useInfraGet<FirewallStatus>(path, undefined, { intervalMs: 5000 })
  const rows = useMemo(() => (Array.isArray(state.data?.rules) ? (state.data!.rules as FirewallRule[]) : []), [state.data])

  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState("ACCEPT")
  const [ruleType, setRuleType] = useState("in")
  const [source, setSource] = useState("")
  const [dest, setDest] = useState("")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [deletePos, setDeletePos] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU firewall"
        description="Per-VM firewall — live from PVE /nodes/{node}/qemu/{vmid}/firewall/rules (polled every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall.</p>
      </ProviderShell>
    )
  }

  if (!validVmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title={`QEMU firewall — ${trimmedNode}/${trimmedVmid}`}
        description={`Per-VM firewall for QEMU ${trimmedVmid} on node ${trimmedNode}. GET infra, POST/DELETE platform_admin, proxmox murni.`}
      >
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  const createRule = async () => {
    if (!path) return
    if (!action.trim()) {
      toast.error("action is required")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { action: action.trim().toUpperCase(), type: ruleType }
      if (source.trim()) body.source = source.trim()
      if (dest.trim()) body.dest = dest.trim()
      if (comment.trim()) body.comment = comment.trim()
      body.enable = 1
      await apiPost(path, body)
      toast.success(`Firewall rule ${body.action} created`)
      setCreateOpen(false)
      setSource("")
      setDest("")
      setComment("")
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create firewall rule")
    } finally {
      setSaving(false)
    }
  }

  const deleteRule = async (pos: number) => {
    if (!path) return
    setBusy(true)
    try {
      await apiDelete(`${path}/${pos}`)
      toast.success(`Firewall rule pos ${pos} deleted`)
      setDeletePos(null)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete firewall rule")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU firewall — ${trimmedNode}/${trimmedVmid}`}
      description={`Live firewall rules for VM ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall (polled every 5s, infra-readable). POST/DELETE require platform_admin.`}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Add rule
          </Button>
        </div>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall</span> · requireStaff infra (NOC + platform_admin) · proxmox murni (proxmoxAdapterFor) · 5s poll ·
        <span className="font-mono"> POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall {"{action,type}"}</span> · platform_admin only ·
        <span className="font-mono"> DELETE /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall/:pos</span>
      </p>

      <SimpleDataTable<FirewallRule>
        columns={[
          { key: "pos", header: "Pos", render: (r) => <span className="font-mono text-xs">{r.pos ?? "—"}</span> },
          {
            key: "action",
            header: "Action",
            render: (r) => <span className="font-mono text-xs font-medium">{stringify(r.action)}</span>,
          },
          { key: "type", header: "Type", render: (r) => stringify(r.type) },
          { key: "source", header: "Source", render: (r) => <span className="font-mono text-xs">{stringify((r as Record<string, unknown>).source)}</span> },
          { key: "dest", header: "Dest", render: (r) => <span className="font-mono text-xs">{stringify((r as Record<string, unknown>).dest)}</span> },
          { key: "enable", header: "Enable", render: (r) => String(r.enable ?? "—") },
          { key: "comment", header: "Comment", className: "hidden md:table-cell max-w-48 truncate", render: (r) => stringify((r as Record<string, unknown>).comment) },
          {
            key: "actions",
            header: "",
            className: "w-28 text-right",
            render: (r) => (
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => setDeletePos(typeof r.pos === "number" ? r.pos : null)}>
                Delete
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={state.loading}
        error={null}
        getRowKey={(r, idx) => String(r.pos ?? idx)}
        emptyMessage={state.loading ? "Loading firewall rules…" : "No firewall rules — add one via Add rule."}
        skeletonRows={5}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firewall options</CardTitle>
          <CardDescription>
            <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall/options</span> (infra-readable). PUT via{" "}
            <span className="font-mono">/firewall/options</span> — enable/policy (see PVE docs).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.data?.options ? (
            <pre className="max-h-64 overflow-auto rounded bg-muted p-3 font-mono text-xs">{JSON.stringify(state.data.options, null, 2)}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">No options data — PVE returned nothing or firewall is disabled.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add firewall rule — {trimmedNode}/{trimmedVmid}</DialogTitle>
            <DialogDescription>
              POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall — {"{action, type, source?, dest?, comment?}"} — forwarded to PVE POST /nodes/{"{node}"}/qemu/{"{vmid}"}/firewall/rules. Action is required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Action *</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCEPT">ACCEPT</SelectItem>
                  <SelectItem value="DROP">DROP</SelectItem>
                  <SelectItem value="REJECT">REJECT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={ruleType} onValueChange={setRuleType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">in</SelectItem>
                  <SelectItem value="out">out</SelectItem>
                  <SelectItem value="group">group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-source">Source</Label>
              <Input id="fw-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. 10.0.0.0/24 or empty = any" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-dest">Dest</Label>
              <Input id="fw-dest" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="e.g. 192.168.1.0/24 or empty = any" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-comment">Comment</Label>
              <Input id="fw-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Allow SSH" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void createRule()} disabled={saving}>
              {saving ? "Creating…" : "Create rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletePos !== null} onOpenChange={(open) => !open && setDeletePos(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete firewall rule pos {deletePos}?</DialogTitle>
            <DialogDescription>
              This deletes rule <span className="font-mono">pos={deletePos}</span> via{" "}
              <span className="font-mono">DELETE /nodes/{trimmedNode}/qemu/{trimmedVmid}/firewall/rules/{deletePos}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePos(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy || deletePos === null} onClick={() => void deleteRule(deletePos!)}>
              {busy ? "Deleting…" : "Delete rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
