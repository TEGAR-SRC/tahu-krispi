// Affiliate program overview hub: live program status and earnings counters,
// linking to the settings and earnings sub-pages.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  PercentIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UserPlusIcon,
} from "lucide-react"

interface AffiliateSettingsData {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
}

interface EarningTotals {
  all?: number
  pending?: number
  paid?: number
}

export default function FinanceAffiliatePage() {
  const [settings, setSettings] = useState<AffiliateSettingsData | null>(null)
  const [totals, setTotals] = useState<EarningTotals>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    // Settings plus three tiny paged requests whose meta.total gives real
    // ledger counts per status.
    const [settingsRes, allRes, pendingRes, paidRes] = await Promise.allSettled([
      apiGet<AffiliateSettingsData>("/admin/affiliate/settings"),
      apiGet<unknown[]>("/admin/affiliate/earnings", { query: { page: 1, per_page: 1 } }),
      apiGet<unknown[]>("/admin/affiliate/earnings", {
        query: { page: 1, per_page: 1, status: "pending" },
      }),
      apiGet<unknown[]>("/admin/affiliate/earnings", {
        query: { page: 1, per_page: 1, status: "paid" },
      }),
    ])
    if (settingsRes.status === "fulfilled") {
      setSettings(settingsRes.value.data)
      setError(null)
    } else {
      setError(settingsRes.reason)
    }
    const totalOf = (result: PromiseSettledResult<{ data: unknown[]; meta?: unknown }>) =>
      result.status === "fulfilled"
        ? ((result.value.meta as { total?: number } | undefined)?.total ?? result.value.data.length)
        : undefined
    setTotals({ all: totalOf(allRes), pending: totalOf(pendingRes), paid: totalOf(paidRes) })
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Affiliate program"
        description="Referral commission configuration and the resulting earnings ledger."
        actions={
          settings ? (
            settings.enabled ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" variant="outline">
                Program active
              </Badge>
            ) : (
              <Badge variant="outline">Program disabled</Badge>
            )
          ) : null
        }
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {loading && !settings ? (
          Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <PercentIcon className="size-3.5" /> Commission
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {settings ? `${settings.commission_percent}%` : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Referee bonus{" "}
                {settings ? `${settings.referee_bonus_percent}%` : "—"} · min invoice{" "}
                {settings ? new Intl.NumberFormat("id-ID").format(settings.min_invoice_total) : "—"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <UserPlusIcon className="size-3.5" /> Pending commissions
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">{totals.pending ?? "—"}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Awaiting settlement
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <ReceiptTextIcon className="size-3.5" /> Paid commissions
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">{totals.paid ?? "—"}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {totals.all ?? "—"} commission record(s) in total
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Program settings</CardTitle>
            <CardDescription>
              Commission and referee bonus percentages, minimum qualifying invoice total and the
              program on/off switch.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild size="sm">
              <Link to="/finance/affiliate/settings">
                <SettingsIcon /> Manage settings
              </Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Earnings</CardTitle>
            <CardDescription>
              The full commission ledger with status filters and a confirmed reverse action for
              mistaken or abusive payouts.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild size="sm">
              <Link to="/finance/affiliate/earnings">
                <ReceiptTextIcon /> View earnings
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
