// Admin billing: platform orders table (GET /admin/orders) with a status
// filter, a detail dialog (GET /admin/orders/:order_id with line items,
// linked invoices, coupon redemption and quote breakdown) and voiding
// (POST /admin/orders/:order_id/void).
import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { EyeIcon, MoreHorizontalIcon, SquareArrowOutUpRightIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { StatusBadge, Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface OrderRow {
  id: string
  public_id: string
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

interface OrderDetail extends OrderRow {
  created_by?: string
  updated_at?: string
  items: OrderItem[]
  invoices: OrderInvoiceRef[]
  coupon_redemption?: { code: string; discount_amount: number } | null
  quote?: QuoteSummary | null
}

// Matches the backend's admOrderStatuses allow-list.
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

const TERMINAL_STATUSES = new Set(["cancelled", "refunded", "failed"])

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

export default function BillingOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const list = usePagedList<OrderRow>(
    "/admin/orders",
    statusFilter === "all" ? {} : { status: statusFilter },
  )
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [voidTarget, setVoidTarget] = useState<OrderRow | null>(null)
  const [voiding, setVoiding] = useState(false)
  const bulk = useBulkSelection<OrderRow>((order) => order.id)
  const [bulkVoidOpen, setBulkVoidOpen] = useState(false)
  const [bulkVoiding, setBulkVoiding] = useState(false)

  const openDetail = (order: OrderRow) => {
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    apiGet<OrderDetail>(`/admin/orders/${order.id}`)
      .then((envelope) => setDetail(envelope.data))
      .catch((cause: unknown) => setDetailError(cause))
      .finally(() => setDetailLoading(false))
  }

  const confirmVoid = async () => {
    if (!voidTarget) return
    setVoiding(true)
    try {
      await apiPost(`/admin/orders/${voidTarget.id}/void`)
      toast.success(`Order ${voidTarget.public_id} cancelled`)
      setVoidTarget(null)
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to void order",
      )
    } finally {
      setVoiding(false)
    }
  }

  const confirmBulkVoid = async () => {
    const targets = bulk.resolve(list.rows).filter(
      (order) => !TERMINAL_STATUSES.has(order.status),
    )
    if (targets.length === 0) {
      setBulkVoidOpen(false)
      return
    }
    setBulkVoiding(true)
    try {
      for (const order of targets) {
        await apiPost(`/admin/orders/${order.id}/void`)
      }
      toast.success(
        `${targets.length} order${targets.length > 1 ? "s" : ""} cancelled`,
      )
      setBulkVoidOpen(false)
      bulk.clear()
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to void orders",
      )
    } finally {
      setBulkVoiding(false)
    }
  }

  const voidableCount = bulk
    .resolve(list.rows)
    .filter((order) => !TERMINAL_STATUSES.has(order.status)).length

  const columns: Array<SimpleColumn<OrderRow>> = [
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
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.public_id}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/admin/billing/orders/${row.id}`}>
                <SquareArrowOutUpRightIcon /> Open full page
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDetail(row)}>
              <EyeIcon /> View details
            </DropdownMenuItem>
            {!TERMINAL_STATUSES.has(row.status) ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setVoidTarget(row)}
              >
                Void order
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Customer orders across the platform."
        actions={
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ORDER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkVoiding}
        actions={[
          {
            key: "void",
            label: "Void selected",
            destructive: true,
            onClick: () => setBulkVoidOpen(true),
          },
        ]}
      />

      <SimpleDataTable
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No orders match this filter."
        skeletonRows={6}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      <Dialog open={detailLoading || detailError !== null || detail !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null)
            setDetailError(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order detail</DialogTitle>
            <DialogDescription>
              {detailLoading
                ? "Loading…"
                : detail
                  ? `${detail.public_id} · ${detail.org_slug}`
                  : ""}
            </DialogDescription>
          </DialogHeader>

          {detailError ? <ErrorBanner error={detailError} /> : null}

          {detail ? (
            <div className="flex w-full max-w-full min-w-0 flex-col gap-5">
              <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailField label="Status" value={<StatusBadge status={detail.status} />} />
                <DetailField label="Total" value={formatMoney(detail.total, detail.currency)} />
                <DetailField label="Subtotal" value={formatMoney(detail.subtotal, detail.currency)} />
                <DetailField label="Discount" value={formatMoney(detail.discount, detail.currency)} />
                <DetailField label="Tax" value={formatMoney(detail.tax, detail.currency)} />
                <DetailField label="Created" value={formatDateTime(detail.created_at)} />
                <DetailField label="Completed" value={formatDateTime(detail.completed_at)} />
                <DetailField label="Cancelled" value={formatDateTime(detail.cancelled_at)} />
                {detail.coupon_redemption ? (
                  <DetailField
                    label="Coupon"
                    value={`${detail.coupon_redemption.code} (−${formatMoney(detail.coupon_redemption.discount_amount, detail.currency)})`}
                  />
                ) : null}
              </div>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Line items</h3>
                <SimpleDataTable
                  columns={[
                    { key: "description", header: "Description" },
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
                      render: (item) => formatMoney(item.unit_price, detail.currency),
                    },
                    {
                      key: "subtotal",
                      header: "Subtotal",
                      className: "text-right tabular-nums",
                      render: (item) => formatMoney(item.subtotal, detail.currency),
                    },
                  ]}
                  rows={detail.items ?? []}
                  getRowKey={(item) => item.id}
                  emptyMessage="No line items."
                />
              </section>

              {detail.invoices && detail.invoices.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Invoices</h3>
                  <SimpleDataTable
                    columns={[
                      { key: "public_id", header: "Invoice" },
                      {
                        key: "status",
                        header: "Status",
                        render: (invoice) => <StatusBadge status={invoice.status} />,
                      },
                      {
                        key: "total",
                        header: "Total",
                        className: "text-right tabular-nums",
                        render: (invoice) => formatMoney(invoice.total, detail.currency),
                      },
                      {
                        key: "amount_due",
                        header: "Due",
                        className: "text-right tabular-nums",
                        render: (invoice) => formatMoney(invoice.amount_due, detail.currency),
                      },
                    ]}
                    rows={detail.invoices}
                    getRowKey={(invoice) => invoice.id}
                    emptyMessage="No invoices."
                  />
                </section>
              ) : null}

              {detail.quote?.pricing_breakdown &&
              detail.quote.pricing_breakdown.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    Quote breakdown
                    <Badge variant="outline">{detail.quote.price_mode}</Badge>
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {detail.quote.pricing_breakdown.map((line, index) => (
                      <li
                        key={`${line.dimension_code ?? "line"}-${index}`}
                        className="flex min-w-0 items-center justify-between gap-4 rounded-md border px-3 py-1.5"
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
                          {formatMoney(line.amount, detail.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open && !voiding) setVoidTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this order?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget
                ? `Order ${voidTarget.public_id} (${formatMoney(voidTarget.total, voidTarget.currency)}) will be cancelled and its draft/unpaid invoices voided. This cannot be undone.`
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

      <AlertDialog
        open={bulkVoidOpen}
        onOpenChange={(open) => {
          if (!open && !bulkVoiding) setBulkVoidOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void selected orders?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidableCount} order{voidableCount === 1 ? "" : "s"} will be
              cancelled and their draft/unpaid invoices voided. Terminal orders
              are skipped. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkVoiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkVoiding}
              onClick={(event) => {
                event.preventDefault()
                void confirmBulkVoid()
              }}
            >
              {bulkVoiding ? "Voiding…" : "Void selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
