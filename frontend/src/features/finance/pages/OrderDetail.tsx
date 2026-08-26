// Full-page order detail: header amounts, items, linked invoices, coupon
// redemption and the originating quote's pricing breakdown, plus a guarded
// void action (POST /admin/orders/:id/void).
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { BanIcon } from "lucide-react"
import {
  DetailRow,
  formatDateTime,
  formatMoney,
  StatusBadge,
} from "../lib"
import type {
  AdminOrderDetail,
  OrderInvoiceRef,
  OrderItem,
} from "../lib"

const itemColumns: Array<SimpleColumn<OrderItem>> = [
  { key: "description", header: "Item" },
  {
    key: "service_kind",
    header: "Kind",
    render: (row) => row.service_kind ?? "—",
  },
  { key: "quantity", header: "Qty", className: "w-16 tabular-nums" },
  {
    key: "unit_price",
    header: "Unit price",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.unit_price),
  },
  {
    key: "subtotal",
    header: "Subtotal",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.subtotal),
  },
  {
    key: "billing_period",
    header: "Period",
    render: (row) => row.billing_period || "—",
  },
]

const invoiceColumns: Array<SimpleColumn<OrderInvoiceRef>> = [
  {
    key: "public_id",
    header: "Invoice",
    render: (row) => (
      <Link
        to={`/finance/invoices/${row.id}`}
        className="font-mono text-xs underline-offset-4 hover:underline"
      >
        {row.public_id}
      </Link>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: "total",
    header: "Total",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.total),
  },
  {
    key: "amount_due",
    header: "Due",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.amount_due),
  },
]

export default function FinanceOrderDetailPage() {
  const orderId = useParams().orderId
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AdminOrderDetail>(`/admin/orders/${orderId}`)
      setDetail(envelope.data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const voidOrder = useCallback(async () => {
    if (!detail) return
    setVoiding(true)
    try {
      await apiPost(`/admin/orders/${detail.id}/void`)
      toast.success(`Order ${detail.public_id} voided`)
      setConfirmVoid(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to void order")
    } finally {
      setVoiding(false)
    }
  }, [detail, load])

  // Terminal/settled orders cannot be voided; the backend rejects them anyway.
  const canVoid =
    detail !== null &&
    detail.status !== "paid" &&
    detail.status !== "completed" &&
    detail.status !== "cancelled" &&
    detail.status !== "refunded"

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/finance">Finance</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/finance/orders">Orders</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{detail?.public_id ?? "Order"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Order ${detail?.public_id ?? ""}`}
        description={
          detail
            ? `${detail.org_slug} · created ${formatDateTime(detail.created_at)}`
            : "Loading…"
        }
        actions={
          detail && canVoid ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmVoid(true)}>
              <BanIcon /> Void order
            </Button>
          ) : null
        }
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : detail ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription className="font-mono text-xs">{detail.id}</CardDescription>
              </CardHeader>
              <CardContent>
                <DetailRow label="Status">
                  <StatusBadge status={detail.status} />
                </DetailRow>
                <DetailRow label="Organization">{detail.org_slug}</DetailRow>
                <DetailRow label="Created">{formatDateTime(detail.created_at)}</DetailRow>
                <DetailRow label="Completed">{formatDateTime(detail.completed_at)}</DetailRow>
                <DetailRow label="Cancelled">{formatDateTime(detail.cancelled_at)}</DetailRow>
                <DetailRow label="Quote mode">
                  {detail.quote ? detail.quote.price_mode : "—"}
                </DetailRow>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Amounts ({detail.currency})</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailRow label="Subtotal">
                  {formatMoney(detail.subtotal, detail.currency)}
                </DetailRow>
                <DetailRow label="Discount">
                  {formatMoney(detail.discount, detail.currency)}
                </DetailRow>
                <DetailRow label="Tax">{formatMoney(detail.tax, detail.currency)}</DetailRow>
                <Separator className="my-2" />
                <DetailRow label="Total">
                  <span className="text-base font-semibold">
                    {formatMoney(detail.total, detail.currency)}
                  </span>
                </DetailRow>
                {detail.coupon_redemption ? (
                  <DetailRow label={`Coupon ${detail.coupon_redemption.code}`}>
                    −{formatMoney(detail.coupon_redemption.discount_amount, detail.currency)}
                  </DetailRow>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Items</h3>
            <SimpleDataTable
              columns={itemColumns}
              rows={detail.items}
              getRowKey={(row) => row.id}
              emptyMessage="This order has no line items."
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Linked invoices</h3>
            <SimpleDataTable
              columns={invoiceColumns}
              rows={detail.invoices}
              getRowKey={(row) => row.id}
              emptyMessage="No invoices issued for this order yet."
            />
          </section>

          {detail.quote?.pricing_breakdown ? (
            <Card>
              <CardHeader>
                <CardTitle>Quote pricing breakdown</CardTitle>
                <CardDescription>
                  Price mode {detail.quote.price_mode}
                  {detail.quote.expires_at
                    ? ` · quoted until ${formatDateTime(detail.quote.expires_at)}`
                    : ""}
                  . Quote subtotal {formatMoney(detail.quote.subtotal, detail.currency)}, tax{" "}
                  {formatMoney(detail.quote.tax, detail.currency)}, total{" "}
                  {formatMoney(detail.quote.total, detail.currency)}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleDataTable
                  columns={[
                    {
                      key: "component",
                      header: "Component",
                      render: (row) => String(row.dimension_code ?? row.description ?? "—"),
                    },
                    {
                      key: "quantity",
                      header: "Billable qty",
                      className: "w-28 text-right tabular-nums",
                      render: (row) =>
                        row.billable_quantity !== undefined
                          ? String(row.billable_quantity)
                          : row.quantity !== undefined
                            ? String(row.quantity)
                            : "—",
                    },
                    {
                      key: "unit_price",
                      header: "Unit price",
                      className: "text-right tabular-nums",
                      render: (row) =>
                        row.unit_price !== undefined
                          ? formatMoney(Number(row.unit_price), detail.currency)
                          : "—",
                    },
                    {
                      key: "amount",
                      header: "Amount",
                      className: "text-right tabular-nums",
                      render: (row) => formatMoney(row.amount, detail.currency),
                    },
                  ]}
                  rows={detail.quote.pricing_breakdown}
                  getRowKey={(_, index) => String(index)}
                  emptyMessage="No pricing breakdown."
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Order {detail?.public_id} ({formatMoney(detail?.total, detail?.currency)}) will be
              marked voided and any linked unpaid invoices cancelled. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              disabled={voiding}
              onClick={(event) => {
                event.preventDefault()
                void voidOrder()
              }}
            >
              {voiding ? "Voiding…" : "Void order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
