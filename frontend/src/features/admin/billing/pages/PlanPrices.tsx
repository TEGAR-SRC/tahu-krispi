// Admin plan prices page (route /admin/billing/plans/:planId). Shows the
// plan (resolved client-side from GET /admin/plans — there is no
// single-plan GET) and appends prices via POST
// /admin/plans/:plan_id/prices. The API deliberately has no price listing
// (GET returns 405 and the plan payload carries no price array), so the
// "added this session" table only reflects prices created in this tab.
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { InfoIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
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
import { DetailBreadcrumbs, DetailField } from "./detailShared"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"

interface PlanRow {
  id: string
  product_id: string
  product_code: string
  code: string
  name: string
  description: string
  price_mode: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  additional_hdd_gb: number
  bandwidth_gb: number
  ipv4_count: number
  ipv6_count: number
  backup_slots: number
  snapshot_slots: number
  network_rate_mbps: number
  setup_fee: number
  enabled: boolean
  featured: boolean
  sort_order: number
}

// Full allow-list confirmed against the live backend's validation error.
const BILLING_PERIODS = [
  "hourly",
  "daily",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "biennial",
  "triennial",
  "quinquennial",
  "one_time",
] as const

interface PriceRecord {
  id: string
  billing_period: string
  currency: string
  amount: number
  minimum_charge: number
  provider_cost: number | null
  region_id: string | null
  active_from: string
}

const PAGE_SIZE = 100

export default function PlanPricesPage() {
  const { planId } = useParams()

  const [plan, setPlan] = useState<PlanRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!planId) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<PlanRow[]>("/admin/plans", { query: { page: 1, per_page: PAGE_SIZE } })
        .then((envelope) => {
          if (cancelled) return
          setPlan(envelope.data.find((row) => row.id === planId) ?? null)
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
  }, [planId])

  // ---- Price form ------------------------------------------------------------
  const [currency, setCurrency] = useState("IDR")
  const [billingPeriod, setBillingPeriod] =
    useState<(typeof BILLING_PERIODS)[number]>("monthly")
  const [amount, setAmount] = useState("")
  const [minimumCharge, setMinimumCharge] = useState("")
  const [providerCost, setProviderCost] = useState("")
  const [regionId, setRegionId] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Prices appended during this session (the API offers no read-back).
  const [sessionPrices, setSessionPrices] = useState<PriceRecord[]>([])

  const submitPrice = async () => {
    if (!plan) return
    const normalizedCurrency = currency.trim().toUpperCase()
    const parsedAmount = Number(amount)
    if (normalizedCurrency.length !== 3) {
      setFormError("Currency must be a 3-letter ISO code (e.g. IDR).")
      return
    }
    if (amount.trim() === "" || Number.isNaN(parsedAmount) || parsedAmount < 0) {
      setFormError("Amount is required and must be >= 0.")
      return
    }
    const parsedMinimum = minimumCharge.trim() === "" ? undefined : Number(minimumCharge)
    if (parsedMinimum !== undefined && (Number.isNaN(parsedMinimum) || parsedMinimum < 0)) {
      setFormError("Minimum charge must be a number >= 0.")
      return
    }
    const parsedProviderCost =
      providerCost.trim() === "" ? undefined : Number(providerCost)
    if (
      parsedProviderCost !== undefined &&
      (Number.isNaN(parsedProviderCost) || parsedProviderCost < 0)
    ) {
      setFormError("Provider cost must be a number >= 0.")
      return
    }

    setSaving(true)
    try {
      const envelope = await apiPost<PriceRecord>(`/admin/plans/${plan.id}/prices`, {
        currency: normalizedCurrency,
        billing_period: billingPeriod,
        amount: parsedAmount,
        minimum_charge: parsedMinimum ?? 0,
        provider_cost: parsedProviderCost,
        region_id: regionId.trim() || undefined,
      })
      toast.success(
        `Price added for ${plan.code} (${billingPeriod.replace(/_/g, " ")})`,
      )
      if (envelope.data) {
        setSessionPrices((current) => [envelope.data as PriceRecord, ...current])
      }
      setFormError(null)
      setAmount("")
      setMinimumCharge("")
      setProviderCost("")
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.message : "Failed to add price.",
      )
    } finally {
      setSaving(false)
    }
  }

  const specs = plan
    ? [
        ["vCPU", plan.vcpu || "—"],
        ["RAM", plan.ram_mb ? `${(plan.ram_mb / 1024).toFixed(plan.ram_mb % 1024 === 0 ? 0 : 1)} GB` : "—"],
        ["Disk", plan.disk_gb ? `${plan.disk_gb} GB` : "—"],
        ["Extra HDD", plan.additional_hdd_gb ? `${plan.additional_hdd_gb} GB` : "—"],
        ["Bandwidth", plan.bandwidth_gb ? `${plan.bandwidth_gb} GB` : "—"],
        ["IPv4", plan.ipv4_count || "—"],
        ["IPv6", plan.ipv6_count || "—"],
        ["Backup slots", plan.backup_slots || "—"],
        ["Snapshot slots", plan.snapshot_slots || "—"],
        ["Network", plan.network_rate_mbps ? `${plan.network_rate_mbps} Mbps` : "—"],
      ] as Array<[string, string | number]>
    : []

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Products & Plans", to: "/admin/billing/products-plans" },
          { label: plan ? `Plan ${plan.code}` : (planId ?? "…") },
        ]}
      />

      <PageHeader
        title={plan ? `Plan prices · ${plan.name}` : "Plan prices"}
        description={
          plan ? `${plan.product_code} · ${plan.price_mode} · ${plan.code}` : undefined
        }
      />

      {error ? <ErrorBanner error={error} /> : null}
      {!error && loading ? <Skeleton className="h-32 rounded-xl" /> : null}

      {!loading && !error && !plan ? (
        <ErrorBanner
          error={
            new Error(
              `No plan with id ${planId ?? "(missing)"} in the first ${PAGE_SIZE} plans.`,
            )
          }
        />
      ) : null}

      {plan ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                Plan{" "}
                <StatusBadge status={plan.enabled ? "active" : "disabled"} />
                {plan.featured ? (
                  <StatusBadge status="featured" />
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Code" value={<span className="font-mono text-xs">{plan.code}</span>} />
                <DetailField
                  label="Setup fee"
                  value={formatMoney(plan.setup_fee)}
                />
                <DetailField label="Sort order" value={String(plan.sort_order)} />
                <DetailField label="Product" value={plan.product_code} />
              </div>

              {specs.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-5">
                  {specs.map(([label, value]) => (
                    <div key={label} className="text-sm">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-medium tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add a price</CardTitle>
              <CardDescription>
                Appends a new price version for one billing period. Prices are
                insert-only through this API.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="price-currency">Currency *</Label>
                  <Input
                    id="price-currency"
                    maxLength={3}
                    placeholder="IDR"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price-period">Billing period *</Label>
                  <Select
                    value={billingPeriod}
                    onValueChange={(value) =>
                      setBillingPeriod(value as (typeof BILLING_PERIODS)[number])
                    }
                  >
                    <SelectTrigger id="price-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_PERIODS.map((period) => (
                        <SelectItem key={period} value={period}>
                          {period.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price-amount">Amount *</Label>
                  <Input
                    id="price-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price-minimum">Minimum charge</Label>
                  <Input
                    id="price-minimum"
                    type="number"
                    min="0"
                    step="any"
                    value={minimumCharge}
                    onChange={(event) => setMinimumCharge(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price-provider-cost">Provider cost</Label>
                  <Input
                    id="price-provider-cost"
                    type="number"
                    min="0"
                    step="any"
                    value={providerCost}
                    onChange={(event) => setProviderCost(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price-region">Region ID</Label>
                  <Input
                    id="price-region"
                    placeholder="UUID or blank for global"
                    value={regionId}
                    onChange={(event) => setRegionId(event.target.value)}
                  />
                </div>
              </div>

              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

              <div>
                <Button onClick={() => void submitPrice()} disabled={saving}>
                  <PlusIcon /> {saving ? "Adding…" : "Add price"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Known prices</CardTitle>
              <CardDescription className="flex items-start gap-2">
                <InfoIcon className="mt-0.5 size-4 shrink-0" />
                The API exposes no way to list existing prices (GET on
                /admin/plans/:id/prices answers 405, and the plan payload carries no
                price array), so this table only shows prices added from this page
                during the current session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable
                columns={[
                  { key: "billing_period", header: "Period" },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums",
                    render: (price) => formatMoney(price.amount, price.currency),
                  },
                  {
                    key: "minimum_charge",
                    header: "Min charge",
                    className: "text-right tabular-nums",
                    render: (price) => formatMoney(price.minimum_charge, price.currency),
                  },
                  {
                    key: "provider_cost",
                    header: "Provider cost",
                    className: "text-right tabular-nums",
                    render: (price) =>
                      price.provider_cost != null
                        ? formatMoney(price.provider_cost, price.currency)
                        : "—",
                  },
                  {
                    key: "region_id",
                    header: "Region",
                    render: (price) => price.region_id ?? "global",
                  },
                  {
                    key: "active_from",
                    header: "Active from",
                    render: (price) => formatDateTime(price.active_from),
                  },
                ]}
                rows={sessionPrices}
                getRowKey={(price) => price.id}
                emptyMessage="No prices have been added from this page yet."
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
