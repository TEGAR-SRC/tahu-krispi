// Admin billing: platform invoices (GET /admin/invoices) with status filter,
// status badges, a detail dialog (GET /admin/invoices/:invoice_id with line
// items, payments and provider webhook events) and voiding
// (POST /admin/invoices/:invoice_id/void). The API exposes no mark-paid
// action, so paid state only ever comes from the payment flow.
import { useState } from "react"
import { EyeIcon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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

interface InvoiceRow {
  id: string
  public_id: string
  invoice_number: string
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

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  subtotal: number
  tax_amount: number
  total: number
}

interface InvoicePayment {
  id: string
  public_id: string
  provider: string
  method: string
  currency: string
  amount: number
  fee: number
  status: string
  paid_at: string
  created_at: string
}

interface PaymentEvent {
  id: number
  payment_id: string
  provider: string
  event_type: string
  processed_at: string
  processing_error?: string | null
  received_at: string
}

interface InvoiceDetail extends InvoiceRow {
  items: InvoiceItem[]
  payments: InvoicePayment[]
  payment_events: PaymentEvent[]
}

// Matches the backend's admInvoiceStatuses allow-list.
const INVOICE_STATUSES = [
  "draft",
  "unpaid",
  "paid",
  "overdue",
  "void",
  "refunded",
  "partially_refunded",
] as const

/** The backend refuses to void paid/partially_refunded/void invoices. */
function canVoid(invoice: InvoiceRow): boolean {
  return !["paid", "partially_refunded", "void"].includes(invoice.status)
}

export default function BillingInvoicesPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const list = usePagedList<InvoiceRow>(
    "/admin/invoices",
    statusFilter === "all" ? {} : { status: statusFilter },
  )
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [detailOpenId, setDetailOpenId] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null)
  const [voiding, setVoiding] = useState(false)

  const openDetail = (invoice: InvoiceRow) => {
    setDetailOpenId(invoice.id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    apiGet<InvoiceDetail>(`/admin/invoices/${invoice.id}`)
      .then((envelope) => setDetail(envelope.data))
      .catch((cause: unknown) => setDetailError(cause))
      .finally(() => setDetailLoading(false))
  }

  const confirmVoid = async () => {
    if (!voidTarget) return
    setVoiding(true)
    try {
      await apiPost(`/admin/invoices/${voidTarget.id}/void`)
      toast.success(`Invoice ${voidTarget.invoice_number} voided`)
      setVoidTarget(null)
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to void invoice",
      )
    } finally {
      setVoiding(false)
    }
  }

  const columns: Array<SimpleColumn<InvoiceRow>> = [
    {
      key: "invoice_number",
      header: "Invoice",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.invoice_number}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.public_id}
          </span>
        </div>
      ),
    },
    { key: "org_slug", header: "Organization" },
    {
      key: "total",
      header: "Total",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.total, row.currency),
    },
    {
      key: "amount_paid",
      header: "Paid",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.amount_paid, row.currency),
    },
    {
      key: "amount_due",
      header: "Due",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.amount_due, row.currency),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "due_at",
      header: "Due date",
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.due_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${row.invoice_number}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openDetail(row)}>
              <EyeIcon /> View detail
            </DropdownMenuItem>
            {canVoid(row) ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setVoidTarget(row)}
              >
                Void invoice
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Issued invoices and their settlement status."
        actions={
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {INVOICE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <SimpleDataTable
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        getRowKey={(row) => row.id}
        emptyMessage="No invoices match this filter."
        skeletonRows={6}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      <Dialog
        open={detailOpenId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailOpenId(null)
            setDetail(null)
            setDetailError(null)
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invoice detail</DialogTitle>
            <DialogDescription>
              {detailLoading
                ? "Loading…"
                : detail
                  ? `${detail.invoice_number} · ${detail.org_slug}`
                  : ""}
            </DialogDescription>
          </DialogHeader>

          {detailError ? <ErrorBanner error={detailError} /> : null}

          {detail ? (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <StatusBadge status={detail.status} />
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(detail.total, detail.currency)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(detail.amount_paid, detail.currency)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Amount due</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(detail.amount_due, detail.currency)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Issued</span>
                  <span>{formatDateTime(detail.issued_at)}</span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Due</span>
                  <span>{formatDateTime(detail.due_at)}</span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Paid at</span>
                  <span>{formatDateTime(detail.paid_at)}</span>
                </div>
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-muted-foreground">Voided</span>
                  <span>{formatDateTime(detail.voided_at)}</span>
                </div>
              </div>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Line items</h3>
                <SimpleDataTable
                  columns={[
                    { key: "description", header: "Description" },
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
                      key: "tax_amount",
                      header: "Tax",
                      className: "text-right tabular-nums",
                      render: (item) => formatMoney(item.tax_amount, detail.currency),
                    },
                    {
                      key: "total",
                      header: "Total",
                      className: "text-right tabular-nums",
                      render: (item) => formatMoney(item.total, detail.currency),
                    },
                  ]}
                  rows={detail.items ?? []}
                  getRowKey={(item) => item.id}
                  emptyMessage="No line items."
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Payments</h3>
                <SimpleDataTable
                  columns={[
                    { key: "public_id", header: "Payment" },
                    { key: "provider", header: "Provider" },
                    {
                      key: "amount",
                      header: "Amount",
                      className: "text-right tabular-nums",
                      render: (payment) => formatMoney(payment.amount, payment.currency),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (payment) => <StatusBadge status={payment.status} />,
                    },
                    {
                      key: "paid_at",
                      header: "Paid at",
                      render: (payment) => formatDateTime(payment.paid_at),
                    },
                  ]}
                  rows={detail.payments ?? []}
                  getRowKey={(payment) => payment.id}
                  emptyMessage="No payments recorded."
                />
              </section>

              {detail.payment_events && detail.payment_events.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Provider webhook events</h3>
                  <SimpleDataTable
                    columns={[
                      { key: "event_type", header: "Event" },
                      { key: "provider", header: "Provider" },
                      {
                        key: "received_at",
                        header: "Received",
                        render: (event) => formatDateTime(event.received_at),
                      },
                      {
                        key: "processing_error",
                        header: "Result",
                        render: (event) =>
                          event.processing_error ? (
                            <span className="text-destructive">
                              {event.processing_error}
                            </span>
                          ) : (
                            <StatusBadge status="completed" />
                          ),
                      },
                    ]}
                    rows={detail.payment_events}
                    getRowKey={(event) => String(event.id)}
                    emptyMessage="No webhook events."
                  />
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
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget
                ? `Invoice ${voidTarget.invoice_number} (${formatMoney(voidTarget.amount_due, voidTarget.currency)} outstanding) will be marked void. This cannot be undone.`
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
              {voiding ? "Voiding…" : "Void invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
