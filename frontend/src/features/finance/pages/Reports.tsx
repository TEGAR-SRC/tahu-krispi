// Finance reports: fetches /admin/finance/summary for 7/30/90/365-day windows
// in parallel, renders a side-by-side comparison matrix, a sparkline per
// metric across the windows, and a client-side CSV export.
import { useCallback, useEffect, useState } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { formatMoney, formatNumber } from "../lib-utils"
import type { FinanceSummaryData } from "../lib"

const PERIODS = [7, 30, 90, 365] as const
type Period = (typeof PERIODS)[number]

interface MetricDef {
  key: string
  label: string
  pick: (summary: FinanceSummaryData) => number
  kind: "money" | "count"
  hint?: string
}

// wallet_balance_total / mrr_active are point-in-time snapshots, not windowed
// sums; they still compare usefully across refreshes.
const METRICS: MetricDef[] = [
  {
    key: "invoices_paid_total",
    label: "Invoices paid (total)",
    pick: (s) => s.invoices.paid_total,
    kind: "money",
    hint: "Settled invoice amount within the window",
  },
  {
    key: "invoices_paid_count",
    label: "Invoices paid (count)",
    pick: (s) => s.invoices.paid_count,
    kind: "count",
  },
  {
    key: "outstanding_total",
    label: "Outstanding (total)",
    pick: (s) => s.outstanding.total,
    kind: "money",
    hint: "Unpaid invoice amount within the window",
  },
  {
    key: "outstanding_count",
    label: "Outstanding (count)",
    pick: (s) => s.outstanding.count,
    kind: "count",
  },
  {
    key: "topups_total",
    label: "Wallet top-ups (total)",
    pick: (s) => s.topups.paid_total,
    kind: "money",
    hint: "Paid top-up amount within the window",
  },
  {
    key: "topups_count",
    label: "Wallet top-ups (count)",
    pick: (s) => s.topups.paid_count,
    kind: "count",
  },
  {
    key: "wallet_balance_total",
    label: "Wallet balances",
    pick: (s) => s.wallet_balance_total,
    kind: "money",
    hint: "Point-in-time snapshot",
  },
  {
    key: "mrr_active",
    label: "Active MRR",
    pick: (s) => s.mrr_active,
    kind: "money",
    hint: "Point-in-time snapshot",
  },
]

function formatMetric(value: number, kind: "money" | "count"): string {
  if (kind === "money") return formatMoney(value)
  return formatNumber(value)
}

export default function FinanceReportsPage() {
  const [summaries, setSummaries] = useState<Partial<Record<Period, FinanceSummaryData>>>({})
  const [loading, setLoading] = useState(true)
  const [failedAll, setFailedAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailedAll(false)
    // One request per window; independent failures only blank that column.
    const settled = await Promise.allSettled(
      PERIODS.map((days) =>
        apiGet<FinanceSummaryData>("/admin/finance/summary", { query: { days } }),
      ),
    )
    const next: Partial<Record<Period, FinanceSummaryData>> = {}
    let okCount = 0
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        next[PERIODS[index]] = result.value.data
        okCount += 1
      }
    })
    setSummaries(next)
    setFailedAll(okCount === 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const exportCsv = useCallback(() => {
    const header = ["metric", ...PERIODS.map((days) => `${days}d`)]
    const lines = METRICS.map((metric) => [
      metric.key,
      ...PERIODS.map((days) => {
        const summary = summaries[days]
        return summary ? String(metric.pick(summary)) : ""
      }),
    ])
    const csv = [
      `# Kilat Cloud finance report,,generated ${new Date().toISOString()}`,
      header.join(","),
      ...lines.map((cells) => cells.join(",")),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `finance-report-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [summaries])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finance reports"
        description="Key billing metrics compared across 7/30/90/365-day windows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCwIcon /> Refresh
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={loading || failedAll}>
              <DownloadIcon /> Export CSV
            </Button>
          </div>
        }
      />

      {failedAll ? (
        <ErrorBanner error={new Error("Finance summary could not be loaded for any window.")} />
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Comparison matrix</CardTitle>
              <CardDescription>
                Amounts in IDR (the summary endpoint's default currency). Windows ending today;
                empty cells mean that window failed to load.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-52">Metric</TableHead>
                      {PERIODS.map((days) => (
                        <TableHead key={days} className="text-right tabular-nums">
                          Last {days}d
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {METRICS.map((metric) => (
                      <TableRow key={metric.key}>
                        <TableCell className="font-medium">
                          {metric.label}
                          {metric.hint ? (
                            <p className="text-xs font-normal text-muted-foreground">
                              {metric.hint}
                            </p>
                          ) : null}
                        </TableCell>
                        {PERIODS.map((days) => {
                          const summary = summaries[days]
                          return (
                            <TableCell
                              key={days}
                              className="text-right tabular-nums whitespace-nowrap"
                            >
                              {summary ? (
                                formatMetric(metric.pick(summary), metric.kind)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Trend across windows</h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {METRICS.filter((metric) => metric.kind === "money").map((metric) => {
                const config = {
                  v: { label: metric.label, color: "var(--chart-1)" },
                } satisfies ChartConfig
                const series = PERIODS.map((days) => ({
                  d: `${days}d`,
                  v: summaries[days] ? metric.pick(summaries[days] as FinanceSummaryData) : 0,
                }))
                return (
                  <Card key={metric.key}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{metric.label}</CardTitle>
                      <CardDescription className="text-xs">7 → 365 day windows</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={config} className="h-20 w-full">
                        <LineChart data={series} margin={{ left: 4, right: 8, top: 4 }}>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis dataKey="d" tickLine={false} axisLine={false} tickMargin={4} />
                          <YAxis hide domain={[0, "auto"]} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            dataKey="v"
                            type="monotone"
                            stroke="var(--color-v)"
                            strokeWidth={2}
                            dot={{ r: 2 }}
                          />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
