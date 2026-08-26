// Admin billing: affiliate program configuration (GET/PUT
// /admin/affiliate/settings) plus earnings browsing with status filter,
// pagination and reversal (POST /admin/affiliate/earnings/:earning_id/reverse).
// The earnings list doubles as the referrals view: each row links a referrer,
// their referee and the invoice that generated the commission.
import { useEffect, useState } from "react"
import { RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPut, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { StatusBadge, Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface AffiliateSettings {
  commission_percent: number
  referee_bonus_percent: number
  min_invoice_total: number
  enabled: boolean
  updated_at: string
}

interface EarningRow {
  id: string
  referrer_email: string
  referee_email: string
  invoice_number: string
  base_amount: number
  commission_amount: number
  currency: string
  status: string
  paid_at?: string | null
  created_at: string
}

const EARNING_STATUSES = ["approved", "paid", "reversed"] as const

function SettingsForm({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<AffiliateSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [commissionPercent, setCommissionPercent] = useState("")
  const [refereeBonusPercent, setRefereeBonusPercent] = useState("")
  const [minInvoiceTotal, setMinInvoiceTotal] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<AffiliateSettings>("/admin/affiliate/settings")
      .then((envelope) => {
        if (cancelled) return
        setSettings(envelope.data)
        setCommissionPercent(String(envelope.data.commission_percent))
        setRefereeBonusPercent(String(envelope.data.referee_bonus_percent))
        setMinInvoiceTotal(String(envelope.data.min_invoice_total))
        setEnabled(envelope.data.enabled)
        setLoading(false)
      })
      .catch((cause: unknown) => {
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
    const percent = Number(commissionPercent)
    const bonus = Number(refereeBonusPercent)
    const minTotal = Number(minInvoiceTotal)
    if (
      Number.isNaN(percent) ||
      percent < 0 ||
      percent > 100 ||
      Number.isNaN(bonus) ||
      bonus < 0 ||
      bonus > 100
    ) {
      setFormError("Percents must be numbers between 0 and 100.")
      return
    }
    if (Number.isNaN(minTotal) || minTotal < 0) {
      setFormError("Minimum invoice total must be >= 0.")
      return
    }

    setSaving(true)
    try {
      await apiPut<AffiliateSettings>("/admin/affiliate/settings", {
        commission_percent: percent,
        referee_bonus_percent: bonus,
        min_invoice_total: minTotal,
        enabled,
      })
      toast.success("Affiliate settings saved")
      setFormError(null)
      onSaved()
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.message : "Failed to save settings.",
      )
    } finally {
      setSaving(false)
    }
  }

  if (error) return <ErrorBanner error={error} />
  if (loading) return <Skeleton className="h-56 w-full rounded-xl" />

  return (
    <div className="grid gap-4">
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
          <Label htmlFor="affiliate-bonus">Referee bonus %</Label>
          <Input
            id="affiliate-bonus"
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

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Program enabled</span>
          <span className="text-xs text-muted-foreground">
            Last updated {settings ? formatDateTime(settings.updated_at) : "—"}
          </span>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Toggle affiliate program" />
      </div>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <div>
        <Button disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  )
}

export default function BillingAffiliateConfigPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  // Remount the settings form after saves so it re-reads the server state.
  const [settingsVersion, setSettingsVersion] = useState(0)
  const list = usePagedList<EarningRow>(
    "/admin/affiliate/earnings",
    statusFilter === "all" ? {} : { status: statusFilter },
  )
  const [reverseTarget, setReverseTarget] = useState<EarningRow | null>(null)
  const [reversing, setReversing] = useState(false)

  const confirmReverse = async () => {
    if (!reverseTarget) return
    setReversing(true)
    try {
      await apiPost(`/admin/affiliate/earnings/${reverseTarget.id}/reverse`)
      toast.success(`Earning for ${reverseTarget.referrer_email} reversed`)
      setReverseTarget(null)
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to reverse earning.",
      )
    } finally {
      setReversing(false)
    }
  }

  const columns: Array<SimpleColumn<EarningRow>> = [
    {
      key: "referrer_email",
      header: "Referrer",
    },
    {
      key: "referee_email",
      header: "Referred user",
    },
    {
      key: "invoice_number",
      header: "Invoice",
      render: (row) => row.invoice_number || "—",
    },
    {
      key: "base_amount",
      header: "Base amount",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.base_amount, row.currency),
    },
    {
      key: "commission_amount",
      header: "Commission",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.commission_amount, row.currency),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "paid_at",
      header: "Paid at",
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.paid_at ?? null)}</span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (row) =>
        row.status === "approved" ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Reverse earning ${row.id}`}
            onClick={() => setReverseTarget(row)}
          >
            <RotateCcwIcon />
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Affiliate Config"
        description="Program rules and commission payouts."
      />

      <Card>
        <CardHeader>
          <CardTitle>Program settings</CardTitle>
          <CardDescription>
            Commission is credited to the referrer once the referred invoice is
            paid; blank fields keep their current values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm key={settingsVersion} onSaved={() => setSettingsVersion((v) => v + 1)} />
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Earnings & referrals</h2>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EARNING_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SimpleDataTable
          columns={columns}
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          getRowKey={(row) => row.id}
          emptyMessage="No affiliate earnings recorded yet."
          skeletonRows={5}
        />

        <Pager
          page={list.page}
          meta={list.meta}
          onPage={list.setPage}
          disabled={list.loading}
        />
      </section>

      <AlertDialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reversing) setReverseTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this earning?</AlertDialogTitle>
            <AlertDialogDescription>
              {reverseTarget
                ? `The ${formatMoney(reverseTarget.commission_amount, reverseTarget.currency)} commission for ${reverseTarget.referrer_email} will be marked reversed (fraud control). This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reversing}
              onClick={(event) => {
                event.preventDefault()
                void confirmReverse()
              }}
            >
              {reversing ? "Reversing…" : "Reverse earning"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
