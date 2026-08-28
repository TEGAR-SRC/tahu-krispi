// Full-page invoice detail: header amounts, line items, applied payments and
// the payment events timeline, plus a guarded void action
// (POST /admin/invoices/:id/void).
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
  StatusBadge,
} from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"
import type {
  AdminInvoiceDetail,
  AdminPaymentRow,
  InvoiceItem,
} from "../lib"

const itemColumns: Array<SimpleColumn<InvoiceItem>> = [
  { key: "description", header: "Description" },
  { key: "quantity", header: "Qty", className: "w-16 tabular-nums" },
  {
    key: "unit_price",
    header: "Unit price",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.unit_price),
  },
  {
    key: "tax_amount",
    header: "Tax",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.tax_amount),
  },
  {
    key: "total",
    header: "Total",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.total),
  },
]

const paymentColumns: Array<SimpleColumn<AdminPaymentRow>> = [
  {
    key: "public_id",
    header: "Payment",
    render: (row) => <span className="font-mono text-xs">{row.public_id}</span>,
  },
  { key: "provider", header: "Provider" },
  { key: "method", header: "Method" },
  {
    key: "amount",
    header: "Amount",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.amount, row.currency),
  },
  {
    key: "fee",
    header: "Fee",
    className: "text-right tabular-nums",
    render: (row) => formatMoney(row.fee, row.currency),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: "paid_at",
    header: "Paid at",
    render: (row) => formatDateTime(row.paid_at),
  },
]

export default function FinanceInvoiceDetailPage() {
  const invoiceId = useParams().invoiceId
  const [detail, setDetail] = useState<AdminInvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AdminInvoiceDetail>(`/admin/invoices/${invoiceId}`)
      setDetail(envelope.data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

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

  const voidInvoice = useCallback(async () => {
    if (!detail) return
    setVoiding(true)
    try {
      await apiPost(`/admin/invoices/${detail.id}/void`)
      toast.success(`Invoice ${detail.invoice_number} voided`)
      setConfirmVoid(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to void invoice")
    } finally {
      setVoiding(false)
    }
  }, [detail, load])

  // Settled or already-void invoices cannot be voided.
  const canVoid =
    detail !== null &&
    detail.status !== "paid" &&
    detail.status !== "void" &&
    detail.status !== "refunded" &&
    detail.status !== "partially_refunded"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
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
              <Link to="/finance/invoices">Invoices</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{detail?.invoice_number ?? "Invoice"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={`Invoice ${detail?.invoice_number ?? ""}`}
        description={
          detail
            ? `${detail.org_slug} · ${detail.public_id} · due ${formatDateTime(detail.due_at)}`
            : "Loading…"
        }
        actions={
          detail && canVoid ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmVoid(true)}>
              <BanIcon /> Void invoice
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
        <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
          <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
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
                <DetailRow label="Issued">{formatDateTime(detail.issued_at)}</DetailRow>
                <DetailRow label="Due">{formatDateTime(detail.due_at)}</DetailRow>
                <DetailRow label="Paid">{formatDateTime(detail.paid_at)}</DetailRow>
                {detail.voided_at ? (
                  <DetailRow label="Voided">{formatDateTime(detail.voided_at)}</DetailRow>
                ) : null}
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
                <DetailRow label="Amount paid">
                  {formatMoney(detail.amount_paid, detail.currency)}
                </DetailRow>
                <DetailRow label="Amount due">
                  {formatMoney(detail.amount_due, detail.currency)}
                </DetailRow>
              </CardContent>
            </Card>
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Line items</h3>
            <SimpleDataTable
              columns={itemColumns}
              rows={detail.items}
              getRowKey={(row) => row.id}
              emptyMessage="No line items."
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Payments applied</h3>
            {/* payments rows are untyped on the envelope; the list endpoint shape matches AdminPaymentRow */}
            <SimpleDataTable
              columns={paymentColumns}
              rows={detail.payments as unknown as AdminPaymentRow[]}
              getRowKey={(row, index) => String(row?.id ?? index)}
              emptyMessage="No payments recorded."
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Payment events</h3>
            {detail.payment_events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment events.</p>
            ) : (
              <ol className="relative space-y-3 border-l pl-4">
                {detail.payment_events.map((event, index) => (
                  <li key={event.id ?? index} className="rounded-md border p-3 text-sm">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <StatusBadge status={String(event.status ?? "")} />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(String(event.created_at ?? ""))}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
                      {event.provider ? <span>via {String(event.provider)}</span> : null}
                      {event.amount !== undefined && event.amount !== null ? (
                        <span>
                          {formatMoney(
                            Number(event.amount),
                            typeof event.currency === "string" ? event.currency : undefined,
                          )}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Invoice {detail?.invoice_number} (
              {formatMoney(detail?.total, detail?.currency)}) will be voided. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              disabled={voiding}
              onClick={(event) => {
                event.preventDefault()
                void voidInvoice()
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
