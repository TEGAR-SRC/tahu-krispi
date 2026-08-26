// Admin product detail (route /admin/billing/products/:productId). The API
// has no single-product GET — the product is resolved from
// GET /admin/products (client-side find) and edited via
// PATCH /admin/products/:product_id (name/description/sort order/default
// monthly amount/enabled). The code and service kind are immutable here.
// The plan table filters GET /admin/plans client-side because there is no
// per-product plan listing.
import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { DollarSignIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPatch, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  DetailBreadcrumbs,
  DetailField,
} from "./detailShared"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"

interface ProductRow {
  id: string
  code: string
  name: string
  service_kind: string
  description: string
  enabled: boolean
  sort_order: number
  default_monthly_amount: number
  created_at: string
}

interface PlanRow {
  id: string
  product_id: string
  product_code: string
  code: string
  name: string
  price_mode: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  setup_fee: number
  enabled: boolean
  featured: boolean
}

const PAGE_SIZE = 100

export default function BillingProductDetailPage() {
  const { productId } = useParams()

  const [product, setProduct] = useState<ProductRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!productId) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      apiGet<ProductRow[]>("/admin/products", { query: { page: 1, per_page: PAGE_SIZE } })
        .then((envelope) => {
          if (cancelled) return
          setProduct(envelope.data.find((row) => row.id === productId) ?? null)
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
  }, [productId, reloadTick])

  const reload = () => setReloadTick((tick) => tick + 1)

  // ---- Editor state ----------------------------------------------------------
  const [form, setForm] = useState({
    name: "",
    description: "",
    sort_order: "",
    default_monthly_amount: "",
    enabled: true,
  })
  const [formLoadedFor, setFormLoadedFor] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Sync the editor once per loaded product instead of on every keystroke of
  // a refetch.
  useEffect(() => {
    if (!product || formLoadedFor === product.id) return
    setForm({
      name: product.name ?? "",
      description: product.description ?? "",
      sort_order: String(product.sort_order ?? 0),
      default_monthly_amount: String(product.default_monthly_amount ?? 0),
      enabled: product.enabled,
    })
    setFormLoadedFor(product.id)
  }, [product, formLoadedFor])

  // ---- Plans of this product ---------------------------------------------------
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [plansError, setPlansError] = useState<unknown>(null)
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      apiGet<PlanRow[]>("/admin/plans", { query: { page: 1, per_page: PAGE_SIZE } })
        .then((envelope) => {
          if (!cancelled) setPlans(envelope.data)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setPlansError(cause)
        })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ownPlans = useMemo(
    () => (plans ?? []).filter((plan) => plan.product_id === productId),
    [plans, productId],
  )

  const submitPatch = async () => {
    if (!product) return
    const name = form.name.trim()
    if (!name) {
      setFormError("Name is required.")
      return
    }
    const sortOrder = Number(form.sort_order)
    if (form.sort_order.trim() === "" || Number.isNaN(sortOrder)) {
      setFormError("Sort order must be a number.")
      return
    }
    const monthlyAmount = Number(form.default_monthly_amount)
    if (
      form.default_monthly_amount.trim() === "" ||
      Number.isNaN(monthlyAmount) ||
      monthlyAmount < 0
    ) {
      setFormError("Default monthly amount must be a number >= 0.")
      return
    }

    setSaving(true)
    try {
      await apiPatch(`/admin/products/${product.id}`, {
        name,
        description: form.description.trim(),
        sort_order: sortOrder,
        default_monthly_amount: monthlyAmount,
        enabled: form.enabled,
      })
      toast.success(`Product ${product.code} updated`)
      setFormError(null)
      reload()
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.message : "Failed to update product.",
      )
    } finally {
      setSaving(false)
    }
  }

  const planColumns: Array<SimpleColumn<PlanRow>> = [
    {
      key: "code",
      header: "Plan",
      render: (plan) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {plan.name}
            {plan.featured ? (
              <span className="ml-2 align-middle text-xs text-primary">★ featured</span>
            ) : null}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
        </div>
      ),
    },
    { key: "price_mode", header: "Pricing" },
    {
      key: "specs",
      header: "Specs",
      render: (plan) =>
        `${plan.vcpu || "—"} vCPU · ${plan.ram_mb ? `${(plan.ram_mb / 1024).toFixed(plan.ram_mb % 1024 === 0 ? 0 : 1)} GB` : "—"} RAM · ${plan.disk_gb ? `${plan.disk_gb} GB` : "—"}`,
    },
    {
      key: "setup_fee",
      header: "Setup fee",
      className: "text-right tabular-nums",
      render: (plan) => formatMoney(plan.setup_fee),
    },
    {
      key: "enabled",
      header: "Status",
      render: (plan) => <StatusBadge status={plan.enabled ? "active" : "disabled"} />,
    },
    {
      key: "prices",
      header: "",
      className: "w-32 text-right",
      render: (plan) => (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/admin/billing/plans/${plan.id}`}>
            <DollarSignIcon /> Prices
          </Link>
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Products & Plans", to: "/admin/billing/products-plans" },
          { label: product ? product.name : (productId ?? "…") },
        ]}
      />

      <PageHeader
        title={product ? `Product · ${product.name}` : "Product detail"}
        description={product?.description || undefined}
        actions={
          <Button variant="outline" onClick={reload} disabled={loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />

      {error ? <ErrorBanner error={error} /> : null}
      {!error && loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : null}

      {!loading && !error && !product ? (
        <ErrorBanner
          error={
            new Error(
              `No product with id ${productId ?? "(missing)"} in the first ${PAGE_SIZE} products.`,
            )
          }
        />
      ) : null}

      {product ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Identity{" "}
                <StatusBadge status={product.enabled ? "active" : "disabled"} />
              </CardTitle>
              <CardDescription>
                Code and service kind are immutable through the API.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="Code" value={<span className="font-mono text-xs">{product.code}</span>} />
              <DetailField label="Service kind" value={product.service_kind} />
              <DetailField label="Created" value={formatDateTime(product.created_at)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Edit product</CardTitle>
              <CardDescription>PATCH /admin/products/:product_id</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="grid gap-2">
                  <Label htmlFor="product-name">Name *</Label>
                  <Input
                    id="product-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="product-sort">Sort order *</Label>
                  <Input
                    id="product-sort"
                    type="number"
                    step="1"
                    value={form.sort_order}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, sort_order: event.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="product-monthly">Default monthly amount *</Label>
                  <Input
                    id="product-monthly"
                    type="number"
                    min="0"
                    step="any"
                    value={form.default_monthly_amount}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        default_monthly_amount: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch
                    id="product-enabled"
                    checked={form.enabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, enabled: checked }))
                    }
                  />
                  <Label htmlFor="product-enabled">Enabled</Label>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="product-description">Description</Label>
                <Textarea
                  id="product-description"
                  rows={2}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>

              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

              <div>
                <Button onClick={() => void submitPatch()} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plans for this product</CardTitle>
              <CardDescription>
                Filtered client-side from the platform plan list ({ownPlans.length} of{" "}
                {plans?.length ?? "?"} plans).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {plansError ? <ErrorBanner error={plansError} /> : null}
              {!plansError ? (
                <SimpleDataTable
                  columns={planColumns}
                  rows={ownPlans}
                  loading={plans === null}
                  getRowKey={(plan) => plan.id}
                  emptyMessage="No plans reference this product yet."
                  skeletonRows={4}
                />
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
