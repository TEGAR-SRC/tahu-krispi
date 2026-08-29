// Full-page provisioning wizard: region → image → size (plan or custom spec)
// → billing period with a live debounced price quote → review → create.
// On success the user is taken to the new instance's overview page.
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CpuIcon,
  HardDriveIcon,
  Loader2Icon,
  MemoryStickIcon,
  MonitorIcon,
  MapPinIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import type { Plan, PriceQuote, Region } from "../instances/types"

interface OsTemplate {
  id: string
  name: string
  family?: string
  version?: string
  min_disk_gb?: number
}

const BILLING_PERIODS = ["hourly", "monthly", "quarterly", "semiannual", "annual"] as const
type BillingPeriod = (typeof BILLING_PERIODS)[number]

const STEPS = ["Region", "Image", "Size", "Billing", "Review"] as const

export default function CreateInstancePage() {
  const navigate = useNavigate()
  const { orgId } = useOrg()

  const [step, setStep] = useState(0)

  // Catalog data.
  const [regions, setRegions] = useState<Region[]>([])
  const [templates, setTemplates] = useState<OsTemplate[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<unknown>(null)

  // Wizard selection.
  const [regionId, setRegionId] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [mode, setMode] = useState<"plan" | "custom">("plan")
  const [planId, setPlanId] = useState("")
  const [cpu, setCpu] = useState(1)
  const [ram, setRam] = useState(1024) // MB
  const [disk, setDisk] = useState(20) // GB
  const [currency, setCurrency] = useState("IDR")
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly")
  const [name, setName] = useState("")

  // Live quote.
  const [quote, setQuote] = useState<PriceQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiGet<Region[]>("/regions"),
      apiGet<OsTemplate[]>("/os-templates"),
      apiGet<Plan[]>("/plans"),
    ])
      .then(([regionsRes, templatesRes, plansRes]) => {
        if (cancelled) return
        setRegions((regionsRes.data ?? []).filter((region) => region.enabled))
        setTemplates(templatesRes.data ?? [])
        setPlans(plansRes.data ?? [])
      })
      .catch((cause) => !cancelled && setCatalogError(cause))
      .finally(() => !cancelled && setCatalogLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const region = regions.find((candidate) => candidate.id === regionId) ?? null
  const template = templates.find((candidate) => candidate.id === templateId) ?? null
  const plan = plans.find((candidate) => candidate.id === planId) ?? null

  // Live debounced quote whenever a priceable selection is complete.
  useEffect(() => {
    if (!regionId || step < 3) return
    if (mode === "plan" && !plan) return
    let cancelled = false
    const body =
      mode === "plan"
        ? { plan_id: plan?.id, region_id: regionId, currency, billing_period: billingPeriod }
        : {
            region_id: regionId,
            currency,
            billing_period: billingPeriod,
            custom_resources: {
              vcpu: cpu,
              ram_gb: Math.round((ram / 1024) * 100) / 100,
              nvme_gb: disk,
            },
          }
    const timer = setTimeout(() => {
      setQuoteLoading(true)
      apiPost<PriceQuote>("/pricing/quote", body, { headers: orgHeaders(orgId) })
        .then(({ data }) => {
          if (!cancelled) {
            setQuote(data)
            setQuoteError(null)
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setQuote(null)
            setQuoteError(
              cause instanceof ApiError ? cause.message : "Pricing unavailable",
            )
          }
        })
        .finally(() => !cancelled && setQuoteLoading(false))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setQuoteLoading(false)
    }
  }, [regionId, mode, plan, cpu, ram, disk, currency, billingPeriod, orgId, step])

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(regionId)
      case 1:
        return Boolean(templateId)
      case 2:
        return mode === "plan" ? Boolean(planId) : cpu > 0 && ram > 0 && disk > 0
      case 3:
        return true // billing period always has a value; quote may be unavailable
      default:
        return name.trim().length > 0
    }
  }, [step, regionId, templateId, mode, planId, cpu, ram, disk, name])

  const submit = useCallback(async () => {
    if (!name.trim() || !regionId || !orgId) return
    setSubmitting(true)
    try {
      const { data } = await apiPost<{ id?: string }>(
        "/instances",
        {
          name: name.trim(),
          region_id: regionId,
          os_template_id: templateId || undefined,
          plan_id: mode === "plan" ? plan?.id : undefined,
          cpu: mode === "plan" ? (plan?.vcpu ?? cpu) : cpu,
          ram: mode === "plan" ? (plan?.ram_mb ?? ram) : ram,
          disk: mode === "plan" ? (plan?.disk_gb ?? disk) : disk,
          currency,
          billing_period: billingPeriod,
          recurring_amount: quote?.total ?? 0,
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`Instance "${name.trim()}" provisioning started`)
      if (data?.id) {
        navigate(`/app/instances/${data.id}`)
      } else {
        // The create reply can come back without a usable id — fall back to the list.
        navigate("/app/instances")
      }
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to create instance",
      )
    } finally {
      setSubmitting(false)
    }
  }, [
    name,
    regionId,
    orgId,
    templateId,
    mode,
    plan,
    cpu,
    ram,
    disk,
    currency,
    billingPeriod,
    quote,
    navigate,
  ])

  const specSummary =
    mode === "plan" && plan
      ? `${plan.vcpu} vCPU · ${plan.ram_mb} MB RAM · ${plan.disk_gb} GB disk`
      : `${cpu} vCPU · ${ram} MB RAM · ${disk} GB disk`

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Create instance"
        description="Pick a region, an image and a size. Pricing comes from a live quote."
      />

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((label, index) => (
          <li key={label} className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              disabled={index > step}
              onClick={() => setStep(index)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors ${
                index === step
                  ? "border-primary bg-primary/5 font-medium"
                  : index < step
                    ? "border-primary/40 bg-primary/5 text-muted-foreground hover:bg-primary/10"
                    : "text-muted-foreground opacity-60"
              }`}
            >
              {index < step ? (
                <CheckIcon className="size-3.5 text-primary" />
              ) : (
                <span className="tabular-nums">{index + 1}</span>
              )}
              {label}
            </button>
            {index < STEPS.length - 1 ? (
              <span className="text-muted-foreground">→</span>
            ) : null}
          </li>
        ))}
      </ol>

      <ErrorBanner error={catalogError} />

      {catalogLoading ? (
        <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          {step === 0 ? (
            <StepRegion regions={regions} selected={regionId} onSelect={setRegionId} />
          ) : null}
          {step === 1 ? (
            <StepImage templates={templates} selected={templateId} onSelect={setTemplateId} />
          ) : null}
          {step === 2 ? (
            <StepSize
              plans={plans}
              mode={mode}
              onModeChange={setMode}
              planId={planId}
              onPlanChange={setPlanId}
              cpu={cpu}
              ram={ram}
              disk={disk}
              onCpuChange={setCpu}
              onRamChange={setRam}
              onDiskChange={setDisk}
            />
          ) : null}
          {step === 3 ? (
            <StepBilling
              currency={currency}
              onCurrencyChange={setCurrency}
              billingPeriod={billingPeriod}
              onBillingPeriodChange={setBillingPeriod}
              quote={quote}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
            />
          ) : null}
          {step === 4 ? (
            <Card>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ci-name">Instance name *</Label>
                  <Input
                    id="ci-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="my-server-01"
                    autoFocus
                  />
                </div>
                <Separator />
                <ReviewRow label="Region" value={region ? `${region.name} (${region.code})` : "—"} />
                <ReviewRow label="Image" value={template?.name ?? "—"} />
                <ReviewRow
                  label="Size"
                  value={
                    mode === "plan"
                      ? `Plan: ${plan?.name ?? "—"} (${specSummary})`
                      : `Custom (${specSummary})`
                  }
                />
                <ReviewRow
                  label="Billing"
                  value={`${billingPeriod} · ${currency}`}
                />
                <Separator />
                {quoteError ? (
                  <p className="text-sm text-muted-foreground">
                    Price estimate unavailable ({quoteError}). You can still create the instance;
                    the final price follows the provider's rate card.
                  </p>
                ) : quote ? (
                  <p className="text-sm">
                    Estimated total{" "}
                    <span className="font-semibold tabular-nums">
                      {formatMoney(quote.total, quote.currency)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      per {billingPeriod} period (subtotal {formatMoney(quote.subtotal, quote.currency)}{" "}
                      + tax {formatMoney(quote.tax, quote.currency)})
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Fetching live quote…</p>
                )}
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={!name.trim() || submitting}
                  onClick={() => void submit()}
                >
                  {submitting ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                  Create instance
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={step === 0}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
            >
              <ArrowLeftIcon /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button disabled={!canAdvance} onClick={() => setStep((current) => current + 1)}>
                Next <ArrowRightIcon />
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function StepRegion({
  regions,
  selected,
  onSelect,
}: {
  regions: Region[]
  selected: string
  onSelect: (id: string) => void
}) {
  if (regions.length === 0) {
    return <EmptyState message="No enabled regions available." />
  }
  return (
    <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          onClick={() => onSelect(region.id)}
          aria-pressed={selected === region.id}
          className={`rounded-lg border p-4 text-left transition-colors hover:bg-muted ${
            selected === region.id ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <MapPinIcon className="size-4 text-muted-foreground" />
            <span className="font-medium">{region.name}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            code {region.code}
            {region.city ? ` · ${region.city}` : ""}
            {region.country_code ? ` · ${region.country_code}` : ""}
          </p>
        </button>
      ))}
    </div>
  )
}

function StepImage({
  templates,
  selected,
  onSelect,
}: {
  templates: OsTemplate[]
  selected: string
  onSelect: (id: string) => void
}) {
  const families = useMemo(() => {
    const groups = new Map<string, OsTemplate[]>()
    for (const template of templates) {
      const family = template.family || "Other"
      const list = groups.get(family) ?? []
      list.push(template)
      groups.set(family, list)
    }
    return Array.from(groups.entries())
  }, [templates])

  if (templates.length === 0) {
    return <EmptyState message="No OS images available." />
  }

  return (
    <div className="space-y-6">
      {families.map(([family, list]) => (
        <div key={family} className="space-y-2">
          <h3 className="text-sm font-semibold">{family}</h3>
          <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template.id)}
                aria-pressed={selected === template.id}
                className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                  selected === template.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium">{template.name}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {typeof template.min_disk_gb === "number" && template.min_disk_gb > 0
                    ? `requires ≥ ${template.min_disk_gb} GB disk`
                    : "\u00A0"}
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StepSize({
  plans,
  mode,
  onModeChange,
  planId,
  onPlanChange,
  cpu,
  ram,
  disk,
  onCpuChange,
  onRamChange,
  onDiskChange,
}: {
  plans: Plan[]
  mode: "plan" | "custom"
  onModeChange: (mode: "plan" | "custom") => void
  planId: string
  onPlanChange: (id: string) => void
  cpu: number
  ram: number
  disk: number
  onCpuChange: (value: number) => void
  onRamChange: (value: number) => void
  onDiskChange: (value: number) => void
}) {
  return (
    <div className="space-y-5">
      <div className="grid w-full max-w-full min-w-0 w-fit grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "plan" ? "default" : "outline"}
          onClick={() => onModeChange("plan")}
        >
          From plan
        </Button>
        <Button
          type="button"
          variant={mode === "custom" ? "default" : "outline"}
          onClick={() => onModeChange("custom")}
        >
          Custom spec
        </Button>
      </div>

      {mode === "plan" ? (
        plans.length === 0 ? (
          <EmptyState
            message="No published plans."
            description="Switch to a custom spec to define vCPU, RAM and disk yourself."
          />
        ) : (
          <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => onPlanChange(plan.id)}
                aria-pressed={planId === plan.id}
                className={`rounded-lg border p-4 text-left transition-colors hover:bg-muted ${
                  planId === plan.id ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="font-medium">{plan.name}</span>
                  {plan.featured ? <Badge>featured</Badge> : null}
                </div>
                <div className="mt-2 space-y-1 text-xs tabular-nums text-muted-foreground">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <CpuIcon className="size-3.5" /> {plan.vcpu} vCPU
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5">
                    <MemoryStickIcon className="size-3.5" /> {plan.ram_mb} MB RAM
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5">
                    <HardDriveIcon className="size-3.5" /> {plan.disk_gb} GB NVMe
                    {plan.bandwidth_gb ? ` · ${plan.bandwidth_gb} GB transfer` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="grid w-full max-w-full min-w-0 max-w-md grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ci-cpu">vCPU</Label>
            <Input
              id="ci-cpu"
              type="number"
              min={1}
              value={cpu}
              onChange={(event) => onCpuChange(Math.max(1, Number(event.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-ram">RAM (MB)</Label>
            <Input
              id="ci-ram"
              type="number"
              min={128}
              step={128}
              value={ram}
              onChange={(event) =>
                onRamChange(Math.max(128, Number(event.target.value) || 128))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ci-disk">Disk (GB)</Label>
            <Input
              id="ci-disk"
              type="number"
              min={5}
              value={disk}
              onChange={(event) =>
                onDiskChange(Math.max(5, Number(event.target.value) || 5))
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StepBilling({
  currency,
  onCurrencyChange,
  billingPeriod,
  onBillingPeriodChange,
  quote,
  quoteLoading,
  quoteError,
}: {
  currency: string
  onCurrencyChange: (value: string) => void
  billingPeriod: BillingPeriod
  onBillingPeriodChange: (value: BillingPeriod) => void
  quote: PriceQuote | null
  quoteLoading: boolean
  quoteError: string | null
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:max-w-md sm:grid sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <div className="flex gap-2">
              {["IDR"].map((code) => (
                <Button
                  key={code}
                  type="button"
                  variant={currency === code ? "default" : "outline"}
                  onClick={() => onCurrencyChange(code)}
                >
                  {code}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Billing period</Label>
            <div className="flex flex-wrap gap-2">
              {BILLING_PERIODS.map((period) => (
                <Button
                  key={period}
                  type="button"
                  size="sm"
                  variant={billingPeriod === period ? "default" : "outline"}
                  onClick={() => onBillingPeriodChange(period)}
                  className="capitalize"
                >
                  {period}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        {quoteError ? (
          <p className="text-sm text-muted-foreground">
            Live estimate unavailable: {quoteError}. This backend has no rate card for every
            dimension — you can still proceed and review the final price after provisioning.
          </p>
        ) : quoteLoading && !quote ? (
          <Skeleton className="h-8 w-56" />
        ) : quote ? (
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {formatMoney(quote.total, quote.currency)}
              </span>
              <span className="text-muted-foreground">
                per {quote.billing_period ?? billingPeriod} period
              </span>
              {quoteLoading ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <p className="text-muted-foreground tabular-nums">
              subtotal {formatMoney(quote.subtotal, quote.currency)} · discount{" "}
              {formatMoney(quote.discount, quote.currency)} · tax{" "}
              {formatMoney(quote.tax, quote.currency)}
              {quote.setup_fee ? ` · setup ${formatMoney(quote.setup_fee, quote.currency)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Choose a size to see pricing…</p>
        )}
      </CardContent>
    </Card>
  )
}
