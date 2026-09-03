// Admin billing: custom resource rates (per-dimension pricing used by
// custom_resource price quotes). GET /admin/custom-rates lists versions;
// POST /admin/custom-rates appends a new version for a product+dimension.
// The API exposes no update or delete action for rates, so none are offered.
import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface CustomRateRow {
  id: string
  product_id: string
  product_code: string
  dimension_code: string
  currency: string
  billing_period: string
  unit_price: number
  included_quantity: number
  min_quantity: number
  max_quantity?: number | null
  step_quantity: number
  provider_id?: string | null
  region_id?: string | null
  active_from: string
  active_until: string
}

interface ProductOption {
  id: string
  code: string
  name: string
}

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

// Seeded resource_dimensions rows in kilat_cloud_schema_v2.sql; other codes
// work too as long as they exist server-side (errors are surfaced verbatim).
const KNOWN_DIMENSIONS = [
  "vcpu",
  "ram_gb",
  "nvme_gb",
  "hdd_gb",
  "bandwidth_gb",
  "ipv4",
  "ipv6",
  "backup_gb",
  "snapshot_gb",
] as const

interface RateFormState {
  product_id: string
  dimension_code: string
  currency: string
  billing_period: (typeof BILLING_PERIODS)[number]
  unit_price: string
  included_quantity: string
  min_quantity: string
  max_quantity: string
  step_quantity: string
  provider_id: string
  region_id: string
}

const EMPTY_FORM: RateFormState = {
  product_id: "",
  dimension_code: "",
  currency: "IDR",
  billing_period: "monthly",
  unit_price: "",
  included_quantity: "0",
  min_quantity: "0",
  max_quantity: "",
  step_quantity: "1",
  provider_id: "",
  region_id: "",
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

export default function BillingCustomRatesPage() {
  const list = usePagedList<CustomRateRow>("/admin/custom-rates")
  const [products, setProducts] = useState<ProductOption[] | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<RateFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const bulk = useBulkSelection<CustomRateRow>((row) => row.id)

  // Products power the rate form's target selector.
  const loadProducts = () => {
    if (products) return
    apiGet<ProductOption[]>("/admin/products", { query: { per_page: 100 } })
      .then((envelope) => {
        const options = Array.isArray(envelope.data)
          ? envelope.data.map((product) => ({
              id: product.id,
              code: product.code,
              name: product.name,
            }))
          : []
        setProducts(options)
        setForm((current) => ({
          ...current,
          product_id: current.product_id || options[0]?.id || "",
        }))
      })
      .catch(() => setProducts([]))
  }

  const openCreate = () => {
    loadProducts()
    setForm({ ...EMPTY_FORM })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async () => {
    if (!form.product_id) {
      setFormError("Choose the product this rate applies to.")
      return
    }
    const dimension = form.dimension_code.trim().toLowerCase()
    if (!dimension) {
      setFormError("Dimension code is required.")
      return
    }
    const currency = form.currency.trim().toUpperCase()
    if (currency.length !== 3) {
      setFormError("Currency must be a 3-letter ISO code (e.g. IDR).")
      return
    }
    const unitPrice = optionalNumber(form.unit_price)
    if (unitPrice === undefined || unitPrice < 0) {
      setFormError("Unit price is required and must be >= 0.")
      return
    }
    const included = optionalNumber(form.included_quantity) ?? 0
    const minQty = optionalNumber(form.min_quantity) ?? 0
    const stepQty = optionalNumber(form.step_quantity) ?? 1
    const maxQty = optionalNumber(form.max_quantity)
    if (included < 0 || minQty < 0) {
      setFormError("Included/min quantities must be >= 0.")
      return
    }
    if (stepQty <= 0) {
      setFormError("Step quantity must be > 0.")
      return
    }
    if (maxQty !== undefined && maxQty < minQty) {
      setFormError("Max quantity must be >= min quantity.")
      return
    }

    setSaving(true)
    try {
      await apiPost("/admin/custom-rates", {
        product_id: form.product_id,
        dimension_code: dimension,
        currency,
        billing_period: form.billing_period,
        unit_price: unitPrice,
        included_quantity: included,
        min_quantity: minQty,
        max_quantity: maxQty,
        step_quantity: stepQty,
        provider_id: form.provider_id.trim() || undefined,
        region_id: form.region_id.trim() || undefined,
      })
      toast.success(`Rate added for ${dimension}`)
      setFormOpen(false)
      list.reload()
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : "Failed to save rate.")
    } finally {
      setSaving(false)
    }
  }

  const columns: Array<SimpleColumn<CustomRateRow>> = [
    {
      key: "product_code",
      header: "Product",
    },
    { key: "dimension_code", header: "Dimension" },
    {
      key: "unit_price",
      header: "Unit price",
      className: "text-right tabular-nums",
      render: (rate) => `${formatMoney(rate.unit_price, rate.currency)} / ${rate.billing_period}`,
    },
    {
      key: "included_quantity",
      header: "Included",
      className: "text-right tabular-nums",
    },
    {
      key: "min_quantity",
      header: "Min",
      className: "text-right tabular-nums",
    },
    {
      key: "max_quantity",
      header: "Max",
      className: "text-right tabular-nums",
      render: (rate) => rate.max_quantity ?? "—",
    },
    {
      key: "step_quantity",
      header: "Step",
      className: "text-right tabular-nums",
    },
    {
      key: "provider_id",
      header: "Provider",
      render: (rate) => (
        <span className="font-mono text-xs">
          {rate.provider_id ? `${rate.provider_id.slice(0, 8)}…` : "any"}
        </span>
      ),
    },
    {
      key: "region_id",
      header: "Region",
      render: (rate) => (
        <span className="font-mono text-xs">
          {rate.region_id ? `${rate.region_id.slice(0, 8)}…` : "global"}
        </span>
      ),
    },
    {
      key: "active_from",
      header: "Active from",
      render: (rate) => (
        <span className="whitespace-nowrap">{formatDateTime(rate.active_from)}</span>
      ),
    },
    {
      key: "active_until",
      header: "Active until",
      render: (rate) =>
        rate.active_until ? formatDateTime(rate.active_until) : "current",
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Custom Rates"
        description="Per-dimension resource pricing used by custom_resource quotes. Creating a rate appends a new version; the API offers no edit or delete."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon /> New rate
          </Button>
        }
      />

      <BulkActionBar selectedCount={bulk.selectedKeys.size} actions={[]} />

      <SimpleDataTable
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No custom rates yet."
        skeletonRows={6}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setFormOpen(false)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New custom rate</DialogTitle>
            <DialogDescription>
              Appends a new rate version for the chosen product and dimension.
            </DialogDescription>
          </DialogHeader>

          <div className="grid w-full max-w-full min-w-0 gap-4">
            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label>Product *</Label>
                <Select
                  value={form.product_id}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, product_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose product" />
                  </SelectTrigger>
                  <SelectContent>
                    {(products ?? []).map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-dimension">Dimension code *</Label>
                <Input
                  id="rate-dimension"
                  list="known-dimensions"
                  placeholder="vcpu"
                  value={form.dimension_code}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      dimension_code: event.target.value,
                    }))
                  }
                />
                <datalist id="known-dimensions">
                  {KNOWN_DIMENSIONS.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-currency">Currency</Label>
                <Input
                  id="rate-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, currency: event.target.value }))
                  }
                />
              </div>
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label>Billing period</Label>
                <Select
                  value={form.billing_period}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      billing_period: value as RateFormState["billing_period"],
                    }))
                  }
                >
                  <SelectTrigger>
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
            </div>

            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-unit-price">Unit price *</Label>
                <Input
                  id="rate-unit-price"
                  type="number"
                  min="0"
                  step="any"
                  value={form.unit_price}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, unit_price: event.target.value }))
                  }
                />
              </div>
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-included">Included quantity</Label>
                <Input
                  id="rate-included"
                  type="number"
                  min="0"
                  step="any"
                  value={form.included_quantity}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      included_quantity: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-min">Min qty</Label>
                <Input
                  id="rate-min"
                  type="number"
                  min="0"
                  step="any"
                  value={form.min_quantity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, min_quantity: event.target.value }))
                  }
                />
              </div>
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-max">Max qty</Label>
                <Input
                  id="rate-max"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="None"
                  value={form.max_quantity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, max_quantity: event.target.value }))
                  }
                />
              </div>
              <div className="grid w-full max-w-full min-w-0 gap-2">
                <Label htmlFor="rate-step">Step qty</Label>
                <Input
                  id="rate-step"
                  type="number"
                  min="0"
                  step="any"
                  value={form.step_quantity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, step_quantity: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid w-full max-w-full min-w-0 gap-2">
              <Label htmlFor="rate-provider">Provider ID</Label>
              <Input
                id="rate-provider"
                placeholder="UUID or blank for any provider"
                value={form.provider_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, provider_id: event.target.value }))
                }
              />
            </div>

            <div className="grid w-full max-w-full min-w-0 gap-2">
              <Label htmlFor="rate-region">Region ID</Label>
              <Input
                id="rate-region"
                placeholder="UUID or blank for global"
                value={form.region_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, region_id: event.target.value }))
                }
              />
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void submitForm()}>
              {saving ? "Saving…" : "Create rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
