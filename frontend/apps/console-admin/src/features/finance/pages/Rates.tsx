// Custom resource rates: all rates from GET /admin/custom-rates grouped by
// product, each row carrying its own validity window ("version"), plus a
// create dialog for POST /admin/custom-rates.
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PlusIcon } from "lucide-react"
import { TablePagination } from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"

interface CustomRate {
  id: string
  product_id: string
  product_code: string
  dimension_code: string
  currency: string
  billing_period: string
  unit_price: string | number
  included_quantity: number
  min_quantity: number | null
  max_quantity: number | null
  step_quantity: number
  region_id: string | null
  active_from: string
  active_until: string
}

interface Product {
  id: string
  code: string
  name: string
  enabled: boolean
}

interface Region {
  id: string
  code: string
  name: string
  enabled: boolean
}

const PER_PAGE = 100

const DIMENSION_CODES = [
  "vcpu",
  "ram_gb",
  "nvme_gb",
  "hdd_gb",
  "bandwidth_gb",
  "ipv4",
  "ipv6",
  "backup_gb",
  "snapshot_gb",
]

// Exact enum accepted by POST /admin/custom-rates (same as plan prices).
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

function toNumberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

export default function FinanceRatesPage() {
  const [rates, setRates] = useState<CustomRate[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ratesRes, productsRes, regionsRes] = await Promise.all([
        apiGet<CustomRate[]>("/admin/custom-rates", { query: { page, per_page: PER_PAGE } }),
        apiGet<Product[]>("/admin/products"),
        apiGet<Region[]>("/admin/regions"),
      ])
      setRates(
        [...ratesRes.data].sort(
          (a, b) =>
            a.product_code.localeCompare(b.product_code) ||
            a.dimension_code.localeCompare(b.dimension_code),
        ),
      )
      setProducts(productsRes.data)
      setRegions(regionsRes.data)
      setMeta(ratesRes.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  // Rates grouped by product code; within a product, sorted by dimension.
  const groups = useMemo(() => {
    const byProduct = new Map<string, CustomRate[]>()
    for (const rate of rates) {
      const bucket = byProduct.get(rate.product_code)
      if (bucket) bucket.push(rate)
      else byProduct.set(rate.product_code, [rate])
    }
    return [...byProduct.entries()]
  }, [rates])

  const regionName = useMemo(() => {
    const names = new Map(regions.map((region) => [region.id, region.name]))
    return (id: string | null) => (id ? (names.get(id) ?? id.slice(0, 8)) : null)
  }, [regions])

  const columnsFor = (): Array<SimpleColumn<CustomRate>> => [
    {
      key: "dimension_code",
      header: "Dimension",
      render: (row) => <span className="font-mono">{row.dimension_code}</span>,
    },
    {
      key: "unit_price",
      header: "Unit price",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.unit_price), row.currency),
    },
    { key: "billing_period", header: "Period" },
    {
      key: "bounds",
      header: "Bounds",
      render: (row) => {
        const parts: string[] = []
        if (row.included_quantity) parts.push(`incl ${row.included_quantity}`)
        if (row.min_quantity) parts.push(`min ${row.min_quantity}`)
        if (row.max_quantity) parts.push(`max ${row.max_quantity}`)
        if (row.step_quantity > 1) parts.push(`step ${row.step_quantity}`)
        return parts.length > 0 ? parts.join(" · ") : "—"
      },
    },
    {
      key: "region_id",
      header: "Region",
      render: (row) => regionName(row.region_id) ?? "All regions",
    },
    {
      key: "active_from",
      header: "Active from",
      render: (row) => formatDateTime(row.active_from),
    },
    {
      key: "active_until",
      header: "Valid until",
      render: (row) => (row.active_until ? formatDateTime(row.active_until) : "Indefinite"),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Custom rates"
        description="Per-dimension resource pricing used by custom_resource quotes. Each row is one rate version with its own validity window."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New rate
          </Button>
        }
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : loading ? (
        <Skeleton className="h-72 w-full" />
      ) : rates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No custom rates configured yet. Create the first rate to enable custom_resource
            pricing.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([productCode, productRates]) => (
            <section key={productCode} className="space-y-3">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                {productCode}
                <span className="font-normal text-muted-foreground">
                  ({productRates.length} rate{productRates.length === 1 ? "" : "s"})
                </span>
              </h3>
              <SimpleDataTable
                columns={columnsFor()}
                rows={productRates}
                getRowKey={(row) => row.id}
                emptyMessage="No rates."
              />
            </section>
          ))}
          <TablePagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      <RateCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        products={products}
        regions={regions}
        onCreated={load}
      />
    </div>
  )
}

function RateCreateDialog({
  open,
  onOpenChange,
  products,
  regions,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  regions: Region[]
  onCreated: () => Promise<void>
}) {
  const [productId, setProductId] = useState("")
  const [dimensionCode, setDimensionCode] = useState("")
  const [currency, setCurrency] = useState("IDR")
  const [period, setPeriod] = useState("monthly")
  const [unitPrice, setUnitPrice] = useState("")
  const [includedQuantity, setIncludedQuantity] = useState("0")
  const [minQuantity, setMinQuantity] = useState("")
  const [maxQuantity, setMaxQuantity] = useState("")
  const [stepQuantity, setStepQuantity] = useState("1")
  const [regionId, setRegionId] = useState("none")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!productId) {
      setFormError("Choose the product this rate applies to")
      return
    }
    if (!dimensionCode.trim()) {
      setFormError("Dimension code is required")
      return
    }
    const numericPrice = Number(unitPrice)
    if (!unitPrice || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setFormError("Unit price must be greater than zero")
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await apiPost("/admin/custom-rates", {
        product_id: productId,
        dimension_code: dimensionCode.trim(),
        currency: currency.trim().toUpperCase(),
        billing_period: period,
        unit_price: numericPrice,
        included_quantity: Number(includedQuantity) || 0,
        min_quantity: toNumberOrUndefined(minQuantity),
        max_quantity: toNumberOrUndefined(maxQuantity),
        step_quantity: Number(stepQuantity) || 1,
        ...(regionId !== "none" ? { region_id: regionId } : {}),
      })
      toast.success(`Rate for ${dimensionCode.trim()} created`)
      onOpenChange(false)
      setDimensionCode("")
      setUnitPrice("")
      await onCreated()
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to create rate",
      )
    } finally {
      setSaving(false)
    }
  }

  const numField = (
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    min = "0",
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        step="any"
        value={value}
        onChange={(event) => setter(event.target.value)}
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New custom rate</DialogTitle>
          <DialogDescription>Priced per unit of a resource dimension.</DialogDescription>
        </DialogHeader>
        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm break-all text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Product *</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({product.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="rate-dimension">Dimension code *</Label>
            <Input
              id="rate-dimension"
              list="finance-rate-dimension-codes"
              value={dimensionCode}
              onChange={(event) => setDimensionCode(event.target.value)}
              placeholder="vcpu, ram_gb, nvme_gb…"
              className="font-mono"
            />
            <datalist id="finance-rate-dimension-codes">
              {DIMENSION_CODES.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-price">Unit price *</Label>
            <Input
              id="rate-price"
              type="number"
              min="0"
              step="any"
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              placeholder="e.g. 35000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-currency">Currency *</Label>
            <Input
              id="rate-currency"
              value={currency}
              maxLength={3}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Billing period *</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_PERIODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {numField("rate-included", "Included quantity", includedQuantity, setIncludedQuantity)}
          {numField("rate-min", "Min quantity (optional)", minQuantity, setMinQuantity)}
          {numField("rate-max", "Max quantity (optional)", maxQuantity, setMaxQuantity)}
          {numField("rate-step", "Step quantity", stepQuantity, setStepQuantity)}
          <div className="col-span-2 space-y-1.5">
            <Label>Region (optional)</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All regions</SelectItem>
                {regions
                  .filter((region) => region.enabled)
                  .map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Creating…" : "Create rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
