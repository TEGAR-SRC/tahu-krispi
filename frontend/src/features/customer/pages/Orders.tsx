// Orders: the organization's order history with status filter, live
// pagination and links into the per-order detail page.
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

interface OrderItem {
  id: string
  service_kind: string
  description: string
  quantity: number
}

interface Order {
  id: string
  public_id: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  created_at: string
  items?: OrderItem[]
}

// The same status set the backend validates ?status= against.
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

export default function CustomerOrdersPage() {
  const { orgId } = useOrg()
  const [orders, setOrders] = useState<Order[]>([])
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
      const { data, meta } = await apiGet<Order[]>("/orders", {
        headers: orgHeaders(orgId),
        query: {
          page,
          per_page: PER_PAGE,
          status: statusFilter === "all" ? undefined : statusFilter,
        },
      })
      setOrders(data ?? [])
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

  const columns: Array<SimpleColumn<Order>> = [
    {
      key: "public_id",
      header: "Order",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.public_id}</p>
          <p className="text-xs text-muted-foreground">
            {row.items && row.items.length > 0
              ? `${row.items.length} item${row.items.length === 1 ? "" : "s"}`
              : "—"}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "total",
      header: "Total",
      render: (row) => <span className="tabular-nums">{formatMoney(row.total, row.currency)}</span>,
    },
    { key: "created_at", header: "Placed", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-20",
      render: (row) => (
        <div className="flex justify-end">
          <Button asChild size="icon" variant="ghost" title="View order">
            <Link to={`/app/orders/${row.id}`}>
              <EyeIcon />
            </Link>
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Every purchase and provisioning order placed for this organization."
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
            {ORDER_STATUSES.map((status) => (
              <SelectItem key={status} value={status} className="capitalize">
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable
        columns={columns}
        rows={orders}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No orders yet — provision something from the catalog to get started."}
        getRowKey={(row) => row.id}
      />

      {meta ? (
        <Pagination page={page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
