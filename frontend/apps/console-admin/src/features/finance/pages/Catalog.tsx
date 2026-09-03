// Catalog management: products, plans, plan prices and custom resource rates.
// All four tabs hit the live /admin endpoints; the API exposes no read
// endpoint for plan prices (create-only), which the prices tab states openly.
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { formatDateTime, formatMoney } from "../lib-utils"

interface Product {
  id: string
  code: string
  name: string
  service_kind: string
  description: string
  enabled: boolean
  sort_order: number
  default_monthly_amount: number
}

interface Plan {
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
  setup_fee: number
  enabled: boolean
  featured: boolean
  sort_order: number
}

interface PlanPriceCreated {
  id: string
  plan_id: string
  region_id: string | null
  currency: string
  billing_period: string
  amount: number
  minimum_charge: number
  active_from: string
}

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
  provider_id: string | null
  region_id: string | null
  active_from: string
  active_until: string
}

interface Region {
  id: string
  code: string
  name: string
  enabled: boolean
}

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

// Exact enum accepted by POST /admin/plans/:plan_id/prices.
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

function toNumberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

export default function FinanceCatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [rates, setRates] = useState<CustomRate[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [productsRes, plansRes, ratesRes, regionsRes] = await Promise.all([
        apiGet<Product[]>("/admin/products"),
        apiGet<Plan[]>("/admin/plans", { query: { per_page: 100 } }),
        apiGet<CustomRate[]>("/admin/custom-rates", { query: { per_page: 100 } }),
        apiGet<Region[]>("/admin/regions"),
      ])
      setProducts([...productsRes.data].sort((a, b) => a.sort_order - b.sort_order))
      setPlans(plansRes.data)
      setRates(ratesRes.data)
      setRegions(regionsRes.data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await loadCatalog()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [loadCatalog])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Catalog"
        description="Products, plans and pricing used across the billing pipeline."
      />
      {error ? <ErrorBanner error={error} /> : null}

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products ({products.length})</TabsTrigger>
          <TabsTrigger value="plans">Plans ({plans.length})</TabsTrigger>
          <TabsTrigger value="prices">Plan prices</TabsTrigger>
          <TabsTrigger value="rates">Custom rates ({rates.length})</TabsTrigger>
        </TabsList>

        <ProductsTab products={products} loading={loading} onChanged={loadCatalog} />
        <PlansTab products={products} plans={plans} loading={loading} onChanged={loadCatalog} />
        <PlanPricesTab plans={plans} regions={regions} loading={loading} />
        <CustomRatesTab rates={rates} products={products} regions={regions} loading={loading} onChanged={loadCatalog} />
      </Tabs>
    </div>
  )
}

// ---- Products ---------------------------------------------------------------

function ProductsTab({
  products,
  loading,
  onChanged,
}: {
  products: Product[]
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Product | null>(null)
  const bulkProducts = useBulkSelection<Product>((row) => row.id)

  return (
    <TabsContent value="products" className="mt-4 space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New product
        </Button>
      </div>
      <BulkActionBar selectedCount={bulkProducts.selectedKeys.size} actions={[]} />
      <SimpleDataTable
        columns={[
          { key: "code", header: "Code", render: (row) => <span className="font-mono">{row.code}</span> },
          { key: "name", header: "Name" },
          { key: "service_kind", header: "Kind" },
          {
            key: "default_monthly_amount",
            header: "Default monthly",
            className: "text-right tabular-nums",
            render: (row) =>
              row.default_monthly_amount > 0 ? formatMoney(row.default_monthly_amount) : "—",
          },
          { key: "sort_order", header: "Sort", className: "w-16 tabular-nums" },
          {
            key: "enabled",
            header: "Enabled",
            render: (row) => (
              <span className={row.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                {row.enabled ? "yes" : "no"}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-24 text-right",
            render: (row) => (
              <Button variant="outline" size="sm" onClick={() => setEditTarget(row)}>
                Edit
              </Button>
            ),
          },
        ]}
        rows={products}
        loading={loading}
        getRowKey={bulkProducts.getRowKey}
        selectable
        selectedKeys={bulkProducts.selectedKeys}
        onSelectionChange={bulkProducts.onSelectionChange}
        emptyMessage="No products defined."
      />

      <ProductCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onChanged} />
      <ProductEditDialog product={editTarget} onOpenChange={() => setEditTarget(null)} onSaved={onChanged} />
    </TabsContent>
  )
}

function ProductFormFields({
  code,
  name,
  description,
  serviceKind,
  defaultAmount,
  sortOrder,
  set,
  codeLocked,
}: {
  code: string
  name: string
  description: string
  serviceKind: string
  defaultAmount: string
  sortOrder: string
  set: (patch: Partial<{ code: string; name: string; description: string; service_kind: string; defaultAmount: string; sortOrder: string }>) => void
  codeLocked?: boolean
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="prod-code">Code *</Label>
        <Input id="prod-code" value={code} disabled={codeLocked} onChange={(event) => set({ code: event.target.value })} placeholder="kilat-vps" className="font-mono" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prod-name">Name *</Label>
        <Input id="prod-name" value={name} onChange={(event) => set({ name: event.target.value })} placeholder="Kilat Cloud VPS" />
      </div>
      <div className="space-y-1.5">
        <Label>Service kind</Label>
        <Select value={serviceKind} onValueChange={(value) => set({ service_kind: value })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SERVICE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>{kind.replaceAll("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prod-amount">Default monthly amount</Label>
        <Input id="prod-amount" type="number" min="0" step="any" value={defaultAmount} onChange={(event) => set({ defaultAmount: event.target.value })} placeholder="0" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prod-sort">Sort order</Label>
        <Input id="prod-sort" type="number" step="1" value={sortOrder} onChange={(event) => set({ sortOrder: event.target.value })} placeholder="10" />
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label htmlFor="prod-desc">Description</Label>
        <Input id="prod-desc" value={description} onChange={(event) => set({ description: event.target.value })} placeholder="Shown to customers in the catalog" />
      </div>
    </div>
  )
}

function ProductCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const [state, setState] = useState({ code: "", name: "", description: "", service_kind: "vm", defaultAmount: "", sortOrder: "" })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!state.code.trim() || !state.name.trim()) {
      setError("Code and name are required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await apiPost("/admin/products", {
        code: state.code.trim(),
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        service_kind: state.service_kind,
        default_monthly_amount: toNumberOrUndefined(state.defaultAmount) ?? 0,
        sort_order: toNumberOrUndefined(state.sortOrder) ?? 10,
      })
      toast.success(`Product ${state.code.trim()} created`)
      onOpenChange(false)
      setState({ code: "", name: "", description: "", service_kind: "vm", defaultAmount: "", sortOrder: "" })
      await onCreated()
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to create product")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>Products group plans and custom rates.</DialogDescription>
        </DialogHeader>
        <InlineFormError error={error} />
        <ProductFormFields {...state} serviceKind={state.service_kind} set={(patch) => setState((prev) => ({ ...prev, ...patch }))} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProductEditDialog({
  product,
  onOpenChange,
  onSaved,
}: {
  product: Product | null
  onOpenChange: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [defaultAmount, setDefaultAmount] = useState("")
  const [sortOrder, setSortOrder] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Sync local fields whenever a different product is opened.
  const [loadedId, setLoadedId] = useState<string | null>(null)
  if (product && loadedId !== product.id) {
    setLoadedId(product.id)
    setName(product.name)
    setDescription(product.description ?? "")
    setDefaultAmount(String(product.default_monthly_amount ?? ""))
    setSortOrder(String(product.sort_order ?? ""))
    setEnabled(product.enabled)
  }

  const submit = async () => {
    if (!product) return
    const patch: Record<string, unknown> = {}
    if (name.trim()) patch.name = name.trim()
    if (description !== (product.description ?? "")) patch.description = description
    const numericAmount = toNumberOrUndefined(defaultAmount)
    if (numericAmount !== undefined && numericAmount !== product.default_monthly_amount)
      patch.default_monthly_amount = numericAmount
    const numericSort = toNumberOrUndefined(sortOrder)
    if (numericSort !== undefined && numericSort !== product.sort_order) patch.sort_order = numericSort
    if (enabled !== product.enabled) patch.enabled = enabled
    if (Object.keys(patch).length === 0) {
      setError("Nothing to update")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await apiPatch(`/admin/products/${product.id}`, patch)
      toast.success(`Product ${product.code} updated`)
      onOpenChange()
      setLoadedId(null)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to update product")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={product !== null} onOpenChange={(open) => { if (!open) { onOpenChange(); setLoadedId(null) } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit product {product?.code}</DialogTitle>
          <DialogDescription>Only changed fields are sent.</DialogDescription>
        </DialogHeader>
        <InlineFormError error={error} />
        {product ? (
          <div className="space-y-3">
            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-prod-name">Name</Label>
                <Input id="edit-prod-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-prod-amount">Default monthly amount</Label>
                <Input id="edit-prod-amount" type="number" min="0" step="any" value={defaultAmount} onChange={(event) => setDefaultAmount(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-prod-sort">Sort order</Label>
                <Input id="edit-prod-sort" type="number" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
              </div>
              <div className="flex min-w-0 items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="edit-prod-enabled" className="cursor-pointer">Enabled</Label>
                <Switch id="edit-prod-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-prod-desc">Description</Label>
              <Input id="edit-prod-desc" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(); setLoadedId(null) }}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !product}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Plans ------------------------------------------------------------------

function PlansTab({
  products,
  plans,
  loading,
  onChanged,
}: {
  products: Product[]
  plans: Plan[]
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const [productFilter, setProductFilter] = useState<string>("all")
  const [createOpen, setCreateOpen] = useState(false)
  const bulkPlans = useBulkSelection<Plan>((row) => row.id)

  const filtered = useMemo(
    () =>
      (productFilter === "all" ? plans : plans.filter((plan) => plan.product_id === productFilter)).slice().sort((a, b) => a.sort_order - b.sort_order),
    [plans, productFilter],
  )

  return (
    <TabsContent value="plans" className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Filter by product" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New plan
        </Button>
      </div>
      <BulkActionBar selectedCount={bulkPlans.selectedKeys.size} actions={[]} />
      <SimpleDataTable
        columns={[
          { key: "code", header: "Code", render: (row) => <span className="font-mono">{row.code}</span> },
          { key: "name", header: "Name" },
          { key: "product_code", header: "Product" },
          { key: "price_mode", header: "Price mode" },
          {
            key: "specs",
            header: "Specs",
            render: (row) =>
              `${row.vcpu} vCPU · ${(row.ram_mb / 1024).toFixed(row.ram_mb % 1024 === 0 ? 0 : 1)} GB RAM · ${row.disk_gb} GB disk`,
          },
          {
            key: "setup_fee",
            header: "Setup fee",
            className: "text-right tabular-nums",
            render: (row) => (row.setup_fee > 0 ? formatMoney(row.setup_fee) : "—"),
          },
          {
            key: "flags",
            header: "Flags",
            render: (row) =>
              `${row.enabled ? "enabled" : "disabled"}${row.featured ? " · featured" : ""}`,
          },
        ]}
        rows={filtered}
        loading={loading}
        getRowKey={bulkPlans.getRowKey}
        selectable
        selectedKeys={bulkPlans.selectedKeys}
        onSelectionChange={bulkPlans.onSelectionChange}
        emptyMessage="No plans for this product yet."
      />

      <PlanCreateDialog open={createOpen} onOpenChange={setCreateOpen} products={products} onCreated={onChanged} />
    </TabsContent>
  )
}

function PlanCreateDialog({
  open,
  onOpenChange,
  products,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  onCreated: () => Promise<void>
}) {
  const [productId, setProductId] = useState("")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [priceMode, setPriceMode] = useState<string>("fixed_plan")
  const [providerId, setProviderId] = useState<string>("__any__")
  const [providers, setProviders] = useState<Array<{ id: string; code: string; name: string; kind: string }>>([])
  const [vcpu, setVcpu] = useState("1")
  const [ramGb, setRamGb] = useState("1")
  const [diskGb, setDiskGb] = useState("20")
  const [bandwidthGb, setBandwidthGb] = useState("1024")
  const [ipv4Count, setIpv4Count] = useState("1")
  const [setupFee, setSetupFee] = useState("0")
  const [enabled, setEnabled] = useState(true)
  const [featured, setFeatured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      apiGet<Array<{ id: string; code: string; name: string; kind: string }>>("/admin/providers")
        .then((r) => setProviders(r.data ?? []))
        .catch(() => {})
    }
  }, [open])

  const submit = async () => {
    if (!productId) {
      setError("Choose the parent product")
      return
    }
    if (!code.trim() || !name.trim()) {
      setError("Code and name are required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await apiPost("/admin/plans", {
        product_id: productId,
        code: code.trim(),
        name: name.trim(),
        price_mode: priceMode,
        provider_id: providerId !== "__any__" ? providerId : undefined,
        vcpu: Number(vcpu) || 0,
        ram_mb: Math.round((Number(ramGb) || 0) * 1024),
        disk_gb: Number(diskGb) || 0,
        bandwidth_gb: Number(bandwidthGb) || 0,
        ipv4_count: Number(ipv4Count) || 0,
        setup_fee: Number(setupFee) || 0,
        enabled,
        featured,
      })
      toast.success(`Plan ${code.trim()} created`)
      onOpenChange(false)
      setCode("")
      setName("")
      await onCreated()
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to create plan")
    } finally {
      setSaving(false)
    }
  }

  const numField = (id: string, label: string, value: string, setter: (v: string) => void, step = "1") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min="0" step={step} value={value} onChange={(event) => setter(event.target.value)} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New plan</DialogTitle>
          <DialogDescription>Fixed-size offering under a product.</DialogDescription>
        </DialogHeader>
        <InlineFormError error={error} />
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Product *</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose product…" /></SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>{product.name} ({product.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-code">Code *</Label>
            <Input id="plan-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="starter-monthly" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Name *</Label>
            <Input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Starter" />
          </div>
          <div className="space-y-1.5">
            <Label>Price mode</Label>
            <Select value={priceMode} onValueChange={setPriceMode}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRICE_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>{mode.replaceAll("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Provider (optional — kosong = semua region)</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Universal — all providers via region</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.code} · {p.kind})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {numField("plan-vcpu", "vCPU", vcpu, setVcpu)}
          {numField("plan-ram", "RAM (GB)", ramGb, setRamGb, "any")}
          {numField("plan-disk", "Disk (GB)", diskGb, setDiskGb)}
          {numField("plan-bw", "Bandwidth (GB/mo)", bandwidthGb, setBandwidthGb)}
          {numField("plan-ipv4", "IPv4 count", ipv4Count, setIpv4Count)}
          {numField("plan-setup", "Setup fee", setupFee, setSetupFee, "any")}
          <div className="flex min-w-0 items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="plan-enabled" className="cursor-pointer">Enabled</Label>
            <Switch id="plan-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="flex min-w-0 items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="plan-featured" className="cursor-pointer">Featured</Label>
            <Switch id="plan-featured" checked={featured} onCheckedChange={setFeatured} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? "Creating…" : "Create plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Plan prices ------------------------------------------------------------

function PlanPricesTab({
  plans,
  regions,
  loading,
}: {
  plans: Plan[]
  regions: Region[]
  loading: boolean
}) {
  const [planId, setPlanId] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState("IDR")
  const [period, setPeriod] = useState<string>("monthly")
  const [minimumCharge, setMinimumCharge] = useState("0")
  const [regionId, setRegionId] = useState("none")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addedThisSession, setAddedThisSession] = useState<PlanPriceCreated[]>([])
  const bulkPrices = useBulkSelection<PlanPriceCreated>((row) => row.id)

  const selectedPlan = plans.find((plan) => plan.id === planId)

  const submit = async () => {
    if (!selectedPlan) {
      setError("Choose a plan first")
      return
    }
    const numericAmount = Number(amount)
    if (!amount || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setError("Amount must be zero or greater")
      return
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError("Currency must be a 3-letter ISO code")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const envelope = await apiPost<PlanPriceCreated>(`/admin/plans/${selectedPlan.id}/prices`, {
        amount: numericAmount,
        currency: currency.trim().toUpperCase(),
        billing_period: period,
        minimum_charge: Number(minimumCharge) || 0,
        ...(regionId !== "none" ? { region_id: regionId } : {}),
      })
      toast.success(`${period} price added to ${selectedPlan.code}`)
      setAddedThisSession((previous) => [...previous, envelope.data])
      setAmount("")
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to add price")
    } finally {
      setSaving(false)
    }
  }

  return (
    <TabsContent value="prices" className="mt-4 space-y-4">
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        The admin API only exposes price creation (POST /admin/plans/:plan_id/prices); there is no
        listing endpoint, so prices added here are shown below until you leave the page. Quotes and
        invoices always reflect the stored prices.
      </p>
      <div className="rounded-lg border p-4">
        <h3 className="mb-3 text-sm font-semibold">Add price to plan</h3>
        <InlineFormError error={error} />
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3 md:grid-cols-3">
          <div className="col-span-2 space-y-1.5 md:col-span-3">
            <Label>Plan *</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger className="w-full max-w-md"><SelectValue placeholder={loading ? "Loading plans…" : "Choose plan…"} /></SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>{plan.product_code} · {plan.name} ({plan.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price-amount">Amount *</Label>
            <Input id="price-amount" type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 99000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price-currency">Currency *</Label>
            <Input id="price-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label>Billing period *</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILLING_PERIODS.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price-mincharge">Minimum charge</Label>
            <Input id="price-mincharge" type="number" min="0" step="any" value={minimumCharge} onChange={(event) => setMinimumCharge(event.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Region (optional)</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All regions</SelectItem>
                {regions.filter((region) => region.enabled).map((region) => (
                  <SelectItem key={region.id} value={region.id}>{region.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void submit()} disabled={saving || !selectedPlan}>
            {saving ? "Adding…" : "Add price"}
          </Button>
        </div>
      </div>

      {addedThisSession.length > 0 ? (
        <SimpleDataTable
          columns={[
            { key: "billing_period", header: "Period" },
            {
              key: "amount",
              header: "Amount",
              className: "text-right tabular-nums",
              render: (row) => formatMoney(row.amount, row.currency),
            },
            {
              key: "minimum_charge",
              header: "Min charge",
              className: "text-right tabular-nums",
              render: (row) => formatMoney(row.minimum_charge, row.currency),
            },
            { key: "active_from", header: "Active from", render: (row) => formatDateTime(row.active_from) },
          ]}
          rows={[...addedThisSession].reverse()}
          getRowKey={bulkPrices.getRowKey}
          selectable
          selectedKeys={bulkPrices.selectedKeys}
          onSelectionChange={bulkPrices.onSelectionChange}
          emptyMessage=""
        />
      ) : null}
    </TabsContent>
  )
}

// ---- Custom rates -----------------------------------------------------------

function CustomRatesTab({
  rates,
  products,
  regions,
  loading,
  onChanged,
}: {
  rates: CustomRate[]
  products: Product[]
  regions: Region[]
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const bulkRates = useBulkSelection<CustomRate>((row) => row.id)

  return (
    <TabsContent value="rates" className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Per-dimension resource pricing (custom_resource quotes).
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New rate
        </Button>
      </div>
      <BulkActionBar selectedCount={bulkRates.selectedKeys.size} actions={[]} />
      <SimpleDataTable
        columns={[
          { key: "product_code", header: "Product" },
          { key: "dimension_code", header: "Dimension", render: (row) => <span className="font-mono">{row.dimension_code}</span> },
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
            key: "active_until",
            header: "Active until",
            render: (row) => (row.active_until ? formatDateTime(row.active_until) : "Indefinite"),
          },
        ]}
        rows={rates}
        loading={loading}
        getRowKey={bulkRates.getRowKey}
        selectable
        selectedKeys={bulkRates.selectedKeys}
        onSelectionChange={bulkRates.onSelectionChange}
        emptyMessage="No custom rates configured."
      />

      <RateCreateDialog open={createOpen} onOpenChange={setCreateOpen} products={products} regions={regions} onCreated={onChanged} />
    </TabsContent>
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
  const [period, setPeriod] = useState<string>("monthly")
  const [unitPrice, setUnitPrice] = useState("")
  const [includedQuantity, setIncludedQuantity] = useState("0")
  const [minQuantity, setMinQuantity] = useState("")
  const [maxQuantity, setMaxQuantity] = useState("")
  const [stepQuantity, setStepQuantity] = useState("1")
  const [providerId, setProviderId] = useState("")
  const [regionId, setRegionId] = useState("none")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!productId) {
      setError("Choose the product this rate applies to")
      return
    }
    if (!dimensionCode.trim()) {
      setError("Dimension code is required")
      return
    }
    const numericPrice = Number(unitPrice)
    if (!unitPrice || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Unit price must be greater than zero")
      return
    }
    setSaving(true)
    setError(null)
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
        ...(providerId.trim() ? { provider_id: providerId.trim() } : {}),
        ...(regionId !== "none" ? { region_id: regionId } : {}),
      })
      toast.success(`Rate for ${dimensionCode.trim()} created`)
      onOpenChange(false)
      setDimensionCode("")
      setUnitPrice("")
      await onCreated()
    } catch (cause) {
      setError(cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to create rate")
    } finally {
      setSaving(false)
    }
  }

  const numField = (id: string, label: string, value: string, setter: (v: string) => void, min = "0") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} step="any" value={value} onChange={(event) => setter(event.target.value)} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New custom rate</DialogTitle>
          <DialogDescription>Priced per unit of a resource dimension.</DialogDescription>
        </DialogHeader>
        <InlineFormError error={error} />
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Product *</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose product…" /></SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>{product.name} ({product.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="rate-dimension">Dimension code *</Label>
            <Input
              id="rate-dimension"
              list="dimension-codes"
              value={dimensionCode}
              onChange={(event) => setDimensionCode(event.target.value)}
              placeholder="vcpu, ram_gb, nvme_gb…"
              className="font-mono"
            />
            <datalist id="dimension-codes">
              {DIMENSION_CODES.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-price">Unit price *</Label>
            <Input id="rate-price" type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="e.g. 35000" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-currency">Currency *</Label>
            <Input id="rate-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label>Billing period *</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILLING_PERIODS.map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {numField("rate-included", "Included quantity", includedQuantity, setIncludedQuantity)}
          {numField("rate-min", "Min quantity (optional)", minQuantity, setMinQuantity)}
          {numField("rate-max", "Max quantity (optional)", maxQuantity, setMaxQuantity)}
          {numField("rate-step", "Step quantity", stepQuantity, setStepQuantity)}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="rate-provider">Provider ID (optional)</Label>
            <Input id="rate-provider" value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="UUID or blank for any provider" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">When blank the rate applies to all providers (per-provider wiring via optional provider_id).</p>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Region (optional)</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All regions</SelectItem>
                {regions.filter((region) => region.enabled).map((region) => (
                  <SelectItem key={region.id} value={region.id}>{region.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>{saving ? "Creating…" : "Create rate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Shared inline validation/API error block for catalog dialogs. */
function InlineFormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm break-all text-destructive">
      {error}
    </p>
  )
}
