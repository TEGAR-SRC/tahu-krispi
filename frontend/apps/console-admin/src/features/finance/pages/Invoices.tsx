// Admin invoice ledger: status/search filtered paged table, detail dialog with
// line items, applied payments and payment events, plus void action.
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
  StatusBadge,
  TablePagination,
} from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"
import type {
  AdminInvoiceDetail,
  AdminInvoiceRow,
  InvoiceItem,
} from "../lib"

const INVOICE_STATUSES = [
  "draft",
  "unpaid",
  "paid",
  "overdue",
  "void",
  "refunded",
  "partially_refunded",
] as const

const PER_PAGE = 10

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

export default function FinanceInvoicesPage() {
  const [status, setStatus] = useState<(typeof INVOICE_STATUSES)[number] | "all">("all")
  const [search, setSearch] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminInvoiceRow[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminInvoiceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [voiding, setVoiding] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AdminInvoiceRow[]>("/admin/invoices", {
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
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await loadList()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [loadList])

  const openDetail = useCallback(async (invoiceId: string) => {
    setSelectedId(invoiceId)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const envelope = await apiGet<AdminInvoiceDetail>(`/admin/invoices/${invoiceId}`)
      setDetail(envelope.data)
    } catch (cause) {
      setDetailError(cause)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const voidInvoice = useCallback(async () => {
    if (!detail) return
    setVoiding(true)
    try {
      await apiPost(`/admin/invoices/${detail.id}/void`)
      toast.success(`Invoice ${detail.invoice_number} voided`)
      setConfirmVoid(false)
      await openDetail(detail.id)
      await loadList()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to void invoice")
    } finally {
      setVoiding(false)
    }
  }, [detail, openDetail, loadList])

  const voidable =
    detail !== null &&
    detail.status !== "paid" &&
    detail.status !== "void" &&
    detail.status !== "refunded" &&
    detail.status !== "partially_refunded"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Invoice ledger with line items, settlements and payment events."
      />

      <div className="flex w-full max-w-full min-w-0 flex-col gap-3">
        <FilterChips
          options={INVOICE_STATUSES}
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
            placeholder="Search invoice number or ID…"
          />
          <Button type="submit" variant="outline" size="sm">
            <SearchIcon /> Search
          </Button>
        </form>
      </div>

      <SimpleDataTable
        columns={[
          {
            key: "invoice_number",
            header: "Invoice",
            render: (row) => (
              <Link
                to={`/finance/invoices/${row.id}`}
                className="underline-offset-4 hover:underline"
              >
                <span className="block font-medium">{row.invoice_number}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {row.public_id}
                </span>
              </Link>
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
          { key: "due_at", header: "Due date", render: (row) => formatDateTime(row.due_at) },
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
        emptyMessage="No invoices match this filter."
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
            <DialogTitle>Invoice {detail?.invoice_number ?? ""}</DialogTitle>
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
              <div className="grid w-full max-w-full min-w-0 gap-x-8 sm:grid-cols-2">
                <div>
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
                  <DetailRow label="Amount paid">
                    {formatMoney(detail.amount_paid, detail.currency)}
                  </DetailRow>
                  <DetailRow label="Amount due">
                    {formatMoney(detail.amount_due, detail.currency)}
                  </DetailRow>
                </div>
              </div>

              <Separator />
              <h3 className="text-sm font-semibold">Line items</h3>
              <SimpleDataTable
                columns={itemColumns}
                rows={detail.items}
                getRowKey={(row) => row.id}
                emptyMessage="No line items."
              />

              <h3 className="pt-2 text-sm font-semibold">Payments applied</h3>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <SimpleDataTable
                  columns={[
                    {
                      key: "provider",
                      header: "Provider",
                      render: (row) => String(row.provider ?? "—"),
                    },
                    {
                      key: "amount",
                      header: "Amount",
                      className: "text-right tabular-nums",
                      render: (row) =>
                        formatMoney(
                          Number(row.amount ?? 0),
                          typeof row.currency === "string" ? row.currency : undefined,
                        ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (row) => <StatusBadge status={String(row.status ?? "")} />,
                    },
                    {
                      key: "paid_at",
                      header: "Paid at",
                      render: (row) => formatDateTime(String(row.paid_at ?? "")),
                    },
                  ]}
                  rows={detail.payments}
                  getRowKey={(row, index) => String(row.id ?? index)}
                  emptyMessage="No payments recorded."
                />
              )}

              <h3 className="pt-2 text-sm font-semibold">Payment events</h3>
              {detail.payment_events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment events.</p>
              ) : (
                <div className="space-y-2">
                  {detail.payment_events.map((event, index) => (
                    <div key={event.id ?? index} className="rounded-md border p-3 text-sm">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <StatusBadge status={String(event.status ?? "")} />
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(String(event.created_at ?? ""))}
                        </span>
                      </div>
                      {event.provider ? (
                        <p className="mt-1 text-muted-foreground">via {String(event.provider)}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {voidable ? (
                <>
                  <Separator />
                  <div className="flex justify-end">
                    <Button variant="destructive" size="sm" onClick={() => setConfirmVoid(true)}>
                      <BanIcon /> Void invoice
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
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Invoice {detail?.invoice_number} ({formatMoney(detail?.total)}) will be voided.
              This cannot be undone.
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
