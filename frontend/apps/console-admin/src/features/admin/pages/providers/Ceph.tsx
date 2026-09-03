// Ceph health board: overall status, health checks, OSD/PG summaries and
// throughput numbers derived from GET …/ceph-status (raw ClusterCephStatus).
import { useParams } from "react-router-dom"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { StatusBadge } from "../shared"
import { ProviderShell } from "./shared"
import { formatBytes, useInfraGet } from "./infra"
import type { CephStatusPayload } from "./types"

interface PgStateRow {
  state_name?: string
  count?: number
}

export default function ProviderCephPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const status = useInfraGet<CephStatusPayload>(
    providerId ? `/admin/proxmox/${providerId}/ceph-status` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (status.loading) {
    return (
      <ProviderShell providerId={providerId} title="Ceph" description="Cluster health and placement group summary.">
        <Skeleton className="h-64 w-full" />
      </ProviderShell>
    )
  }
  if (status.error) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Ceph"
        description="Cluster health and placement group summary."
      >
        <ErrorBanner error={status.error} />
      </ProviderShell>
    )
  }
  const data = status.data
  if (!data) return null

  const health = data.health
  const checks = Object.entries(health?.checks ?? {})
  const pgmap = data.pgmap
  const osdmap = data.osdmap
  const mons = data.monmap?.mons ?? []

  return (
    <ProviderShell
      providerId={providerId}
      title="Ceph"
      description={`fsid ${data.fsid ?? "—"} · quorum: ${(data.quorum_names ?? []).join(", ") || "—"}`}
    >
      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Health" value={<StatusBadge status={(health?.status ?? "").toLowerCase()} />} hint={`${checks.length} active check(s)`} />
        <StatCard label="OSDs" value={`${osdmap?.num_osds ?? 0}`} hint={`${osdmap?.num_up_osds ?? 0} up · ${osdmap?.num_in_osds ?? 0} in`} />
        <StatCard label="Placement groups" value={`${pgmap?.num_pgs ?? data.pgmap?.num_pgs ?? 0}`} hint={`${pgmap?.num_pools ?? ""} pools`} />
        <StatCard label="Objects" value={pgmap ? (pgmap.num_objects ?? 0).toLocaleString() : "—"} hint={`data ${formatBytes(pgmap?.data_bytes)}`} />
      </div>

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Used" value={formatBytes(pgmap?.bytes_used)} />
        <StatCard label="Total capacity" value={formatBytes(pgmap?.bytes_total)} />
        <StatCard label="Available" value={formatBytes(pgmap?.bytes_avail)} />
        <StatCard
          label="Throughput"
          value={
            <>
              ↑{formatBytes(pgmap?.write_bytes_sec)}/s{" "}
              ↓{formatBytes(pgmap?.read_bytes_sec)}/s
            </>
          }
          hint={`${pgmap?.read_op_per_sec ?? 0} rd / ${pgmap?.write_op_per_sec ?? 0} wr ops/s`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Health checks</CardTitle>
          <CardDescription>Active warnings reported by the Ceph monitor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.length === 0 ? (
            <EmptyState message="No health checks firing." description="The cluster reports no active warnings." />
          ) : (
            checks.map(([name, check]) => (
              <div key={name} className="rounded-md border p-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusBadge status={check.severity === "HEALTH_WARN" ? "pending" : "failed"} />
                  <span className="font-mono text-xs">{name}</span>
                  {check.summary?.count ? (
                    <span className="text-xs text-muted-foreground">×{check.summary.count}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm">{check.summary?.message}</p>
                {(check.detail ?? []).map((detail, index) => (
                  <p key={index} className="mt-0.5 text-xs text-muted-foreground">
                    {detail.message}
                  </p>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">PG states</CardTitle>
          <CardDescription>Distribution of placement groups across states.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<PgStateRow>
            columns={[
              { key: "state_name", header: "State", render: (row) => row.state_name || "—" },
              { key: "count", header: "PGs", render: (row) => (row.count ?? 0).toLocaleString() },
              {
                key: "share",
                header: "Share",
                render: (row) => {
                  const total = pgmap?.num_pgs ?? 0
                  return total > 0 && row.count ? `${((row.count / total) * 100).toFixed(1)}%` : "—"
                },
              },
            ]}
            rows={pgmap?.pgs_by_state ?? []}
            getRowKey={(row, index) => String(row.state_name ?? index)}
            emptyMessage="No PG map returned."
            skeletonRows={3}
          />
        </CardContent>
      </Card>

      {mons.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monitors</CardTitle>
            <CardDescription>Monitor quorum members.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<(typeof mons)[number]>
              columns={[
                { key: "name", header: "Name", render: (mon) => mon.name || "—" },
                { key: "rank", header: "Rank", render: (mon) => mon.rank ?? "—" },
                { key: "addr", header: "Address", render: (mon) => mon.addr || mon.public_addr || "—" },
              ]}
              rows={mons}
              getRowKey={(mon, index) => String(mon.name ?? index)}
              skeletonRows={2}
            />
          </CardContent>
        </Card>
      ) : null}
    </ProviderShell>
  )
}
