// Admin affiliate program settings: commission rules via
// GET/PUT /admin/affiliate/settings. Percent fields must stay within 0–100;
// the backend keeps any omitted field at its current value, so the form sends
// all four fields together.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { formatDateTime } from "../format"

interface AffiliateSettings {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
  updated_at?: string
}

export default function AffiliateSettingsPage() {
  const [settings, setSettings] = useState<AffiliateSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [commissionPercent, setCommissionPercent] = useState("")
  const [refereeBonusPercent, setRefereeBonusPercent] = useState("")
  const [minInvoiceTotal, setMinInvoiceTotal] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<AffiliateSettings>("/admin/affiliate/settings")
      .then((envelope) => {
        if (cancelled) return
        const data = envelope.data
        setSettings(data)
        setCommissionPercent(String(data.commission_percent))
        setRefereeBonusPercent(String(data.referee_bonus_percent))
        setMinInvoiceTotal(String(data.min_invoice_total))
        setEnabled(data.enabled)
        setLoading(false)
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

  const submit = async () => {
    const commission = Number(commissionPercent)
    const bonus = Number(refereeBonusPercent)
    const minTotal = Number(minInvoiceTotal)
    if (
      !Number.isFinite(commission) ||
      commission < 0 ||
      commission > 100 ||
      !Number.isFinite(bonus) ||
      bonus < 0 ||
      bonus > 100
    ) {
      setValidationError("Commission and referee bonus must be numbers between 0 and 100.")
      return
    }
    if (!Number.isFinite(minTotal) || minTotal < 0) {
      setValidationError("Minimum invoice total must be a number >= 0.")
      return
    }

    setSaving(true)
    setValidationError(null)
    try {
      const envelope = await apiPut<AffiliateSettings>("/admin/affiliate/settings", {
        commission_percent: commission,
        referee_bonus_percent: bonus,
        min_invoice_total: minTotal,
        enabled,
      })
      setSettings(envelope.data)
      // Normalize the fields against what the server actually stored.
      setCommissionPercent(String(envelope.data.commission_percent))
      setRefereeBonusPercent(String(envelope.data.referee_bonus_percent))
      setMinInvoiceTotal(String(envelope.data.min_invoice_total))
      setEnabled(envelope.data.enabled)
      toast.success("Affiliate settings saved")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/billing/affiliate-config">Affiliate program</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardHeader>
          <CardTitle>Affiliate settings</CardTitle>
          <CardDescription>
            Commission and referral-bonus percentages plus the minimum invoice
            total that qualifies for a commission. Changes apply to future
            earnings immediately.
            {settings?.updated_at
              ? ` Last updated ${formatDateTime(settings.updated_at)}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <ErrorBanner error={error} />
          ) : loading ? (
            <Skeleton className="h-56 w-full rounded-xl" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="affiliate-commission">Commission %</Label>
                  <Input
                    id="affiliate-commission"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={commissionPercent}
                    onChange={(event) => setCommissionPercent(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="affiliate-referee-bonus">Referee bonus %</Label>
                  <Input
                    id="affiliate-referee-bonus"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={refereeBonusPercent}
                    onChange={(event) => setRefereeBonusPercent(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="affiliate-min-invoice">Min invoice total</Label>
                  <Input
                    id="affiliate-min-invoice"
                    type="number"
                    min="0"
                    step="any"
                    value={minInvoiceTotal}
                    onChange={(event) => setMinInvoiceTotal(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <div className="space-y-0.5">
                  <Label htmlFor="affiliate-enabled">Program enabled</Label>
                  <p className="text-xs text-muted-foreground">
                    When off, new referrals earn nothing until re-enabled.
                  </p>
                </div>
                <Switch
                  id="affiliate-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>

              {validationError ? (
                <p className="text-sm text-destructive">{validationError}</p>
              ) : null}

              <div>
                <Button disabled={saving} onClick={() => void submit()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
