// Catalog & pricing: a read-only explorer over regions, plans, instance types
// and OS templates, plus a live price calculator that quotes a fixed plan or
// custom resource dimensions through POST /pricing/quote (debounced).
import { useEffect, useRef, useState } from "react"
import { CalculatorIcon, Loader2Icon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { formatDateTime, formatMoney } from "../format"

interface Region {
  id: string
  code: string
  name: string
  country_code?: string
  city?: string
  enabled: boolean
}

interface Plan {
  id: string
  code: string
  name: string
  description?: string
  product_id: string
  price_mode: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  bandwidth_gb: number
  ipv4_count: number
  featured?: boolean | null
}

interface InstanceType {
  id: string
  name: string
  category: string
  max_vcpu: number
  max_ram_mb: number
  max_disk_gb: number
  network_rate?: number
}

interface OsTemplate {
  id: string
  name: string
  family?: string
  version?: string
  architecture?: string
  min_disk_gb?: number
}

interface BreakdownLine {
  dimension_code: string
  description: string
  quantity: number
  included_quantity: number
  billable_quantity: number
  unit_price: number
  amount: number
}

interface QuoteResult {
  quote_id: string
  price_mode: string
  currency: string
  billing_period: string
  breakdown: BreakdownLine[]
  subtotal: number
  discount: number
  tax: number
  setup_fee: number
  total: number
  expires_at: string
}

// The billing_period enum values accepted by the pricing engine.
const BILLING_PERIODS = ["hourly", "daily", "monthly", "quarterly", "semiannual", "annual"] as const

const CUSTOM_DIMENSIONS = [
  { code: "vcpu", label: "vCPU", step: 1, initial: "2" },
  { code: "ram_gb", label: "RAM (GB)", step: 0.5, initial: "4" },
  { code: "nvme_gb", label: "NVMe storage (GB)", step: 10, initial: "40" },
  { code: "bandwidth_gb", label: "Bandwidth (GB)", step: 100, initial: "0" },
  { code: "ipv4", label: "IPv4 addresses", step: 1, initial: "1" },
] as const

export default function CatalogPage() {
  const [regions, setRegions] = useState<Region[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [instanceTypes, setInstanceTypes] = useState<InstanceType[]>([])
  const [osTemplates, setOsTemplates] = useState<OsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [regionRes, planRes, typeRes, osRes] = await Promise.all([
          apiGet<Region[]>("/regions"),
          apiGet<Plan[]>("/plans"),
          apiGet<InstanceType[]>("/instance-types"),
          apiGet<OsTemplate[]>("/os-templates"),
        ])
        setRegions(regionRes.data ?? [])
        setPlans(planRes.data ?? [])
        setInstanceTypes(typeRes.data ?? [])
        setOsTemplates(osRes.data ?? [])
      } catch (cause) {
        setError(cause)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalog & pricing"
        description="Browse what the platform offers and estimate costs before provisioning."
      />

      <ErrorBanner error={error} />

      <Tabs defaultValue="calculator">
        <TabsList className="flex-wrap">
          <TabsTrigger value="calculator">Price calculator</TabsTrigger>
          <TabsTrigger value="plans">Plans ({loading ? "…" : plans.length})</TabsTrigger>
          <TabsTrigger value="regions">Regions ({loading ? "…" : regions.length})</TabsTrigger>
          <TabsTrigger value="types">Instance types ({loading ? "…" : instanceTypes.length})</TabsTrigger>
          <TabsTrigger value="templates">OS templates ({loading ? "…" : osTemplates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="calculator" className="pt-4">
          <PriceCalculator plans={plans} regions={regions} loading={loading} />
        </TabsContent>

        <TabsContent value="plans" className="pt-4">
          <PlansTable plans={plans} loading={loading} error={error} />
        </TabsContent>

        <TabsContent value="regions" className="pt-4">
          <RegionsTable regions={regions} loading={loading} error={error} />
        </TabsContent>

        <TabsContent value="types" className="pt-4">
          <InstanceTypesTable types={instanceTypes} loading={loading} error={error} />
        </TabsContent>

        <TabsContent value="templates" className="pt-4">
          <OsTemplatesTable templates={osTemplates} loading={loading} error={error} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---- Price calculator --------------------------------------------------------

function PriceCalculator({
  plans,
  regions,
  loading,
}: {
  plans: Plan[]
  regions: Region[]
  loading: boolean
}) {
  const [mode, setMode] = useState("plan")
  const [planId, setPlanId] = useState("")
  const [period, setPeriod] = useState<string>("monthly")
  const [currency, setCurrency] = useState("IDR")
  const [regionId, setRegionId] = useState("any")
  const [dims, setDims] = useState<Record<string, string>>(() =>
    Object.fromEntries(CUSTOM_DIMENSIONS.map((d) => [d.code, d.initial])),
  )
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<unknown>(null)

  // Auto-select the first plan once loaded.
  useEffect(() => {
    if (planId || plans.length === 0) return
    const t = setTimeout(() => setPlanId(plans[0].id), 0)
    return () => clearTimeout(t)
  }, [plans, planId])

  // Debounced live quote: refires ~0.5 s after the inputs settle.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (loading) return
    if (mode === "plan" && !planId) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const body: Record<string, unknown> = {
          currency,
          billing_period: period,
        }
        if (regionId !== "any") body.region_id = regionId
        if (mode === "plan") {
          body.plan_id = planId
        } else {
          const customResources: Record<string, number> = {}
          for (const dim of CUSTOM_DIMENSIONS) {
            const value = Number(dims[dim.code])
            if (Number.isFinite(value) && value > 0) customResources[dim.code] = value
          }
          if (Object.keys(customResources).length === 0) {
            setQuote(null)
            setQuoteError(new ApiError("validation", "Enter at least one resource quantity above zero.", 400))
            setQuoteLoading(false)
            return
          }
          body.custom_resources = customResources
        }
        const { data } = await apiPost<QuoteResult>("/pricing/quote", body)
        setQuote(data)
      } catch (cause) {
        setQuote(null)
        setQuoteError(cause)
      } finally {
        setQuoteLoading(false)
      }
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mode, planId, period, currency, regionId, dims, loading])

  const setDim = (code: string, value: string) =>
    setDims((prev) => ({ ...prev, [code]: value }))

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Inputs */}
      <Card>
        <CardContent className="space-y-4 px-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalculatorIcon className="size-4" /> Configure a workload
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Pricing model</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Fixed plan</SelectItem>
                  <SelectItem value="custom">Custom resources</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Billing period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_PERIODS.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IDR">IDR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Region</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any region</SelectItem>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "plan" ? (
            <div className="space-y-1.5">
              <Label>Plan</Label>
              {loading ? (
                <Skeleton className="h-9 w-full" />
              ) : plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No plans available.</p>
              ) : (
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name} · {plan.vcpu} vCPU / {(plan.ram_mb / 1024).toFixed(plan.ram_mb % 1024 === 0 ? 0 : 1)} GB RAM / {plan.disk_gb} GB
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {planId ? <PlanSpecNote plan={plans.find((p) => p.id === planId)} /> : null}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {CUSTOM_DIMENSIONS.map((dim) => (
                <div key={dim.code} className="space-y-1.5">
                  <Label htmlFor={`dim-${dim.code}`}>{dim.label}</Label>
                  <Input
                    id={`dim-${dim.code}`}
                    type="number"
                    min={0}
                    step={dim.step}
                    value={dims[dim.code]}
                    onChange={(event) => setDim(dim.code, event.target.value)}
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Estimates refresh automatically ~0.5 s after you stop changing inputs. Quotes expire
            after 24 hours.
          </p>
        </CardContent>
      </Card>

      {/* Estimate */}
      <Card>
        <CardContent className="space-y-4 px-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Estimate</h2>
            {quoteLoading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>

          <ErrorBanner error={quoteError} />

          {!quote && !quoteError && !quoteLoading ? (
            <p className="text-sm text-muted-foreground">Adjust the inputs to see a live estimate.</p>
          ) : null}

          {quote ? (
            <div className="space-y-4">
              <div>
                <p className={`text-2xl font-semibold tabular-nums sm:text-3xl ${quoteLoading ? "opacity-60 transition-opacity" : ""}`}>
                  {formatMoney(quote.total, quote.currency)}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="capitalize">
                    {quote.price_mode.replace(/_/g, " ")}
                  </Badge>
                  <span className="capitalize">{quote.billing_period}</span>
                  <span>· valid until {formatDateTime(quote.expires_at)}</span>
                </p>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quote.breakdown.map((line) => (
                      <TableRow key={line.dimension_code}>
                        <TableCell>
                          <p>{line.description}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {line.billable_quantity} × {formatMoney(line.unit_price, quote.currency)}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(line.amount, quote.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-muted-foreground">Subtotal</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(quote.subtotal, quote.currency)}
                      </TableCell>
                    </TableRow>
                    {quote.discount > 0 ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Discount</TableCell>
                        <TableCell className="text-right tabular-nums">
                          −{formatMoney(quote.discount, quote.currency)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {quote.setup_fee > 0 ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Setup fee</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(quote.setup_fee, quote.currency)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    <TableRow>
                      <TableCell className="text-muted-foreground">Tax</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(quote.tax, quote.currency)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(quote.total, quote.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function PlanSpecNote({ plan }: { plan?: Plan }) {
  if (!plan) return null
  return (
    <p className="text-xs text-muted-foreground">
      {plan.vcpu} vCPU · {plan.ram_mb >= 1024 ? `${(plan.ram_mb / 1024).toFixed(plan.ram_mb % 1024 === 0 ? 0 : 1)} GB` : `${plan.ram_mb} MB`} RAM ·{" "}
      {plan.disk_gb} GB disk · {plan.bandwidth_gb} GB bandwidth · {plan.ipv4_count} IPv4
      {plan.featured ? " · featured" : ""}
    </p>
  )
}

// ---- Explorer tables -----------------------------------------------------------

function PlansTable({
  plans,
  loading,
  error,
}: {
  plans: Plan[]
  loading: boolean
  error: unknown
}) {
  const columns: Array<SimpleColumn<Plan>> = [
    {
      key: "name",
      header: "Plan",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    {
      key: "spec",
      header: "Specs",
      render: (row) => (
        <span className="tabular-nums">
          {row.vcpu} vCPU · {row.ram_mb >= 1024 ? `${(row.ram_mb / 1024).toFixed(row.ram_mb % 1024 === 0 ? 0 : 1)} GB` : `${row.ram_mb} MB`} · {row.disk_gb} GB
        </span>
      ),
    },
    { key: "bandwidth_gb", header: "Bandwidth (GB)", render: (row) => <span className="tabular-nums">{row.bandwidth_gb}</span> },
    { key: "ipv4_count", header: "IPv4" },
    { key: "price_mode", header: "Pricing", render: (row) => <Badge variant="outline">{row.price_mode.replace(/_/g, " ")}</Badge> },
    {
      key: "featured",
      header: "",
      render: (row) => (row.featured ? <Badge>Featured</Badge> : null),
    },
  ]
  return (
    <SimpleDataTable
      columns={columns}
      rows={plans}
      loading={loading}
      error={error}
      emptyMessage="No plans are published yet."
      getRowKey={(row) => row.id}
    />
  )
}

function RegionsTable({
  regions,
  loading,
  error,
}: {
  regions: Region[]
  loading: boolean
  error: unknown
}) {
  const columns: Array<SimpleColumn<Region>> = [
    {
      key: "name",
      header: "Region",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    { key: "city", header: "City", render: (row) => row.city || "—" },
    { key: "country_code", header: "Country", render: (row) => row.country_code || "—" },
    {
      key: "enabled",
      header: "Status",
      render: (row) =>
        row.enabled ? <Badge variant="default">Enabled</Badge> : <Badge variant="secondary">Disabled</Badge>,
    },
  ]
  return (
    <SimpleDataTable
      columns={columns}
      rows={regions}
      loading={loading}
      error={error}
      emptyMessage="No regions configured."
      getRowKey={(row) => row.id}
    />
  )
}

function InstanceTypesTable({
  types,
  loading,
  error,
}: {
  types: InstanceType[]
  loading: boolean
  error: unknown
}) {
  const columns: Array<SimpleColumn<InstanceType>> = [
    {
      key: "name",
      header: "Type",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs capitalize text-muted-foreground">{row.category}</p>
        </div>
      ),
    },
    { key: "max_vcpu", header: "Max vCPU", render: (row) => <span className="tabular-nums">{row.max_vcpu}</span> },
    {
      key: "max_ram_mb",
      header: "Max RAM",
      render: (row) => (
        <span className="tabular-nums">
          {row.max_ram_mb >= 1024 ? `${(row.max_ram_mb / 1024).toFixed(row.max_ram_mb % 1024 === 0 ? 0 : 1)} GB` : `${row.max_ram_mb} MB`}
        </span>
      ),
    },
    { key: "max_disk_gb", header: "Max disk", render: (row) => <span className="tabular-nums">{row.max_disk_gb} GB</span> },
    {
      key: "network_rate",
      header: "Network (Mbps)",
      render: (row) => (row.network_rate ? <span className="tabular-nums">{row.network_rate}</span> : "—"),
    },
  ]
  return (
    <SimpleDataTable
      columns={columns}
      rows={types}
      loading={loading}
      error={error}
      emptyMessage="No instance types published."
      getRowKey={(row) => row.id}
    />
  )
}

function OsTemplatesTable({
  templates,
  loading,
  error,
}: {
  templates: OsTemplate[]
  loading: boolean
  error: unknown
}) {
  const columns: Array<SimpleColumn<OsTemplate>> = [
    { key: "name", header: "Template", render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "family", header: "Family", render: (row) => row.family || "—" },
    { key: "version", header: "Version", render: (row) => row.version || "—" },
    { key: "architecture", header: "Arch", render: (row) => row.architecture || "—" },
    {
      key: "min_disk_gb",
      header: "Min disk (GB)",
      render: (row) =>
        row.min_disk_gb !== undefined && row.min_disk_gb > 0 ? (
          <span className="tabular-nums">{row.min_disk_gb}</span>
        ) : (
          "—"
        ),
    },
  ]
  return (
    <SimpleDataTable
      columns={columns}
      rows={templates}
      loading={loading}
      error={error}
      emptyMessage="No OS templates available."
      getRowKey={(row) => row.id}
    />
  )
}
