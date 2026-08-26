// Guest performance charts for any provider kind (?v=<external_id>&timeframe=).
// The backend returns whatever the adapter produced — Proxmox RRDData arrays
// with Go-style keys (Time/CPU/Mem/NetIn/…) or vSphere EntityMetric series —
// so the payload is normalized into chart rows before plotting; anything
// unrecognized falls back to the raw JSON viewer.
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { ApiError } from "@/lib/api"
import { JsonBlock } from "../shared"
import { ProviderShell, useInfraGet } from "./shared"

interface PerfPayload {
  provider_id: string
  code: string
  external_id: string
  timeframe: string
  metrics: unknown
}

interface Normalized {
  /** One row per timestamp; each series contributes its key. */
  rows: Array<Record<string, string | number>>
  /** Selectable metric groups: label + the series keys they plot. */
  groups: Array<{ id: string; label: string; unit: string; series: Array<{ key: string; label: string }> }>
}

const TIMEFRAMES = ["hour", "day"]

function normalizePveRrd(metrics: Array<Record<string, unknown>>): Normalized | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const first = metrics[0]
  if (typeof first.Time !== "number") return null

  const rows = metrics.map((point) => ({
    label: new Date(Number(point.Time) * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cpu_pct: typeof point.CPU === "number" ? Math.round(point.CPU * 1000) / 10 : 0,
    mem_bytes: typeof point.Mem === "number" ? point.Mem : 0,
    net_in: typeof point.NetIn === "number" ? point.NetIn : 0,
    net_out: typeof point.NetOut === "number" ? point.NetOut : 0,
    disk_read: typeof point.DiskRead === "number" ? point.DiskRead : 0,
    disk_write: typeof point.DiskWrite === "number" ? point.DiskWrite : 0,
  }))

  return {
    rows,
    groups: [
      { id: "cpu", label: "CPU", unit: "%", series: [{ key: "cpu_pct", label: "CPU used %" }] },
      { id: "memory", label: "Memory", unit: "bytes", series: [{ key: "mem_bytes", label: "RAM in use" }] },
      {
        id: "network",
        label: "Network",
        unit: "bytes/s",
        series: [
          { key: "net_in", label: "In" },
          { key: "net_out", label: "Out" },
        ],
      },
      {
        id: "disk",
        label: "Disk IO",
        unit: "bytes/s",
        series: [
          { key: "disk_read", label: "Read" },
          { key: "disk_write", label: "Write" },
        ],
      },
    ],
  }
}

/** vSphere EntityMetric[]: {sampleInfo:[{timestamp}], value:[{name,value[]}]} */
function normalizeVmwareSeries(metrics: Array<Record<string, unknown>>): Normalized | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const first = metrics[0]
  if (!Array.isArray(first.sampleInfo) || !Array.isArray(first.value)) return null

  interface Sample {
    timestamp?: { Format?: string }
  }
  const samples = first.sampleInfo as Array<Record<string, unknown>>
  const stamps = samples.map((sample) => {
    const ts = (sample as unknown as Sample).timestamp
    const raw =
      typeof ts === "object" && ts !== null && typeof ts.Format === "string" ? "" : ""
    void raw
    // govmomi serializes timestamps either as ISO strings or {Format,Value}.
    const direct = typeof sample.timestamp === "string" ? (sample.timestamp as string) : ""
    const nested =
      typeof sample.timestamp === "object" && sample.timestamp !== null
        ? ((sample.timestamp as Record<string, unknown>).Value as string) ?? ""
        : ""
    return direct || nested || ""
  })

  const seriesByKey = new Map<string, { label: string; values: number[] }>()
  for (const counter of first.value as Array<Record<string, unknown>>) {
    const name = String(counter.name ?? "")
    const values = Array.isArray(counter.value)
      ? (counter.value as number[]).map((value) => (typeof value === "number" ? value : 0))
      : []
    if (!name) continue
    const key =
      name.startsWith("cpu.") ? "cpu_pct" : name.startsWith("mem.") ? "mem_kib" : name.replace(/\./g, "_")
    seriesByKey.set(key, {
      label: `${name}${name.includes("mem.active") ? " (KB)" : name.includes("cpu") ? " (%)" : ""}`,
      values,
    })
  }

  const hasCpu = seriesByKey.has("cpu_pct")
  const hasMem = seriesByKey.has("mem_kib")
  if (!hasCpu && !hasMem) return null

  const rows = stamps.map((stamp, index) => {
    const row: Record<string, string | number> = {
      label: stamp ? new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : String(index),
    }
    for (const [key, series] of seriesByKey) {
      row[key] = series.values[index] ?? 0
    }
    return row
  })

  const groups: Normalized["groups"] = []
  if (hasCpu) {
    groups.push({
      id: "cpu",
      label: "CPU",
      unit: "%",
      series: [{ key: "cpu_pct", label: seriesByKey.get("cpu_pct")?.label ?? "cpu" }],
    })
  }
  if (hasMem) {
    groups.push({
      id: "memory",
      label: "Memory active",
      unit: "KB",
      series: [{ key: "mem_kib", label: seriesByKey.get("mem_kib")?.label ?? "mem" }],
    })
  }
  return { rows, groups }
}

export default function GuestPerfPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""

  const [extId, setExtId] = useState("")
  const [timeframe, setTimeframe] = useState("hour")
  const [applied, setApplied] = useState<{ ext: string; tf: string } | null>(null)

  const perf = useInfraGet<PerfPayload>(
    applied
      ? `/admin/providers/${providerId}/perf`
      : null,
    { v: applied?.ext, timeframe: applied?.tf },
  )

  const normalized = useMemo(() => {
    const metrics = perf.data?.metrics
    if (Array.isArray(metrics)) {
      return normalizePveRrd(metrics as Array<Record<string, unknown>>) ??
        normalizeVmwareSeries(metrics as Array<Record<string, unknown>>)
    }
    return null
  }, [perf.data])

  const [groupId, setGroupId] = useState("cpu")
  const group = normalized?.groups.find((candidate) => candidate.id === groupId) ?? normalized?.groups[0]

  const chartConfig = Object.fromEntries(
    (group?.series ?? []).map((series, index) => [
      series.key,
      { label: series.label, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  ) satisfies ChartConfig

  const loadError =
    perf.error instanceof ApiError && perf.error.status === 501
      ? "This provider kind does not expose guest metrics through the shared perf endpoint."
      : null

  return (
    <ProviderShell
      providerId={providerId}
      title="Guest performance"
      description="Realtime (hour) or 5-minute-sampled (day) metric series for one guest."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="perf-v">Guest external ID *</Label>
          <Input
            id="perf-v"
            value={extId}
            onChange={(event) => setExtId(event.target.value)}
            placeholder={`e.g. ${providerId ? "external vm id" : "…"} (qemu/lxc path or vm-123)`}
            className="w-72 font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="perf-tf">Timeframe</Label>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger id="perf-tf" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={extId.trim() === ""}
          onClick={() => {
            setGroupId("cpu")
            setApplied({ ext: extId.trim(), tf: timeframe })
          }}
        >
          Load metrics
        </Button>
      </div>

      {loadError ? (
        <EmptyState message={loadError} description="Inventory/perf endpoints only serve proxmox and vmware providers." />
      ) : !applied ? (
        <EmptyState message="Pick a guest to chart." description="The external ID matches the provider's own guest identifier." />
      ) : perf.loading ? (
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
      ) : perf.error ? (
        loadError ? (
          <EmptyState message={loadError} />
        ) : (
          <ErrorBanner error={perf.error} />
        )
      ) : normalized && group && normalized.rows.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {normalized.groups.map((candidate) => (
              <Button
                key={candidate.id}
                variant={candidate.id === group.id ? "default" : "outline"}
                size="sm"
                onClick={() => setGroupId(candidate.id)}
              >
                {candidate.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              {normalized.rows.length} samples · unit {group.unit} · timeframe {perf.data?.timeframe}
            </span>
          </div>
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <LineChart data={normalized.rows} margin={{ left: -8, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => formatAxis(value)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {group.series.map((series) => (
                <Line
                  key={series.key}
                  dataKey={series.key}
                  stroke={`var(--color-${series.key})`}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The response did not match a known metric shape — inspect it below.
          </p>
          <JsonBlock value={perf.data} />
        </div>
      )}
    </ProviderShell>
  )
}

function formatAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}
