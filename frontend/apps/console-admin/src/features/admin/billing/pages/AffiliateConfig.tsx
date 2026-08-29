// Admin affiliate program hub. The working pages live at
// /admin/affiliate/settings (GET/PUT /admin/affiliate/settings) and
// /admin/affiliate/earnings (GET /admin/affiliate/earnings + reversal); this
// page links to both and summarizes the current rules from a live GET.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRightIcon, CoinsIcon, GiftIcon } from "lucide-react"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMoney } from "./shared"

interface AffiliateSettings {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
}

export default function BillingAffiliateConfigPage() {
  const [settings, setSettings] = useState<AffiliateSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<AffiliateSettings>("/admin/affiliate/settings")
      .then((envelope) => {
        if (!cancelled) {
          setSettings(envelope.data)
          setLoading(false)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Affiliate program"
        description="Referral commission rules and payout records."
      />

      {error ? <ErrorBanner error={error} /> : null}

      <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2">
        <Card className="flex min-w-0 flex-col">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <GiftIcon className="size-4 text-muted-foreground" />
              Settings
            </CardTitle>
            <CardDescription>
              Commission percentage, referee bonus, minimum invoice total and
              whether the program is active.
            </CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto justify-between gap-3">
            {loading ? (
              <Skeleton className="h-6 w-48" />
            ) : settings ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="secondary">{settings.commission_percent}% commission</Badge>
                <Badge variant="secondary">{settings.referee_bonus_percent}% referee bonus</Badge>
                <Badge variant="outline">min invoice {formatMoney(settings.min_invoice_total)}</Badge>
                {settings.enabled ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    enabled
                  </Badge>
                ) : (
                  <Badge variant="destructive">disabled</Badge>
                )}
              </div>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/affiliate/settings">
                Manage
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex min-w-0 flex-col">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <CoinsIcon className="size-4 text-muted-foreground" />
              Earnings
            </CardTitle>
            <CardDescription>
              Every referral commission with its status — approved earnings can
              be reversed as a fraud control.
            </CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/affiliate/earnings">
                Browse earnings
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
