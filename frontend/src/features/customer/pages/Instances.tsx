// Customer instances: list with state badges, links into the per-instance
// deep-dive pages, power actions, and destructive delete that requires typing
// the instance name. Creation happens on the full-page wizard at
// /app/instances/new.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
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
import { Badge } from "@/components/ui/badge"
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
import type { CustomerInstance } from "../instances/types"

export default function CustomerInstancesPage() {
  const { orgId } = useOrg()
  const [instances, setInstances] = useState<CustomerInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const [selected, setSelected] = useState<CustomerInstance | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

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
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
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
          <Link
            to={`/app/instances/${row.id}`}
            className="block max-w-56 truncate font-medium underline-offset-4 hover:underline"
          >
            {row.name}
          </Link>
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
          <Button asChild>
            <Link to="/app/instances/new">
              <PlusIcon /> Create instance
            </Link>
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
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
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
