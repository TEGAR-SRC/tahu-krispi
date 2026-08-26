// Affiliate program settings: GET/PUT /admin/affiliate/settings with client
// validation (percents 0–100, non-negative minimum).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPut, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

interface AffiliateSettingsData {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
  updated_at?: string
}

export default function FinanceAffiliateSettingsPage() {
  const [settings, setSettings] = useState<AffiliateSettingsData | null>(null)
  const [commissionPercent, setCommissionPercent] = useState("")
  const [refereeBonusPercent, setRefereeBonusPercent] = useState("")
  const [minInvoiceTotal, setMinInvoiceTotal] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const envelope = await apiGet<AffiliateSettingsData>("/admin/affiliate/settings")
      setSettings(envelope.data)
      setCommissionPercent(String(envelope.data.commission_percent))
      setRefereeBonusPercent(String(envelope.data.referee_bonus_percent))
      setMinInvoiceTotal(String(envelope.data.min_invoice_total))
      setEnabled(Boolean(envelope.data.enabled))
    } catch {
      setLoadError(true)
      setSettings(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const save = useCallback(async () => {
    const commission = Number(commissionPercent)
    const bonus = Number(refereeBonusPercent)
    const minimum = Number(minInvoiceTotal)
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      toast.error("Commission percent must be between 0 and 100")
      return
    }
    if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100) {
      toast.error("Referee bonus percent must be between 0 and 100")
      return
    }
    if (!Number.isFinite(minimum) || minimum < 0) {
      toast.error("Minimum invoice total cannot be negative")
      return
    }
    setSaving(true)
    try {
      await apiPut<AffiliateSettingsData>("/admin/affiliate/settings", {
        commission_percent: commission,
        referee_bonus_percent: bonus,
        min_invoice_total: minimum,
        enabled,
      })
      toast.success("Affiliate settings saved")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }, [commissionPercent, refereeBonusPercent, minInvoiceTotal, enabled, load])

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/finance">Finance</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/finance/affiliate">Affiliate program</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title="Affiliate settings"
        description="Commission applied when an invoice of a referred customer is settled."
      />

      <Card>
        <CardHeader>
          <CardTitle>Program parameters</CardTitle>
          <CardDescription>
            {settings?.updated_at
              ? `Last updated ${new Date(settings.updated_at).toLocaleString()}.`
              : "Changes apply to future settlements immediately."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full max-w-xl" />
          ) : loadError || !settings ? (
            <>
              <ErrorBanner error={new Error("Affiliate settings could not be loaded.")} />
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                Retry
              </Button>
            </>
          ) : (
            <div className="grid max-w-xl gap-3">
              <div className="grid grid-cols-3 items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aff-commission">Commission % *</Label>
                  <Input
                    id="aff-commission"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={commissionPercent}
                    onChange={(event) => setCommissionPercent(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aff-bonus">Referee bonus % *</Label>
                  <Input
                    id="aff-bonus"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={refereeBonusPercent}
                    onChange={(event) => setRefereeBonusPercent(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aff-min">Min invoice total *</Label>
                  <Input
                    id="aff-min"
                    type="number"
                    min="0"
                    step="any"
                    value={minInvoiceTotal}
                    onChange={(event) => setMinInvoiceTotal(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="aff-enabled" className="cursor-pointer">
                  Program enabled
                </Label>
                <Switch id="aff-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
          )}
        </CardContent>
        {!loading && !loadError && settings ? (
          <CardFooter className="justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  )
}
