// Affiliate program administration: commission settings form (GET/PUT
// /admin/affiliate/settings) plus the earnings ledger with reverse action.
import { useCallback, useEffect, useState } from "react"
import { apiGet, apiPut, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Undo2Icon } from "lucide-react"
import {
  FilterChips,
  formatDateTime,
  formatMoney,
  StatusBadge,
  TablePagination,
} from "../lib"

interface AffiliateSettings {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
  updated_at?: string
}

interface AffiliateEarning {
  id: string
  referrer_user_id: string
  referrer_email: string
  referee_user_id: string
  referee_email: string
  invoice_number: string
  base_amount: string | number
  commission_amount: string | number
  currency: string
  status: string
  paid_at: string
  created_at: string
}

const EARNING_STATUSES = ["pending", "paid", "reversed"] as const

export default function FinanceAffiliatePage() {
  const [settings, setSettings] = useState<AffiliateSettings | null>(null)
  const [commissionPercent, setCommissionPercent] = useState("")
  const [refereeBonusPercent, setRefereeBonusPercent] = useState("")
  const [minInvoiceTotal, setMinInvoiceTotal] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)

  const [earnings, setEarnings] = useState<AffiliateEarning[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [status, setStatus] = useState<(typeof EARNING_STATUSES)[number] | "all">("all")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [reverseTarget, setReverseTarget] = useState<AffiliateEarning | null>(null)
  const [reversing, setReversing] = useState(false)

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const envelope = await apiGet<AffiliateSettings>("/admin/affiliate/settings")
      setSettings(envelope.data)
      setCommissionPercent(String(envelope.data.commission_percent))
      setRefereeBonusPercent(String(envelope.data.referee_bonus_percent))
      setMinInvoiceTotal(String(envelope.data.min_invoice_total))
      setEnabled(Boolean(envelope.data.enabled))
    } catch {
      // Settings card stays empty; earnings table shows its own errors.
      setSettings(null)
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const loadEarnings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AffiliateEarning[]>("/admin/affiliate/earnings", {
        query: { page, per_page: 10, status: status === "all" ? undefined : status },
      })
      setEarnings(envelope.data)
      setMeta(envelope.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadEarnings()
  }, [loadEarnings])

  const saveSettings = useCallback(async () => {
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
    setSavingSettings(true)
    try {
      await apiPut<AffiliateSettings>("/admin/affiliate/settings", {
        commission_percent: commission,
        referee_bonus_percent: bonus,
        min_invoice_total: minimum,
        enabled,
      })
      toast.success("Affiliate settings saved")
      await loadSettings()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save settings")
    } finally {
      setSavingSettings(false)
    }
  }, [commissionPercent, refereeBonusPercent, minInvoiceTotal, enabled, loadSettings])

  const reverseEarning = useCallback(async () => {
    if (!reverseTarget) return
    setReversing(true)
    try {
      await apiPost(`/admin/affiliate/earnings/${reverseTarget.id}/reverse`)
      toast.success(`Commission on ${reverseTarget.invoice_number} reversed`)
      setReverseTarget(null)
      await loadEarnings()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to reverse earning")
    } finally {
      setReversing(false)
    }
  }, [reverseTarget, loadEarnings])

  const columns: Array<SimpleColumn<AffiliateEarning>> = [
    { key: "referrer_email", header: "Referrer" },
    { key: "referee_email", header: "Referred customer" },
    { key: "invoice_number", header: "Invoice" },
    {
      key: "base_amount",
      header: "Base",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.base_amount), row.currency),
    },
    {
      key: "commission_amount",
      header: "Commission",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.commission_amount), row.currency),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "paid_at",
      header: "Paid at",
      render: (row) => formatDateTime(row.paid_at),
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      render: (row) =>
        row.status === "reversed" ? null : (
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setReverseTarget(row)}>
            <Undo2Icon /> Reverse
          </Button>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Affiliate program"
        description="Commission settings and referral earnings."
      />

      <Card>
        <CardHeader>
          <CardTitle>Program settings</CardTitle>
          <CardDescription>
            Applied when an invoice of a referred customer is settled.
            {settings?.updated_at ? ` Last updated ${formatDateTime(settings.updated_at)}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsLoading && !settings ? (
            <p className="text-sm text-muted-foreground">Loading settings…</p>
          ) : settings ? (
            <div className="grid max-w-xl gap-3">
              <div className="grid grid-cols-3 items-center gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aff-commission">Commission %</Label>
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
                  <Label htmlFor="aff-bonus">Referee bonus %</Label>
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
                  <Label htmlFor="aff-min">Min invoice total</Label>
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
          ) : (
            <ErrorBanner error={new Error("Affiliate settings could not be loaded.")} />
          )}
        </CardContent>
        {settings ? (
          <CardFooter className="justify-end">
            <Button onClick={() => void saveSettings()} disabled={savingSettings}>
              {savingSettings ? "Saving…" : "Save settings"}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <FilterChips
        options={EARNING_STATUSES}
        value={status}
        allLabel="All statuses"
        onChange={(next) => {
          setPage(1)
          setStatus(next)
        }}
      />

      {error ? <ErrorBanner error={error} /> : null}

      <SimpleDataTable
        columns={columns}
        rows={earnings}
        loading={loading}
        getRowKey={(row) => row.id}
        emptyMessage="No affiliate earnings recorded for this filter."
      />
      <TablePagination meta={meta} onPageChange={setPage} />

      <AlertDialog open={reverseTarget !== null} onOpenChange={(open) => {
        if (!open) setReverseTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this commission?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMoney(Number(reverseTarget?.commission_amount ?? 0))} earned by{" "}
              {reverseTarget?.referrer_email} on invoice {reverseTarget?.invoice_number} will be
              reversed and deducted from their affiliate balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep commission</AlertDialogCancel>
            <AlertDialogAction
              disabled={reversing}
              onClick={(event) => {
                event.preventDefault()
                void reverseEarning()
              }}
            >
              {reversing ? "Reversing…" : "Reverse"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
