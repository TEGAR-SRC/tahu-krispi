// Admin billing: catalog hierarchy management. Products (POST upserts by
// code, PATCH updates default_monthly_amount/enabled/description), plans
// (POST /admin/plans, requires a product) and plan prices (POST
// /admin/plans/:plan_id/prices — insert-only; the API exposes no price or
// plan listing beyond the two list endpoints and no edit/delete actions).
import { useState } from "react"
import { DollarSignIcon, PencilIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { apiPost, apiPatch, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
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
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge, Pager, formatMoney, usePagedList } from "./shared"

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
  description: string
  price_mode: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  bandwidth_gb: number
  ipv4_count: number
  setup_fee: number
  enabled: boolean
  featured: boolean
  sort_order: number
}

// Backend allow-lists (handlers_admin_users.go).
const SERVICE_KINDS = [
  "vm",
  "object_storage",
  "bare_metal",
  "block_storage",
  "database",
  "kubernetes",
  "hosting",
  "domain",
  "other",
] as const

const PRICE_MODES = ["fixed_plan", "custom_resource", "manual_quote"] as const

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

// ---- Product form ----------------------------------------------------------

interface ProductFormState {
  code: string
  name: string
  service_kind: (typeof SERVICE_KINDS)[number]
  description: string
  sort_order: string
  default_monthly_amount: string
  enabled: boolean
}

const EMPTY_PRODUCT: ProductFormState = {
  code: "",
  name: "",
  service_kind: "vm",
  description: "",
  sort_order: "10",
  default_monthly_amount: "0",
  enabled: true,
}

function productFormFrom(row: ProductRow): ProductFormState {
  return {
    code: row.code,
    name: row.name,
    service_kind:
      (SERVICE_KINDS as readonly string[]).includes(row.service_kind)
        ? (row.service_kind as ProductFormState["service_kind"])
        : "other",
    description: row.description ?? "",
    sort_order: String(row.sort_order ?? 0),
    default_monthly_amount: String(row.default_monthly_amount ?? 0),
    enabled: row.enabled,
  }
}

// ---- Plan form -------------------------------------------------------------

interface PlanFormState {
  product_id: string
  code: string
  name: string
  price_mode: (typeof PRICE_MODES)[number]
  description: string
  vcpu: string
  ram_mb: string
  disk_gb: string
  bandwidth_gb: string
  ipv4_count: string
  backup_slots: string
  snapshot_slots: string
  network_rate_mbps: string
  setup_fee: string
  sort_order: string
  featured: boolean
  enabled: boolean
}

const EMPTY_PLAN: PlanFormState = {
  product_id: "",
  code: "",
  name: "",
  price_mode: "fixed_plan",
  description: "",
  vcpu: "",
  ram_mb: "",
  disk_gb: "",
  bandwidth_gb: "",
  ipv4_count: "",
  backup_slots: "",
  snapshot_slots: "",
  network_rate_mbps: "",
  setup_fee: "0",
  sort_order: "10",
  featured: false,
  enabled: true,
}

// ---- Price form ------------------------------------------------------------

interface PriceFormState {
  currency: string
  billing_period: (typeof BILLING_PERIODS)[number]
  amount: string
  provider_cost: string
  minimum_charge: string
  region_id: string
}

const EMPTY_PRICE: PriceFormState = {
  currency: "IDR",
  billing_period: "monthly",
  amount: "",
  provider_cost: "",
  minimum_charge: "",
  region_id: "",
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

export default function BillingProductsPlansPage() {
  const productTab = usePagedList<ProductRow>("/admin/products")
  const planTab = usePagedList<PlanRow>("/admin/plans")

  // Product dialog state
  const [productOpen, setProductOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null)
  const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT)
  const [productError, setProductError] = useState<string | null>(null)
  const [savingProduct, setSavingProduct] = useState(false)

  // Plan dialog state
  const [planOpen, setPlanOpen] = useState(false)
  const [planForm, setPlanForm] = useState<PlanFormState>(EMPTY_PLAN)
  const [planError, setPlanError] = useState<string | null>(null)
  const [savingPlan, setSavingPlan] = useState(false)

  // Price dialog state
  const [priceTarget, setPriceTarget] = useState<PlanRow | null>(null)
  const [priceForm, setPriceForm] = useState<PriceFormState>(EMPTY_PRICE)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [savingPrice, setSavingPrice] = useState(false)

  const openProductCreate = () => {
    setEditingProduct(null)
    setProductForm(EMPTY_PRODUCT)
    setProductError(null)
    setProductOpen(true)
  }

  const openProductEdit = (product: ProductRow) => {
    setEditingProduct(product)
    setProductForm(productFormFrom(product))
    setProductError(null)
    setProductOpen(true)
  }

  const submitProduct = async () => {
    const code = productForm.code.trim()
    const name = productForm.name.trim()
    if (!code || !name) {
      setProductError("Code and name are required.")
      return
    }
    const sortOrder = Number(productForm.sort_order)
    if (Number.isNaN(sortOrder)) {
      setProductError("Sort order must be a number.")
      return
    }
    const monthlyAmount = optionalNumber(productForm.default_monthly_amount) ?? 0
    if (monthlyAmount < 0) {
      setProductError("Default monthly amount must be >= 0.")
      return
    }

    setSavingProduct(true)
    try {
      const saved = await apiPost<ProductRow>("/admin/products", {
        code,
        name,
        service_kind: productForm.service_kind,
        description: productForm.description.trim(),
        sort_order: sortOrder,
        enabled: productForm.enabled,
      })
      // default_monthly_amount is only writable via PATCH.
      const needsMonthlyPatch = editingProduct
        ? editingProduct.default_monthly_amount !== monthlyAmount
        : monthlyAmount !== 0
      if (needsMonthlyPatch && saved.data?.id) {
        await apiPatch(`/admin/products/${saved.data.id}`, {
          default_monthly_amount: monthlyAmount,
        })
      }
      toast.success(editingProduct ? `Product ${code} updated` : `Product ${code} created`)
      setProductOpen(false)
      productTab.reload()
      planTab.reload()
    } catch (cause) {
      setProductError(
        cause instanceof ApiError ? cause.message : "Failed to save product.",
      )
    } finally {
      setSavingProduct(false)
    }
  }

  const submitPlan = async () => {
    const code = planForm.code.trim()
    const name = planForm.name.trim()
    if (!planForm.product_id) {
      setPlanError("Choose a product for this plan.")
      return
    }
    if (!code || !name) {
      setPlanError("Code and name are required.")
      return
    }
    const setupFee = optionalNumber(planForm.setup_fee) ?? 0
    if (setupFee < 0) {
      setPlanError("Setup fee must be >= 0.")
      return
    }

    setSavingPlan(true)
    try {
      await apiPost("/admin/plans", {
        product_id: planForm.product_id,
        code,
        name,
        description: planForm.description.trim(),
        price_mode: planForm.price_mode,
        enabled: planForm.enabled,
        featured: planForm.featured,
        sort_order: Number(planForm.sort_order) || 0,
        setup_fee: setupFee,
        vcpu: optionalNumber(planForm.vcpu),
        ram_mb: optionalNumber(planForm.ram_mb),
        disk_gb: optionalNumber(planForm.disk_gb),
        bandwidth_gb: optionalNumber(planForm.bandwidth_gb),
        ipv4_count: optionalNumber(planForm.ipv4_count) ?? 0,
        backup_slots: optionalNumber(planForm.backup_slots) ?? 0,
        snapshot_slots: optionalNumber(planForm.snapshot_slots) ?? 0,
        network_rate_mbps: optionalNumber(planForm.network_rate_mbps),
      })
      toast.success(`Plan ${code} saved`)
      setPlanOpen(false)
      planTab.reload()
    } catch (cause) {
      setPlanError(cause instanceof ApiError ? cause.message : "Failed to save plan.")
    } finally {
      setSavingPlan(false)
    }
  }

  const submitPrice = async () => {
    if (!priceTarget) return
    const currency = priceForm.currency.trim().toUpperCase()
    const amount = optionalNumber(priceForm.amount)
    if (currency.length !== 3) {
      setPriceError("Currency must be a 3-letter ISO code (e.g. IDR).")
      return
    }
    if (amount === undefined || amount < 0) {
      setPriceError("Amount is required and must be >= 0.")
      return
    }
    const providerCost = optionalNumber(priceForm.provider_cost)
    if (providerCost !== undefined && providerCost < 0) {
      setPriceError("Provider cost must be >= 0.")
      return
    }
    const minimumCharge = optionalNumber(priceForm.minimum_charge)
    if (minimumCharge !== undefined && minimumCharge < 0) {
      setPriceError("Minimum charge must be >= 0.")
      return
    }

    setSavingPrice(true)
    try {
      await apiPost(`/admin/plans/${priceTarget.id}/prices`, {
        currency,
        billing_period: priceForm.billing_period,
        amount,
        provider_cost: providerCost,
        minimum_charge: minimumCharge ?? 0,
        region_id: priceForm.region_id.trim() || undefined,
      })
      toast.success(`Price added for ${priceTarget.code} (${priceForm.billing_period})`)
      setPriceTarget(null)
    } catch (cause) {
      setPriceError(
        cause instanceof ApiError ? cause.message : "Failed to add price.",
      )
    } finally {
      setSavingPrice(false)
    }
  }

  const productColumns: Array<SimpleColumn<ProductRow>> = [
    {
      key: "code",
      header: "Product",
      render: (product) => (
        <div className="flex flex-col">
          <span className="font-medium">{product.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{product.code}</span>
        </div>
      ),
    },
    { key: "service_kind", header: "Kind" },
    {
      key: "default_monthly_amount",
      header: "Default monthly",
      className: "text-right tabular-nums",
      render: (product) => formatMoney(product.default_monthly_amount),
    },
    { key: "sort_order", header: "Sort", className: "text-right tabular-nums" },
    {
      key: "enabled",
      header: "Status",
      render: (product) => (
        <StatusBadge status={product.enabled ? "active" : "disabled"} />
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (product) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${product.code}`}
          onClick={() => openProductEdit(product)}
        >
          <PencilIcon />
        </Button>
      ),
    },
  ]

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
    { key: "product_code", header: "Product" },
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
      key: "actions",
      header: "",
      className: "w-32 text-right",
      render: (plan) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPriceForm({ ...EMPTY_PRICE })
            setPriceError(null)
            setPriceTarget(plan)
          }}
        >
          <DollarSignIcon /> Add price
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products & Plans"
        description="Catalog hierarchy: products own plans, plans own per-period prices."
      />

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4 flex flex-col gap-4">
          <div className="flex justify-end">
            <Button onClick={openProductCreate}>
              <PlusIcon /> New product
            </Button>
          </div>
          <SimpleDataTable
            columns={productColumns}
            rows={productTab.rows}
            loading={productTab.loading}
            error={productTab.error}
            getRowKey={(product) => product.id}
            emptyMessage="No products yet."
            skeletonRows={5}
          />
          <Pager
            page={productTab.page}
            meta={productTab.meta}
            onPage={productTab.setPage}
            disabled={productTab.loading}
          />
        </TabsContent>

        <TabsContent value="plans" className="mt-4 flex flex-col gap-4">
          <div className="flex justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              Plans are upsert-only via the API; existing prices cannot be listed,
              only new prices can be appended per billing period.
            </p>
            <Button
              onClick={() => {
                setPlanForm({
                  ...EMPTY_PLAN,
                  product_id: productTab.rows[0]?.id ?? "",
                })
                setPlanError(null)
                setPlanOpen(true)
              }}
            >
              <PlusIcon /> New plan
            </Button>
          </div>
          <SimpleDataTable
            columns={planColumns}
            rows={planTab.rows}
            loading={planTab.loading}
            error={planTab.error}
            getRowKey={(plan) => plan.id}
            emptyMessage="No plans yet."
            skeletonRows={5}
          />
          <Pager
            page={planTab.page}
            meta={planTab.meta}
            onPage={planTab.setPage}
            disabled={planTab.loading}
          />
        </TabsContent>
      </Tabs>

      {/* Product create/edit */}
      <Dialog
        open={productOpen}
        onOpenChange={(open) => {
          if (!open && !savingProduct) setProductOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? `Edit ${editingProduct.code}` : "New product"}
            </DialogTitle>
            <DialogDescription>
              Saving with an existing code updates that product.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="product-code">Code *</Label>
                <Input
                  id="product-code"
                  value={productForm.code}
                  disabled={Boolean(editingProduct)}
                  onChange={(event) =>
                    setProductForm((current) => ({ ...current, code: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-name">Name *</Label>
                <Input
                  id="product-name"
                  value={productForm.name}
                  onChange={(event) =>
                    setProductForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="product-kind">Service kind</Label>
                <Select
                  value={productForm.service_kind}
                  onValueChange={(value) =>
                    setProductForm((current) => ({
                      ...current,
                      service_kind: value as ProductFormState["service_kind"],
                    }))
                  }
                >
                  <SelectTrigger id="product-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kind.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-sort">Sort order</Label>
                <Input
                  id="product-sort"
                  type="number"
                  step="1"
                  value={productForm.sort_order}
                  onChange={(event) =>
                    setProductForm((current) => ({
                      ...current,
                      sort_order: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-[3fr_2fr] items-end gap-3">
              <div className="grid gap-2">
                <Label htmlFor="product-monthly">Default monthly amount</Label>
                <Input
                  id="product-monthly"
                  type="number"
                  min="0"
                  step="any"
                  value={productForm.default_monthly_amount}
                  onChange={(event) =>
                    setProductForm((current) => ({
                      ...current,
                      default_monthly_amount: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex h-9 items-center gap-2 pb-1">
                <Switch
                  id="product-enabled"
                  checked={productForm.enabled}
                  onCheckedChange={(checked) =>
                    setProductForm((current) => ({ ...current, enabled: checked }))
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
                value={productForm.description}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>

            {productError ? (
              <p className="text-sm text-destructive">{productError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={savingProduct} onClick={() => setProductOpen(false)}>
              Cancel
            </Button>
            <Button disabled={savingProduct} onClick={() => void submitProduct()}>
              {savingProduct ? "Saving…" : "Save product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan create */}
      <Dialog
        open={planOpen}
        onOpenChange={(open) => {
          if (!open && !savingPlan) setPlanOpen(false)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New plan</DialogTitle>
            <DialogDescription>
              Spec fields are optional; blank values stay unset server-side.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Product *</Label>
                <Select
                  value={planForm.product_id}
                  onValueChange={(value) =>
                    setPlanForm((current) => ({ ...current, product_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose product" />
                  </SelectTrigger>
                  <SelectContent>
                    {productTab.rows.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {productTab.rows.length === 0 && !productTab.loading ? (
                  <p className="text-xs text-destructive">
                    Create a product first — plans must reference one.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="plan-mode">Price mode</Label>
                <Select
                  value={planForm.price_mode}
                  onValueChange={(value) =>
                    setPlanForm((current) => ({
                      ...current,
                      price_mode: value as PlanFormState["price_mode"],
                    }))
                  }
                >
                  <SelectTrigger id="plan-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {mode.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="plan-code">Code *</Label>
                <Input
                  id="plan-code"
                  value={planForm.code}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, code: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="plan-name">Name *</Label>
                <Input
                  id="plan-name"
                  value={planForm.name}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="plan-description">Description</Label>
              <Textarea
                id="plan-description"
                rows={2}
                value={planForm.description}
                onChange={(event) =>
                  setPlanForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>

            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Specs (optional)</legend>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["vcpu", "vCPU"],
                    ["ram_mb", "RAM (MB)"],
                    ["disk_gb", "Disk (GB)"],
                    ["bandwidth_gb", "Bandwidth (GB)"],
                    ["ipv4_count", "IPv4 count"],
                    ["backup_slots", "Backup slots"],
                    ["snapshot_slots", "Snapshot slots"],
                    ["network_rate_mbps", "Network Mbps"],
                  ] as Array<[keyof PlanFormState, string]>
                ).map(([key, label]) => (
                  <div key={key} className="grid gap-1">
                    <Label htmlFor={`plan-${key}`} className="text-xs text-muted-foreground">
                      {label}
                    </Label>
                    <Input
                      id={`plan-${key}`}
                      type="number"
                      min="0"
                      step="any"
                      value={String(planForm[key] ?? "")}
                      onChange={(event) =>
                        setPlanForm((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="plan-setup-fee">Setup fee</Label>
                <Input
                  id="plan-setup-fee"
                  type="number"
                  min="0"
                  step="any"
                  value={planForm.setup_fee}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, setup_fee: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="plan-sort">Sort order</Label>
                <Input
                  id="plan-sort"
                  type="number"
                  step="1"
                  value={planForm.sort_order}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, sort_order: event.target.value }))
                  }
                />
              </div>
              <div className="flex h-9 items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={planForm.enabled}
                    onCheckedChange={(checked) =>
                      setPlanForm((current) => ({ ...current, enabled: checked }))
                    }
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={planForm.featured}
                    onCheckedChange={(checked) =>
                      setPlanForm((current) => ({ ...current, featured: checked }))
                    }
                  />
                  Featured
                </label>
              </div>
            </div>

            {planError ? <p className="text-sm text-destructive">{planError}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={savingPlan} onClick={() => setPlanOpen(false)}>
              Cancel
            </Button>
            <Button disabled={savingPlan} onClick={() => void submitPlan()}>
              {savingPlan ? "Saving…" : "Save plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price create for a plan */}
      <Dialog
        open={priceTarget !== null}
        onOpenChange={(open) => {
          if (!open && !savingPrice) setPriceTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add price</DialogTitle>
            <DialogDescription>
              {priceTarget
                ? `Appends a new price version for ${priceTarget.code} (${priceTarget.product_code}). Existing prices are not listable via the API.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="price-currency">Currency *</Label>
                <Input
                  id="price-currency"
                  maxLength={3}
                  value={priceForm.currency}
                  onChange={(event) =>
                    setPriceForm((current) => ({ ...current, currency: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Billing period</Label>
                <Select
                  value={priceForm.billing_period}
                  onValueChange={(value) =>
                    setPriceForm((current) => ({
                      ...current,
                      billing_period: value as PriceFormState["billing_period"],
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

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="price-amount">Amount *</Label>
                <Input
                  id="price-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={priceForm.amount}
                  onChange={(event) =>
                    setPriceForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="price-minimum">Minimum charge</Label>
                <Input
                  id="price-minimum"
                  type="number"
                  min="0"
                  step="any"
                  value={priceForm.minimum_charge}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      minimum_charge: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="price-provider-cost">Provider cost</Label>
                <Input
                  id="price-provider-cost"
                  type="number"
                  min="0"
                  step="any"
                  value={priceForm.provider_cost}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      provider_cost: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="price-region">Region ID</Label>
                <Input
                  id="price-region"
                  placeholder="UUID or blank for global"
                  value={priceForm.region_id}
                  onChange={(event) =>
                    setPriceForm((current) => ({
                      ...current,
                      region_id: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {priceError ? <p className="text-sm text-destructive">{priceError}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={savingPrice} onClick={() => setPriceTarget(null)}>
              Cancel
            </Button>
            <Button disabled={savingPrice} onClick={() => void submitPrice()}>
              {savingPrice ? "Adding…" : "Add price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
