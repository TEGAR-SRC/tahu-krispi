// Admin billing: platform-wide finance summary for a selectable lookback
// window (GET /admin/finance/summary?days=N) plus a daily collected-revenue
// chart derived from the most recent paid payments.
import { useEffect, useMemo, useState } from "react"
import {
  BanknoteIcon,
  CalendarClockIcon,
  LandmarkIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { formatMoney } from "./shared"

interface FinanceTotals {
  paid_count: number
  paid_total: number
}

interface FinanceSummaryData {
  period_days: number
  invoices: FinanceTotals
  outstanding: { count: number; total: number }
  topups: FinanceTotals
  wallet_balance_total: number
  mrr_active: number
}

interface AdminPaymentRow {
  public_id: string
  amount: number
  currency: string
  status: string
  paid_at: string
}

const PERIODS = [7, 30, 90, 365]

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Buckets the latest paid payments into per-day revenue over the window. */
function buildDailySeries(
  payments: AdminPaymentRow[],
  days: number,
): Array<{ date: string; collected: number }> {
  const today = new Date()
  const sums = new Map<string, number>()
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today)
    day.setDate(day.getDate() - i)
    sums.set(localDayKey(day), 0)
  }
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)

  for (const payment of payments) {
    if (!payment.paid_at) continue
    const paidAt = new Date(payment.paid_at.replace(" ", "T"))
    if (Number.isNaN(paidAt.getTime()) || paidAt < cutoff) continue
    const key = localDayKey(paidAt)
    if (!sums.has(key)) continue
    sums.set(key, (sums.get(key) ?? 0) + payment.amount)
  }
  return Array.from(sums.entries()).map(([date, collected]) => ({
    date,
    collected,
  }))
}

const chartConfig = {
  collected: { label: "Collected", color: "var(--primary)" },
} satisfies ChartConfig

export default function BillingFinanceSummaryPage() {
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<FinanceSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [paidPayments, setPaidPayments] = useState<AdminPaymentRow[] | null>(null)
  const [chartError, setChartError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<FinanceSummaryData>("/admin/finance/summary", { query: { days } })
        .then((envelope) => {
          if (cancelled) return
          setSummary(envelope.data)
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
  }, [days])

  // The summary endpoint aggregates totals only, so the daily chart is built
  // from the most recent paid payments exposed by the list endpoint.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPaidPayments(null)
      setChartError(null)
      apiGet<AdminPaymentRow[]>("/admin/payments", {
        query: { status: "paid", page: 1, per_page: 100 },
      })
        .then((envelope) => {
          if (cancelled) return
          setPaidPayments(Array.isArray(envelope.data) ? envelope.data : [])
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setChartError(cause)
        })
    })
    return () => {
      cancelled = true
    }
  }, [days])

  const series = useMemo(
    () => buildDailySeries(paidPayments ?? [], days),
    [paidPayments, days],
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Finance Summary"
        description="Platform-wide collections, outstanding invoices and wallet balances."
        actions={
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Last {option} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {error ? <ErrorBanner error={error} /> : null}

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading && !summary ? (
          Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))
        ) : summary ? (
          <>
            <StatCard
              label="Invoices paid"
              value={formatMoney(summary.invoices.paid_total)}
              hint={`${summary.invoices.paid_count} invoice(s) in period`}
              icon={<BanknoteIcon />}
            />
            <StatCard
              label="Outstanding"
              value={formatMoney(summary.outstanding.total)}
              hint={`${summary.outstanding.count} unpaid/overdue invoice(s)`}
              icon={<CalendarClockIcon />}
            />
            <StatCard
              label="Wallet topups"
              value={formatMoney(summary.topups.paid_total)}
              hint={`${summary.topups.paid_count} paid topup(s) in period`}
              icon={<LandmarkIcon />}
            />
            <StatCard
              label="Wallet balance"
              value={formatMoney(summary.wallet_balance_total)}
              hint="All organizations, current"
              icon={<WalletIcon />}
            />
            <StatCard
              label="MRR (active subs)"
              value={formatMoney(summary.mrr_active)}
              hint="Monthly-normalized recurring revenue"
              icon={<TrendingUpIcon />}
            />
          </>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily collected revenue</CardTitle>
          <CardDescription>
            Paid payment amounts per day over the last {days} day(s), built from
            the most recent paid payments exposed by the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartError ? (
            <ErrorBanner error={chartError} />
          ) : paidPayments === null ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={series}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="collected"
                  fill="var(--color-collected)"
                  radius={4}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
