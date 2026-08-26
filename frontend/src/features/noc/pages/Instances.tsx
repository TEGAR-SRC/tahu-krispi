import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  EyeIcon,
  Loader2Icon,
  PowerIcon,
  PowerOffIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import {
  type InstanceDetail,
  type InstanceRow,
  StatusBadge,
} from "../lib"
import { fmtDateTime, formatMoney, previewValue, toastApiError } from "../lib-utils"

const PER_PAGE = 20
const INSTANCE_STATES = [
  "all",
  "active",
  "provisioning",
  "suspended",
  "stopped",
  "failed",
  "pending",
  "deleting",
] as const

type Operation = "suspend" | "unsuspend" | "terminate" | "migrate" | null

/** Optional columns; name/status/actions are always shown. */
const TOGGLEABLE_COLUMNS = ["org_slug", "power_status", "resources", "created_at"] as const
type ToggleableColumn = (typeof TOGGLEABLE_COLUMNS)[number]

const COLUMN_LABELS: Record<ToggleableColumn, string> = {
  org_slug: "Organization",
  power_status: "Power",
  resources: "vCPU / RAM / Disk",
  created_at: "Created",
}

export default function NocInstancesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<InstanceRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // State filtering runs server-side via ?status= so pagination stays correct.
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [orgQuery, setOrgQuery] = useState("")
  const [visibleColumns, setVisibleColumns] = useState<Set<ToggleableColumn>>(
    new Set(TOGGLEABLE_COLUMNS),
  )

  const [sheetId, setSheetId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)

  const [pendingOp, setPendingOp] = useState<Operation>(null)
  const [confirmTerminate, setConfirmTerminate] = useState(false)
  const [targetNode, setTargetNode] = useState("")

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const envelope = await apiGet<InstanceRow[]>("/admin/instances", {
          query: {
            page: targetPage,
            per_page: PER_PAGE,
            ...(statusFilter !== "all" ? { status: statusFilter } : {}),
          },
        })
        setRows(envelope.data)
        setTotal(envelope.meta?.total ?? envelope.data.length)
        setPage(targetPage)
        setError(null)
      } catch (cause) {
        setError(cause)
      } finally {
        setLoading(false)
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(1), 0)
    return () => clearTimeout(t)
  }, [load])

  const openDetail = useCallback(async (id: string) => {
    setSheetId(id)
    setDetail(null)
    setDetailError(null)
    setTargetNode("")
    setDetailLoading(true)
    try {
      const envelope = await apiGet<InstanceDetail>(`/admin/instances/${id}`)
      setDetail(envelope.data)
    } catch (cause) {
      setDetailError(cause)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const runOperation = useCallback(
    async (op: Exclude<Operation, null>) => {
      if (!detail) return
      setPendingOp(op)
      try {
        if (op === "suspend") {
          await apiPost(`/admin/instances/${detail.id}/suspend`)
          toast.success(`Suspend queued for ${detail.name}`)
        } else if (op === "unsuspend") {
          await apiPost(`/admin/instances/${detail.id}/unsuspend`)
          toast.success(`Unsuspend queued for ${detail.name}`)
        } else if (op === "terminate") {
          await apiPost(`/admin/instances/${detail.id}/terminate`)
          toast.success(`Termination requested for ${detail.name}`)
          setConfirmTerminate(false)
        } else if (op === "migrate") {
          await apiPost(`/admin/instances/${detail.id}/migrate`, { target_node: targetNode.trim() })
          toast.success(`Migration to ${targetNode.trim()} queued for ${detail.name}`)
        }
        await Promise.all([load(page), openDetail(detail.id)])
      } catch (cause) {
        toastApiError(cause, `Could not ${op} instance`)
      } finally {
        setPendingOp(null)
      }
    },
    [detail, targetNode, load, page, openDetail],
  )

  // Org filter stays client-side over the fetched page; the backend exposes no
  // ?organization= parameter on this endpoint.
  const filtered = rows.filter((row) =>
    orgQuery
      ? `${row.org_slug} ${row.org_public_id}`.toLowerCase().includes(orgQuery.toLowerCase())
      : true,
  )

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const toggleColumn = (column: ToggleableColumn) => {
    setVisibleColumns((current) => {
      const next = new Set(current)
      if (next.has(column)) next.delete(column)
      else next.add(column)
      return next
    })
  }

  const cellFor = (row: InstanceRow, column: ToggleableColumn): ReactNode => {
    switch (column) {
      case "org_slug":
        return row.org_slug
      case "power_status":
        return row.power_status ? <Badge variant="outline">{row.power_status}</Badge> : "—"
      case "resources":
        return `${row.vcpu} vCPU · ${row.ram_mb} MB · ${row.disk_gb} GB`
      case "created_at":
        return fmtDateTime(row.created_at)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Fleet inventory and lifecycle operations."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by organization…"
          value={orgQuery}
          onChange={(event) => setOrgQuery(event.target.value)}
          className="w-64"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontalIcon /> Columns <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            {TOGGLEABLE_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={visibleColumns.has(column)}
                onCheckedChange={() => toggleColumn(column)}
              >
                {COLUMN_LABELS[column]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-sm text-muted-foreground">
          {filtered.length} on this page · {total} total
        </span>
      </div>

      {/* Saved state presets */}
      <div className="flex flex-wrap gap-2">
        {INSTANCE_STATES.map((state) => (
          <Button
            key={state}
            size="sm"
            variant={statusFilter === state ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs capitalize"
            aria-pressed={statusFilter === state}
            disabled={loading && statusFilter !== state}
            onClick={() => setStatusFilter(state)}
          >
            {state === "all" ? "All states" : state}
          </Button>
        ))}
      </div>

      {error ? (
        <ErrorBanner error={error} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, rowIndex) => (
            <Skeleton key={rowIndex} className="h-9 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No instances match the current filters.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                {[...visibleColumns].map((column) => (
                  <TableHead key={column}>{COLUMN_LABELS[column]}</TableHead>
                ))}
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => void navigate(`/noc/instances/${row.id}`)}
                >
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.public_id}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  {[...visibleColumns].map((column) => (
                    <TableCell key={column}>{cellFor(row, column)}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div
                      className="flex justify-end gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Quick inspect ${row.name}`}
                        onClick={() => void openDetail(row.id)}
                      >
                        <EyeIcon />
                      </Button>
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          to={`/noc/instances/${row.id}`}
                          aria-label={`Open full details for ${row.name}`}
                        >
                          <ExternalLinkIcon />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => void load(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => void load(page + 1)}
        >
          Next
        </Button>
      </div>

      {/* ---- Quick-inspect sheet with lifecycle ops ---- */}
      <Sheet open={sheetId !== null} onOpenChange={(open) => !open && setSheetId(null)}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              Instance quick actions
              {detail ? <StatusBadge status={detail.status} /> : null}
            </SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-2">
              {detail ? `${detail.name} · ${detail.public_id}` : "Loading…"}
              {detail ? (
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/noc/instances/${detail.id}`}>
                    Full details <ExternalLinkIcon />
                  </Link>
                </Button>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 pb-6">
            {detailLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Loading instance…
              </div>
            ) : detailError ? (
              <p className="text-destructive text-sm">
                Failed to load instance:{" "}
                {detailError instanceof Error ? detailError.message : "request failed"}
              </p>
            ) : detail ? (
              <>
                <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <InfoLine label="Status" value={<StatusBadge status={detail.status} />} />
                  <InfoLine
                    label="Power"
                    value={
                      detail.power_status ? (
                        <Badge variant="outline">{detail.power_status}</Badge>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <InfoLine
                    label="Organization"
                    value={`${detail.organization?.slug ?? detail.org_slug} (${detail.organization?.name ?? "—"})`}
                  />
                  <InfoLine label="Hostname" value={previewValue(detail.hostname)} />
                  <InfoLine label="Provider" value={detail.provider_id} />
                  <InfoLine label="Region" value={previewValue(detail.region_id)} />
                  <InfoLine label="Primary IPv4" value={previewValue(detail.primary_ipv4)} />
                  <InfoLine label="Primary IPv6" value={previewValue(detail.primary_ipv6)} />
                  <InfoLine
                    label="Recurring amount"
                    value={formatMoney(detail.recurring_amount, detail.currency)}
                  />
                  <InfoLine
                    label="Billing"
                    value={`${detail.pricing_mode} · ${detail.billing_period}`}
                  />
                  <InfoLine label="Sync status" value={detail.sync_status || "—"} />
                  <InfoLine label="Last synced" value={fmtDateTime(detail.last_synced_at)} />
                  <InfoLine label="Created" value={fmtDateTime(detail.created_at)} />
                  <InfoLine label="Updated" value={fmtDateTime(detail.updated_at)} />
                  <InfoLine
                    label="Snapshots / backups"
                    value={
                      detail.child_counts
                        ? `${detail.child_counts.snapshots ?? 0} / ${detail.child_counts.backups ?? 0}`
                        : "—"
                    }
                  />
                  <InfoLine
                    label="Auto backup"
                    value={detail.auto_backup_enabled ? "enabled" : "disabled"}
                  />
                </section>

                {detail.provider_actions && detail.provider_actions.length > 0 ? (
                  <section className="space-y-2">
                    <p className="text-sm font-medium">Provider actions</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.provider_actions.map((action) => (
                        <Badge key={action} variant="secondary">
                          {action}
                        </Badge>
                      ))}
                    </div>
                  </section>
                ) : null}

                <Separator />

                <section className="space-y-3">
                  <p className="text-sm font-medium">Operations</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        pendingOp !== null ||
                        ["suspended", "deleting", "deleted"].includes(detail.status)
                      }
                      onClick={() => void runOperation("suspend")}
                    >
                      {pendingOp === "suspend" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <PowerOffIcon />
                      )}
                      Suspend
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingOp !== null || detail.status !== "suspended"}
                      onClick={() => void runOperation("unsuspend")}
                    >
                      {pendingOp === "unsuspend" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <PowerIcon />
                      )}
                      Unsuspend
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pendingOp !== null || ["deleting", "deleted"].includes(detail.status)}
                      onClick={() => setConfirmTerminate(true)}
                    >
                      <Trash2Icon /> Terminate…
                    </Button>
                  </div>

                  <div className="rounded-md border p-3">
                    <Label htmlFor="migrate-target" className="text-sm font-medium">
                      Migrate to node
                    </Label>
                    <p className="mt-1 mb-2 text-xs text-muted-foreground">
                      Cross-node migration is only accepted for self-hosted Proxmox instances; the
                      backend rejects other kinds with a clear error.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        id="migrate-target"
                        placeholder="target node name"
                        value={targetNode}
                        onChange={(event) => setTargetNode(event.target.value)}
                        className="max-w-56"
                      />
                      <Button
                        size="sm"
                        disabled={pendingOp !== null || targetNode.trim() === ""}
                        onClick={() => void runOperation("migrate")}
                      >
                        {pendingOp === "migrate" ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <ArrowLeftRightIcon />
                        )}
                        Queue migration
                      </Button>
                    </div>
                  </div>
                </section>

                {detail.jobs && detail.jobs.length > 0 ? (
                  <section className="space-y-2">
                    <p className="text-sm font-medium">Recent jobs</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {detail.jobs.slice(0, 5).map((job) => (
                        <li key={job.id} className="flex items-center gap-2">
                          <StatusBadge status={job.status} />
                          <span>{job.job_type}</span>
                          <span>·</span>
                          <span>{fmtDateTime(job.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---- Terminate confirmation ---- */}
      <AlertDialog open={confirmTerminate} onOpenChange={setConfirmTerminate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force terminate instance?</AlertDialogTitle>
            <AlertDialogDescription>
              This requests termination of {detail?.name ?? "the instance"} and enqueues a
              destructive job. The action cannot be undone from the console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingOp === "terminate"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingOp === "terminate"}
              onClick={(event) => {
                event.preventDefault()
                void runOperation("terminate")
              }}
            >
              {pendingOp === "terminate" ? <Loader2Icon className="animate-spin" /> : null}
              Request termination
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </div>
  )
}
