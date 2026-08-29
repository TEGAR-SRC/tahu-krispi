// Full-page resize: upgrade-only plan picker or custom spec with a live
// debounced price quote, confirmed behind an old → new summary dialog.
// The provider rejects downgrades, so every control is clamped/disabled
// below the instance's current spec.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useParams } from "react-router-dom"
import {
  CpuIcon,
  HardDriveIcon,
  Loader2Icon,
  MemoryStickIcon,
  ScalingIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { orgHeaders, useOrg } from "../../useOrg"
import { formatMoney } from "../../format"
import type { Plan, PriceQuote } from "../../instances/types"
import { InstanceBreadcrumb, useInstance } from "./shared"

const BILLING_PERIODS = ["hourly", "monthly", "quarterly", "semiannual", "annual"] as const
type BillingPeriod = (typeof BILLING_PERIODS)[number]

/** True when a plan is not smaller than the current spec in any dimension. */
function planIsUpgrade(plan: Plan, vcpu: number, ramMb: number, diskGb: number): boolean {
  return plan.vcpu >= vcpu && plan.ram_mb >= ramMb && plan.disk_gb >= diskGb
}

export default function InstanceResizePage() {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const { instance, loading, error, reload } = useInstance(instanceId)

  // Catalog.
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState<unknown>(null)

  // Selection (seeded from the instance once it loads).
  const [mode, setMode] = useState<"plan" | "custom">("plan")
  const [planId, setPlanId] = useState("")
  const [cpu, setCpu] = useState(0)
  const [ram, setRam] = useState(0) // MB
  const [disk, setDisk] = useState(0) // GB
  const [currency, setCurrency] = useState("IDR")
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly")

  // Live quote + submit.
  const [quote, setQuote] = useState<PriceQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<Plan[]>("/plans")
      .then(({ data }) => !cancelled && setPlans(data ?? []))
      .catch((cause) => !cancelled && setPlansError(cause))
      .finally(() => !cancelled && setPlansLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Seed currency/period/spec from the loaded instance exactly once.
  useEffect(() => {
    if (!instance) return
    const t = setTimeout(() => {
      setCpu(instance.vcpu)
      setRam(instance.ram_mb)
      setDisk(instance.disk_gb)
      if (instance.currency && instance.currency.length === 3) setCurrency(instance.currency)
      const period = instance.billing_period as BillingPeriod | undefined
      if (period && (BILLING_PERIODS as readonly string[]).includes(period)) {
        setBillingPeriod(period)
      }
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only when a different instance loads
  }, [instance?.id])

  const plan = plans.find((candidate) => candidate.id === planId) ?? null

  // Live debounced quote whenever a priceable selection is complete.
  useEffect(() => {
    if (!instance || !orgId) return
    if (mode === "plan" && !plan) return
    let cancelled = false
    const body =
      mode === "plan"
        ? { plan_id: plan?.id, currency, billing_period: billingPeriod }
        : {
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
            setQuoteError(cause instanceof ApiError ? cause.message : "Pricing unavailable")
          }
        })
        .finally(() => !cancelled && setQuoteLoading(false))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setQuoteLoading(false)
    }
  }, [instance, orgId, mode, plan, cpu, ram, disk, currency, billingPeriod])

  /** Picking a plan must never lower a dimension below the current spec. */
  const selectPlan = useCallback(
    (next: Plan) => {
      if (!instance) return
      if (!planIsUpgrade(next, instance.vcpu, instance.ram_mb, instance.disk_gb)) return
      setMode("plan")
      setPlanId(next.id)
      setCpu(Math.max(cpu, next.vcpu))
      setRam(Math.max(ram, next.ram_mb))
      setDisk(Math.max(disk, next.disk_gb))
    },
    [instance, cpu, ram, disk],
  )

  const increased =
    instance !== null &&
    (cpu > instance.vcpu || ram > instance.ram_mb || disk > instance.disk_gb)
  const downgraded =
    instance !== null &&
    (cpu < instance.vcpu || ram < instance.ram_mb || disk < instance.disk_gb)

  const applyResize = useCallback(async () => {
    if (!instance || !orgId) return
    setSubmitting(true)
    try {
      await apiPost(
        `/instances/${instance.id}/resize`,
        { cpu, ram, disk },
        { headers: orgHeaders(orgId) },
      )
      toast.success(
        `Resize request for "${instance.name}" accepted — new spec ${cpu} vCPU · ${ram} MB · ${disk} GB`,
      )
      setConfirmOpen(false)
      void reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Resize failed")
    } finally {
      setSubmitting(false)
    }
  }, [instance, orgId, cpu, ram, disk, reload])

  const summaryRows = useMemo(() => {
    if (!instance) return []
    return [
      { label: "vCPU", from: instance.vcpu, to: cpu, unit: "" },
      { label: "RAM", from: instance.ram_mb, to: ram, unit: " MB" },
      { label: "Disk", from: instance.disk_gb, to: disk, unit: " GB" },
    ]
  }, [instance, cpu, ram, disk])

  if (loading && !instance) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <InstanceBreadcrumb section="Resize" />
        <ErrorBanner error={error} />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <InstanceBreadcrumb section="Resize" />
        <p className="text-sm text-muted-foreground">Instance not found.</p>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance.name} section="Resize" />

      <div className="space-y-1">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <ScalingIcon className="size-6 text-muted-foreground" /> Resize “{instance.name}”
        </h1>
        <p className="text-sm text-muted-foreground">
          Upgrades only — the provider rejects any dimension below the current spec.
        </p>
      </div>

      {/* Current spec */}
      <Card>
        <CardContent className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-3 gap-4 px-4 py-4">
          <SpecBox icon={<CpuIcon />} label="Current vCPU" value={String(instance.vcpu)} />
          <SpecBox
            icon={<MemoryStickIcon />}
            label="Current RAM"
            value={`${instance.ram_mb.toLocaleString()} MB`}
          />
          <SpecBox icon={<HardDriveIcon />} label="Current disk" value={`${instance.disk_gb} GB`} />
        </CardContent>
      </Card>

      {/* Mode switch */}
      <div className="grid w-full max-w-full min-w-0 w-fit grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "plan" ? "default" : "outline"}
          onClick={() => setMode("plan")}
        >
          From plan
        </Button>
        <Button
          type="button"
          variant={mode === "custom" ? "default" : "outline"}
          onClick={() => setMode("custom")}
        >
          Custom spec
        </Button>
      </div>

      {mode === "plan" ? (
        plansError ? (
          <ErrorBanner error={plansError} />
        ) : plansLoading ? (
          <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No published plans.</p>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((candidate) => {
                const eligible = planIsUpgrade(
                  candidate,
                  instance.vcpu,
                  instance.ram_mb,
                  instance.disk_gb,
                )
                const selected = planId === candidate.id
                const card = (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={!eligible}
                    aria-pressed={selected}
                    onClick={() => selectPlan(candidate)}
                    className={`rounded-lg border p-4 text-left transition-colors enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="font-medium">{candidate.name}</span>
                      {candidate.featured ? <Badge>featured</Badge> : null}
                    </div>
                    <div className="mt-2 space-y-1 text-xs tabular-nums text-muted-foreground">
                      <p className="flex min-w-0 items-center gap-1.5">
                        <CpuIcon className="size-3.5" /> {candidate.vcpu} vCPU
                      </p>
                      <p className="flex min-w-0 items-center gap-1.5">
                        <MemoryStickIcon className="size-3.5" /> {candidate.ram_mb} MB RAM
                      </p>
                      <p className="flex min-w-0 items-center gap-1.5">
                        <HardDriveIcon className="size-3.5" /> {candidate.disk_gb} GB NVMe
                      </p>
                    </div>
                  </button>
                )
                return eligible ? (
                  card
                ) : (
                  <Tooltip key={candidate.id}>
                    <TooltipTrigger asChild>{card}</TooltipTrigger>
                    <TooltipContent>Upgrade only</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        )
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:max-w-md sm:grid sm:grid-cols-3">
            <UpgradeOnlyField tooltip="Upgrade only — cannot go below the current spec">
              <Label htmlFor="resize-cpu">vCPU (min {instance.vcpu})</Label>
              <Input
                id="resize-cpu"
                type="number"
                min={instance.vcpu}
                value={cpu}
                onChange={(event) =>
                  setCpu(Math.max(instance.vcpu, Number(event.target.value) || instance.vcpu))
                }
              />
            </UpgradeOnlyField>
            <UpgradeOnlyField tooltip="Upgrade only — cannot go below the current spec">
              <Label htmlFor="resize-ram">RAM MB (min {instance.ram_mb})</Label>
              <Input
                id="resize-ram"
                type="number"
                min={instance.ram_mb}
                value={ram}
                onChange={(event) =>
                  setRam(Math.max(instance.ram_mb, Number(event.target.value) || instance.ram_mb))
                }
              />
            </UpgradeOnlyField>
            <UpgradeOnlyField tooltip="Upgrade only — cannot go below the current spec">
              <Label htmlFor="resize-disk">Disk GB (min {instance.disk_gb})</Label>
              <Input
                id="resize-disk"
                type="number"
                min={instance.disk_gb}
                value={disk}
                onChange={(event) =>
                  setDisk(Math.max(instance.disk_gb, Number(event.target.value) || instance.disk_gb))
                }
              />
            </UpgradeOnlyField>
          </div>
        </TooltipProvider>
      )}

      {/* Billing + live quote */}
      <Card>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:max-w-md sm:grid sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <div className="flex gap-2">
                {["IDR"].map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={currency === code ? "default" : "outline"}
                    onClick={() => setCurrency(code)}
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
                    onClick={() => setBillingPeriod(period)}
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
              Live estimate unavailable ({quoteError}). You can still resize; the final price
              follows the rate card.
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
              <p className="tabular-nums text-muted-foreground">
                subtotal {formatMoney(quote.subtotal, quote.currency)} · discount{" "}
                {formatMoney(quote.discount, quote.currency)} · tax{" "}
                {formatMoney(quote.tax, quote.currency)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pick a size above to see pricing…</p>
          )}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Current price{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatMoney(instance.recurring_amount ?? 0, instance.currency)} /{" "}
                {instance.billing_period ?? "period"}
              </span>
            </p>
            <Button disabled={!increased || submitting} onClick={() => setConfirmOpen(true)}>
              <ScalingIcon /> Apply resize…
            </Button>
          </div>
          {!increased ? (
            <p className="text-xs text-muted-foreground">
              Increase at least one dimension above the current spec to continue.
            </p>
          ) : null}
          {downgraded ? (
            <p className="text-xs text-destructive">
              Every dimension must be ≥ the current spec (upgrade only).
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Old → new confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resize “{instance.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This applies the new spec at the provider and adjusts billing. Downgrades are not
              possible later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border text-sm">
            {summaryRows.map((row) => (
              <div
                key={row.label}
                className="flex min-w-0 items-center justify-between gap-4 border-b px-3 py-2 last:border-b-0"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">
                  {row.from.toLocaleString()}
                  {row.unit} <span className="text-muted-foreground">→</span>{" "}
                  {row.to.toLocaleString()}
                  {row.unit}
                </span>
              </div>
            ))}
          </div>
          {quote ? (
            <p className="text-sm tabular-nums">
              New estimate{" "}
              <span className="font-semibold">{formatMoney(quote.total, quote.currency)}</span> per{" "}
              {quote.billing_period ?? billingPeriod} period
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault()
                void applyResize()
              }}
            >
              {submitting ? <Loader2Icon className="animate-spin" /> : null} Apply resize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SpecBox({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="space-y-1">
      <p className="flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/** Wraps a form field whose value is clamped to the current spec. */
function UpgradeOnlyField({
  tooltip,
  children,
}: {
  tooltip: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1.5">{children}</div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
