import { useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type CloudInitPending = {
  key?: string
  value?: string
  pending?: string
  delete?: number | boolean
  [k: string]: unknown
}

export default function ProxmoxCloudInitPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const path =
    providerId && node && vmid ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/cloud-init` : null
  const state = useInfraGet<CloudInitPending[]>(path, undefined, { intervalMs: 5000 })
  const rows = Array.isArray(state.data) ? (state.data as CloudInitPending[]) : []

  if (!providerId || !node || !vmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="Cloud-init"
        description="Per-VM cloud-init pending diff — live from PVE /nodes/{node}/qemu/{vmid}/cloudinit (polled every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/cloud-init.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`Cloud-init — ${node}/${vmid}`}
      description={`Pending cloud-init diff for QEMU ${vmid} on node ${node}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/cloud-init (polled every 5s). Value = applied, Pending = staged for next regenerate, Delete = pending removal.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
          Refresh
        </Button>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}
      <SimpleDataTable<CloudInitPending>
        columns={[
          { key: "key", header: "Key", render: (row) => <span className="font-mono text-sm">{(row.key as string) || "—"}</span> },
          { key: "value", header: "Value", render: (row) => <span className="max-w-64 truncate font-mono text-xs">{row.value != null && String(row.value) !== "" ? String(row.value) : "—"}</span> },
          { key: "pending", header: "Pending", render: (row) => {
              const p = row.pending != null ? String(row.pending) : ""
              return p ? <Badge variant="outline" className="max-w-64 truncate font-mono text-xs">{p}</Badge> : <span className="text-muted-foreground">—</span>
            } },
          { key: "delete", header: "Delete", className: "w-24", render: (row) => {
              const del = row.delete
              const on = del === 1 || del === true || String(del) === "1"
              return on ? <Badge variant="destructive" className="text-xs">pending delete</Badge> : <span className="text-muted-foreground">—</span>
            } },
        ]}
        rows={rows}
        loading={state.loading}
        error={null}
        getRowKey={(row, i) => String((row.key as string) ?? i)}
        emptyMessage={state.loading ? "Loading cloud-init diff…" : "No pending cloud-init changes — image is in sync with config."}
        skeletonRows={6}
      />
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/cloud-init</span> · requireStaff infra (NOC + platform_admin) · proxmox murni (proxmoxAdapterFor) · 5s poll
      </p>
    </ProviderShell>
  )
}
