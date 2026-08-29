// NOC cluster console for a Proxmox provider: node/resource inventory, the
// cluster event log, running/archived tasks and QEMU CPU models — all
// NOC-readable GETs; every mutation here is platform-admin only.
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCwIcon } from "lucide-react"
import { fmtDateTime } from "../../lib-utils"
import {
  AdminOnlyHint,
  HealthBadge,
  type PveClusterPayload,
  type PveCpuModel,
  type PveLogEntry,
  type PveNode,
  type PveResource,
  type PveTask,
  ProviderSurfaceNote,
} from "./pve"
import { fmtFraction, fmtUptime, useNocProvider, useTyped } from "./pve-utils"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

export default function NocProviderClusterPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const base = `/admin/providers/${providerId}`

  const [resourceType, setResourceType] = useState("all")
  const [logMax, setLogMax] = useState(100)
  const [arch, setArch] = useState("x86_64")

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Cluster" />
      <PageHeader
        title="Cluster"
        description="Live PVE cluster inventory and activity. All writes on these surfaces are platform-admin only."
        actions={<AdminOnlyHint />}
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="log">Cluster log</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="cpu">CPU models</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8">
          <NodesSection base={base} providerId={providerId} />
          <ResourcesSection base={base} typeFilter={resourceType} onTypeChange={setResourceType} />
        </TabsContent>

        <TabsContent value="log" className="space-y-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm text-muted-foreground">Entries</span>
            <Select
              value={String(logMax)}
              onValueChange={(value) => setLogMax(Number(value))}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[50, 100, 200, 500].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    last {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <LogTable base={base} max={logMax} />
        </TabsContent>

        <TabsContent value="tasks">
          <TasksTable base={base} />
        </TabsContent>

        <TabsContent value="cpu" className="space-y-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm text-muted-foreground">Architecture</span>
            <Select value={arch} onValueChange={setArch}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="x86_64">x86_64</SelectItem>
                <SelectItem value="aarch64">aarch64</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CpuModelsTable base={base} arch={arch} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NodesSection({ base, providerId }: { base: string; providerId: string }) {
  const cluster = useTyped<PveClusterPayload>(`${base}/cluster`)

  if (cluster.error) return <ErrorBanner error={cluster.error} />

  const nodes = cluster.data?.nodes ?? []
  return (
    <section className="space-y-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Nodes</h2>
        <Button variant="outline" size="sm" onClick={cluster.reload} disabled={cluster.loading}>
          <RefreshCwIcon /> Refresh
        </Button>
      </div>
      <SimpleDataTable<PveNode>
        columns={[
          {
            key: "node",
            header: "Node",
            render: (row) => {
              const name = row.node ?? row.name ?? "—"
              return row.node ? (
                <Link
                  to={`/noc/providers/${providerId}/nodes/${encodeURIComponent(row.node)}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {name}
                </Link>
              ) : (
                name
              )
            },
          },
          { key: "id", header: "ID", render: (row) => row.id ?? `node/${row.name ?? "?"}` },
          { key: "status", header: "Health", render: (row) => <HealthBadge status={row.status || (row.online ? "online" : "unknown")} /> },
          { key: "ip", header: "IP", render: (row) => row.ip ?? "—" },
          {
            key: "cpu",
            header: "CPU",
            render: (row) =>
              row.maxcpu ? `${((row.cpu ?? 0) * 100).toFixed(0)}% of ${row.maxcpu}` : "—",
          },
          {
            key: "mem",
            header: "Memory",
            render: (row) =>
              row.maxmem
                ? `${fmtFraction((row.mem ?? 0) / row.maxmem)} of ${(row.maxmem / 1024 ** 3).toFixed(1)} GiB`
                : "—",
          },
          {
            key: "disk",
            header: "Root fs",
            render: (row) =>
              row.maxdisk
                ? `${fmtFraction((row.disk ?? 0) / row.maxdisk)} used`
                : "—",
          },
          { key: "uptime", header: "Uptime", render: (row) => fmtUptime(row.uptime) },
        ]}
        rows={nodes}
        loading={cluster.loading}
        skeletonRows={3}
        emptyMessage="No nodes reported by the cluster."
        getRowKey={(row) => row.node ?? row.name ?? String(row.nodeid ?? Math.random())}
      />
    </section>
  )
}

const RESOURCE_TYPES = ["all", "node", "qemu", "lxc", "storage", "sdn", "pool"] as const

function ResourcesSection({
  base,
  typeFilter,
  onTypeChange,
}: {
  base: string
  typeFilter: string
  onTypeChange: (value: string) => void
}) {
  const cluster = useTyped<PveClusterPayload>(`${base}/cluster`)
  const resources = (cluster.data?.resources ?? []).filter(
    (row) => typeFilter === "all" || row.type === typeFilter,
  )

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Guest &amp; resource inventory</h2>
        <Select value={typeFilter} onValueChange={onTypeChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {RESOURCE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type === "all" ? "All types" : type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {cluster.error ? (
        <ErrorBanner error={cluster.error} />
      ) : (
        <SimpleDataTable<PveResource>
          columns={[
            { key: "name", header: "Name", render: (row) => row.name ?? "—" },
            { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
            { key: "node", header: "Node", render: (row) => row.node ?? "—" },
            { key: "status", header: "Status", render: (row) => <HealthBadge status={row.status} /> },
            { key: "vmid", header: "VMID", render: (row) => row.vmid ?? "—" },
            {
              key: "cpu",
              header: "CPU",
              render: (row) => (row.maxcpu ? `${(((row.cpu ?? 0) / row.maxcpu) * 100).toFixed(0)}%` : "—"),
            },
            {
              key: "mem",
              header: "Memory",
              render: (row) =>
                row.maxmem ? `${fmtFraction((row.mem ?? 0) / row.maxmem)} of ${(row.maxmem / 1024 ** 3).toFixed(1)} GiB` : "—",
            },
            {
              key: "disk",
              header: "Disk",
              render: (row) =>
                row.maxdisk ? `${fmtFraction((row.disk ?? 0) / row.maxdisk)} of ${(row.maxdisk / 1024 ** 3).toFixed(0)} GiB` : "—",
            },
            { key: "uptime", header: "Uptime", render: (row) => fmtUptime(row.uptime) },
            { key: "pool", header: "Pool", render: (row) => row.pool ?? "—" },
          ]}
          rows={resources}
          loading={cluster.loading}
          skeletonRows={6}
          emptyMessage="No resources match this type filter."
          getRowKey={(row) => row.id ?? `${row.type}-${row.vmid ?? Math.random()}`}
        />
      )}
    </section>
  )
}

function LogTable({ base, max }: { base: string; max: number }) {
  const log = useTyped<PveLogEntry[]>(`${base}/cluster/log`, { query: { max } })

  if (log.error) return <ErrorBanner error={log.error} />
  return (
    <SimpleDataTable<PveLogEntry>
      columns={[
        { key: "time", header: "Time", render: (row) => fmtDateTime(row.time ? new Date(row.time * 1000).toISOString() : null), className: "whitespace-nowrap" },
        { key: "node", header: "Node", render: (row) => row.node ?? "—" },
        { key: "tag", header: "Tag", render: (row) => row.tag ?? "—" },
        { key: "user", header: "User", render: (row) => row.user ?? "—" },
        { key: "pri", header: "Pri", render: (row) => row.pri ?? "—" },
        { key: "msg", header: "Message", render: (row) => <span className="break-all">{row.msg ?? row.upid ?? "—"}</span> },
      ]}
      rows={log.data ?? []}
      loading={log.loading}
      skeletonRows={8}
      emptyMessage="The cluster log is empty."
      getRowKey={(row, index) => `${row.uid ?? index}-${row.time ?? ""}`}
    />
  )
}

function TasksTable({ base }: { base: string }) {
  const tasks = useTyped<PveTask[]>(`${base}/cluster/tasks`)

  if (tasks.error) return <ErrorBanner error={tasks.error} />
  return (
    <SimpleDataTable<PveTask>
      columns={[
        { key: "Type", header: "Type", render: (row) => row.Type ?? "—" },
        { key: "ID", header: "Target", render: (row) => row.ID ?? "—" },
        { key: "Node", header: "Node", render: (row) => row.Node ?? "—" },
        { key: "User", header: "User", render: (row) => row.User ?? "—" },
        {
          key: "state",
          header: "State",
          render: (row) =>
            row.IsRunning ? (
              <Badge variant="secondary">running</Badge>
            ) : row.IsFailed ? (
              <Badge variant="destructive">{row.ExitStatus || "failed"}</Badge>
            ) : row.IsSuccessful ? (
              <Badge variant="default">OK</Badge>
            ) : (
              <HealthBadge status={row.Status} />
            ),
        },
        { key: "upid", header: "UPID", render: (row) => <span className="font-mono text-xs break-all">{row.UPID ?? "—"}</span> },
      ]}
      rows={tasks.data ?? []}
      loading={tasks.loading}
      skeletonRows={8}
      emptyMessage="No cluster tasks recorded."
      getRowKey={(row) => row.UPID ?? Math.random().toString()}
    />
  )
}

function CpuModelsTable({ base, arch }: { base: string; arch: string }) {
  const models = useTyped<PveCpuModel[]>(`${base}/cpu-models`, { query: { arch } })

  if (models.error) return <ErrorBanner error={models.error} />
  return (
    <SimpleDataTable<PveCpuModel>
      columns={[
        { key: "name", header: "Model", render: (row) => row.name ?? "—" },
        { key: "vendor", header: "Vendor", render: (row) => row.vendor || "—" },
        { key: "custom", header: "Custom", render: (row) => (row.custom ? "yes" : "no") },
        { key: "abstract", header: "Abstract", render: (row) => (row.abstract ? "yes" : "no") },
      ]}
      rows={models.data ?? []}
      loading={models.loading}
      skeletonRows={5}
      emptyMessage={`No QEMU CPU models reported for ${arch}.`}
      getRowKey={(row) => row.name ?? Math.random().toString()}
    />
  )
}
