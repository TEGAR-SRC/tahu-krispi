// Admin invoice detail (GET /admin/invoices/:invoice_id): line items, linked
// payments and provider webhook events. Voiding goes through
// POST /admin/invoices/:invoice_id/void behind a confirmation dialog; the
// backend refuses to void paid/partially_refunded/void invoices, so the
// action is hidden there. There is no mark-paid endpoint — paid state only
// comes from the payment flow.
import { useState } from "react"
import { useParams } from "react-router-dom"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DetailBreadcrumbs,
  DetailField,
} from "./detailShared"
import { useApiDetail } from "./use-api-detail"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"

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
  public_id?: string
  provider?: string
  method?: string
  currency?: string
  amount: number
  fee?: number
  status?: string
  paid_at?: string
  created_at?: string
}

interface PaymentEvent {
  id: number
  payment_id?: string
  provider?: string
  event_type: string
  received_at?: string
  processed_at?: string
  processing_error?: string | null
}

interface InvoiceDetailData {
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
  items: InvoiceItem[]
  payments: InvoicePayment[]
  payment_events: PaymentEvent[]
}

/** The backend refuses to void paid/partially_refunded/void invoices. */
function canVoid(invoice: InvoiceDetailData): boolean {
  return !["paid", "partially_refunded", "void"].includes(invoice.status)
}

export default function BillingInvoiceDetailPage() {
  const { invoiceId } = useParams()
  const detail = useApiDetail<InvoiceDetailData>(
    invoiceId ? `/admin/invoices/${invoiceId}` : null,
  )
  const [voidOpen, setVoidOpen] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const confirmVoid = async () => {
    if (!detail.data) return
    setVoiding(true)
    try {
      await apiPost(`/admin/invoices/${detail.data.id}/void`)
      toast.success(`Invoice ${detail.data.invoice_number} voided`)
      setVoidOpen(false)
      detail.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to void invoice",
      )
      setVoidOpen(false)
    } finally {
      setVoiding(false)
    }
  }

  const invoice = detail.data

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Invoices", to: "/admin/billing/invoices" },
          { label: invoice ? invoice.invoice_number : (invoiceId ?? "…") },
        ]}
      />

      <PageHeader
        title={invoice ? `Invoice ${invoice.invoice_number}` : "Invoice detail"}
        description={
          invoice
            ? `${invoice.org_slug} · ${formatMoney(invoice.total, invoice.currency)} · ${invoice.public_id}`
            : undefined
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
            {invoice && canVoid(invoice) ? (
              <Button variant="destructive" onClick={() => setVoidOpen(true)}>
                <BanIcon /> Void invoice
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

      {invoice ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Summary <StatusBadge status={invoice.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="Total" value={formatMoney(invoice.total, invoice.currency)} />
              <DetailField label="Subtotal" value={formatMoney(invoice.subtotal, invoice.currency)} />
              <DetailField label="Discount" value={formatMoney(invoice.discount, invoice.currency)} />
              <DetailField label="Tax" value={formatMoney(invoice.tax, invoice.currency)} />
              <DetailField
                label="Amount paid"
                value={formatMoney(invoice.amount_paid, invoice.currency)}
              />
              <DetailField
                label="Amount due"
                value={formatMoney(invoice.amount_due, invoice.currency)}
              />
              <DetailField
                label="Organization"
                value={`${invoice.org_slug} (${invoice.org_public_id})`}
              />
              <DetailField label="Issued" value={formatDateTime(invoice.issued_at)} />
              <DetailField label="Due" value={formatDateTime(invoice.due_at)} />
              <DetailField label="Paid at" value={formatDateTime(invoice.paid_at)} />
              <DetailField label="Voided" value={formatDateTime(invoice.voided_at)} />
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
                  {
                    key: "quantity",
                    header: "Qty",
                    className: "text-right tabular-nums",
                  },
                  {
                    key: "unit_price",
                    header: "Unit price",
                    className: "text-right tabular-nums",
                    render: (item) => formatMoney(item.unit_price, invoice.currency),
                  },
                  {
                    key: "tax_amount",
                    header: "Tax",
                    className: "text-right tabular-nums",
                    render: (item) => formatMoney(item.tax_amount, invoice.currency),
                  },
                  {
                    key: "total",
                    header: "Total",
                    className: "text-right tabular-nums",
                    render: (item) => formatMoney(item.total, invoice.currency),
                  },
                ]}
                rows={invoice.items ?? []}
                getRowKey={(item) => item.id}
                emptyMessage="No line items on this invoice."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleDataTable
                columns={[
                  {
                    key: "public_id",
                    header: "Payment",
                    render: (payment) => (
                      <span className="font-mono text-xs">{payment.public_id || payment.id}</span>
                    ),
                  },
                  { key: "provider", header: "Provider" },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums",
                    render: (payment) =>
                      formatMoney(payment.amount, payment.currency ?? invoice.currency),
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
                rows={invoice.payments ?? []}
                getRowKey={(payment) => payment.id}
                emptyMessage="No payments recorded against this invoice."
                skeletonRows={3}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider webhook events</CardTitle>
            </CardHeader>
            <CardContent>
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
                    key: "processed_at",
                    header: "Processed",
                    render: (event) => formatDateTime(event.processed_at),
                  },
                  {
                    key: "processing_error",
                    header: "Result",
                    render: (event) =>
                      event.processing_error ? (
                        <span className="text-destructive">{event.processing_error}</span>
                      ) : (
                        <StatusBadge status="completed" />
                      ),
                  },
                ]}
                rows={invoice.payment_events ?? []}
                getRowKey={(event) => String(event.id)}
                emptyMessage="No webhook events recorded for this invoice."
                skeletonRows={3}
              />
            </CardContent>
          </Card>
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
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoice
                ? `Invoice ${invoice.invoice_number} (${formatMoney(invoice.amount_due, invoice.currency)} outstanding) will be marked void. This cannot be undone.`
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
