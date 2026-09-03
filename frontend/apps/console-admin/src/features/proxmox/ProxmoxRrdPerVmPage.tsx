import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
    cpu: typeof p.CPU === "number" ? Math.round(Number(p.CPU) * 1000) / 10 : 0,
    mem: typeof p.Mem === "number" ? Number(p.Mem) : 0,
    net_in: typeof p.NetIn === "number" ? Number(p.NetIn) : 0,
    net_out: typeof p.NetOut === "number" ? Number(p.NetOut) : 0,
    disk_read: typeof p.DiskRead === "number" ? Number(p.DiskRead) : 0,
    disk_write: typeof p.DiskWrite === "number" ? Number(p.DiskWrite) : 0,
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

export default function ProxmoxRrdPerVmPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const [timeframe, setTimeframe] = useState<string>("hour")
  const [cf, setCf] = useState<string>("AVERAGE")

  const path =
    providerId && node && vmid ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/rrd` : null
  const query = useMemo(() => ({ timeframe, cf }), [timeframe, cf])
  const rrd = useInfraGet<RrdPoint[]>(path, query, { intervalMs: 5000 })

  if (!providerId || !node || !vmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title="RRD per-VM"
        description="GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd — proxmox murni via proxmoxAdapterFor (non-proxmox → 501 expect proxmox), requireStaff infra, polled every 5s."
      >
        <p className="text-sm text-destructive">Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd.</p>
      </ProviderShell>
    )
  }

  const rows = Array.isArray(rrd.data) ? toRows(rrd.data as RrdPoint[]) : []

  return (
    <ProviderShell
      providerId={providerId}
      title={`RRD — ${node}/${vmid}`}
      description={`Per-VM QEMU RRD for VM ${vmid} on node ${node}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd?timeframe=&cf= (proxmox murni, requireStaff infra, polled every 5s via useInfraGet).`}
      actions={
        <Button variant="outline" size="sm" onClick={() => rrd.reload()} disabled={rrd.loading}>
          Refresh
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Timeframe</Label>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>CF</Label>
          <Select value={cf} onValueChange={setCf}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CFS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="pb-2 text-xs text-muted-foreground">?timeframe=&amp;cf= forwarded to PVE; defaults hour/AVERAGE.</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            QEMU {vmid} on {node} — RRD
          </CardTitle>
          <CardDescription>
            GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd · {rows.length} samples · polled 5s · requireStaff infra · proxmoxAdapterFor guard (501 expect proxmox)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rrd.error ? <ErrorBanner error={rrd.error} /> : null}
          {rrd.loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading QEMU RRD…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No QEMU RRD samples.</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <LineChart data={rows} margin={{ left: -8, right: 8 }}>
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
          <SimpleDataTable<RrdPoint>
            columns={[
              {
                key: "time",
                header: "Time",
                render: (r) => (typeof r.Time === "number" ? new Date(Number(r.Time) * 1000).toLocaleString() : String(r.Time ?? "—")),
              },
              { key: "cpu", header: "CPU", render: (r) => (typeof r.CPU === "number" ? `${(Number(r.CPU) * 100).toFixed(1)}%` : "—") },
              { key: "mem", header: "Mem", render: (r) => String(r.Mem ?? "—") },
              { key: "net", header: "Net In/Out", render: (r) => `${String(r.NetIn ?? "—")} / ${String(r.NetOut ?? "—")}` },
            ]}
            rows={(rrd.data as RrdPoint[]) ?? []}
            loading={rrd.loading}
            error={undefined}
            emptyMessage="No QEMU RRD rows."
            getRowKey={(_, i) => String(i)}
            skeletonRows={3}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd?timeframe=&amp;cf=</span> · requireStaff infra (NOC + platform_admin) · proxmox murni (proxmoxAdapterFor)
          </p>
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
