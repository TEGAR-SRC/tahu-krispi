// Security incidents queue (GET /admin/security-incidents + POST .../resolve).
// Status filter is server-side (?status=open|investigating|resolved|dismissed —
// the exact enum accepted by the backend). Resolving has no request body and
// flips status to resolved; already-resolved rows are hidden from the action.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "../shared"
import { formatDateTime } from "../format"

interface IncidentRow {
  id: string
  user_id: string | null
  user_email: string
  organization_id: string | null
  org_slug: string
  type: string
  severity: string
  status: string
  description: string
  created_at: string
  resolved_at: string
}

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"]
const PER_PAGE = 20

export default function SecurityIncidentsPage() {
  const [rows, setRows] = useState<IncidentRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Row currently opened in the resolve confirmation.
  const [resolving, setResolving] = useState<IncidentRow | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<IncidentRow[]>("/admin/security-incidents", {
      query: {
        page,
        per_page: PER_PAGE,
        status: status === "all" ? null : status,
      },
    })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, status, reloadTick])

  const resolveIncident = useCallback(async () => {
    if (!resolving) return
    try {
      await apiPost(`/admin/security-incidents/${resolving.id}/resolve`)
      toast.success("Incident resolved")
      setResolving(null)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to resolve incident",
      )
    }
  }, [resolving])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security incidents"
        description="Sign-in anomalies and abuse signals across the platform."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-47.5">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INCIDENT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable<IncidentRow>
        columns={[
          {
            key: "type",
            header: "Incident",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium capitalize">{row.type || "—"}</p>
                <p className="truncate text-xs text-muted-foreground" title={row.description}>
                  {row.description || "—"}
                </p>
              </div>
            ),
          },
          {
            key: "severity",
            header: "Severity",
            render: (row) => <SeverityChip value={row.severity} />,
          },
          {
            key: "user_email",
            header: "User / org",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate text-sm">{row.user_email || "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{row.org_slug || "—"}</p>
              </div>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "created_at",
            header: "Detected",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "resolved_at",
            header: "Resolved",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.resolved_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-28 text-right",
            render: (row) =>
              row.status === "resolved" ? null : (
                <Button variant="outline" size="sm" onClick={() => setResolving(row)}>
                  Resolve
                </Button>
              ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No incidents recorded for this filter."
        skeletonRows={6}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog open={resolving !== null} onOpenChange={(open) => !open && setResolving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve this incident?</AlertDialogTitle>
            <AlertDialogDescription>
              {resolving
                ? `${resolving.type} — ${resolving.user_email || resolving.org_slug || "unknown scope"}. `
                : ""}
              The incident will be marked resolved with the current timestamp; this cannot be
              undone from the console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resolveIncident()}>
              Resolve incident
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Severity chip; critical/high stand out, everything else stays muted. */
function SeverityChip({ value }: { value?: string | null }) {
  if (!value) return <span className="text-sm text-muted-foreground">—</span>
  const tone =
    value === "critical" || value === "high"
      ? "bg-destructive/15 text-destructive"
      : value === "medium"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {value}
    </span>
  )
}
