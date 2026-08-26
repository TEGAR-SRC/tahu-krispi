// Cluster node inventory for one provider: GET …/cluster returns the raw PVE
// nodes plus every cluster resource; this page lists the nodes and links into
// the per-node console.
import { Link, useParams } from "react-router-dom"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusBadge } from "../shared"
import { ProviderShell } from "./shared"
import { formatBytes, formatPercent, formatUptime, useInfraGet } from "./infra"
import type { ClusterPayload, PveNodeStatus } from "./types"

const nodeName = (node: PveNodeStatus) => String(node.node ?? node.name ?? "—")

export default function ProviderNodesPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const cluster = useInfraGet<ClusterPayload>(
    providerId ? `/admin/providers/${providerId}/cluster` : null,
  )
  const nodes = cluster.data?.nodes ?? []

  return (
    <ProviderShell
      providerId={providerId}
      title="Nodes"
      description="Cluster members as reported by the provider's /cluster/resources endpoint."
    >
      <SimpleDataTable<PveNodeStatus>
        columns={[
          {
            key: "node",
            header: "Node",
            render: (node) => (
              <Button
                asChild
                variant="link"
                size="sm"
                className="h-auto p-0 font-medium"
              >
                <Link to={`/admin/providers/${providerId}/nodes/${encodeURIComponent(nodeName(node))}`}>
                  {nodeName(node)}
                </Link>
              </Button>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (node) => (
              <div className="flex items-center gap-2">
                <StatusBadge status={node.status ?? null} />
                {node.level ? (
                  <span className="text-xs text-muted-foreground">{node.level}</span>
                ) : null}
              </div>
            ),
          },
          {
            key: "cpu",
            header: "CPU",
            render: (node) => (
              <div className="w-28 space-y-1">
                <span className="text-xs tabular-nums">
                  {formatPercent(typeof node.cpu === "number" ? node.cpu : null)}
                </span>
                <Progress value={(typeof node.cpu === "number" ? node.cpu : 0) * 100} className="h-1.5" />
              </div>
            ),
          },
          {
            key: "mem",
            header: "Memory",
            render: (node) => (
              <div className="w-36 space-y-1">
                <span className="text-xs tabular-nums">
                  {formatBytes(node.mem)} / {formatBytes(node.maxmem)}
                </span>
                <Progress
                  value={
                    typeof node.mem === "number" &&
                    typeof node.maxmem === "number" &&
                    node.maxmem > 0
                      ? (node.mem / node.maxmem) * 100
                      : 0
                  }
                  className="h-1.5"
                />
              </div>
            ),
          },
          {
            key: "disk",
            header: "Root fs",
            className: "hidden md:table-cell",
            render: (node) => (
              <span className="whitespace-nowrap text-xs tabular-nums">
                {formatBytes(node.disk)} / {formatBytes(node.maxdisk)}
              </span>
            ),
          },
          {
            key: "uptime",
            header: "Uptime",
            className: "hidden lg:table-cell",
            render: (node) => formatUptime(node.uptime),
          },
        ]}
        rows={nodes}
        loading={cluster.loading}
        error={cluster.error}
        getRowKey={nodeName}
        emptyMessage="The cluster reports no nodes."
        skeletonRows={4}
      />
      {!cluster.loading && !cluster.error && nodes.length === 0 ? (
        <EmptyState
          message="No guest resources reported."
          description="The cluster payload contained no node entries — verify the provider credentials and kind."
        />
      ) : null}
    </ProviderShell>
  )
}
