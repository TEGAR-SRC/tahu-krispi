// Order detail: totals, line items, related invoices and cancellation of
// draft/pending/processing orders behind a confirmation dialog.
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeftIcon, Loader2Icon, XCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface OrderItem {
  id: string
  service_kind: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  billing_period?: string
}

interface OrderInvoice {
  id: string
  public_id: string
  status: string
  total: number
  amount_due: number
}

interface OrderDetailData {
  id: string
  public_id: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  created_at: string
  completed_at?: string | null
  cancelled_at?: string | null
  items: OrderItem[]
  invoices: OrderInvoice[]
}

// Only these statuses can be cancelled server-side.
const CANCELLABLE = new Set(["draft", "pending_payment", "processing"])

export default function CustomerOrderDetailPage() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const { orgId } = useOrg()
  const [order, setOrder] = useState<OrderDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    if (!orgId || !orderId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<OrderDetailData>(`/orders/${orderId}`, {
        headers: orgHeaders(orgId),
      })
      setOrder(data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, orderId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const cancelOrder = async () => {
    if (!order) return
    setCancelling(true)
    try {
      await apiPost(`/orders/${order.id}/cancel`, {}, { headers: orgHeaders(orgId) })
      toast.success(`Order ${order.public_id} cancelled`)
      setConfirmOpen(false)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to cancel order")
    } finally {
      setCancelling(false)
    }
  }

  const itemColumns: Array<SimpleColumn<OrderItem>> = [
    {
      key: "description",
      header: "Item",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.description}</p>
          <p className="text-xs capitalize text-muted-foreground">{row.service_kind.replace(/_/g, " ")}</p>
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Qty × unit",
      render: (row) => (
        <span className="tabular-nums">
          {row.quantity} × {formatMoney(row.unit_price, order?.currency)}
        </span>
      ),
    },
    {
      key: "billing_period",
      header: "Billing",
      render: (row) =>
        row.billing_period ? (
          <span className="capitalize">{row.billing_period}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "subtotal",
      header: "Subtotal",
      render: (row) => (
        <span className="tabular-nums font-medium">{formatMoney(row.subtotal, order?.currency)}</span>
      ),
    },
  ]

  const invoiceColumns: Array<SimpleColumn<OrderInvoice>> = [
    {
      key: "public_id",
      header: "Invoice",
      render: (row) => <span className="font-mono text-xs">{row.public_id}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "total",
      header: "Total",
      render: (row) => <span className="tabular-nums">{formatMoney(row.total, order?.currency)}</span>,
    },
    {
      key: "amount_due",
      header: "Due",
      render: (row) => <span className="tabular-nums">{formatMoney(row.amount_due, order?.currency)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-20",
      render: (row) => (
        <div className="flex justify-end">
          <Button asChild size="icon" variant="ghost" title="View invoice">
            <Link to={`/app/invoices/${row.id}`}>→</Link>
          </Button>
        </div>
      ),
    },
  ]

  if (!loading && error) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/app/orders">Orders</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{orderId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <ErrorBanner error={error} />
        <Button variant="outline" className="w-fit" onClick={() => navigate("/app/orders")}>
          <ArrowLeftIcon /> Back to orders
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/orders">Orders</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{order?.public_id ?? orderId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Order ${order?.public_id ?? ""}`}
        description={
          order
            ? `Placed ${formatDateTime(order.created_at)}${
                order.completed_at ? ` · completed ${formatDateTime(order.completed_at)}` : ""
              }${order.cancelled_at ? ` · cancelled ${formatDateTime(order.cancelled_at)}` : ""}`
            : undefined
        }
        actions={
          order && CANCELLABLE.has(order.status) ? (
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              <XCircleIcon /> Cancel order
            </Button>
          ) : null
        }
      />

      <ErrorBanner error={error} />

      {loading || !order ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-4 px-4 sm:grid-cols-2 xl:grid-cols-4">
              <TotalRow label="Total" value={formatMoney(order.total, order.currency)} strong />
              <TotalRow label="Subtotal" value={formatMoney(order.subtotal, order.currency)} />
              <TotalRow label="Tax" value={formatMoney(order.tax, order.currency)} />
              <TotalRow label="Discount" value={formatMoney(order.discount, order.currency)} />
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Items</h2>
            <SimpleDataTable
              columns={itemColumns}
              rows={order.items}
              emptyMessage="No line items on this order."
              getRowKey={(row) => row.id}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <SimpleDataTable
              columns={invoiceColumns}
              rows={order.invoices}
              emptyMessage="No invoices were generated for this order yet."
              getRowKey={(row) => row.id}
            />
          </section>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel order “{order?.public_id}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The order is marked cancelled and any unpaid invoice attached to it is voided. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault()
                void cancelOrder()
              }}
            >
              {cancelling ? <Loader2Icon className="animate-spin" /> : null} Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${strong ? "text-xl font-semibold" : "text-base font-medium"}`}>
        {value}
      </p>
    </div>
  )
}
