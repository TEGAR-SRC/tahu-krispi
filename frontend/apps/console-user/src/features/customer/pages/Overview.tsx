// Customer overview: dashboard summary + hourly resource limits with
// Max/Current progress bars + wallet balance + quick links.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  ActivityIcon,
  CircleDollarSignIcon,
  ClockIcon,
  CpuIcon,
  HistoryIcon,
  LifeBuoyIcon,
  ReceiptTextIcon,
  ServerIcon,
  WalletIcon,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { apiGet } from "@/lib/api"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface WalletBalance {
  currency: string
  balance: number
  reserved_balance: number
}

interface DashboardSummary {
  active_instances: number
  pending_instances: number
  monthly_spend: number
  monthly_spend_currency: string
  outstanding_invoices: { count: number; total_due: number }
  wallet_balances: WalletBalance[]
  recent_activity: Array<Record<string, unknown>>
}

interface ResourceLimits {
  effective_max_hourly_instances: number
  effective_max_instance_monthly_cost: number
  currency: string
  usage: { active_hourly_instances: number; estimated_monthly_cost: number }
}

const quickLinks = [
  { to: "/app/instances", title: "Instances", description: "Provision and manage VMs", icon: ServerIcon },
  { to: "/app/wallet", title: "Wallet", description: "Balance, topup & transactions", icon: WalletIcon },
  { to: "/app/backups", title: "Backups", description: "Snapshots and restores", icon: HistoryIcon },
  { to: "/app/tickets", title: "Support", description: "Open or follow a ticket", icon: LifeBuoyIcon },
]

export default function CustomerOverviewPage() {
  const { orgId } = useOrg()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [limits, setLimits] = useState<ResourceLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    Promise.all([
      apiGet<DashboardSummary>("/dashboard/summary", { headers: orgHeaders(orgId) }),
      apiGet<ResourceLimits>("/me/resource-limits"),
    ])
      .then(([summaryRes, limitsRes]) => {
        if (cancelled) return
        setSummary(summaryRes.data)
        setLimits(limitsRes.data)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const wallet = summary?.wallet_balances?.[0]
  const maxInstances = Math.max(limits?.effective_max_hourly_instances ?? 0, 1)
  const usedInstances = limits?.usage.active_hourly_instances ?? 0
  const instancePercent = Math.min(100, (usedInstances / maxInstances) * 100)
  const maxCost = Math.max(limits?.effective_max_instance_monthly_cost ?? 0, 0.01)
  const usedCost = limits?.usage.estimated_monthly_cost ?? 0
  const costPercent = Math.min(100, (usedCost / maxCost) * 100)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your cloud resources, spending and account health at a glance."
      />
      <ErrorBanner error={error} />

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 px-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Active instances"
              value={summary?.active_instances ?? 0}
              hint={`${summary?.pending_instances ?? 0} pending`}
              icon={<ServerIcon />}
            />
            <StatCard
              label="Monthly spend"
              value={formatMoney(summary?.monthly_spend ?? 0, summary?.monthly_spend_currency)}
              hint="Current billing period"
              icon={<CircleDollarSignIcon />}
            />
            <StatCard
              label="Outstanding invoices"
              value={summary?.outstanding_invoices?.count ?? 0}
              hint={formatMoney(summary?.outstanding_invoices?.total_due ?? 0)}
              icon={<ReceiptTextIcon />}
            />
            <StatCard
              label="Wallet balance"
              value={formatMoney(wallet?.balance ?? 0, wallet?.currency)}
              hint={`Reserved ${formatMoney(wallet?.reserved_balance ?? 0, wallet?.currency)}`}
              icon={<WalletIcon />}
            />
          </>
        )}
      </div>

      <div className="grid w-full max-w-full min-w-0 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <CpuIcon /> Instance resource limits
            </CardTitle>
            <CardDescription>Hourly on-demand provisioning quota for your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between text-sm">
                <span>Instances</span>
                <span className="tabular-nums text-muted-foreground">
                  Current {usedInstances} / Max {limits?.effective_max_hourly_instances ?? "—"}
                </span>
              </div>
              <Progress value={instancePercent} />
            </div>
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between text-sm">
                <span>Max instance cost</span>
                <span className="tabular-nums text-muted-foreground">
                  Est. {formatMoney(usedCost, limits?.currency)} /{" "}
                  {formatMoney(limits?.effective_max_instance_monthly_cost ?? 0, limits?.currency)}
                </span>
              </div>
              <Progress value={costPercent} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <ActivityIcon /> Recent activity
            </CardTitle>
            <CardDescription>Latest events across this organization.</CardDescription>
          </CardHeader>
          <CardContent>
            {!loading && (summary?.recent_activity?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {(summary?.recent_activity ?? []).map((item, index) => (
                  <li key={index} className="flex items-start gap-3 text-sm">
                    <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="min-w-0 truncate font-medium">{String(item.description ?? item.action ?? "Event")}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.created_at ? formatDateTime(String(item.created_at)) : ""}
                      </p>
                    </div>
                  </li>
                ))}
                {loading
                  ? Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))
                  : null}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {quickLinks.map((link) => {
          const Icon = link.icon
          return (
            <Link key={link.to} to={link.to} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-start gap-3 px-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                    <Icon />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">{link.title}</p>
                    <p className="min-w-0 truncate text-xs text-muted-foreground">{link.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <Button asChild variant="outline" className="w-fit">
        <Link to="/app/instances">
          <ServerIcon /> Provision a new instance
        </Link>
      </Button>
    </div>
  )
}
