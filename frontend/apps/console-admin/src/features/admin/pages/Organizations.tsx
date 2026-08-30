// Platform-admin organizations directory (GET /admin/organizations). The
// endpoint supports pagination only — no search/status query params (verified
// against the live API) — so the table is purely paginated. The org name and
// the per-row Open button both link to the detail page.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { Button } from "@/components/ui/button"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "./shared"
import { formatDateTime } from "./format"
import type { AdminOrgRow } from "./identityLookup"

const PER_PAGE = 20

export default function OrganizationsPage() {
  const [rows, setRows] = useState<AdminOrgRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const bulk = useBulkSelection<AdminOrgRow>((row) => row.id)

  useEffect(() => {
    let cancelled = false
    apiGet<AdminOrgRow[]>("/admin/organizations", { query: { page, per_page: PER_PAGE } })
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
  }, [page])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Organizations"
        description="Every customer organization on the platform, newest first."
      />

      <BulkActionBar selectedCount={bulk.selectedKeys.size} actions={[]} />

      <SimpleDataTable<AdminOrgRow>
        columns={[
          {
            key: "name",
            header: "Organization",
            render: (row) => (
              <div className="min-w-0">
                <Link
                  to={`/admin/organizations/${row.id}`}
                  className="min-w-0 block truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {row.name || row.slug}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">{row.slug}</p>
              </div>
            ),
          },
          {
            key: "public_id",
            header: "Public ID",
            className: "hidden md:table-cell",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">{row.public_id}</span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "billing_email",
            header: "Billing email",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="min-w-0 truncate text-muted-foreground">{row.billing_email || "—"}</span>
            ),
          },
          {
            key: "member_count",
            header: "Members",
            render: (row) => <span>{row.member_count}</span>,
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden xl:table-cell",
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
                <Link to={`/admin/organizations/${row.id}`}>Open</Link>
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
        emptyMessage="No organizations yet."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </div>
  )
}
