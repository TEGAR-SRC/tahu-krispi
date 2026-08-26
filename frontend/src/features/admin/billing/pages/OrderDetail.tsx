// Admin order detail (GET /admin/orders/:order_id): line items, linked
// invoices (each links to its invoice detail page), the applied coupon
// redemption and the quote breakdown. Voiding goes through
// POST /admin/orders/:order_id/void behind a confirmation dialog and is
// hidden for terminal statuses (cancelled/refunded/failed).
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { BanIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  DetailBreadcrumbs,
  DetailField,
  useApiDetail,
} from "./detailShared"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"

interface OrderItem {
  id: string
  service_kind: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  billing_period: string
}

interface OrderInvoiceRef {
  id: string
  public_id: string
  status: string
  total: number
  amount_due: number
}

interface QuoteBreakdownLine {
  description: string
  dimension_code?: string
  quantity: number
  unit_price: number
  amount: number
  included_quantity?: number
  billable_quantity?: number
}

interface QuoteSummary {
  id: string
  price_mode: string
  subtotal: number
  tax: number
  total: number
  expires_at?: string
  pricing_breakdown?: QuoteBreakdownLine[]
}

interface OrderDetailData {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  created_by?: string
  quote_id?: string
  coupon_id?: string
  currency: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  idempotency_key?: string
  created_at: string
  updated_at?: string
  completed_at: string
  cancelled_at: string
  items: OrderItem[]
  invoices: OrderInvoiceRef[]
  coupon_redemption?: { code: string; discount_amount: number } | null
  quote?: QuoteSummary | null
}

/** The backend refuses to void cancelled/refunded/failed orders. */
function canVoid(order: OrderDetailData): boolean {
  return !["cancelled", "refunded", "failed"].includes(order.status)
}

export default function BillingOrderDetailPage() {
  const { orderId } = useParams()
  const detail = useApiDetail<OrderDetailData>(
    orderId ? `/admin/orders/${orderId}` : null,
  )
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const confirmVoid = async () => {
    if (!detail.data) return
    setVoiding(true)
    try {
      await apiPost(`/admin/orders/${detail.data.id}/void`)
      toast.success(`Order ${detail.data.public_id} voided`)
      setVoidOpen(false)
      detail.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to void order",
      )
      setVoidOpen(false)
    } finally {
      setVoiding(false)
    }
  }

  const order = detail.data

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Orders", to: "/admin/billing/orders" },
          { label: order ? order.public_id : (orderId ?? "…") },
        ]}
      />

      <PageHeader
        title={order ? `Order ${order.public_id}` : "Order detail"}
        description={
          order ? `${order.org_slug} · ${formatMoney(order.total, order.currency)}` : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={detail.reload}
              disabled={detail.loading}
            >
              <RefreshCwIcon /> Refresh
            </Button>
            {order && canVoid(order) ? (
              <Button variant="destructive" onClick={() => setVoidOpen(true)}>
                <BanIcon /> Void order
              </Button>
            ) : null}
          </>
        }
      />

      {detail.error ? <ErrorBanner error={detail.error} /> : null}
      {!detail.error && detail.loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : null}

      {order ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Summary <StatusBadge status={order.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="Total" value={formatMoney(order.total, order.currency)} />
              <DetailField label="Subtotal" value={formatMoney(order.subtotal, order.currency)} />
              <DetailField label="Discount" value={formatMoney(order.discount, order.currency)} />
              <DetailField label="Tax" value={formatMoney(order.tax, order.currency)} />
              <DetailField
                label="Organization"
                value={`${order.org_slug} (${order.org_public_id})`}
              />
              <DetailField label="Created" value={formatDateTime(order.created_at)} />
              <DetailField label="Updated" value={formatDateTime(order.updated_at)} />
              <DetailField label="Completed" value={formatDateTime(order.completed_at)} />
              <DetailField label="Cancelled" value={formatDateTime(order.cancelled_at)} />
              <DetailField label="Currency" value={order.currency} />
              <DetailField
                label="Idempotency key"
                value={order.idempotency_key || "—"}
              />
              <DetailField
                label="Created by"
                value={
                  <span className="font-mono text-xs">{order.created_by || "—"}</span>
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleDataTable
                columns={[
                  { key: "description", header: "Description" },
                  { key: "service_kind", header: "Kind" },
                  { key: "billing_period", header: "Period" },
                  {
                    key: "quantity",
                    header: "Qty",
                    className: "text-right tabular-nums",
                  },
                  {
                    key: "unit_price",
                    header: "Unit price",
                    className: "text-right tabular-nums",
                    render: (item) => formatMoney(item.unit_price, order.currency),
                  },
                  {
                    key: "subtotal",
                    header: "Subtotal",
                    className: "text-right tabular-nums",
                    render: (item) => formatMoney(item.subtotal, order.currency),
                  },
                ]}
                rows={order.items ?? []}
                getRowKey={(item) => item.id}
                emptyMessage="No line items on this order."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(order.invoices ?? []).length > 0 ? (
                order.invoices.map((invoice) => (
                  <Link
                    key={invoice.id}
                    to={`/admin/billing/invoices/${invoice.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs">{invoice.public_id}</span>
                      <StatusBadge status={invoice.status} />
                    </span>
                    <span className="flex items-center gap-4 tabular-nums">
                      <span>{formatMoney(invoice.total, order.currency)}</span>
                      <span className="text-muted-foreground">
                        due {formatMoney(invoice.amount_due, order.currency)}
                      </span>
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No invoices issued for this order yet.
                </p>
              )}
            </CardContent>
          </Card>

          {order.coupon_redemption ? (
            <Card>
              <CardHeader>
                <CardTitle>Coupon redemption</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="outline" className="font-mono uppercase">
                  {order.coupon_redemption.code}
                </Badge>
                <span className="tabular-nums">
                  −{formatMoney(order.coupon_redemption.discount_amount, order.currency)}
                </span>
                {order.coupon_id ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/admin/billing/coupons/${order.coupon_id}`}>
                      Open coupon
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {order.quote ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Quote breakdown
                  <Badge variant="outline">{order.quote.price_mode}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-4">
                  <DetailField
                    label="Quote subtotal"
                    value={formatMoney(order.quote.subtotal, order.currency)}
                  />
                  <DetailField
                    label="Quote tax"
                    value={formatMoney(order.quote.tax, order.currency)}
                  />
                  <DetailField
                    label="Quote total"
                    value={formatMoney(order.quote.total, order.currency)}
                  />
                  <DetailField
                    label="Expires at"
                    value={formatDateTime(order.quote.expires_at)}
                  />
                </div>

                <Separator />

                {order.quote.pricing_breakdown &&
                order.quote.pricing_breakdown.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {order.quote.pricing_breakdown.map((line, index) => (
                      <li
                        key={`${line.dimension_code ?? "line"}-${index}`}
                        className="flex items-center justify-between gap-4 rounded-md border px-3 py-1.5"
                      >
                        <span>
                          {line.description} × {line.quantity}
                          {line.included_quantity ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({line.included_quantity} included)
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(line.amount, order.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No pricing breakdown lines on this quote.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <AlertDialog
        open={voidOpen}
        onOpenChange={(open) => {
          if (!open && !voiding) setVoidOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this order?</AlertDialogTitle>
            <AlertDialogDescription>
              {order
                ? `Order ${order.public_id} (${formatMoney(order.total, order.currency)}) will be cancelled and its draft/unpaid invoices voided. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={voiding}
              onClick={(event) => {
                event.preventDefault()
                void confirmVoid()
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
