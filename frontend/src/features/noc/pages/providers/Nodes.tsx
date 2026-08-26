// NOC node list for one provider: cluster-reported node health with links
// into the per-node read-only inspector.
import { Link, useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react"
import {
  type PveClusterPayload,
  type PveNode,
  ProviderSurfaceNote,
} from "./pve"
import { fmtFraction, fmtUptime, useNocProvider, useTyped } from "./pve-utils"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

function UsageCell({ label, fraction }: { label: string; fraction: number | null }) {
  if (fraction === null) return <span>—</span>
  const pct = Math.min(100, Math.round(fraction * 100))
  return (
    <div className="min-w-32 space-y-1">
      <p className="text-xs text-muted-foreground">
        {label} · {pct}%
      </p>
      <Progress value={pct} className="h-1.5" />
    </div>
  )
}

export default function NocProviderNodesPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const cluster = useTyped<PveClusterPayload>(`/admin/providers/${providerId}/cluster`)

  const nodes = cluster.data?.nodes ?? []

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Nodes" />
      <PageHeader
        title="Nodes"
        description="Cluster members as reported by GET /cluster. Select a node for disks, certificates, DNS, time, storages and tasks."
        actions={
          <Button variant="outline" size="sm" onClick={cluster.reload} disabled={cluster.loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      {cluster.error ? (
        <ErrorBanner error={cluster.error} />
      ) : (
        <SimpleDataTable<PveNode>
          columns={[
            {
              key: "node",
              header: "Node",
              render: (row) => (
                <Link
                  to={`/noc/providers/${providerId}/nodes/${encodeURIComponent(row.node ?? row.name ?? "")}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.node ?? row.name ?? "—"}
                </Link>
              ),
            },
            {
              key: "status",
              header: "Health",
              render: (row) => (
                <span
                  className={
                    row.status === "online" || row.online === 1
                      ? "font-medium text-green-600 dark:text-green-400"
                      : "text-destructive"
                  }
                >
                  {row.status || (row.online === 1 ? "online" : "unknown")}
                </span>
              ),
            },
            { key: "ip", header: "IP", render: (row) => row.ip ?? "—" },
            {
              key: "cpu",
              header: "CPU",
              render: (row) =>
                row.maxcpu ? `${((row.cpu ?? 0) * 100).toFixed(0)}% of ${row.maxcpu} thread(s)` : "—",
            },
            {
              key: "mem",
              header: "Memory",
              render: (row) =>
                row.maxmem ? (
                  <UsageCell
                    label={`${((row.mem ?? 0) / 1024 ** 3).toFixed(1)} / ${(row.maxmem / 1024 ** 3).toFixed(1)} GiB`}
                    fraction={(row.mem ?? 0) / row.maxmem}
                  />
                ) : (
                  "—"
                ),
            },
            {
              key: "disk",
              header: "Root fs",
              render: (row) =>
                row.maxdisk ? (
                  <UsageCell
                    label={`${((row.disk ?? 0) / 1024 ** 3).toFixed(0)} / ${(row.maxdisk / 1024 ** 3).toFixed(0)} GiB`}
                    fraction={(row.disk ?? 0) / row.maxdisk}
                  />
                ) : (
                  "—"
                ),
            },
            {
              key: "used",
              header: "Load",
              render: (row) => `CPU ${fmtFraction(row.cpu)} · uptime ${fmtUptime(row.uptime)}`,
            },
            {
              key: "open",
              header: "",
              className: "w-10 text-right",
              render: () => <ArrowRightIcon className="ml-auto size-4 text-muted-foreground" />,
            },
          ]}
          rows={nodes}
          loading={cluster.loading}
          skeletonRows={4}
          emptyMessage="The cluster reported no nodes."
          getRowKey={(row) => row.node ?? row.name ?? String(row.nodeid ?? Math.random())}
        />
      )}
    </div>
  )
}
