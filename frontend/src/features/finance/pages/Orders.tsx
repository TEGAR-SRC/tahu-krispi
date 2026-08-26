// Admin orders ledger: status/search filtered paged table, detail dialog with
// items/invoices/coupon/quote breakdown, and void action (finance allowed).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Separator } from "@/components/ui/separator"
import { BanIcon, SearchIcon } from "lucide-react"
import {
  DetailRow,
  FilterChips,
  formatDateTime,
  formatMoney,
  StatusBadge,
  TablePagination,
} from "../lib"
import type {
  AdminOrderDetail,
  AdminOrderRow,
  OrderInvoiceRef,
  OrderItem,
} from "../lib"

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

const PER_PAGE = 10

const itemColumns: Array<SimpleColumn<OrderItem>> = [
  { key: "description", header: "Item" },
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
  { key: "public_id", header: "Invoice" },
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

export default function FinanceOrdersPage() {
  const [status, setStatus] = useState<(typeof ORDER_STATUSES)[number] | "all">("all")
  const [search, setSearch] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminOrderRow[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AdminOrderRow[]>("/admin/orders", {
        query: {
          page,
          per_page: PER_PAGE,
          status: status === "all" ? undefined : status,
          search: appliedSearch || undefined,
        },
      })
      setRows(envelope.data)
      setMeta(envelope.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page, status, appliedSearch])

  useEffect(() => {
    const t = setTimeout(() => void loadList(), 0)
    return () => clearTimeout(t)
  }, [loadList])

  const openDetail = useCallback(async (orderId: string) => {
    setSelectedId(orderId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const envelope = await apiGet<AdminOrderDetail>(`/admin/orders/${orderId}`)
      setDetail(envelope.data)
    } catch (cause) {
      setDetailError(cause)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const voidOrder = useCallback(async () => {
    if (!detail) return
    setVoiding(true)
    try {
      await apiPost(`/admin/orders/${detail.id}/void`)
      toast.success(`Order ${detail.public_id} voided`)
      setConfirmVoid(false)
      await openDetail(detail.id)
      await loadList()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to void order")
    } finally {
      setVoiding(false)
    }
  }, [detail, openDetail, loadList])

  const terminal = detail?.status === "completed" || detail?.status === "cancelled"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Customer orders with amounts, coupons and quotes." />

      <div className="flex flex-col gap-3">
        <FilterChips
          options={ORDER_STATUSES}
          value={status}
          onChange={(next) => {
            setPage(1)
            setStatus(next)
          }}
        />
        <form
          className="flex max-w-md items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setPage(1)
            setAppliedSearch(search.trim())
          }}
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by public ID…"
          />
          <Button type="submit" variant="outline" size="sm">
            <SearchIcon /> Search
          </Button>
        </form>
      </div>

      <SimpleDataTable
        columns={[
          {
            key: "public_id",
            header: "Order",
            render: (row) => (
              <Link
                to={`/finance/orders/${row.id}`}
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
            className: "text-right tabular-nums",
            render: (row) =>
              `${formatMoney(row.total, row.currency)}${row.discount > 0 ? ` (−${formatMoney(row.discount, row.currency)})` : ""}`,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "created_at",
            header: "Created",
            render: (row) => formatDateTime(row.created_at),
          },
          {
            key: "actions",
            header: "",
            className: "w-20",
            render: (row) => (
              <Button variant="ghost" size="sm" onClick={() => void openDetail(row.id)}>
                View
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No orders match this filter."
      />

      <TablePagination meta={meta} onPageChange={setPage} />

      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order detail</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {detail?.public_id ?? selectedId}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : detailError ? (
            <InlineError error={detailError} />
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <DetailRow label="Status">
                    <StatusBadge status={detail.status} />
                  </DetailRow>
                  <DetailRow label="Organization">{detail.org_slug}</DetailRow>
                  <DetailRow label="Created">{formatDateTime(detail.created_at)}</DetailRow>
                  <DetailRow label="Completed">{formatDateTime(detail.completed_at)}</DetailRow>
                </div>
                <div>
                  <DetailRow label="Subtotal">
                    {formatMoney(detail.subtotal, detail.currency)}
                  </DetailRow>
                  <DetailRow label="Discount">
                    {formatMoney(detail.discount, detail.currency)}
                  </DetailRow>
                  <DetailRow label="Tax">{formatMoney(detail.tax, detail.currency)}</DetailRow>
                  <DetailRow label="Total">{formatMoney(detail.total, detail.currency)}</DetailRow>
                </div>
              </div>

              {detail.coupon_redemption ? (
                <>
                  <Separator />
                  <DetailRow label={`Coupon ${detail.coupon_redemption.code}`}>
                    −{formatMoney(detail.coupon_redemption.discount_amount, detail.currency)}
                  </DetailRow>
                </>
              ) : null}

              <Separator />
              <h3 className="text-sm font-semibold">Items</h3>
              <SimpleDataTable
                columns={itemColumns}
                rows={detail.items}
                getRowKey={(row) => row.id}
              />

              {detail.invoices.length > 0 ? (
                <>
                  <h3 className="pt-2 text-sm font-semibold">Invoices</h3>
                  <SimpleDataTable
                    columns={invoiceColumns}
                    rows={detail.invoices}
                    getRowKey={(row) => row.id}
                  />
                </>
              ) : null}

              {detail.quote && detail.quote.pricing_breakdown ? (
                <>
                  <h3 className="pt-2 text-sm font-semibold">
                    Quote ({detail.quote.price_mode})
                  </h3>
                  <SimpleDataTable
                    columns={[
                      {
                        key: "label",
                        header: "Component",
                        render: (row) =>
                          String(
                            (row as Record<string, unknown>).dimension_code ??
                              (row as Record<string, unknown>).description ??
                              "—",
                          ),
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
                </>
              ) : null}

              {!terminal ? (
                <>
                  <Separator />
                  <div className="flex justify-end">
                    <Button variant="destructive" size="sm" onClick={() => setConfirmVoid(true)}>
                      <BanIcon /> Void order
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Order {detail?.public_id} will be marked voided and any linked unpaid invoices
              cancelled. This cannot be undone.
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

/** Compact inline error for failures inside dialogs. */
function InlineError({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm break-all text-destructive"
    >
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}
