// VMware per-VM perf detail — GET /admin/vmware/:id/perf/:vmid realtime 5s drill.
// Endpoint: GET /admin/vmware/:id/perf/:vmid?timeframe=hour|day (vmwareAdapterFor
// guard kind==vmware, requireStaff infra → NOC readable, finance 403).
// Reuses the same chart/table normalizers as VmwarePerfPage but polls the
// path-param drill endpoint and renders SimpleDataTable + ProviderShell.
// Route: /admin/vmware/:providerId/perf/:vmid
import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"
import { ApiError } from "@/lib/api"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

interface PerfDetailPayload {
  provider_id: string
  code: string
  external_id: string
  vmid?: string
  timeframe: string
  metrics: unknown
}

interface Normalized {
  rows: Array<Record<string, string | number>>
  groups: Array<{ id: string; label: string; unit: string; series: Array<{ key: string; label: string }> }>
}

const TIMEFRAMES = ["hour", "day"] as const

function normalizePveRrd(metrics: Array<Record<string, unknown>>): Normalized | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const first = metrics[0] as Record<string, unknown>
  if (typeof first.Time !== "number") return null
  const rows = metrics.map((point) => ({
    label: new Date(Number((point as Record<string, unknown>).Time) * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cpu_pct: typeof point.CPU === "number" ? Math.round((point.CPU as number) * 1000) / 10 : 0,
    mem_bytes: typeof point.Mem === "number" ? (point.Mem as number) : 0,
    net_in: typeof point.NetIn === "number" ? (point.NetIn as number) : 0,
    net_out: typeof point.NetOut === "number" ? (point.NetOut as number) : 0,
    disk_read: typeof point.DiskRead === "number" ? (point.DiskRead as number) : 0,
    disk_write: typeof point.DiskWrite === "number" ? (point.DiskWrite as number) : 0,
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

function normalizeVmwareSeries(metrics: Array<Record<string, unknown>>): Normalized | null {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const first = metrics[0] as Record<string, unknown>
  if (!Array.isArray(first.sampleInfo) || !Array.isArray(first.value)) return null
  const samples = first.sampleInfo as Array<Record<string, unknown>>
  const stamps = samples.map((sample, idx) => {
    const ts = sample.timestamp
    if (typeof ts === "string" && ts) return ts
    if (typeof ts === "object" && ts !== null) {
      const nested = ts as Record<string, unknown>
      if (typeof nested.Value === "string" && nested.Value) return nested.Value as string
      if (typeof nested.value === "string" && nested.value) return nested.value as string
    }
    return String(idx)
  })
  const seriesByKey = new Map<string, { label: string; values: number[] }>()
  for (const counter of first.value as Array<Record<string, unknown>>) {
    const name = String(counter.name ?? "")
    const values = Array.isArray(counter.value)
      ? (counter.value as number[]).map((v) => (typeof v === "number" ? v : 0))
      : []
    if (!name) continue
    const key = name.startsWith("cpu.") ? "cpu_pct" : name.startsWith("mem.") ? "mem_kib" : name.replace(/\./g, "_")
    seriesByKey.set(key, {
      label: `${name}${name.includes("mem.active") ? " (KB)" : name.includes("cpu") ? " (%)" : ""}`,
      values,
    })
  }
  const hasCpu = seriesByKey.has("cpu_pct")
  const hasMem = seriesByKey.has("mem_kib")
  if (!hasCpu && !hasMem && seriesByKey.size === 0) return null
  const rows = stamps.map((stamp, index) => {
    const row: Record<string, string | number> = {
      label: stamp ? new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : String(index),
    }
    for (const [key, series] of seriesByKey) row[key] = series.values[index] ?? 0
    return row
  })
  const groups: Normalized["groups"] = []
  if (hasCpu) groups.push({ id: "cpu", label: "CPU", unit: "%", series: [{ key: "cpu_pct", label: seriesByKey.get("cpu_pct")?.label ?? "cpu" }] })
  if (hasMem) groups.push({ id: "memory", label: "Memory active", unit: "KB", series: [{ key: "mem_kib", label: seriesByKey.get("mem_kib")?.label ?? "mem" }] })
  if (!hasCpu && !hasMem) {
    for (const [key, series] of seriesByKey) groups.push({ id: key, label: series.label, unit: "", series: [{ key, label: series.label }] })
  }
  return { rows, groups }
}

function formatAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}G`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export default function VmwarePerfDetailPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const vmidParam = (params.vmid ?? (params as Record<string, string>).vmId ?? "") as string
  const [searchParams, setSearchParams] = useSearchParams()
  const decodedVmid = useMemo(() => {
    try {
      return decodeURIComponent(vmidParam)
    } catch {
      return vmidParam
    }
  }, [vmidParam])

  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>(
    (searchParams.get("timeframe") as (typeof TIMEFRAMES)[number]) ?? "hour",
  )

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.set("timeframe", timeframe)
    setSearchParams(next, { replace: true })
  }, [timeframe]) // eslint-disable-line react-hooks/exhaustive-deps

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const perfPath =
    providerId && decodedVmid && isVmware
      ? `/admin/vmware/${providerId}/perf/${encodeURIComponent(decodedVmid)}`
      : null

  const perf = useInfraGet<PerfDetailPayload>(perfPath, { timeframe }, { intervalMs: 5000 })

  const normalized = useMemo(() => {
    const metrics = perf.data?.metrics
    if (Array.isArray(metrics)) {
      return normalizePveRrd(metrics as Array<Record<string, unknown>>) ?? normalizeVmwareSeries(metrics as Array<Record<string, unknown>>)
    }
    return null
  }, [perf.data])

  const [groupId, setGroupId] = useState("cpu")
  const group = normalized?.groups.find((c) => c.id === groupId) ?? normalized?.groups[0]

  const chartConfig = Object.fromEntries(
    (group?.series ?? []).map((series, index) => [series.key, { label: series.label, color: `var(--chart-${(index % 5) + 1})` }]),
  ) satisfies ChartConfig

  if (!providerId || !decodedVmid) {
    return (
      <ProviderShell providerId={providerId} title="VMware perf detail" description="Per-VM realtime perf drill — /admin/vmware/:id/perf/:vmid">
        <ErrorBanner error={new Error("Missing providerId or vmid in route params")} />
      </ProviderShell>
    )
  }

  if (perf.error instanceof ApiError && perf.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware perf detail" description="Per-VM realtime perf drill — /admin/vmware/:id/perf/:vmid">
        <EmptyState
          message="Perf detail is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET /v1/admin/vmware/:id/perf/:vmid."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — perf detail at{" "}
              <span className="font-mono">/admin/vmware/:id/perf/:vmid</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`VMware perf — ${decodedVmid}`}
      description={`Per-VM realtime metrics via vSphere GuestMetrics — GET /v1/admin/vmware/:id/perf/:vmid?timeframe= — polling every 5s.`}
    >
      {providers.error ? <ErrorBanner error={providers.error} /> : null}
      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={match.kind === "vmware" ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant={isVmware ? "outline" : "destructive"}>{match.health_status || "unknown"}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)}</CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — perf at /admin/vmware/:id/perf/:vmid answers 501.`} />
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">VM — {decodedVmid}</CardTitle>
              <CardDescription>
                Realtime perf drill for <span className="font-mono">{decodedVmid}</span> — timeframe via query, polled every 5s via{" "}
                <span className="font-mono">useInfraGet intervalMs 5000</span>. Matches existing VmwarePerf chart normalizers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="vmware-perf-detail-tf">Timeframe</Label>
                  <Select value={timeframe} onValueChange={(v) => setTimeframe(v as typeof timeframe)}>
                    <SelectTrigger id="vmware-perf-detail-tf" className="w-32">
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
                <Button variant="outline" size="sm" onClick={() => perf.reload()} disabled={perf.loading}>
                  {perf.loading ? "Refreshing…" : "Refresh"}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/vmware/${providerId}/perf?vmid=${encodeURIComponent(decodedVmid)}`}>Open perf picker</Link>
                </Button>
                <span className="text-xs text-muted-foreground">
                  Endpoint <span className="font-mono">GET /v1/admin/vmware/:id/perf/:vmid?timeframe=</span> — NOC infra (read), platform_admin for mutations elsewhere.
                </span>
              </div>
            </CardContent>
          </Card>

          {perf.loading && !perf.data ? (
            <p className="text-sm text-muted-foreground">Loading metrics…</p>
          ) : perf.error ? (
            <ErrorBanner error={perf.error} />
          ) : normalized && group && normalized.rows.length > 0 ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Chart — {group.label}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
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
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Samples (per-VM drill)</CardTitle>
                  <CardDescription>First 100 samples of the normalized series — full payload below as JSON. Polls every 5s.</CardDescription>
                </CardHeader>
                <CardContent>
                  <SimpleDataTable
                    columns={[
                      { key: "label", header: "Time" },
                      ...group.series.map((s) => ({
                        key: s.key,
                        header: s.label,
                        render: (row: Record<string, string | number>) => {
                          const v = row[s.key]
                          return typeof v === "number" ? v.toLocaleString() : String(v ?? "—")
                        },
                      })),
                    ]}
                    rows={normalized.rows.slice(0, 100)}
                    getRowKey={(_row, index) => String(index)}
                    emptyMessage="No samples."
                    skeletonRows={5}
                  />
                </CardContent>
              </Card>

              <JsonBlock value={perf.data} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">The response did not match a known metric shape — raw payload ( polled every 5s ):</p>
              <JsonBlock value={perf.data} />
            </div>
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
