// LXC inventory across the whole cluster with an optional node filter. Rows
// come from the adapter's VMState struct, so fields keep their Go names.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "../shared"
import { ProviderShell } from "./shared"
import { formatBytes, useInfraGet } from "./infra"
import type { ClusterPayload, ContainerRow } from "./types"

export default function ProviderContainersPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = `/admin/providers/${providerId}`

  const cluster = useInfraGet<ClusterPayload>(providerId ? `${base}/cluster` : null)
  const nodes = (cluster.data?.nodes ?? [])
    .map((node) => node.node ?? node.name ?? "")
    .filter(Boolean)

  const [nodeFilter, setNodeFilter] = useState("all")
  const effectiveNode = nodeFilter === "all" ? null : nodeFilter
  const containers = useInfraGet<ContainerRow[]>(
    providerId ? `${base}/containers` : null,
    { node: effectiveNode },
  )

  return (
    <ProviderShell
      providerId={providerId}
      title="Containers (LXC)"
      description="Every container registered on the provider's cluster."
      actions={
        <Select value={nodeFilter} onValueChange={setNodeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Node filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All nodes</SelectItem>
            {nodes.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        rows={containers.data ?? []}
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
