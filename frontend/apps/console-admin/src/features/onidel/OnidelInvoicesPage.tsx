import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { PaginationBar, StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime, formatMoney } from "@/features/admin/pages/format"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"

interface OnidelInvoiceRow {
  id: string
  public_id: string
  invoice_number: string
  organization_id: string
  org_public_id: string
  org_slug: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  amount_paid: number
  amount_due: number
  status: string
  issued_at: string
  due_at: string
  paid_at: string
  voided_at: string
  created_at: string
}

const INVOICE_STATUSES = [
  "draft",
  "unpaid",
  "paid",
  "overdue",
  "void",
  "refunded",
  "partially_refunded",
] as const

const PER_PAGE = 20

export default function OnidelInvoicesPage() {
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

  const infraPath = providerId ? `/admin/onidel/${providerId}/invoices` : null

  const infra = useInfraGet<OnidelInvoiceRow[]>(
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
      title="Onidel invoices"
      description="Invoices whose order targets this Onidel provider (GET /admin/onidel/:id/invoices, infra 5s polling; NOC readable, platform_admin writable). Filter via order_items.provider_id==:id."
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
            {INVOICE_STATUSES.map((value) => (
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
          GET /admin/onidel/{providerId.slice(0, 8)}…/invoices · order_items.provider_id==:id via order_id · 5s poll via useInfraGet
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">useInfraGet intervalMs 5000</Badge>
        <Badge variant="outline">ProviderShell</Badge>
        <Badge variant="outline">SimpleDataTable</Badge>
        <span className="text-xs text-muted-foreground">
          Read-only history — links open billing invoice detail / org wallet. Void stays on billing invoices.
        </span>
      </div>

      <SimpleDataTable<OnidelInvoiceRow>
        columns={[
          {
            key: "invoice_number",
            header: "Invoice",
            render: (row) => (
              <div className="flex min-w-0 flex-col">
                <Link
                  to={`/admin/billing/invoices/${row.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.invoice_number}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">{row.public_id}</span>
              </div>
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
            key: "amount_paid",
            header: "Paid",
            render: (row) => formatMoney(row.amount_paid, row.currency),
            className: "text-right tabular-nums",
          },
          {
            key: "amount_due",
            header: "Due",
            render: (row) => formatMoney(row.amount_due, row.currency),
            className: "text-right tabular-nums",
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "due_at",
            header: "Due date",
            render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.due_at)}</span>,
          },
          {
            key: "created_at",
            header: "Issued",
            className: "hidden lg:table-cell",
            render: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.created_at)}</span>,
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No Onidel invoices match these filters."
        skeletonRows={6}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </ProviderShell>
  )
}
