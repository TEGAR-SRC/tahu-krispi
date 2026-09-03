import { useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import { StatusBadge } from "@/features/admin/pages/shared"
import type { PveClusterResource } from "@/features/admin/pages/providers/types"

export default function ProxmoxQemuPerNodePage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const path =
    providerId && node
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu`
      : null
  const qemu = useInfraGet<PveClusterResource[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(qemu.data) ? qemu.data : []) as PveClusterResource[]

  if (!providerId || !node) {
    return (
      <ProviderShell
        providerId={providerId}
        title="QEMU per node"
        description="QEMU guests on this node via ClusterResources type=vm filtered by node."
      >
        <p className="text-sm text-destructive">Missing providerId or node in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU on ${node}`}
      description={`QEMU guests on node ${node} via GET /admin/proxmox/:id/nodes/:node/qemu (ClusterResources type=vm per node, polled every 5s).`}
      actions={
        <Button variant="outline" size="sm" onClick={() => qemu.reload()} disabled={qemu.loading}>
          Refresh
        </Button>
      }
    >
      <SimpleDataTable<PveClusterResource>
        columns={[
          {
            key: "vmid",
            header: "VMID",
            render: (row) => <span className="font-mono text-sm">{row.vmid ?? "—"}</span>,
          },
          { key: "name", header: "Name", render: (row) => (row.name as string) || "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={(row.status as string) ?? null} />,
          },
          { key: "node", header: "Node", render: (row) => <Badge variant="outline">{(row.node as string) || node}</Badge> },
          {
            key: "cpu",
            header: "CPU",
            className: "hidden md:table-cell",
            render: (row) => `${row.cpu ?? 0} / ${row.maxcpu ?? "—"}`,
          },
          {
            key: "mem",
            header: "Memory",
            className: "hidden lg:table-cell",
            render: (row) => `${formatBytes(row.mem)} / ${formatBytes(row.maxmem)}`,
          },
          {
            key: "disk",
            header: "Disk",
            className: "hidden xl:table-cell",
            render: (row) => `${formatBytes(row.disk)} / ${formatBytes(row.maxdisk)}`,
          },
          { key: "uptime", header: "Uptime", className: "hidden xl:table-cell", render: (row) => (row.uptime ? `${row.uptime}s` : "—") },
        ]}
        rows={rows}
        loading={qemu.loading}
        error={qemu.error}
        getRowKey={(row) => String(row.vmid ?? row.id ?? Math.random())}
        emptyMessage={`No QEMU guests on node ${node}.`}
        skeletonRows={4}
      />
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu</span> · infra-readable, 5s poll
      </p>
    </ProviderShell>
  )
}
