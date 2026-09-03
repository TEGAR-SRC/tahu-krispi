// Templates — per-provider QEMU/LXC templates derived from cluster resources
// where template == 1. Endpoint: GET /admin/proxmox/:id/templates (proxmoxAdapterFor
// guard kind==proxmox, RBAC GET infra NOC readable). Polling every 5s via
// useInfraGet intervalMs 5000. Actions: convert (POST /admin/instances/:id/template
// — proxmox-only, 501 otherwise) and delete (DELETE /admin/proxmox/:id/templates/:vmid
// with ?node=, fallback to POST /admin/instances/:id/terminate when no instance mapping).
import { useCallback, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
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
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { PveClusterResource } from "@/features/admin/pages/providers/types"

interface InstanceListRow {
  id: string
  provider_id?: string
  external_vm_id?: string
  externalVmId?: string
  name?: string
  [key: string]: unknown
}

function vmidOf(row: PveClusterResource): string {
  if (row.vmid != null) return String(row.vmid)
  const id = String(row.id ?? "")
  const m = id.match(/qemu\/(\d+)/)
  if (m) return m[1]
  return ""
}

function displayName(row: PveClusterResource): string {
  return String(row.name ?? row.id ?? vmidOf(row) ?? "—")
}

export default function ProxmoxTemplatesPage() {
  const params = useParams()
  const providerId = (params as Record<string, string>).providerId ?? (params as Record<string, string>).id ?? ""

  const templates = useInfraGet<PveClusterResource[]>(
    providerId ? `/admin/proxmox/${providerId}/templates` : null,
    undefined,
    { intervalMs: 5000 },
  )

  // Instance index for convert/delete via /admin/instances/:id/* — the
  // templates endpoint is proxmox-native (VMID + node), while convert/delete
  // through the instance plane needs the internal instance id (external_vm_id == vmid).
  const instances = useInfraGet<InstanceListRow[]>(
    providerId ? "/admin/instances" : null,
    providerId ? { provider: providerId, per_page: 100 } : undefined,
    { intervalMs: 5000 },
  )

  const findInstanceId = useCallback(
    (vmid: string) => {
      const list: InstanceListRow[] = Array.isArray(instances.data) ? instances.data : []
      const match = list.find((r) => {
        const ext = String(r.external_vm_id ?? r.externalVmId ?? "")
        if (ext !== vmid) return false
        if (r.provider_id && r.provider_id !== providerId) return false
        return true
      })
      return match?.id
    },
    [instances.data, providerId],
  )

  const raw = templates.data as unknown
  let rows: PveClusterResource[] = []
  if (Array.isArray(raw)) rows = raw as PveClusterResource[]
  else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).resources as unknown[])) {
    rows = (raw as Record<string, unknown>).resources as PveClusterResource[]
  } else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).templates as unknown[])) {
    rows = (raw as Record<string, unknown>).templates as PveClusterResource[]
  }

  // Backend derives from cluster resources where template == 1 (qemu/lxc).
  // If the endpoint already filters, this is a no-op.
  const filtered = rows.filter((r) => (r as unknown as Record<string, unknown>).template === 1 || (r as unknown as Record<string, unknown>).template === true)

  const displayRows = filtered.length > 0 || rows.length === 0 ? filtered : rows

  const [convertTarget, setConvertTarget] = useState<PveClusterResource | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PveClusterResource | null>(null)
  const [cloneTarget, setCloneTarget] = useState<PveClusterResource | null>(null)
  const [cloneName, setCloneName] = useState("")
  const [busy, setBusy] = useState(false)

  const reload = () => templates.reload()

  const onConvert = async () => {
    if (!convertTarget) return
    const vmid = vmidOf(convertTarget)
    if (!vmid) {
      toast.error("Template VMID missing")
      return
    }
    const instanceId = findInstanceId(vmid)
    if (!instanceId) {
      toast.error(`No linked instance found for VMID ${vmid} — ensure the VM is tracked in /admin/instances (external_vm_id == vmid) and synced for this provider.`)
      return
    }
    setBusy(true)
    try {
      await apiPost(`/admin/instances/${instanceId}/template`, undefined)
      toast.success(`VM ${vmid} converted to template`)
      setConvertTarget(null)
      reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Convert to template failed")
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!deleteTarget || !providerId) return
    const vmid = vmidOf(deleteTarget)
    const node = String(deleteTarget.node ?? "")
    if (!vmid) {
      toast.error("Template VMID missing")
      return
    }
    setBusy(true)
    try {
      // Prefer proxmox-native delete when node is known; PVE destroy needs node+vmid.
      if (node) {
        try {
          await apiDelete(`/admin/proxmox/${providerId}/templates/${encodeURIComponent(vmid)}`, {
            query: { node },
          })
          toast.success(`Template ${vmid} deletion queued`)
          setDeleteTarget(null)
          reload()
          return
        } catch (cause) {
          // Fall through to instance-plane terminate if proxmox-native route is not yet registered (404) or instance not mapped.
          if (!(cause instanceof ApiError) || (cause.status !== 404 && cause.status !== 501)) {
            throw cause
          }
        }
      }
      const instanceId = findInstanceId(vmid)
      if (!instanceId) {
        // Last resort: try without instance mapping via generic delete query
        const res = await apiGet<InstanceListRow[]>("/admin/instances", {
          query: { provider: providerId, per_page: 100, q: vmid },
        })
        const fallback = Array.isArray(res.data) ? res.data.find((r) => String(r.external_vm_id ?? r.externalVmId ?? "") === vmid) : undefined
        if (!fallback?.id) {
          throw new ApiError("not_found", `No instance mapping for VMID ${vmid} — cannot delete without node or instance id`, 404)
        }
        await apiPost(`/admin/instances/${fallback.id}/terminate`, {})
        toast.success(`Template ${vmid} termination queued`)
      } else {
        await apiPost(`/admin/instances/${instanceId}/terminate`, {})
        toast.success(`Template ${vmid} termination queued`)
      }
      setDeleteTarget(null)
      reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete template failed")
    } finally {
      setBusy(false)
    }
  }

  const onClone = async () => {
    if (!cloneTarget || !providerId) return
    const source = vmidOf(cloneTarget)
    const name = cloneName.trim()
    if (!source) {
      toast.error("Template source VMID missing")
      return
    }
    if (!name) {
      toast.error("Clone name is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(`/admin/proxmox/${providerId}/clone`, { source, name })
      toast.success(`Clone "${name}" from template ${source} queued (201)`)
      setCloneTarget(null)
      setCloneName("")
      reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Clone from template failed")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Templates"
        description="Proxmox templates — GET /admin/proxmox/:id/templates derived from cluster resources where template==1, polled every 5s."
      >
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Templates"
      description="Proxmox templates on this cluster — GET /admin/proxmox/:id/templates (derive from cluster resources template==1, qemu/lxc). Polled every 5s via useInfraGet intervalMs 5000. Convert via POST /admin/instances/:id/template (proxmox-only); delete via DELETE /admin/proxmox/:id/templates/:vmid?node= (or terminate fallback)."
      actions={
        <Button variant="outline" size="sm" onClick={reload} disabled={templates.loading}>
          {templates.loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      <SimpleDataTable<PveClusterResource>
        columns={[
          {
            key: "vmid",
            header: "VMID",
            render: (row) => <span className="font-mono text-sm">{vmidOf(row) || "—"}</span>,
          },
          {
            key: "name",
            header: "Name",
            render: (row) => <span className="min-w-0 truncate text-sm">{displayName(row)}</span>,
          },
          {
            key: "type",
            header: "Type",
            render: (row) => <Badge variant="outline">{String(row.type ?? "—")}</Badge>,
          },
          {
            key: "node",
            header: "Node",
            render: (row) => <span className="font-mono text-xs">{String(row.node ?? "—")}</span>,
          },
          {
            key: "template",
            header: "Template",
            render: (row) => {
              const t = (row as unknown as Record<string, unknown>).template
              return t === 1 || t === true ? <Badge variant="secondary">template</Badge> : <Badge variant="outline">—</Badge>
            },
          },
          {
            key: "status",
            header: "Status",
            className: "hidden md:table-cell",
            render: (row) => String(row.status ?? "—"),
          },
          {
            key: "actions",
            header: "",
            className: "w-64 text-right",
            render: (row) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCloneTarget(row)
                    setCloneName(displayName(row) ? `${displayName(row)}-clone` : "")
                  }}
                >
                  Clone
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConvertTarget(row)}>
                  Convert
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={displayRows}
        loading={templates.loading}
        error={templates.error}
        getRowKey={(row, idx) => String(vmidOf(row) || row.id || idx)}
        emptyMessage="No templates on this cluster — cluster resources returned no entries with template==1. Verify provider kind is proxmox, PVE is reachable, and at least one VM has been converted to template."
        skeletonRows={5}
      />

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/templates</span> · infra-readable, 5s poll via{" "}
        <span className="font-mono">useInfraGet(..., {`{intervalMs: 5000}`})</span> · derives from{" "}
        <span className="font-mono">GET /admin/proxmox/:id/cluster → resources[].template == 1</span> · actions:{" "}
        <span className="font-mono">POST /admin/instances/:id/template</span> (convert) ·{" "}
        <span className="font-mono">DELETE /admin/proxmox/:id/templates/:vmid?node=</span> /{" "}
        <span className="font-mono">POST /admin/instances/:id/terminate</span> (delete) ·{" "}
        <span className="font-mono">POST /admin/proxmox/:id/clone {"{source,name}"}</span> (clone from template)
      </p>

      <ConfirmDialog
        open={convertTarget !== null}
        onOpenChange={(open) => !open && setConvertTarget(null)}
        title={`Convert VM ${convertTarget ? vmidOf(convertTarget) : ""} to template?`}
        body="The VM becomes a PVE template synchronously via POST /admin/instances/:id/template (proxmox-only, 501 otherwise). It can no longer be started as-is — clone from it instead."
        confirmLabel="Convert to template"
        busy={busy}
        onConfirm={() => void onConvert()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete template ${deleteTarget ? vmidOf(deleteTarget) : ""}?`}
        body="The template VM is destroyed at the provider (purge, 202). This cannot be undone — ensure no clones depend on it as a base."
        confirmLabel="Delete template"
        busy={busy}
        onConfirm={() => void onDelete()}
      />

      <Dialog
        open={cloneTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCloneTarget(null)
            setCloneName("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clone from template {cloneTarget ? vmidOf(cloneTarget) : ""}</DialogTitle>
            <DialogDescription>
              Full copy via <span className="font-mono">POST /admin/proxmox/:id/clone {"{source,name}"}</span> — source is the template VMID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="template-clone-name">New VM name *</Label>
            <Input
              id="template-clone-name"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="web-01-from-template"
              maxLength={64}
            />
            <p className="text-xs text-muted-foreground">
              Template VMID: <span className="font-mono">{cloneTarget ? vmidOf(cloneTarget) : "—"}</span> on node{" "}
              <span className="font-mono">{cloneTarget ? String(cloneTarget.node ?? "—") : "—"}</span>
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCloneTarget(null)
                setCloneName("")
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void onClone()} disabled={busy || !cloneName.trim()}>
              {busy ? "Cloning…" : "Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
