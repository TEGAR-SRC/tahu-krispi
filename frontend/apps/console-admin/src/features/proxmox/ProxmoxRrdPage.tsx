import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type RrdPoint = Record<string, unknown>

const TIMEFRAMES = ["hour", "day", "week", "month", "year"] as const
const CFS = ["AVERAGE", "MAX"] as const

function toRows(points: RrdPoint[]) {
  return points.map((p) => ({
    label: typeof p.Time === "number" ? new Date(Number(p.Time) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : String(p.Time ?? ""),
    cpu: typeof p.CPU === "number" ? Math.round(p.CPU * 1000) / 10 : 0,
    mem: typeof p.Mem === "number" ? p.Mem : 0,
    net_in: typeof p.NetIn === "number" ? p.NetIn : 0,
    net_out: typeof p.NetOut === "number" ? p.NetOut : 0,
    disk_read: typeof p.DiskRead === "number" ? p.DiskRead : 0,
    disk_write: typeof p.DiskWrite === "number" ? p.DiskWrite : 0,
  }))
}

const chartConfig: ChartConfig = {
  cpu: { label: "CPU %", color: "var(--chart-1)" },
  mem: { label: "Mem", color: "var(--chart-2)" },
  net_in: { label: "Net in", color: "var(--chart-3)" },
  net_out: { label: "Net out", color: "var(--chart-4)" },
  disk_read: { label: "Disk read", color: "var(--chart-5)" },
  disk_write: { label: "Disk write", color: "var(--chart-1)" },
}

export default function ProxmoxRrdPage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const [timeframe, setTimeframe] = useState<string>("hour")
  const [cf, setCf] = useState<string>("AVERAGE")
  const [vmid, setVmid] = useState("")

  const nodePath = providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/rrd` : null
  const nodeQuery = useMemo(() => ({ timeframe, cf }), [timeframe, cf])
  const nodeRrd = useInfraGet<RrdPoint[]>(nodePath, nodeQuery, { intervalMs: 5000 })

  const vmidTrim = vmid.trim()
  const vmidNum = Number(vmidTrim)
  const qemuPath =
    providerId && node && vmidTrim && Number.isFinite(vmidNum) && vmidNum > 0
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmidTrim)}/rrd`
      : null
  const qemuRrd = useInfraGet<RrdPoint[]>(qemuPath, nodeQuery, { intervalMs: 5000 })

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId} title="RRD" description="Node + QEMU RRD charts (polled every 5s).">
        <p className="text-sm text-destructive">Missing providerId or node in route.</p>
      </ProviderShell>
    )
  }

  const nodeRows = Array.isArray(nodeRrd.data) ? toRows(nodeRrd.data as RrdPoint[]) : []
  const qemuRows = Array.isArray(qemuRrd.data) ? toRows(qemuRrd.data as RrdPoint[]) : []

  return (
    <ProviderShell
      providerId={providerId}
      title={`RRD — ${node}`}
      description="Proxmox RRD: GET /admin/proxmox/:id/nodes/:node/rrd + GET :node/qemu/:vmid/rrd. Polled every 5s via useInfraGet. Node chart always on; QEMU chart needs a VMID."
      actions={<Button variant="outline" size="sm" onClick={() => { nodeRrd.reload(); qemuRrd.reload() }} disabled={nodeRrd.loading && qemuRrd.loading}>Refresh</Button>}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Timeframe</Label>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{TIMEFRAMES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>CF</Label>
          <Select value={cf} onValueChange={setCf}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{CFS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rrd-vmid">QEMU VMID (optional)</Label>
          <Input id="rrd-vmid" value={vmid} onChange={(e) => setVmid(e.target.value)} placeholder="101" className="w-32 font-mono" />
        </div>
        <span className="pb-2 text-xs text-muted-foreground">?timeframe=&amp;cf= forwarded to PVE; defaults hour/AVERAGE.</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node {node} — RRD</CardTitle>
            <CardDescription>GET /admin/proxmox/:id/nodes/:node/rrd · {nodeRows.length} samples · polled 5s</CardDescription>
          </CardHeader>
          <CardContent>
            {nodeRrd.error ? <ErrorBanner error={nodeRrd.error} /> : null}
            {nodeRrd.loading && nodeRows.length === 0 ? <p className="text-sm text-muted-foreground">Loading node RRD…</p> : nodeRows.length === 0 ? <p className="text-sm text-muted-foreground">No RRD samples.</p> : (
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <LineChart data={nodeRows} margin={{ left: -8, right: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={36} />
                  <YAxis tickLine={false} axisLine={false} width={56} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Line dataKey="cpu" stroke="var(--color-cpu)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="net_in" stroke="var(--color-net_in)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="net_out" stroke="var(--color-net_out)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="disk_read" stroke="var(--color-disk_read)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  <Line dataKey="disk_write" stroke="var(--color-disk_write)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            )}
            <SimpleDataTable<RrdPoint>
              columns={[
                { key: "time", header: "Time", render: (r) => typeof r.Time === "number" ? new Date(Number(r.Time) * 1000).toLocaleString() : String(r.Time ?? "—") },
                { key: "cpu", header: "CPU", render: (r) => typeof r.CPU === "number" ? `${(Number(r.CPU) * 100).toFixed(1)}%` : "—" },
                { key: "mem", header: "Mem", render: (r) => String(r.Mem ?? "—") },
                { key: "net", header: "Net In/Out", render: (r) => `${String(r.NetIn ?? "—")} / ${String(r.NetOut ?? "—")}` },
              ]}
              rows={(nodeRrd.data as RrdPoint[]) ?? []}
              loading={nodeRrd.loading}
              error={undefined}
              emptyMessage="No node RRD rows."
              getRowKey={(_, i) => String(i)}
              skeletonRows={3}
            />
            <p className="mt-2 text-xs text-muted-foreground">Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/rrd?timeframe=&amp;cf=</span></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">QEMU {vmidTrim || "—"} — RRD</CardTitle>
            <CardDescription>GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd · {qemuRows.length} samples · polled 5s when VMID set</CardDescription>
          </CardHeader>
          <CardContent>
            {!qemuPath ? <p className="text-sm text-muted-foreground">Enter a VMID to load QEMU RRD.</p> : qemuRrd.error ? <ErrorBanner error={qemuRrd.error} /> : qemuRrd.loading && qemuRows.length === 0 ? <p className="text-sm text-muted-foreground">Loading QEMU RRD…</p> : qemuRows.length === 0 ? <p className="text-sm text-muted-foreground">No QEMU RRD samples.</p> : (
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <LineChart data={qemuRows} margin={{ left: -8, right: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={36} />
                  <YAxis tickLine={false} axisLine={false} width={56} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Line dataKey="cpu" stroke="var(--color-cpu)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="mem" stroke="var(--color-mem)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="net_in" stroke="var(--color-net_in)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="net_out" stroke="var(--color-net_out)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ChartContainer>
            )}
            {qemuPath ? (
              <>
                <SimpleDataTable<RrdPoint>
                  columns={[
                    { key: "time", header: "Time", render: (r) => typeof r.Time === "number" ? new Date(Number(r.Time) * 1000).toLocaleString() : String(r.Time ?? "—") },
                    { key: "cpu", header: "CPU", render: (r) => typeof r.CPU === "number" ? `${(Number(r.CPU) * 100).toFixed(1)}%` : "—" },
                    { key: "mem", header: "Mem", render: (r) => String(r.Mem ?? "—") },
                    { key: "net", header: "Net In/Out", render: (r) => `${String(r.NetIn ?? "—")} / ${String(r.NetOut ?? "—")}` },
                  ]}
                  rows={(qemuRrd.data as RrdPoint[]) ?? []}
                  loading={!!qemuPath && qemuRrd.loading}
                  error={undefined}
                  emptyMessage="No QEMU RRD rows."
                  getRowKey={(_, i) => String(i)}
                  skeletonRows={3}
                />
                <p className="mt-2 text-xs text-muted-foreground">Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd?timeframe=&amp;cf=</span></p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
