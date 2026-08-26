// Instance detail side panel: overview + power actions, metrics, notes & tags,
// and the upgrade-only resize picker.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  HardDriveIcon,
  MemoryStickIcon,
  NetworkIcon,
  PlayIcon,
  PowerOffIcon,
  RotateCwIcon,
  SaveIcon,
  ScalingIcon,
  TagIcon,
  XIcon,
} from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import type { CustomerInstance, Plan } from "./types"

const TIMEFRAMES = ["hour", "day", "week", "month"] as const
type Timeframe = (typeof TIMEFRAMES)[number]

interface InstanceDetailSheetProps {
  instance: CustomerInstance | null
  onClose: () => void
  onChanged: () => void
  onDeleteRequest: (instance: CustomerInstance) => void
}

export function InstanceDetailSheet({
  instance,
  onClose,
  onChanged,
  onDeleteRequest,
}: InstanceDetailSheetProps) {
  const { orgId } = useOrg()
  const [current, setCurrent] = useState<CustomerInstance | null>(instance)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  useEffect(() => {
    setCurrent(instance)
  }, [instance])

  const refreshInstance = useCallback(async () => {
    if (!instance || !orgId) return
    try {
      const { data } = await apiGet<CustomerInstance>(`/instances/${instance.id}`, {
        headers: orgHeaders(orgId),
      })
      setCurrent(data)
    } catch {
      // Keep showing the stale copy; list refresh covers hard failures.
    }
  }, [instance, orgId])

  const runAction = async (action: "start" | "stop" | "reboot") => {
    if (!current || !orgId) return
    setActionBusy(action)
    try {
      await apiPost(`/instances/${current.id}/${action}`, {}, { headers: orgHeaders(orgId) })
      toast.success(`Instance ${action} requested`)
      setTimeout(() => {
        void refreshInstance()
        onChanged()
      }, 2000)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `Failed to ${action} instance`)
    } finally {
      setActionBusy(null)
    }
  }

  if (!instance) return null

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-xl">{current?.name ?? instance.name}</SheetTitle>
            <StatusBadge status={current?.status ?? instance.status} />
            {current?.power_status ? (
              <StatusBadge status={current.power_status} />
            ) : null}
          </div>
          <SheetDescription>
            {instance.public_id ? `${instance.public_id} · ` : ""}
            Created {formatDateTime(instance.created_at)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 px-4 pb-2">
          <Button size="sm" variant="outline" disabled={actionBusy !== null} onClick={() => void runAction("start")}>
            <PlayIcon /> Start
          </Button>
          <Button size="sm" variant="outline" disabled={actionBusy !== null} onClick={() => void runAction("stop")}>
            <PowerOffIcon /> Stop
          </Button>
          <Button size="sm" variant="outline" disabled={actionBusy !== null} onClick={() => void runAction("reboot")}>
            <RotateCwIcon /> Reboot
          </Button>
        </div>

        <Tabs defaultValue="overview" className="gap-4 px-4 pb-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="notes">Notes & Tags</TabsTrigger>
            <TabsTrigger value="resize">Resize</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab instance={current ?? instance} />
            <Button variant="destructive" className="mt-4 w-fit" onClick={() => onDeleteRequest(current ?? instance)}>
              Delete instance…
            </Button>
          </TabsContent>

          <TabsContent value="metrics">
            <MetricsTab instanceId={instance.id} />
          </TabsContent>

          <TabsContent value="notes">
            <NotesTagsTab instanceId={instance.id} onSaved={refreshInstance} />
          </TabsContent>

          <TabsContent value="resize">
            <ResizeTab
              instance={current ?? instance}
              onResized={() => {
                void refreshInstance()
                onChanged()
              }}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function OverviewTab({ instance }: { instance: CustomerInstance }) {
  const specs = [
    { icon: <HardDriveIcon />, label: "vCPU", value: String(instance.vcpu) },
    { icon: <MemoryStickIcon />, label: "RAM", value: `${instance.ram_mb} MB` },
    { icon: <HardDriveIcon />, label: "Disk", value: `${instance.disk_gb} GB` },
    {
      icon: <NetworkIcon />,
      label: "IPv4",
      value: instance.primary_ipv4 || "—",
    },
    { icon: <NetworkIcon />, label: "IPv6", value: instance.primary_ipv6 || "—" },
    {
      icon: <NetworkIcon />,
      label: "Service kind",
      value: instance.service_kind || "vm",
    },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {specs.map((spec) => (
          <Card key={spec.label}>
            <CardContent className="flex items-center gap-2 px-3 py-2.5 text-sm">
              <span className="[&_svg]:size-4 [&_svg]:text-muted-foreground">{spec.icon}</span>
              <span className="text-muted-foreground">{spec.label}</span>
              <span className="ml-auto truncate font-medium tabular-nums">{spec.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Recurring amount{" "}
        <span className="font-medium text-foreground">
          {formatMoney(instance.recurring_amount ?? 0, instance.currency)}
        </span>{" "}
        per month · bandwidth {instance.bandwidth_gb ? `${instance.bandwidth_gb} GB` : "—"}
      </p>
    </div>
  )
}

function MetricsTab({ instanceId }: { instanceId: string }) {
  const { orgId } = useOrg()
  const [timeframe, setTimeframe] = useState<Timeframe>("hour")
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<unknown>(`/instances/${instanceId}/metrics`, {
      headers: orgHeaders(orgId),
      query: { timeframe },
    })
      .then(({ data: payload }) => !cancelled && setData(payload))
      .catch((cause) => !cancelled && setError(cause))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId, timeframe])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="metric-timeframe" className="text-sm">
          Timeframe
        </Label>
        <Select value={timeframe} onValueChange={(value) => setTimeframe(value as Timeframe)}>
          <SelectTrigger id="metric-timeframe" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((tf) => (
              <SelectItem key={tf} value={tf} className="capitalize">
                {tf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ErrorBanner error={error} />
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data !== null && data !== undefined ? (
        <ScrollArea className="h-72 rounded-md border bg-muted/30 p-3">
          <pre className="text-xs leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
        </ScrollArea>
      ) : (
        <p className="text-sm text-muted-foreground">No metrics returned for this timeframe.</p>
      )}
    </div>
  )
}

function NotesTagsTab({ instanceId, onSaved }: { instanceId: string; onSaved: () => void }) {
  const { orgId } = useOrg()
  const [notes, setNotes] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [savingNotes, setSavingNotes] = useState(false)
  const [savingTags, setSavingTags] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiGet<{ notes?: string }>(`/instances/${instanceId}/notes`, { headers: orgHeaders(orgId) }),
      apiGet<{ tags?: string[] }>(`/instances/${instanceId}/tags`, { headers: orgHeaders(orgId) }),
    ])
      .then(([notesRes, tagsRes]) => {
        if (cancelled) return
        setNotes(notesRes.data?.notes ?? "")
        setTags(tagsRes.data?.tags ?? [])
      })
      .catch(() => {
        // Notes/tags are optional; leave the editors empty on failure.
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await apiPut(`/instances/${instanceId}/notes`, { notes }, { headers: orgHeaders(orgId) })
      toast.success("Notes saved")
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save notes")
    } finally {
      setSavingNotes(false)
    }
  }

  const addTag = () => {
    const value = tagDraft.trim().slice(0, 64)
    if (!value) return
    if (tags.length >= 32) {
      toast.error("At most 32 tags are allowed")
      return
    }
    if (!tags.includes(value)) setTags([...tags, value])
    setTagDraft("")
  }

  const saveTags = async () => {
    setSavingTags(true)
    try {
      await apiPut(`/instances/${instanceId}/tags`, { tags }, { headers: orgHeaders(orgId) })
      toast.success("Tags saved")
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save tags")
    } finally {
      setSavingTags(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="instance-notes">Notes</Label>
        <Textarea
          id="instance-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Operational notes for this instance…"
          rows={4}
        />
        <Button size="sm" onClick={() => void saveNotes()} disabled={savingNotes}>
          <SaveIcon /> {savingNotes ? "Saving…" : "Save notes"}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="instance-tags">Tags ({tags.length}/32)</Label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              <TagIcon className="size-3" />
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                onClick={() => setTags(tags.filter((item) => item !== tag))}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tags yet.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="instance-tags"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addTag()
              }
            }}
            placeholder="Add a tag (max 64 chars)"
          />
          <Button type="button" size="sm" variant="outline" onClick={addTag}>
            Add
          </Button>
        </div>
        <Button size="sm" onClick={() => void saveTags()} disabled={savingTags}>
          <SaveIcon /> {savingTags ? "Saving…" : "Save tags"}
        </Button>
      </div>
    </div>
  )
}

function specAtLeast(plan: Plan, instance: CustomerInstance): boolean {
  return plan.vcpu >= instance.vcpu && plan.ram_mb >= instance.ram_mb && plan.disk_gb >= instance.disk_gb
}

function ResizeTab({
  instance,
  onResized,
}: {
  instance: CustomerInstance
  onResized: () => void
}) {
  const { orgId } = useOrg()
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [cpu, setCpu] = useState(instance.vcpu)
  const [ram, setRam] = useState(instance.ram_mb)
  const [disk, setDisk] = useState(instance.disk_gb)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<Plan[]>("/plans")
      .then(({ data }) => !cancelled && setPlans(data ?? []))
      .catch(() => undefined)
      .finally(() => !cancelled && setPlansLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const unchanged = cpu === instance.vcpu && ram === instance.ram_mb && disk === instance.disk_gb
  const downgradeSelected = cpu < instance.vcpu || ram < instance.ram_mb || disk < instance.disk_gb

  const apply = async () => {
    setBusy(true)
    try {
      await apiPost(
        `/instances/${instance.id}/resize`,
        { cpu, ram, disk },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Resize applied")
      onResized()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Resize failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link to={`/app/instances/${instance.id}/resize`}>
          <ScalingIcon /> Open full-page resize
        </Link>
      </Button>

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
        Resize is upgrade-only: every dimension must be ≥ the current spec
        (provider policy). Smaller options are disabled.
      </p>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-muted-foreground">Current vCPU</p>
          <p className="font-medium tabular-nums">{instance.vcpu}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Current RAM</p>
          <p className="font-medium tabular-nums">{instance.ram_mb} MB</p>
        </div>
        <div>
          <p className="text-muted-foreground">Current disk</p>
          <p className="font-medium tabular-nums">{instance.disk_gb} GB</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Quick pick plan</Label>
        {plansLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plans published.</p>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((plan) => {
                const eligible = specAtLeast(plan, instance)
                const button = (
                  <button
                    key={plan.id}
                    type="button"
                    disabled={!eligible}
                    onClick={() => {
                      setCpu(plan.vcpu)
                      setRam(plan.ram_mb)
                      setDisk(plan.disk_gb)
                    }}
                    className="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block font-medium">{plan.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {plan.vcpu} vCPU · {plan.ram_mb} MB · {plan.disk_gb} GB
                    </span>
                  </button>
                )
                return eligible ? (
                  button
                ) : (
                  <Tooltip key={plan.id}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent>Upgrade only</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="resize-cpu">vCPU</Label>
          <Input
            id="resize-cpu"
            type="number"
            min={instance.vcpu}
            value={cpu}
            onChange={(event) => setCpu(Math.max(instance.vcpu, Number(event.target.value) || instance.vcpu))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resize-ram">RAM (MB)</Label>
          <Input
            id="resize-ram"
            type="number"
            min={instance.ram_mb}
            value={ram}
            onChange={(event) => setRam(Math.max(instance.ram_mb, Number(event.target.value) || instance.ram_mb))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resize-disk">Disk (GB)</Label>
          <Input
            id="resize-disk"
            type="number"
            min={instance.disk_gb}
            value={disk}
            onChange={(event) => setDisk(Math.max(instance.disk_gb, Number(event.target.value) || instance.disk_gb))}
          />
        </div>
      </div>

      <Button onClick={() => void apply()} disabled={busy || unchanged || downgradeSelected}>
        {busy ? "Applying…" : "Apply resize"}
      </Button>
      {downgradeSelected ? (
        <p className="text-xs text-destructive">Every dimension must be ≥ the current spec.</p>
      ) : null}
    </div>
  )
}

