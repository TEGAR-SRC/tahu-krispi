// GET /admin/proxmox/:id/replication — proxmox murni (proxmoxAdapterFor guard kind==proxmox, 501 expect proxmox otherwise).
// RBAC GET infra (NOC + platform_admin readable, finance 403). Polling every 5s via useInfraGet intervalMs 5000.
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type ReplicationJob = {
  id?: string
  target?: string
  source?: string
  type?: string
  schedule?: string
  comment?: string
  disable?: number | boolean
  rate?: string | number | null
  remove_job?: string
  guest?: number
  jobnum?: number
  [k: string]: unknown
}

export default function ProxmoxReplicationPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`
  const path = providerId ? `${base}/replication` : null
  const state = useInfraGet<ReplicationJob[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as ReplicationJob[]

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Replication" description="Storage replication jobs for this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Replication"
      description="Storage replication jobs (GET /admin/proxmox/:id/replication) — one job per replicated guest disk. Polled every 5s via useInfraGet intervalMs 5000. Proxmox-only via proxmoxAdapterFor (non-proxmox → 501 expect proxmox), GET is infra-readable (NOC + platform_admin)."
      actions={<Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>}
    >
      <SimpleDataTable<ReplicationJob>
        columns={[
          { key: "id", header: "Job ID", render: (r) => <span className="font-mono text-xs">{r.id || "—"}</span> },
          { key: "guest", header: "Guest", render: (r) => (r.guest != null ? String(r.guest) : "—") },
          { key: "target", header: "Target node", render: (r) => r.target || "—" },
          { key: "source", header: "Source", render: (r) => (r.source as string) || "—" },
          { key: "type", header: "Type", render: (r) => (r.type ? <Badge variant="outline">{r.type as string}</Badge> : "—") },
          { key: "schedule", header: "Schedule", className: "hidden md:table-cell font-mono text-xs", render: (r) => r.schedule || "—" },
          { key: "rate", header: "Rate", className: "hidden lg:table-cell", render: (r) => (r.rate != null && String(r.rate) !== "" ? String(r.rate) : "—") },
          { key: "disable", header: "Disabled", render: (r) => (r.disable ? <Badge variant="destructive">disabled</Badge> : <Badge variant="outline">enabled</Badge>) },
          { key: "comment", header: "Comment", className: "hidden xl:table-cell max-w-40 truncate", render: (r) => (r.comment as string) || "—" },
        ]}
        rows={rows}
        loading={state.loading}
        error={state.error}
        getRowKey={(r, idx) => String(r.id ?? `${r.guest}-${r.jobnum}-${idx}`)}
        emptyMessage="No replication jobs — configure storage replication (pvesr) on the PVE cluster, then this table populates via GET /cluster/replication through go-proxmox."
        skeletonRows={4}
      />
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/replication</span> · infra-readable, 5s poll via{" "}
        <span className="font-mono">useInfraGet(..., {`{intervalMs: 5000}`})</span> · proxmox-only guard{" "}
        <span className="font-mono">proxmoxAdapterFor</span> (non-proxmox → <span className="font-mono">501 expect proxmox</span>)
      </p>
    </ProviderShell>
  )
}
