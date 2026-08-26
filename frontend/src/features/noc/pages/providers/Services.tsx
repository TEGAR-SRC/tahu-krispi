// NOC cluster services console: LXC container inventory, SDN zones/vnets,
// Ceph health and resource pools. Every mutation on these surfaces is
// platform-admin only; NOC reads them via the shared infra area.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { HeartPulseIcon } from "lucide-react"
import { formatBytes } from "../../lib"
import {
  AdminOnlyHint,
  fmtFraction,
  HealthBadge,
  type PveClusterPayload,
  type PveContainer,
  type PvePool,
  type PveVnet,
  type PveZone,
  ProviderSurfaceNote,
  useNocProvider,
  useTyped,
} from "./pve"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

/** Ceph status arrives as a deep go-proxmox struct; surface the key fields. */
interface CephStatusPayload {
  health?: {
    status?: string
    checks?: Record<
      string,
      { severity?: string; summary?: { message?: string }; detail?: Array<{ message?: string }> }
    >
  }
  fsid?: string
  election_epoch?: number
  monmap?: { num_mons?: number; epoch?: number }
  mgrmap?: { active_name?: string; num_standby?: number }
  osdmap?: { osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number } }
  pgmap?: {
    pg_num?: number
    data_bytes?: number
    bytes_used?: number
    bytes_total?: number
    num_pgs?: number
  }
}

export default function NocProviderServicesPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const base = `/admin/providers/${providerId}`

  const cluster = useTyped<PveClusterPayload>(`${base}/cluster`)
  const nodes = (cluster.data?.nodes ?? [])
    .map((row) => row.node ?? row.name ?? "")
    .filter(Boolean)

  const [nodeFilter, setNodeFilter] = useState("all")

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Services" />
      <PageHeader
        title="Cluster services"
        description="LXC containers, software-defined networking, Ceph health and pools."
        actions={<AdminOnlyHint />}
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      <Tabs defaultValue="containers" className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="sdn">SDN</TabsTrigger>
          <TabsTrigger value="ceph">Ceph</TabsTrigger>
          <TabsTrigger value="pools">Pools</TabsTrigger>
        </TabsList>

        <TabsContent value="containers" className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Node</span>
            <Select value={nodeFilter} onValueChange={setNodeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All nodes" />
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
            <span className="text-xs text-muted-foreground">
              The backend maps container → node through cluster resources.
            </span>
          </div>
          <ContainersSection base={base} node={nodeFilter === "all" ? undefined : nodeFilter} />
        </TabsContent>

        <TabsContent value="sdn" className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Zones</h2>
            <ZonesTable base={base} />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">VNets</h2>
            <VNetsTable base={base} />
          </section>
        </TabsContent>

        <TabsContent value="ceph">
          <CephPanel base={base} />
        </TabsContent>

        <TabsContent value="pools">
          <PoolsTable base={base} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ContainersSection({
  base,
  node,
}: {
  base: string
  node: string | undefined
}) {
  const containers = useTyped<{ containers?: PveContainer[] }>(`${base}/containers`, {
    query: node ? { node } : {},
  })

  if (containers.error) return <ErrorBanner error={containers.error} />
  return (
    <SimpleDataTable<PveContainer>
      columns={[
        { key: "ExternalID", header: "ID", render: (row) => <span className="font-mono text-xs">{row.ExternalID ?? "—"}</span> },
        { key: "Name", header: "Name", render: (row) => row.Name ?? "—" },
        {
          key: "Status",
          header: "Status",
          render: (row) => (
            <div className="flex items-center gap-2">
              <HealthBadge status={row.Status} />
              {row.PowerStatus ? <Badge variant="outline">{row.PowerStatus}</Badge> : null}
            </div>
          ),
        },
        { key: "MainIPv4", header: "IPv4", render: (row) => row.MainIPv4 || "—" },
        { key: "VCPU", header: "vCPU", render: (row) => row.VCPU ?? "—" },
        { key: "RAM", header: "RAM", render: (row) => (row.RAM ? `${row.RAM} MB` : "—") },
        { key: "Disk", header: "Disk", render: (row) => (row.Disk ? `${row.Disk} GB` : "—") },
        { key: "Template", header: "Template", render: (row) => row.Template || "—" },
      ]}
      rows={containers.data?.containers ?? []}
      loading={containers.loading}
      skeletonRows={4}
      emptyMessage="No LXC containers reported by this cluster."
      getRowKey={(row) => row.ExternalID ?? Math.random().toString()}
    />
  )
}

function ZonesTable({ base }: { base: string }) {
  const zones = useTyped<PveZone[]>(`${base}/sdn/zones`)
  if (zones.error) return <ErrorBanner error={zones.error} />
  return (
    <SimpleDataTable<PveZone>
      columns={[
        { key: "zone", header: "Zone", render: (row) => row.zone ?? "—" },
        { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
        { key: "state", header: "State", render: (row) => <HealthBadge status={row.pending ? `pending (${row.state || "sync"})` : row.state} /> },
        { key: "ipam", header: "IPAM", render: (row) => row.ipam || "—" },
        { key: "mtu", header: "MTU", render: (row) => row.mtu ?? "—" },
        { key: "nodes", header: "Nodes", render: (row) => row.nodes || "all" },
        { key: "dnszone", header: "DNS zone", render: (row) => row.dnszone || "—" },
      ]}
      rows={zones.data ?? []}
      loading={zones.loading}
      skeletonRows={3}
      emptyMessage="No SDN zones configured."
      getRowKey={(row) => row.zone ?? Math.random().toString()}
    />
  )
}

function VNetsTable({ base }: { base: string }) {
  const vnets = useTyped<PveVnet[]>(`${base}/sdn/vnets`)
  if (vnets.error) return <ErrorBanner error={vnets.error} />
  return (
    <SimpleDataTable<PveVnet>
      columns={[
        { key: "vnet", header: "VNet", render: (row) => row.vnet ?? "—" },
        { key: "zone", header: "Zone", render: (row) => row.zone ?? "—" },
        { key: "alias", header: "Alias", render: (row) => row.alias || "—" },
        { key: "tag", header: "Tag", render: (row) => row.tag ?? "—" },
        { key: "vlanaware", header: "VLAN aware", render: (row) => (row.vlanaware === 1 ? "yes" : "no") },
      ]}
      rows={vnets.data ?? []}
      loading={vnets.loading}
      skeletonRows={3}
      emptyMessage="No SDN vnets configured."
      getRowKey={(row) => row.vnet ?? Math.random().toString()}
    />
  )
}

function CephPanel({ base }: { base: string }) {
  const ceph = useTyped<CephStatusPayload>(`${base}/ceph-status`)

  if (ceph.error) return <ErrorBanner error={ceph.error} />
  if (ceph.loading) return <EmptyState message="Loading Ceph status…" />

  const status = ceph.data
  if (!status) return <EmptyState message="This cluster reports no Ceph status." />

  const checks = Object.entries(status.health?.checks ?? {})
  const osd = status.osdmap?.osdmap

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Health" value={<HealthBadge status={status.health?.status} />} hint={`${checks.length} check(s) firing`} icon={<HeartPulseIcon />} />
        <StatCard label="OSDs" value={`${osd?.num_up_osds ?? "?"} up / ${osd?.num_osds ?? "?"}`} hint={`${osd?.num_in_osds ?? "?"} in`} />
        <StatCard label="Monitors" value={status.monmap?.num_mons ?? "—"} hint={`mgr active ${status.mgrmap?.active_name || "—"}`} />
        <StatCard
          label="Usage"
          value={
            status.pgmap?.bytes_total
              ? fmtFraction((status.pgmap.bytes_used ?? 0) / status.pgmap.bytes_total)
              : "—"
          }
          hint={`${status.pgmap?.num_pgs ?? "?"} PGs · ${formatBytes(status.pgmap?.data_bytes)} data`}
        />
      </div>

      {checks.length > 0 ? (
        <SimpleDataTable
          columns={[
            { key: "check", header: "Check", render: (row) => String(row.check) },
            {
              key: "severity",
              header: "Severity",
              render: (row) => (
                <Badge variant={String(row.severity).toLowerCase() === "health_warn" ? "secondary" : "destructive"}>
                  {String(row.severity)}
                </Badge>
              ),
            },
            { key: "summary", header: "Summary", render: (row) => <span className="break-all">{String(row.summary)}</span> },
          ]}
          rows={checks.map(([check, detail]) => ({
            check,
            severity: detail.severity ?? "unknown",
            summary: detail.summary?.message ?? "—",
          }))}
          emptyMessage="No health checks firing."
          getRowKey={(row) => row.check}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No health checks firing — cluster reports {status.health?.status || "unknown"}.</p>
      )}
    </div>
  )
}

function PoolsTable({ base }: { base: string }) {
  const pools = useTyped<PvePool[]>(`${base}/pools`)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (pools.error) return <ErrorBanner error={pools.error} />
  return (
    <div className="space-y-3">
      <SimpleDataTable<PvePool>
        columns={[
          { key: "poolid", header: "Pool", render: (row) => row.poolid ?? "—" },
          { key: "comment", header: "Comment", render: (row) => row.comment ?? "—" },
          {
            key: "members",
            header: "Members",
            render: (row) => (
              <button
                type="button"
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => setExpanded(expanded === row.poolid ? null : (row.poolid ?? null))}
              >
                {row.members?.length ?? 0} member(s){expanded === row.poolid ? " ▲" : " ▼"}
              </button>
            ),
          },
        ]}
        rows={pools.data ?? []}
        loading={pools.loading}
        skeletonRows={3}
        emptyMessage="No resource pools defined."
        getRowKey={(row) => row.poolid ?? Math.random().toString()}
      />

      {expanded && pools.data ? (
        (() => {
          const pool = pools.data.find((row) => row.poolid === expanded)
          if (!pool?.members?.length) {
            return <EmptyState message={`Pool ${expanded} has no members.`} />
          }
          return (
            <SimpleDataTable
              columns={[
                { key: "name", header: "Member", render: (row) => String(row.name ?? "—") },
                { key: "type", header: "Type", render: (row) => <Badge variant="outline">{String(row.type ?? "—")}</Badge> },
                { key: "node", header: "Node", render: (row) => String(row.node ?? "—") },
                { key: "status", header: "Status", render: (row) => <HealthBadge status={String(row.status ?? "")} /> },
                {
                  key: "usage",
                  header: "CPU/Mem/Disk",
                  render: (row) =>
                    typeof row.maxmem === "number" && row.maxmem > 0 && typeof row.mem === "number"
                      ? `${fmtFraction(row.mem / row.maxmem)} mem`
                      : "—",
                },
              ]}
              rows={pool.members as Array<Record<string, unknown>>}
              emptyMessage="No members."
              getRowKey={(row) => String(row.id ?? Math.random())}
            />
          )
        })()
      ) : null}
    </div>
  )
}
