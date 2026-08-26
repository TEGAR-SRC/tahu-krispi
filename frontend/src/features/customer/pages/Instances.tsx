// Customer instances: list with state badges, provisioning wizard (plan or
// custom spec + live price quote), power actions, and destructive delete that
// requires typing the instance name.
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  PowerOffIcon,
  RotateCwIcon,
  SearchIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import { InstanceDetailSheet } from "../instances/InstanceDetailSheet"
import type { CustomerInstance, Plan, PriceQuote, Region } from "../instances/types"

const BILLING_PERIODS = ["hourly", "monthly", "quarterly", "semiannual", "annual"] as const

export default function CustomerInstancesPage() {
  const { orgId } = useOrg()
  const [instances, setInstances] = useState<CustomerInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const [selected, setSelected] = useState<CustomerInstance | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  // Pending destructive actions: stop / reboot confirm + typed delete.
  const [confirmAction, setConfirmAction] = useState<{
    instance: CustomerInstance
    action: "stop" | "reboot"
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomerInstance | null>(null)
  const [deleteTyped, setDeleteTyped] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<CustomerInstance[]>("/instances", {
        headers: orgHeaders(orgId),
      })
      setInstances(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return instances.filter((instance) => {
      if (statusFilter !== "all" && instance.status !== statusFilter) return false
      if (!query) return true
      return (
        instance.name.toLowerCase().includes(query) ||
        (instance.primary_ipv4 ?? "").includes(query) ||
        (instance.public_id ?? "").toLowerCase().includes(query)
      )
    })
  }, [instances, search, statusFilter])

  const statuses = useMemo(
    () => Array.from(new Set(instances.map((instance) => instance.status))).sort(),
    [instances],
  )

  const runPowerAction = async () => {
    if (!confirmAction || !orgId) return
    const { instance, action } = confirmAction
    setBusy(true)
    try {
      await apiPost(`/instances/${instance.id}/${action}`, {}, { headers: orgHeaders(orgId) })
      toast.success(`${instance.name}: ${action} requested`)
      setConfirmAction(null)
      setTimeout(() => void load(), 2500)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : `Failed to ${action} instance`)
    } finally {
      setBusy(false)
    }
  }

  const runStart = async (instance: CustomerInstance) => {
    try {
      await apiPost(`/instances/${instance.id}/start`, {}, { headers: orgHeaders(orgId) })
      toast.success(`${instance.name}: start requested`)
      setTimeout(() => void load(), 2500)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to start instance")
    }
  }

  const runDelete = async () => {
    if (!deleteTarget || !orgId) return
    setBusy(true)
    try {
      await apiDelete(`/instances/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Instance "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      setDeleteTyped("")
      setDetailOpen(false)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete instance")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<CustomerInstance>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.public_id ?? row.id}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "State",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={row.status} />
          {row.power_status && row.power_status !== row.status ? (
            <StatusBadge status={row.power_status} />
          ) : null}
        </div>
      ),
    },
    {
      key: "spec",
      header: "Spec",
      render: (row) => (
        <span className="tabular-nums text-sm">
          {row.vcpu} vCPU · {row.ram_mb} MB · {row.disk_gb} GB
        </span>
      ),
    },
    {
      key: "primary_ipv4",
      header: "IPv4",
      render: (row) => <span className="font-mono text-sm">{row.primary_ipv4 || "—"}</span>,
    },
    {
      key: "recurring_amount",
      header: "Price/mo",
      render: (row) => formatMoney(row.recurring_amount ?? 0, row.currency),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => <span className="text-sm">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-52",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="icon" variant="ghost" title="Start" onClick={() => void runStart(row)}>
            <PlayIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Stop…"
            onClick={() => setConfirmAction({ instance: row, action: "stop" })}
          >
            <PowerOffIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Reboot…"
            onClick={() => setConfirmAction({ instance: row, action: "reboot" })}
          >
            <RotateCwIcon />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected(row)
              setDetailOpen(true)
            }}
          >
            Manage
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Provision, control and inspect your virtual machines."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> Create instance
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, IP or id…"
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loading ? (
          <Badge variant="secondary">
            {filtered.length} of {instances.length}
          </Badge>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <SimpleDataTable
          columns={columns}
          rows={filtered}
          error={error}
          emptyMessage={
            instances.length === 0
              ? "No instances yet — create your first one."
              : "No instances match the current filter."
          }
          getRowKey={(row) => row.id}
        />
      )}

      <InstanceDetailSheet
        instance={detailOpen ? selected : null}
        onClose={() => setDetailOpen(false)}
        onChanged={() => void load()}
        onDeleteRequest={(instance) => {
          setDetailOpen(false)
          setDeleteTarget(instance)
          setDeleteTyped("")
        }}
      />

      <CreateInstanceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          void load()
        }}
      />

      {/* Stop/reboot confirmation */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === "stop" ? "Stop" : "Reboot"} “
              {confirmAction?.instance.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The instance will be {confirmAction?.action === "stop" ? "powered off" : "restarted"}{" "}
              through the provider. Running workloads will be interrupted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runPowerAction()
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Typed-name delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This terminates the instance and its data is lost. Type the instance name to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteTyped}
            onChange={(event) => setDeleteTyped(event.target.value)}
            placeholder={deleteTarget?.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy || deleteTyped !== deleteTarget?.name}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null} Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---- Provisioning wizard -----------------------------------------------------

function CreateInstanceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [regions, setRegions] = useState<Region[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [regionId, setRegionId] = useState("")
  const [mode, setMode] = useState<"plan" | "custom">("plan")
  const [planId, setPlanId] = useState("")
  const [cpu, setCpu] = useState(1)
  const [ram, setRam] = useState(1024)
  const [disk, setDisk] = useState(20)
  const [currency, setCurrency] = useState("IDR")
  const [billingPeriod, setBillingPeriod] = useState<string>("monthly")
  const [quote, setQuote] = useState<PriceQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setCatalogLoading(true)
    Promise.all([apiGet<Region[]>("/regions"), apiGet<Plan[]>("/plans")])
      .then(([regionsRes, plansRes]) => {
        setRegions((regionsRes.data ?? []).filter((region) => region.enabled))
        setPlans(plansRes.data ?? [])
      })
      .catch((cause) =>
        toast.error(cause instanceof Error ? cause.message : "Failed to load catalog"),
      )
      .finally(() => setCatalogLoading(false))
  }, [open])

  const plan = plans.find((candidate) => candidate.id === planId) ?? null

  // Live quote whenever a priceable selection is complete.
  useEffect(() => {
    if (!open || !regionId) return
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
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, regionId, mode, plan, cpu, ram, disk, currency, billingPeriod, orgId])

  const reset = () => {
    setName("")
    setRegionId("")
    setMode("plan")
    setPlanId("")
    setCpu(1)
    setRam(1024)
    setDisk(20)
    setCurrency("IDR")
    setBillingPeriod("monthly")
    setQuote(null)
    setQuoteError(null)
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!regionId) {
      toast.error("Choose a region")
      return
    }
    if (mode === "custom" && (cpu <= 0 || ram <= 0 || disk <= 0)) {
      toast.error("vCPU, RAM and disk must be positive")
      return
    }
    setSubmitting(true)
    try {
      await apiPost<CustomerInstance>(
        "/instances",
        {
          name: name.trim(),
          region_id: regionId,
          cpu: mode === "plan" ? (plan?.vcpu ?? cpu) : cpu,
          ram: mode === "plan" ? (plan?.ram_mb ?? ram) : ram,
          disk: mode === "plan" ? (plan?.disk_gb ?? disk) : disk,
          currency,
          billing_period: billingPeriod,
          recurring_amount: quote?.total ?? 0,
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Instance provisioning started")
      reset()
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create instance")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create instance</DialogTitle>
          <DialogDescription>
            Pick a region and either a published plan or a custom spec. Pricing comes from the
            live quote API.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ci-name">Name *</Label>
            <Input
              id="ci-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-server-01"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Region *</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger>
                <SelectValue placeholder={catalogLoading ? "Loading…" : "Choose region"} />
              </SelectTrigger>
              <SelectContent>
                {regions.map((region) => (
                  <SelectItem key={region.id} value={region.id}>
                    {region.name} ({region.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Spec</Label>
            <div className="grid grid-cols-2 gap-2">
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
          </div>

          {mode === "plan" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.length === 0 && !catalogLoading ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">No plans available.</p>
              ) : null}
              {plans.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setPlanId(candidate.id)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    candidate.id === planId ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="block font-medium">{candidate.name}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {candidate.vcpu} vCPU · {candidate.ram_mb} MB · {candidate.disk_gb} GB
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ci-cpu">vCPU</Label>
                <Input
                  id="ci-cpu"
                  type="number"
                  min={1}
                  value={cpu}
                  onChange={(event) => setCpu(Math.max(1, Number(event.target.value) || 1))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ci-ram">RAM (MB)</Label>
                <Input
                  id="ci-ram"
                  type="number"
                  min={128}
                  step={128}
                  value={ram}
                  onChange={(event) => setRam(Math.max(128, Number(event.target.value) || 128))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ci-disk">Disk (GB)</Label>
                <Input
                  id="ci-disk"
                  type="number"
                  min={5}
                  value={disk}
                  onChange={(event) => setDisk(Math.max(5, Number(event.target.value) || 5))}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IDR">IDR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Billing period</Label>
              <Select value={billingPeriod} onValueChange={setBillingPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_PERIODS.map((period) => (
                    <SelectItem key={period} value={period} className="capitalize">
                      {period}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border px-3 py-2.5 text-sm">
            {quoteError ? (
              <p className="text-muted-foreground">
                Price estimate unavailable: {quoteError}. You can still create the instance.
              </p>
            ) : quote ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Estimated total ({quote.billing_period ?? billingPeriod}, incl. tax)
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(quote.total, quote.currency)}
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground">Choose region and spec to see pricing…</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2Icon className="animate-spin" /> : null} Create instance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
