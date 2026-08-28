// Finance summary: KPI cards from /admin/finance/summary plus a paid-payments
// trend and order/invoice status breakdowns aggregated client-side from the
// real admin lists.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ReceiptTextIcon, TrendingUpIcon, WalletIcon, ClockIcon } from "lucide-react"
import {
  StatusBadge,
} from "../lib"
import { formatMoney, formatNumber, parseTimestamp } from "../lib-utils"
import type {
  AdminInvoiceRow,
  AdminOrderRow,
  AdminPaymentRow,
  FinanceSummaryData,
} from "../lib"

const PERIODS = [7, 30, 90, 365] as const

const chartConfig = {
  amount: { label: "Paid payments", color: "var(--chart-1)" },
} satisfies ChartConfig

interface DayBucket {
  day: string
  label: string
  amount: number
}

/** Buckets paid payments per calendar day across the selected window. */
function buildTrendSeries(
  payments: AdminPaymentRow[],
  days: number,
): { series: DayBucket[]; currencies: string[] } {
  const currencies = new Set<string>()
  const byDay = new Map<string, number>()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))

  for (let i = 0; i < days; i += 1) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    byDay.set(key, 0)
  }

  for (const payment of payments) {
    const date = parseTimestamp(payment.paid_at || payment.created_at)
    if (!date) continue
    currencies.add(payment.currency || "IDR")
    const key = date.toISOString().slice(0, 10)
    if (byDay.has(key)) {
      byDay.set(key, (byDay.get(key) ?? 0) + Number(payment.amount ?? 0))
    }
  }

  const series = [...byDay.entries()].map(([day, amount]) => ({
    day,
    label: day.slice(5),
    amount,
  }))
  return { series, currencies: [...currencies].sort() }
}

function countStatuses<T extends { status: string }>(rows: T[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export default function FinanceSummaryPage() {
  const [days, setDays] = useState<number>(30)
  const [summary, setSummary] = useState<FinanceSummaryData | null>(null)
  const [orders, setOrders] = useState<AdminOrderRow[]>([])
  const [invoices, setInvoices] = useState<AdminInvoiceRow[]>([])
  const [payments, setPayments] = useState<AdminPaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (windowDays: number) => {
    setLoading(true)
    setError(null)
    // allSettled so a failing side list still renders the parts that loaded.
    const [summaryRes, ordersRes, invoicesRes, paymentsRes] = await Promise.allSettled([
      apiGet<FinanceSummaryData>("/admin/finance/summary", { query: { days: windowDays } }),
      apiGet<AdminOrderRow[]>("/admin/orders", { query: { per_page: 100 } }),
      apiGet<AdminInvoiceRow[]>("/admin/invoices", { query: { per_page: 100 } }),
      apiGet<AdminPaymentRow[]>("/admin/payments", {
        query: { status: "paid", per_page: 100 },
      }),
    ])
    let firstError: unknown = null
    if (summaryRes.status === "fulfilled") setSummary(summaryRes.value.data)
    else firstError = summaryRes.reason
    if (ordersRes.status === "fulfilled") setOrders(ordersRes.value.data)
    if (invoicesRes.status === "fulfilled") setInvoices(invoicesRes.value.data)
    if (paymentsRes.status === "fulfilled") setPayments(paymentsRes.value.data)
    if (firstError === null && ordersRes.status === "rejected") firstError = ordersRes.reason
    setError(firstError)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load(days)
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load, days])

  const trend = useMemo(
    () =>
      buildTrendSeries(
        payments.filter((p) => p.currency === (payments[0]?.currency ?? "IDR")),
        days,
      ),
    [payments, days],
  )
  const orderBreakdown = useMemo(() => countStatuses(orders), [orders])
  const invoiceBreakdown = useMemo(() => countStatuses(invoices), [invoices])
  const currency = payments[0]?.currency ?? "IDR"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Summary"
        description={`Financial overview for the last ${days} days.`}
        actions={
          <div className="flex min-w-0 items-center gap-1.5">
            {PERIODS.map((period) => (
              <Button
                key={period}
                size="sm"
                variant={days === period ? "default" : "outline"}
                onClick={() => setDays(period)}
              >
                {period}d
              </Button>
            ))}
          </div>
        }
      />

      {error ? <ErrorBanner error={error} /> : null}

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading && !summary ? (
          Array.from({ length: 5 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-2 px-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))
        ) : summary ? (
          <>
            <StatCard
              label="Invoices paid"
              value={formatMoney(summary.invoices.paid_total)}
              hint={`${formatNumber(summary.invoices.paid_count)} invoices settled`}
              icon={<ReceiptTextIcon />}
            />
            <StatCard
              label="Outstanding"
              value={formatMoney(summary.outstanding.total)}
              hint={`${formatNumber(summary.outstanding.count)} unpaid invoices`}
              icon={<ClockIcon />}
            />
            <StatCard
              label="Top-ups received"
              value={formatMoney(summary.topups.paid_total)}
              hint={`${formatNumber(summary.topups.paid_count)} wallet top-ups`}
              icon={<TrendingUpIcon />}
            />
            <StatCard
              label="Wallet balances"
              value={formatMoney(summary.wallet_balance_total)}
              hint="All organizations combined"
              icon={<WalletIcon />}
            />
            <StatCard
              label="Active MRR"
              value={formatMoney(summary.mrr_active)}
              hint="Recurring revenue from active subscriptions"
            />
          </>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paid payments per day</CardTitle>
          <CardDescription>
            Aggregated from the admin payments list ({trend.currencies.join(", ") || "—"}),{" "}
            {days}-day window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <AreaChart data={trend.series} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={28}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(value: number) =>
                    new Intl.NumberFormat("id-ID", { notation: "compact" }).format(value)
                  }
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="amount"
                  type="monotone"
                  fill="var(--color-amount)"
                  stroke="var(--color-amount)"
                  fillOpacity={0.25}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
            <CardDescription>Most recent {orders.length} orders.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {orderBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders in range.</p>
            ) : (
              orderBreakdown.map(([status, count]) => (
                <Badge key={status} variant="outline" className="gap-1.5 py-1">
                  <StatusBadge status={status} />
                  <span className="tabular-nums">{count}</span>
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoices by status</CardTitle>
            <CardDescription>Most recent {invoices.length} invoices.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {invoiceBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices in range.</p>
            ) : (
              invoiceBreakdown.map(([status, count]) => (
                <Badge key={status} variant="outline" className="gap-1.5 py-1">
                  <StatusBadge status={status} />
                  <span className="tabular-nums">{count}</span>
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">Amounts shown in {currency}.</p>
    </div>
  )
}
