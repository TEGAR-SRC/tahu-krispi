// Instance overview: full detail, power actions (with confirms for the
// destructive ones), quick tiles to the sub-pages, and typed-name delete.
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ActivityIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeCircleIcon,
  HardDriveIcon,
  Loader2Icon,
  MemoryStickIcon,
  NetworkIcon,
  PauseIcon,
  PlayIcon,
  PlugZapIcon,
  PowerOffIcon,
  RotateCwIcon,
  ScrollTextIcon,
  ShieldIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
import { toast } from "sonner"
import { apiDelete, apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../../components"
import { formatDateTime, formatMoney } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"
import { InstanceBreadcrumb, useInstance, type InstanceDetail } from "./shared"

type PowerAction = "start" | "stop" | "reboot" | "reset" | "pause" | "resume" | "hibernate"

/** Actions that must pass a confirmation dialog before they run. */
const CONFIRMED_ACTIONS: ReadonlySet<PowerAction> = new Set(["stop", "reset", "hibernate"])

interface QuickTile {
  to: string
  label: string
  description: string
  icon: ReactNode
}

export default function InstanceOverviewPage() {
  const { instanceId } = useParams()
  const navigate = useNavigate()
  const { orgId } = useOrg()
  const { instance, loading, error, reload } = useInstance(instanceId)

  const [busyAction, setBusyAction] = useState<PowerAction | null>(null)
  const [confirmAction, setConfirmAction] = useState<PowerAction | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState("")
  const [deleting, setDeleting] = useState(false)

  // Poll the detail while a power action is in flight so the new state shows up.
  useEffect(() => {
    if (!busyAction) return
    const interval = window.setInterval(() => void reload(), 4000)
    return () => window.clearInterval(interval)
  }, [busyAction, reload])

  const runPowerAction = useCallback(
    async (action: PowerAction) => {
      if (!instance || !orgId) return
      setBusyAction(action)
      try {
        await apiPost(
          `/instances/${instance.id}/${action}`,
          {},
          { headers: orgHeaders(orgId) },
        )
        toast.success(`${instance.name}: ${action} accepted`)
        setTimeout(() => void reload(), 2500)
      } catch (cause) {
        // VM-only routes answer 501 on containers — surface the API's message.
        toast.error(
          cause instanceof ApiError ? cause.message : `Failed to ${action} instance`,
        )
      } finally {
        setBusyAction(null)
        setConfirmAction(null)
      }
    },
    [instance, orgId, reload],
  )

  const requestPowerAction = (action: PowerAction) => {
    if (CONFIRMED_ACTIONS.has(action)) {
      setConfirmAction(action)
    } else {
      void runPowerAction(action)
    }
  }

  const runDelete = async () => {
    if (!instance || !orgId) return
    setDeleting(true)
    try {
      await apiDelete(`/instances/${instance.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Instance "${instance.name}" deleted`)
      navigate("/app/instances")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete instance")
    } finally {
      setDeleting(false)
    }
  }

  if (loading && !instance) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <InstanceBreadcrumb section="Overview" />
        <ErrorBanner error={error} />
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="flex flex-col gap-6">
        <InstanceBreadcrumb section="Overview" />
        <p className="text-sm text-muted-foreground">Instance not found.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance.name} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{instance.name}</h1>
            <StatusBadge status={instance.status} />
            {instance.power_status && instance.power_status !== instance.status ? (
              <StatusBadge status={instance.power_status} />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {instance.public_id ? `${instance.public_id} · ` : ""}
            created {formatDateTime(instance.created_at)}
          </p>
        </div>

        {/* Power controls */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["start", PlayIcon],
              ["stop", PowerOffIcon],
              ["reboot", RotateCwIcon],
              ["reset", PlugZapIcon],
              ["pause", PauseIcon],
              ["resume", PlayIcon],
              ["hibernate", PowerOffIcon],
            ] as Array<[PowerAction, typeof PlayIcon]>
          ).map(([action, Icon]) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={busyAction !== null}
              title={
                action === "reset" || action === "pause" || action === "hibernate"
                  ? `${action} (VM-only)`
                  : undefined
              }
              onClick={() => requestPowerAction(action)}
            >
              {busyAction === action ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <Icon />
              )}
              <span className="capitalize">{action}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Spec tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SpecTile icon={<CpuIcon />} label="vCPU" value={String(instance.vcpu)} />
        <SpecTile
          icon={<MemoryStickIcon />}
          label="RAM"
          value={`${instance.ram_mb.toLocaleString()} MB`}
        />
        <SpecTile icon={<HardDriveIcon />} label="Disk" value={`${instance.disk_gb} GB`} />
        <SpecTile
          icon={<ActivityIcon />}
          label="Service kind"
          value={instance.service_kind || "vm"}
          hint={
            instance.service_kind === "container"
              ? "VM-only features (VNC, agent, pause…) are unavailable"
              : undefined
          }
        />
      </div>

      {/* Connection + billing summary */}
      <Card>
        <CardContent className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <DetailRow label="IPv4" value={instance.primary_ipv4 || "—"} mono />
          <DetailRow label="IPv6" value={instance.primary_ipv6 || "—"} mono />
          <DetailRow
            label="Price"
            value={`${formatMoney(instance.recurring_amount ?? 0, instance.currency)} / ${instance.billing_period ?? "period"}`}
          />
          <DetailRow
            label="Snapshots / backups"
            value={`${instance.child_counts?.snapshots ?? 0} / ${instance.child_counts?.backups ?? 0}`}
          />
        </CardContent>
      </Card>

      {/* Quick tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quickTiles(instance).map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="rounded-lg border p-4 transition-colors hover:bg-muted"
          >
            <div className="flex items-center gap-2 font-medium">
              <span className="[&_svg]:size-4 [&_svg]:text-muted-foreground">{tile.icon}</span>
              {tile.label}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{tile.description}</p>
          </Link>
        ))}
      </div>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="font-medium text-destructive">Delete this instance</p>
            <p className="text-sm text-muted-foreground">
              Terminates the instance at the provider. Data is lost.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon /> Delete…
          </Button>
        </CardContent>
      </Card>

      {/* Confirmations for stop/reset/hibernate */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="capitalize">
              {confirmAction ?? ""} “{instance.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "stop"
                ? "The instance will be powered off. Running workloads are interrupted."
                : confirmAction === "reset"
                  ? "A hard reset cuts power instantly — unsaved data in the guest can be lost."
                  : "The instance is suspended to disk and stops consuming CPU/RAM until resumed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (confirmAction) void runPowerAction(confirmAction)
              }}
            >
              {busyAction ? <Loader2Icon className="animate-spin" /> : null}{" "}
              <span className="capitalize">Confirm {confirmAction}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Typed-name delete */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{instance.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This terminates the instance and its data is lost. Type the instance name to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteTyped}
            onChange={(event) => setDeleteTyped(event.target.value)}
            placeholder={instance.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting || deleteTyped !== instance.name}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {deleting ? <Loader2Icon className="animate-spin" /> : null} Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function quickTiles(instance: InstanceDetail): QuickTile[] {
  const base = `/app/instances/${instance.id}`
  return [
    {
      to: `${base}/metrics`,
      label: "Metrics",
      description: "CPU, memory, disk & network series",
      icon: <GaugeCircleIcon />,
    },
    {
      to: `${base}/console`,
      label: "Console",
      description:
        instance.service_kind === "container" ? "Serial console" : "VNC & serial console",
      icon: <TerminalIcon />,
    },
    {
      to: `${base}/firewall`,
      label: "Firewall",
      description: "Rules, options & ipsets",
      icon: <ShieldIcon />,
    },
    {
      to: `${base}/agent`,
      label: "Guest agent",
      description: "OS info, filesystems, ping",
      icon: <DatabaseIcon />,
    },
    {
      to: `${base}/network`,
      label: "Network",
      description: "Reverse DNS, BGP, reserved IPs",
      icon: <NetworkIcon />,
    },
    {
      to: `${base}/notes-tags`,
      label: "Notes & tags",
      description: "Free-form notes and labels",
      icon: <ScrollTextIcon />,
    },
    {
      to: `${base}/snapshots`,
      label: "Snapshots & backups",
      description: "Create, restore, download",
      icon: <HardDriveIcon />,
    },
  ]
}

function SpecTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="[&_svg]:size-4">{icon}</span>
          {label}
        </div>
        <p className="mt-1 text-xl font-semibold tabular-nums capitalize">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}
