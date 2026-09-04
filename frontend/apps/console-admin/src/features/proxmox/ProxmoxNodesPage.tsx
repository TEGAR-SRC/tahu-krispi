import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusBadge } from "@/features/admin/pages/shared"
import { formatBytes, formatPercent, formatUptime, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ClusterPayload, PveNodeStatus } from "@/features/admin/pages/providers/types"

const nodeName = (node: PveNodeStatus) => String(node.node ?? node.name ?? "—")

export default function ProxmoxNodesPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const infra = useInfraGet<ClusterPayload>(providerId ? `/admin/proxmox/${providerId}/cluster` : null, undefined, { intervalMs: 5000 })
  const data = infra.data
  const loading = infra.loading
  const error = infra.error
  const load = infra.reload

  const nodes = Array.isArray(data?.nodes) ? data.nodes : []
  const isNotFoundAfterFallback =
    error instanceof ApiError && error.status === 404

  if (!providerId) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6 p-6">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </div>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Nodes"
      description="Cluster members as reported by the provider's /cluster/resources endpoint. Tries /admin/proxmox/:id/cluster with 404 fallback to /admin/providers/:id/cluster."
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      }
    >
      {error && !isNotFoundAfterFallback ? <ErrorBanner error={error} /> : null}

      <SimpleDataTable<PveNodeStatus>
        columns={[
          {
            key: "node",
            header: "Node",
            render: (node) => (
              <Button asChild variant="link" size="sm" className="h-auto p-0 font-medium">
                <Link to={`/admin/proxmox/${providerId}/nodes/${encodeURIComponent(nodeName(node))}`}>
                  {nodeName(node)}
                </Link>
              </Button>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (node) => (
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge status={node.status ?? null} />
                {node.level ? <span className="text-xs text-muted-foreground">{node.level}</span> : null}
              </div>
            ),
          },
          {
            key: "cpu",
            header: "CPU",
            render: (node) => (
              <div className="w-28 space-y-1">
                <span className="text-xs tabular-nums">{formatPercent(typeof node.cpu === "number" ? node.cpu : null)}</span>
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
                    typeof node.mem === "number" && typeof node.maxmem === "number" && node.maxmem > 0
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
        loading={loading}
        error={isNotFoundAfterFallback ? undefined : undefined}
        getRowKey={nodeName}
        emptyMessage="The cluster reports no nodes."
        skeletonRows={4}
      />

      {!loading && !error && nodes.length === 0 ? (
        <EmptyState
          message="No nodes found"
          description="The cluster payload contained no node entries — verify the provider credentials, kind is proxmox, and the PVE endpoint is reachable. Both /admin/proxmox/:id/cluster and fallback /admin/providers/:id/cluster returned no nodes."
        />
      ) : null}

      {isNotFoundAfterFallback ? (
        <EmptyState
          message="No nodes found"
          description="Provider returned 404 for both proxmox and legacy cluster endpoints — treat as empty cluster. Verify the provider id and kind."
        />
      ) : null}
    </ProviderShell>
  )
}
