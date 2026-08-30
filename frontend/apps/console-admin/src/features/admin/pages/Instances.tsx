// Platform-admin instance inventory: every instance across organizations with
// status filtering; rows navigate to the dedicated instance detail page which
// owns provider actions, jobs and child counts. States seen in the loaded rows
// are also surfaced as quick-links to the per-state boards
// (/admin/instances/state/:state).
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "./shared"
import { formatDateTime } from "./format"

interface AdminInstanceRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  name: string
  status: string
  power_status: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  suspended_at: string
  termination_requested_at: string
  created_at: string
}

const RESOURCE_STATUSES = [
  "draft",
  "pending",
  "provisioning",
  "active",
  "stopped",
  "suspended",
  "deleting",
  "deleted",
  "failed",
  "unknown",
]
const PER_PAGE = 20

export default function AdminInstancesPage() {
  const [rows, setRows] = useState<AdminInstanceRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const bulk = useBulkSelection<AdminInstanceRow>((row) => row.id)

  useEffect(() => {
    let cancelled = false
    apiGet<AdminInstanceRow[]>("/admin/instances", {
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
  }, [page, status])

  // States observed in the currently loaded rows drive the quick-link chips.
  const states = useMemo(
    () => [...new Set(rows.map((row) => row.status).filter(Boolean))].sort(),
    [rows],
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Instances"
        description="Every customer instance across all providers and organizations."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RESOURCE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {states.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">State boards:</span>
          {states.map((state) => (
            <Badge key={state} variant="secondary" asChild>
              <Link
                to={`/admin/instances/state/${encodeURIComponent(state)}`}
                className="capitalize hover:bg-secondary/80"
              >
                {state}
              </Link>
            </Badge>
          ))}
        </div>
      ) : null}

      <BulkActionBar selectedCount={bulk.selectedKeys.size} actions={[]} />

      <SimpleDataTable<AdminInstanceRow>
        columns={[
          {
            key: "name",
            header: "Instance",
            render: (row) => (
              <div className="min-w-0">
                <p className="min-w-0 truncate font-medium">{row.name}</p>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {row.public_id}
                </p>
              </div>
            ),
          },
          {
            key: "org_slug",
            header: "Organization",
            className: "hidden md:table-cell",
            render: (row) => <span className="text-muted-foreground">{row.org_slug}</span>,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge status={row.status} />
                {row.power_status ? (
                  <span className="text-xs text-muted-foreground">{row.power_status}</span>
                ) : null}
              </div>
            ),
          },
          {
            key: "vcpu",
            header: "Specs",
            render: (row) => (
              <span className="whitespace-nowrap text-sm tabular-nums">
                {row.vcpu} vCPU · {(row.ram_mb / 1024).toFixed(row.ram_mb % 1024 === 0 ? 0 : 1)} GB ·{" "}
                {row.disk_gb} GB
              </span>
            ),
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/instances/${row.id}`}>Detail</Link>
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No instances match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </div>
  )
}
