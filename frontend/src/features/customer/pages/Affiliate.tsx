// Affiliate / referral program: dashboard stats, copyable referral link and
// earnings withdrawal. (A customer-facing per-earning ledger or click log is
// not exposed by the API — only the aggregate stats below exist.)
import { useCallback, useEffect, useState } from "react"
import {
  CopyIcon,
  GiftIcon,
  GlobeIcon,
  HandCoinsIcon,
  MousePointerClickIcon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { formatMoney } from "../format"
import { useOrg } from "../useOrg"

interface AffiliateDashboard {
  referral_code?: string
  referral_link?: string
  total_referrals: number
  current_earnings: number
  total_earned: number
  total_unique_visitors: number
  available_balance: number
}

export default function CustomerAffiliatePage() {
  const { organization } = useOrg()
  const [data, setData] = useState<AffiliateDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: payload } = await apiGet<AffiliateDashboard>("/me/affiliate")
      setData(payload)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const copy = async (value: string | undefined, label: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Clipboard unavailable — copy manually")
    }
  }

  // POST /me/affiliate/code mints the code when missing; safe to call again.
  const ensureCode = async () => {
    setBusy(true)
    try {
      await apiPost("/me/affiliate/code", {}, {})
      toast.success("Referral code ready")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to mint referral code")
    } finally {
      setBusy(false)
    }
  }

  // POST /me/affiliate/withdraw moves ALL approved earnings to the org wallet
  // (the API takes no amount).
  const withdraw = async () => {
    if (!organization?.id) {
      toast.error("No organization selected")
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/affiliate/withdraw", { organization_id: organization.id }, {})
      toast.success("Withdrawal requested — funds move to your organization wallet")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Withdrawal failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Affiliate program"
        description="Share your referral link and earn a share of what your invitees spend."
      />

      <ErrorBanner error={error} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total referrals"
          value={loading ? "…" : (data?.total_referrals ?? 0)}
          hint="Signed-up referred users"
          icon={<UsersIcon />}
        />
        <StatCard
          label="Unique visitors"
          value={loading ? "…" : (data?.total_unique_visitors ?? 0)}
          hint="Tracked link visits"
          icon={<MousePointerClickIcon />}
        />
        <StatCard
          label="Current earnings"
          value={formatMoney(data?.current_earnings ?? 0)}
          hint={`Lifetime ${formatMoney(data?.total_earned ?? 0)}`}
          icon={<GiftIcon />}
        />
        <StatCard
          label="Available to withdraw"
          value={formatMoney(data?.available_balance ?? 0)}
          icon={<HandCoinsIcon />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your referral link</CardTitle>
            <CardDescription>
              Anyone signing up through this link is attributed to your code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref-code">Referral code</Label>
              <div className="flex items-center gap-2">
                <Input id="ref-code" readOnly value={data?.referral_code ?? ""} className="font-mono" />
                <Button
                  variant="outline"
                  size="icon"
                  title="Copy code"
                  onClick={() => void copy(data?.referral_code, "Referral code")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-link">Link</Label>
              <div className="flex items-center gap-2">
                <Input id="ref-link" readOnly value={data?.referral_link ?? ""} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  title="Copy link"
                  onClick={() => void copy(data?.referral_link, "Referral link")}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
            {!data?.referral_code ? (
              <Button variant="outline" onClick={() => void ensureCode()} disabled={busy}>
                <RefreshCwIcon /> Generate code
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Withdraw earnings</CardTitle>
            <CardDescription>
              Moves your available balance into the selected organization's wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wd-org">Organization</Label>
              <Input id="wd-org" readOnly value={organization?.name ?? ""} />
            </div>
            <p className="text-sm text-muted-foreground">
              Withdrawing moves your entire available balance of{" "}
              <strong>{formatMoney(data?.available_balance ?? 0)}</strong> to the organization
              wallet.
            </p>
            <Button onClick={() => void withdraw()} disabled={busy || !data?.available_balance}>
              <GlobeIcon /> Withdraw all earnings
            </Button>
            <p className="text-xs text-muted-foreground">
              Per-referral earnings details and click logs are not part of the public API; only
              the aggregates above are available.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
