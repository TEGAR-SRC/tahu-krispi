import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ClusterPayload, ContainerRow } from "@/features/admin/pages/providers/types"

export default function ProxmoxContainersPage() {
  const params = useParams()
  const providerId = (params as Record<string, string>).providerId ?? (params as Record<string, string>).id ?? ""

  const cluster = useInfraGet<ClusterPayload>(
    providerId ? `/admin/proxmox/${providerId}/cluster` : null,
    undefined,
    { intervalMs: 5000 },
  )
  const nodes = Array.isArray(cluster.data?.nodes) ? cluster.data!.nodes! : []
  const nodeNames = nodes
    .map((n) => n.node ?? n.name ?? "")
    .filter((v): v is string => Boolean(v))

  const [nodeFilter, setNodeFilter] = useState("all")
  const effectiveNode = nodeFilter === "all" ? null : nodeFilter

  const containers = useInfraGet<ContainerRow[]>(
    providerId ? `/admin/proxmox/${providerId}/containers` : null,
    { node: effectiveNode },
    { intervalMs: 5000 },
  )

  const safeRows: ContainerRow[] = Array.isArray(containers.data) ? containers.data : []

  return (
    <ProviderShell
      providerId={providerId}
      title="Containers (LXC)"
      description="Every LXC container registered on this Proxmox cluster."
      actions={
        <div className="flex items-center gap-2">
          <Select value={nodeFilter} onValueChange={setNodeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Node filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nodes</SelectItem>
              {nodeNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild size="sm">
            <Link to={`/admin/proxmox/${providerId}/lxc/new`}>Create LXC</Link>
          </Button>
        </div>
      }
    >
      <SimpleDataTable<ContainerRow>
        columns={[
          {
            key: "ExternalID",
            header: "VMID / external id",
            render: (row) => (
              <span className="font-mono text-xs">
                {(row.ExternalID ?? "").split("/").pop() || row.ExternalID || "—"}
              </span>
            ),
          },
          { key: "Name", header: "Name", render: (row) => row.Name || "—" },
          {
            key: "Status",
            header: "Status",
            render: (row) => (
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge status={row.Status ?? null} />
                {row.PowerStatus ? (
                  <span className="text-xs text-muted-foreground">{row.PowerStatus}</span>
                ) : null}
              </div>
            ),
          },
          {
            key: "Specs",
            header: "Specs",
            render: (row) =>
              `${row.VCPU ?? "—"} vCPU · ${formatBytes((row.RAM ?? 0) * 1024 * 1024)} · ${row.Disk ?? "—"} GB`,
          },
          {
            key: "MainIPv4",
            header: "IPv4",
            className: "hidden md:table-cell font-mono text-xs",
            render: (row) => row.MainIPv4 || "—",
          },
          {
            key: "Template",
            header: "Template",
            className: "hidden lg:table-cell",
            render: (row) => row.Template || "—",
          },
        ]}
        rows={safeRows}
        loading={containers.loading}
        error={containers.error}
        getRowKey={(row) => String(row.ExternalID ?? "?")}
        emptyMessage={
          effectiveNode
            ? `No containers found on node ${effectiveNode}.`
            : "No containers registered on this cluster."
        }
        skeletonRows={5}
      />
    </ProviderShell>
  )
}
