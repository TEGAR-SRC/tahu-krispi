import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { PaginationBar, StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime, formatMoney } from "@/features/admin/pages/format"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"

interface OnidelOrderRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  created_at: string
  completed_at: string
  cancelled_at: string
}

const ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "paid",
  "processing",
  "completed",
  "cancelled",
  "failed",
  "refunded",
] as const

const PER_PAGE = 20

export default function OnidelOrdersPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [orgFilter, setOrgFilter] = useState("")
  const [orgDraft, setOrgDraft] = useState("")

  const query = useMemo(
    () => ({
      page,
      per_page: PER_PAGE,
      status: status === "all" ? null : status,
      organization_id: orgFilter || null,
    }),
    [page, status, orgFilter],
  )

  const infraPath = providerId ? `/admin/onidel/${providerId}/orders` : null

  const infra = useInfraGet<OnidelOrderRow[]>(
    infraPath,
    query as Record<string, string | number | boolean | null | undefined>,
    { intervalMs: 5000 },
  )

  const rows = Array.isArray(infra.data) ? infra.data : []
  const meta = infra.meta as import("@/lib/types").PagedMeta & Record<string, unknown> | undefined
  const loading = infra.loading
  const error = infra.error

  const applyOrg = () => {
    setPage(1)
    setOrgFilter(orgDraft.trim())
  }

  const clearOrg = () => {
    setOrgDraft("")
    setPage(1)
    setOrgFilter("")
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel orders history"
      description="Orders whose line items target this Onidel provider (GET /admin/onidel/:id/orders, infra 5s polling; NOC readable, platform_admin writable)."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex min-w-0 items-center gap-2">
          <Input
            value={orgDraft}
            placeholder="Organization id / public_id / slug"
            className="w-64"
            onChange={(e) => setOrgDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyOrg() }}
          />
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-xs"
            onClick={applyOrg}
          >
            Apply
          </button>
          {orgFilter ? (
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
              onClick={clearOrg}
            >
              Clear
            </button>
          ) : null}
        </div>

        <span className="text-xs text-muted-foreground">
          GET /admin/onidel/{providerId.slice(0, 8)}…/orders · order_items.provider_id==:id
        </span>
      </div>

      <SimpleDataTable<OnidelOrderRow>
        columns={[
          {
            key: "public_id",
            header: "Order",
            render: (row) => (
              <Link
                to={`/admin/billing/orders/${row.id}`}
                className="font-mono text-xs underline-offset-4 hover:underline"
              >
                {row.public_id}
              </Link>
            ),
          },
          { key: "org_slug", header: "Organization" },
          {
            key: "total",
            header: "Total",
            render: (row) => formatMoney(row.total, row.currency),
            className: "text-right tabular-nums",
          },
          {
            key: "discount",
            header: "Discount",
            render: (row) => formatMoney(row.discount, row.currency),
            className: "text-right tabular-nums",
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "created_at",
            header: "Created",
            render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>,
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No Onidel orders match these filters."
        skeletonRows={6}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </ProviderShell>
  )
}
