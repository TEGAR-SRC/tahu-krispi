import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, ApiError } from "@/lib/api"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type FwAlias = {
  name?: string
  cidr?: string
  comment?: string
  digest?: string
  [k: string]: unknown
}

export default function ProxmoxFwAliasesPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`
  const path = providerId ? `${base}/fw-aliases` : null
  const state = useInfraGet<FwAlias[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as FwAlias[]

  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FwAlias | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
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

  if (!providerId) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Firewall aliases"
        description="Cluster firewall aliases (GET/POST/DELETE /admin/proxmox/:id/fw-aliases). GET is infra-readable (NOC), POST/DELETE require platform_admin."
      >
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Firewall aliases"
      description="Cluster firewall IP aliases — named CIDR shortcuts usable in firewall rules. GET is infra-readable (NOC), POST/DELETE require platform_admin. Polling every 5s."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create alias
          </Button>
        </div>
      }
    >
      <p className="text-xs text-muted-foreground">GET {base}/fw-aliases — polled every 5s.</p>
      <SimpleDataTable<FwAlias>
        columns={[
          {
            key: "name",
            header: "Name",
            render: (r) => <span className="font-mono text-sm font-medium">{r.name || "—"}</span>,
          },
          {
            key: "cidr",
            header: "CIDR",
            render: (r) => <span className="font-mono text-sm">{r.cidr || "—"}</span>,
          },
          {
            key: "comment",
            header: "Comment",
            className: "hidden md:table-cell max-w-64 truncate",
            render: (r) => r.comment || "—",
          },
          {
            key: "digest",
            header: "Digest",
            className: "hidden xl:table-cell max-w-32 truncate font-mono text-xs",
            render: (r) => (r.digest ? String(r.digest).slice(0, 8) : "—"),
          },
          {
            key: "actions",
            header: "",
            className: "w-32 text-right",
            render: (r) => (
              <Button
                variant="destructive"
                size="sm"
                disabled={!r.name}
                onClick={() => setDeleteTarget(r)}
              >
                Delete
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={state.loading}
        error={state.error}
        getRowKey={(r) => String(r.name ?? Math.random())}
        emptyMessage="No firewall aliases defined on this cluster."
        skeletonRows={3}
      />

      <CreateAliasDialog
        open={createOpen}
        busy={busy}
        onOpenChange={setCreateOpen}
        onSubmit={(body, done) =>
          void run(() => apiPost(`${base}/fw-aliases`, body), `Alias ${String(body.name)} created`, done)
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete alias "${String(deleteTarget?.name ?? "")}"?`}
        body="The alias disappears from /cluster/firewall/aliases. Rules referencing it will no longer resolve."
        confirmLabel="Delete alias"
        busy={busy}
        onConfirm={() => {
          const t = deleteTarget
          setDeleteTarget(null)
          if (!t?.name) return
          void run(
            () => apiDelete(`${base}/fw-aliases/${encodeURIComponent(String(t.name))}`),
            `Alias ${String(t.name)} deleted`,
          )
        }}
      />
    </ProviderShell>
  )
}

function CreateAliasDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}) {
  const [name, setName] = useState("")
  const [cidr, setCidr] = useState("")
  const [comment, setComment] = useState("")

  const submit = () => {
    if (!name.trim()) {
      toast.error("name is required")
      return
    }
    if (!cidr.trim()) {
      toast.error("cidr is required")
      return
    }
    const body: Record<string, unknown> = { name: name.trim(), cidr: cidr.trim() }
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => {
      onOpenChange(false)
      setName("")
      setCidr("")
      setComment("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create firewall alias</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/fw-aliases — {`{name, cidr, comment?}`}. Name is the alias key, cidr is the IP/network.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fw-alias-name">Name *</Label>
          <Input id="fw-alias-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="office-net" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fw-alias-cidr">CIDR *</Label>
          <Input id="fw-alias-cidr" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="203.0.113.0/24" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fw-alias-comment">Comment</Label>
          <Input id="fw-alias-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Office uplink" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create alias"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
