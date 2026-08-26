// Instance metrics: timeframe selector + line charts rendered generically from
// the provider's round-robin series. The backend proxies PVE's RRD data
// as-is — an array of points whose keys vary by guest kind (vm/container) and
 // provider — so series are discovered from the payload instead of hardcoded.
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { formatBytes } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"
import { InstanceBreadcrumb, useInstance } from "./shared"

const TIMEFRAMES = ["hour", "day", "week", "month"] as const
type Timeframe = (typeof TIMEFRAMES)[number]

type MetricPoint = Record<string, number | string | null>

/** Groups a metric key into a chart family by name. */
function familyFor(key: string): string {
  const lower = key.toLowerCase()
  if (lower.includes("cpu")) return "cpu"
  if (lower.includes("mem") || lower.includes("ram")) return "memory"
  if (lower.includes("net")) return "network"
  if (lower.includes("disk")) return "disk"
  return `other:${lower}`
}

/** True when the series is a byte-ish quantity (memory, disk, network rates). */
function isByteSeries(key: string): boolean {
  const lower = key.toLowerCase()
  return /(mem|ram|disk|net)/.test(lower) && !lower.includes("cpu")
}

const CHART_TITLES: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  network: "Network",
}

export default function InstanceMetricsPage() {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const { instance } = useInstance(instanceId)

  const [timeframe, setTimeframe] = useState<Timeframe>("hour")
  const [points, setPoints] = useState<MetricPoint[] | null>(null)
  const [rawPayload, setRawPayload] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<unknown>(`/instances/${instanceId}/metrics`, {
      headers: orgHeaders(orgId),
      query: { timeframe },
    })
      .then(({ data }) => {
        if (cancelled) return
        setRawPayload(data ?? null)
        setPoints(Array.isArray(data) ? (data as MetricPoint[]) : null)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause)
        setPoints(null)
        setRawPayload(null)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId, timeframe])

  // Discover the time axis and numeric series from the payload.
  const { timeKey, seriesKeys } = useMemo(() => {
    const keys = new Set<string>()
    let foundTimeKey: string | null = null
    for (const point of points ?? []) {
      for (const [key, value] of Object.entries(point)) {
        if (/^(time|timestamp|date)$/i.test(key)) {
          foundTimeKey = key
          continue
        }
        if ((typeof value === "number" && Number.isFinite(value)) || value === null) {
          keys.add(key)
        }
      }
    }
    return { timeKey: foundTimeKey, seriesKeys: Array.from(keys) }
  }, [points])

  const chartRows = useMemo(() => {
    if (!timeKey || seriesKeys.length === 0) return []
    return [...(points ?? [])]
      .sort((a, b) => Number(a[timeKey] ?? 0) - Number(b[timeKey] ?? 0))
      .map((point) => {
        const row: Record<string, number | string | null> = {}
        row.label =
          typeof point[timeKey] === "number"
            ? new Date(Number(point[timeKey]) * 1000).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : String(point[timeKey] ?? "")
        for (const key of seriesKeys) {
          const value = point[key]
          row[key] = typeof value === "number" && Number.isFinite(value) ? value : null
        }
        return row
      })
  }, [points, timeKey, seriesKeys])

  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const key of seriesKeys) {
      const family = familyFor(key)
      const list = map.get(family) ?? []
      list.push(key)
      map.set(family, list)
    }
    return Array.from(map.entries())
  }, [seriesKeys])

  return (
    <div className="flex flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance?.name} section="Metrics" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Metrics"
          description={
            instance
              ? `Round-robin provider metrics for ${instance.name}.`
              : "Round-robin provider metrics."
          }
        />
        <Select value={timeframe} onValueChange={(value) => setTimeframe(value as Timeframe)}>
          <SelectTrigger className="w-36" aria-label="Timeframe">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((tf) => (
              <SelectItem key={tf} value={tf} className="capitalize">
                last {tf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ErrorBanner error={error} />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? null : points === null ? (
        <>
          <EmptyState
            message="No metric series in the response."
            description="The provider returned no round-robin data for this timeframe."
          />
          {rawPayload !== null ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
              {JSON.stringify(rawPayload, null, 2)}
            </pre>
          ) : null}
        </>
      ) : chartRows.length === 0 || groups.length === 0 ? (
        <EmptyState
          message="No plottable series yet."
          description="Charts appear once the provider has collected at least one sample."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map(([family, keys]) => (
            <MetricChartCard
              key={family}
              title={CHART_TITLES[family] ?? family.replace(/^other:/, "")}
              subtitle={`${keys.length} series · last ${timeframe}`}
              rows={chartRows}
              seriesKeys={keys}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function prettySeriesName(key: string): string {
  // Split camel-case Go field names (NetIn -> Net In) and snake/kebab cases.
  return key
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
}

function MetricChartCard({
  title,
  subtitle,
  rows,
  seriesKeys,
}: {
  title: string
  subtitle: string
  rows: Array<Record<string, number | string | null>>
  seriesKeys: string[]
}) {
  const config = useMemo(() => {
    const entries = seriesKeys.map((key, index) => [
      key,
      { label: prettySeriesName(key), color: `var(--chart-${(index % 5) + 1})` },
    ])
    return Object.fromEntries(entries) as ChartConfig
  }, [seriesKeys])

  const sampleKey = seriesKeys[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-56 w-full">
          <LineChart data={rows} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) =>
                isByteSeries(sampleKey)
                  ? formatBytes(value)
                  : String(Math.round(value * 1000) / 1000)
              }
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {seriesKeys.map((key) => (
              <Line
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                name={prettySeriesName(key)}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
