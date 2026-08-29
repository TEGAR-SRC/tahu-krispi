// Invoices: the organization's billing documents with status filter,
// pagination and links into the per-invoice detail page.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { EyeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import type { PagedMeta } from "@/lib/types"
import { Pagination } from "../Pagination"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface Invoice {
  id: string
  public_id: string
  invoice_number: string
  currency: string
  total: number
  amount_paid: number
  amount_due: number
  status: string
  issued_at?: string | null
  due_at?: string | null
  created_at: string
}

// The same status set the backend validates ?status= against.
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

export default function CustomerInvoicesPage() {
  const { orgId } = useOrg()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [meta, setMeta] = useState<PagedMeta | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, meta } = await apiGet<Invoice[]>("/invoices", {
        headers: orgHeaders(orgId),
        query: {
          page,
          per_page: PER_PAGE,
          status: statusFilter === "all" ? undefined : statusFilter,
        },
      })
      setInvoices(data ?? [])
      setMeta(meta)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, page, statusFilter])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  const columns: Array<SimpleColumn<Invoice>> = [
    {
      key: "invoice_number",
      header: "Invoice",
      render: (row) => (
        <div className="min-w-0">
          <p className="min-w-0 truncate font-medium">{row.invoice_number || row.public_id}</p>
          <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.public_id}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "total",
      header: "Total",
      render: (row) => <span className="tabular-nums">{formatMoney(row.total, row.currency)}</span>,
    },
    {
      key: "amount_due",
      header: "Due",
      render: (row) => (
        <span className={`tabular-nums ${row.amount_due > 0 && row.status !== "void" ? "font-medium" : "text-muted-foreground"}`}>
          {formatMoney(row.amount_due, row.currency)}
        </span>
      ),
    },
    { key: "issued_at", header: "Issued", render: (row) => formatDateTime(row.issued_at ?? row.created_at) },
    { key: "due_at", header: "Due date", render: (row) => formatDateTime(row.due_at) },
    {
      key: "actions",
      header: "",
      className: "w-20",
      render: (row) => (
        <div className="flex justify-end">
          <Button asChild size="icon" variant="ghost" title="View invoice">
            <Link to={`/app/invoices/${row.id}`}>
              <EyeIcon />
            </Link>
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Billing documents for your orders and subscriptions."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVOICE_STATUSES.map((status) => (
              <SelectItem key={status} value={status} className="capitalize">
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable
        columns={columns}
        rows={invoices}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No invoices yet."}
        getRowKey={(row) => row.id}
      />

      {meta ? (
        <Pagination page={page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
