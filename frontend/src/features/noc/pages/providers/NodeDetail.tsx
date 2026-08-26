// NOC per-node inspector: status detail, DNS, time, certificates, disks,
// storages and recent tasks — strictly read-only. Node power commands
// (reboot/shutdown/wakeonlan) are platform-admin only and intentionally
// absent from this console.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  AdminOnlyHint,
  type PveCert,
  type PveDisk,
  type PveNodeStorage,
  type PveTask,
  ProviderSurfaceNote,
} from "./pve"
import { fmtEpoch, fmtFraction, fmtUptime, useNocProvider, useTyped } from "./pve-utils"
import { formatBytes } from "../../lib-utils"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

/** Raw node payload from GET .../nodes/:node/detail (go-proxmox Node). */
interface NodeDetailPayload {
  Name?: string
  PVEVersion?: string
  Kversion?: string
  Uptime?: number
  CPU?: number
  Wait?: number
  Idle?: number
  LoadAvg?: string[]
  Ksm?: { Shared?: number }
  Memory?: { total?: number; used?: number; free?: number }
  Swap?: { total?: number; used?: number; free?: number }
  RootFS?: { total?: number; used?: number; free?: number; avail?: number }
  CPUInfo?: {
    Model?: string
    Cores?: number
    Sockets?: number
    CPUs?: number
    MHZ?: string | number
    Flags?: string
    HVM?: string
    user_hz?: number
  }
}

function UsageBar({ label, used, total }: { label: string; used?: number; total?: number }) {
  if (!total) return <p className="text-sm text-muted-foreground">{label}: no data</p>
  const fraction = (used ?? 0) / total
  const pct = Math.min(100, Math.round(fraction * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {formatBytes(used)} / {formatBytes(total)} · {fmtFraction(fraction)}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  )
}

function KeyValue({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function NocProviderNodeDetailPage() {
  const providerId = useParams().providerId ?? ""
  const node = useParams().node ?? ""
  const { provider } = useNocProvider(providerId)
  const base = `/admin/providers/${providerId}/nodes/${encodeURIComponent(node)}`

  const [tab, setTab] = useState("detail")
  const detail = useTyped<NodeDetailPayload>(`${base}/detail`, { enabled: tab === "detail" })
  const dns = useTyped<Record<string, unknown>>(`${base}/dns`, { enabled: tab === "dns" })
  const time = useTyped<Record<string, unknown>>(`${base}/time`, { enabled: tab === "time" })
  const certs = useTyped<PveCert[]>(`${base}/certs`, { enabled: tab === "certs" })
  const disks = useTyped<PveDisk[]>(`${base}/disks`, { enabled: tab === "disks" })
  const storages = useTyped<PveNodeStorage[]>(`${base}/storages`, { enabled: tab === "storages" })
  const tasks = useTyped<PveTask[]>(`${base}/tasks`, { enabled: tab === "tasks" })

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb
        providerId={providerId}
        providerName={provider?.name}
        page={`Node ${node}`}
      />
      <PageHeader
        title={node}
        description="Read-only node inspector. Power commands (reboot/shutdown/WOL) are platform-admin only and hidden here."
        actions={<AdminOnlyHint />}
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="detail">Detail</TabsTrigger>
          <TabsTrigger value="dns">DNS</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="certs">Certificates</TabsTrigger>
          <TabsTrigger value="disks">Disks</TabsTrigger>
          <TabsTrigger value="storages">Storages</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="detail" className="space-y-4">
          {detail.error ? (
            <ErrorBanner error={detail.error} />
          ) : detail.loading ? (
            <EmptyState message="Loading node detail…" />
          ) : !detail.data ? (
            <EmptyState message="No detail returned for this node." />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="PVE version" value={<span className="text-sm break-all">{detail.data.PVEVersion || "—"}</span>} hint={detail.data.Kversion} icon={undefined} />
                <StatCard label="Uptime" value={fmtUptime(detail.data.Uptime)} hint={`load avg ${(detail.data.LoadAvg ?? []).join(" ") || "—"}`} />
                <StatCard label="CPU" value={`${detail.data.CPUInfo?.Cores ?? "?"} cores · ${detail.data.CPUInfo?.CPUs ?? "?"} CPUs`} hint={detail.data.CPUInfo?.Model || "unknown model"} />
                <StatCard label="CPU usage" value={fmtFraction(detail.data.CPU)} hint={`io-wait ${fmtFraction(detail.data.Wait)} · idle ${detail.data.Idle ?? "—"}%`} />
              </div>
              <div className="space-y-4 rounded-md border p-4">
                <UsageBar label="Memory" used={detail.data.Memory?.used} total={detail.data.Memory?.total} />
                <UsageBar label="Swap" used={detail.data.Swap?.used} total={detail.data.Swap?.total} />
                <UsageBar label="Root filesystem" used={detail.data.RootFS?.used} total={detail.data.RootFS?.total} />
              </div>
              <KeyValue
                entries={[
                  ["Kernel", detail.data.Kversion || "—"],
                  ["CPU model", detail.data.CPUInfo?.Model || "—"],
                  ["Sockets", String(detail.data.CPUInfo?.Sockets ?? "—")],
                  ["KSM shared", `${detail.data.Ksm?.Shared ?? 0}`],
                  ["HVM", detail.data.CPUInfo?.HVM || "—"],
                  ["CPU flags", detail.data.CPUInfo?.Flags || "—"],
                ]}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="dns">
          {dns.error ? (
            <ErrorBanner error={dns.error} />
          ) : dns.loading ? (
            <EmptyState message="Loading DNS…" />
          ) : (
            <KeyValue
              entries={Object.entries(dns.data ?? {}).map(([key, value]) => [
                key,
                value === null || value === undefined || value === "" ? "—" : String(value),
              ])}
            />
          )}
        </TabsContent>

        <TabsContent value="time">
          {time.error ? (
            <ErrorBanner error={time.error} />
          ) : time.loading ? (
            <EmptyState message="Loading time…" />
          ) : (
            <KeyValue
              entries={Object.entries(time.data ?? {}).map(([key, value]) => [
                key,
                key === "time" && typeof value === "number"
                  ? new Date(value * 1000).toLocaleString()
                  : value === null || value === undefined || value === ""
                    ? "—"
                    : String(value),
              ])}
            />
          )}
        </TabsContent>

        <TabsContent value="certs">
          {certs.error ? (
            <ErrorBanner error={certs.error} />
          ) : (
            <SimpleDataTable<PveCert>
              columns={[
                { key: "filename", header: "File", render: (row) => row.filename ?? "—" },
                { key: "subject", header: "Subject", render: (row) => <span className="break-all text-xs">{row.subject ?? "—"}</span> },
                { key: "issuer", header: "Issuer", render: (row) => <span className="break-all text-xs">{row.issuer ?? "—"}</span> },
                { key: "not-after", header: "Expires", render: (row) => row["not-after"] ?? "—" },
                {
                  key: "public-key-type",
                  header: "Key",
                  render: (row) =>
                    row["public-key-type"] ? `${row["public-key-type"]} ${row["public-key-bits"] ?? ""}b` : "—",
                },
                {
                  key: "san",
                  header: "SANs",
                  render: (row) => (row.san && row.san.length > 0 ? row.san.length : "—"),
                },
              ]}
              rows={certs.data ?? []}
              loading={certs.loading}
              skeletonRows={3}
              emptyMessage="No custom certificates installed on this node."
              getRowKey={(row) => row.filename ?? Math.random().toString()}
            />
          )}
        </TabsContent>

        <TabsContent value="disks">
          {disks.error ? (
            <ErrorBanner error={disks.error} />
          ) : (
            <SimpleDataTable<PveDisk>
              columns={[
                { key: "devpath", header: "Device", render: (row) => <span className="font-mono text-xs">{row.devpath ?? "—"}</span> },
                { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
                { key: "model", header: "Model", render: (row) => <span className="truncate">{row.model ?? "—"}</span> },
                { key: "size", header: "Size", render: (row) => formatBytes(row.size) },
                {
                  key: "health",
                  header: "Health",
                  render: (row) => (
                    <Badge variant={(row.health ?? "").toUpperCase() === "PASSED" || row.health === "OK" ? "default" : "destructive"}>
                      {row.health || "unknown"}
                    </Badge>
                  ),
                },
                { key: "wearout", header: "Wearout", render: (row) => row.wearout ?? "—" },
                { key: "serial", header: "Serial", render: (row) => <span className="font-mono text-xs">{row.serial ?? "—"}</span> },
                { key: "osdid", header: "OSD", render: (row) => (typeof row.osdid === "number" && row.osdid >= 0 ? `osd.${row.osdid}` : "—") },
              ]}
              rows={disks.data ?? []}
              loading={disks.loading}
              skeletonRows={4}
              emptyMessage="No disks reported."
              getRowKey={(row) => row.devpath ?? row.serial ?? Math.random().toString()}
            />
          )}
        </TabsContent>

        <TabsContent value="storages">
          {storages.error ? (
            <ErrorBanner error={storages.error} />
          ) : (
            <SimpleDataTable<PveNodeStorage>
              columns={[
                { key: "storage", header: "Storage", render: (row) => row.storage ?? "—" },
                { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
                { key: "content", header: "Content", render: (row) => row.content ?? "—" },
                {
                  key: "active",
                  header: "State",
                  render: (row) => (
                    <Badge variant={row.enabled !== 1 ? "destructive" : row.active === 1 ? "default" : "secondary"}>
                      {row.enabled !== 1 ? "disabled" : row.active === 1 ? "active" : "inactive"}
                    </Badge>
                  ),
                },
                {
                  key: "used_fraction",
                  header: "Usage",
                  render: (row) =>
                    row.total ? `${formatBytes(row.used)} / ${formatBytes(row.total)} · ${fmtFraction(row.used_fraction)}` : fmtFraction(row.used_fraction),
                },
                { key: "shared", header: "Shared", render: (row) => (row.shared === 1 ? "yes" : "no") },
              ]}
              rows={storages.data ?? []}
              loading={storages.loading}
              skeletonRows={4}
              emptyMessage="No storages visible from this node."
              getRowKey={(row) => row.storage ?? Math.random().toString()}
            />
          )}
        </TabsContent>

        <TabsContent value="tasks">
          {tasks.error ? (
            <ErrorBanner error={tasks.error} />
          ) : (
            <SimpleDataTable<PveTask>
              columns={[
                {
                  key: "Saved",
                  header: "Saved",
                  render: (row) => fmtEpoch(row.Saved),
                  className: "whitespace-nowrap",
                },
                { key: "Type", header: "Type", render: (row) => row.Type ?? "—" },
                { key: "ID", header: "Target", render: (row) => row.ID ?? "—" },
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
                      <Badge variant="outline">{row.Status || "unknown"}</Badge>
                    ),
                },
                {
                  key: "UPID",
                  header: "UPID",
                  render: (row) => <span className="font-mono text-xs break-all">{row.UPID ?? "—"}</span>,
                },
              ]}
              rows={tasks.data ?? []}
              loading={tasks.loading}
              skeletonRows={6}
              emptyMessage="No recent tasks on this node."
              getRowKey={(row) => row.UPID ?? Math.random().toString()}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
