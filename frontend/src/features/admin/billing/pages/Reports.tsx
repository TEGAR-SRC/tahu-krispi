// Admin billing reports: multi-period comparison of
// GET /admin/finance/summary?days=N for N = 7/30/90/365 fetched in parallel.
// Renders a KPI table comparing every metric across the windows, a per-metric
// trend chart over the same windows, and a client-side CSV export of the
// comparison. Note: outstanding / wallet balance / MRR are point-in-time
// snapshots, so their value is identical for every window.
import { useEffect, useMemo, useState } from "react"
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatMoney } from "./shared"

interface FinanceTotals {
  paid_count: number
  paid_total: number
}

interface SummaryData {
  period_days: number
  invoices: FinanceTotals
  outstanding: { count: number; total: number }
  topups: FinanceTotals
  wallet_balance_total: number
  mrr_active: number
}

const PERIODS = [7, 30, 90, 365] as const

interface MetricDef {
  key: string
  label: string
  unit: "money" | "count"
  /** Marks point-in-time metrics whose value does not depend on the window. */
  snapshot?: boolean
  value: (summary: SummaryData) => number
}

const METRICS: MetricDef[] = [
  {
    key: "invoice_paid_total",
    label: "Invoices paid",
    unit: "money",
    value: (summary) => summary.invoices.paid_total,
  },
  {
    key: "invoice_paid_count",
    label: "Invoices settled",
    unit: "count",
    value: (summary) => summary.invoices.paid_count,
  },
  {
    key: "topup_total",
    label: "Wallet topups",
    unit: "money",
    value: (summary) => summary.topups.paid_total,
  },
  {
    key: "topup_count",
    label: "Topups settled",
    unit: "count",
    value: (summary) => summary.topups.paid_count,
  },
  {
    key: "outstanding_total",
    label: "Outstanding balance",
    unit: "money",
    snapshot: true,
    value: (summary) => summary.outstanding.total,
  },
  {
    key: "outstanding_count",
    label: "Unpaid invoices",
    unit: "count",
    snapshot: true,
    value: (summary) => summary.outstanding.count,
  },
  {
    key: "wallet_balance",
    label: "Wallet balances (all orgs)",
    unit: "money",
    snapshot: true,
    value: (summary) => summary.wallet_balance_total,
  },
  {
    key: "mrr_active",
    label: "MRR (active subs)",
    unit: "money",
    snapshot: true,
    value: (summary) => summary.mrr_active,
  },
]

function formatMetric(metric: MetricDef, value: number): string {
  return metric.unit === "money" ? formatMoney(value) : String(value)
}

/** Builds the CSV text for the comparison table and triggers a download. */
function exportCsv(
  summaries: Array<{ days: number; data: SummaryData | null }>,
): void {
  const header = [
    "Metric",
    "Unit",
    ...PERIODS.map((days) => `${days}d`),
  ]
  const rows = METRICS.map((metric) => [
    metric.label,
    metric.unit,
    ...PERIODS.map((days) => {
      const summary = summaries.find((entry) => entry.days === days)?.data
      return summary ? String(metric.value(summary)) : ""
    }),
  ])
  const csv = [header, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\r\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `billing-report-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function BillingReportsPage() {
  const [summaries, setSummaries] = useState<Array<{ days: number; data: SummaryData | null }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      Promise.all(
        PERIODS.map((days) =>
          apiGet<SummaryData>("/admin/finance/summary", { query: { days } }).then(
            (envelope) => ({ days, data: envelope.data }) as { days: number; data: SummaryData | null },
          ).catch(() => ({ days, data: null }) as { days: number; data: SummaryData | null }),
        ),
      )
        .then((results) => {
          if (cancelled) return
          setSummaries(results as Array<{ days: number; data: SummaryData | null }>)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setError(cause)
          setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  const byDays = useMemo(() => {
    const map = new Map<number, SummaryData | null>()
    for (const entry of summaries) map.set(entry.days, entry.data)
    return map
  }, [summaries])

  const ready = !loading && !error && summaries.length === PERIODS.length

  // ---- Comparison table --------------------------------------------------------
  interface ComparisonRow {
    metric: MetricDef
    values: Array<number | null>
  }

  const comparisonRows: ComparisonRow[] = useMemo(() => {
    if (!ready) return []
    return METRICS.map((metric) => ({
      metric,
      values: PERIODS.map((days) => {
        const summary = byDays.get(days)
        return summary ? metric.value(summary) : null
      }),
    }))
  }, [ready, byDays])

  const comparisonColumns: Array<SimpleColumn<ComparisonRow>> = useMemo(
    () => [
      {
        key: "metric",
        header: "Metric",
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            {row.metric.label}
            {row.metric.snapshot ? (
              <span className="text-xs text-muted-foreground">(point-in-time)</span>
            ) : null}
          </span>
        ),
      },
      ...PERIODS.map<SimpleColumn<ComparisonRow>>((days) => ({
        key: `days-${days}`,
        header: `Last ${days}d`,
        className: "text-right tabular-nums",
        render: (row) => {
          const value = row.values[PERIODS.indexOf(days)]
          return value === null ? "—" : formatMetric(row.metric, value)
        },
      })),
    ],
    [],
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Billing reports"
        description="Finance summary compared across lookback windows (7 / 30 / 90 / 365 days), fetched in parallel."
        actions={
          <>
            <Button variant="outline" onClick={() => setReloadTick((tick) => tick + 1)} disabled={loading}>
              <RefreshCwIcon /> Refresh
            </Button>
            <Button onClick={() => exportCsv(summaries)} disabled={!ready}>
              <DownloadIcon /> Export CSV
            </Button>
          </>
        }
      />

      <p className="-mt-3 text-xs text-muted-foreground">
        Metrics marked "(point-in-time)" are snapshots and therefore identical for
        every window; windowed metrics aggregate over the preceding N days.
        Amounts use the platform currency returned by the API (IDR when absent).
      </p>

      {error ? <ErrorBanner error={error} /> : null}

      {loading ? (
        <>
          <Skeleton className="h-72 w-full rounded-xl" />
          <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-56 rounded-xl" />
            ))}
          </div>
        </>
      ) : null}

      {ready ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>KPI comparison</CardTitle>
              <CardDescription>
                Every finance-summary metric across the four lookback windows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable
                columns={comparisonColumns}
                rows={comparisonRows}
                getRowKey={(row) => row.metric.key}
                emptyMessage="No report data available."
              />
            </CardContent>
          </Card>

          <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-2">
            {METRICS.map((metric, index) => {
              const series = PERIODS.map((days) => ({
                window: `${days}d`,
                value: byDays.get(days) ? metric.value(byDays.get(days) as SummaryData) : 0,
              }))
              const config = {
                value: {
                  label: metric.label,
                  color: `var(--chart-${(index % 5) + 1})`,
                },
              } satisfies ChartConfig
              return (
                <Card key={metric.key}>
                  <CardHeader>
                    <CardTitle className="text-base">{metric.label}</CardTitle>
                    <CardDescription>
                      Across the 7/30/90/365-day windows
                      {metric.snapshot ? " (snapshot — flat by nature)" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={config} className="h-44 w-full">
                      <BarChart data={series}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="window" tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
