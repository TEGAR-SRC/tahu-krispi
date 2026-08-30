// Admin billing: platform payments (GET /admin/payments). The API supports a
// server-side status filter; the provider filter narrows the current page
// client-side. The detail dialog shows the row fields and, when the payment
// is linked to an invoice, its webhook events via
// GET /admin/invoices/:invoice_id (payment_events are only exposed there).
import { useMemo, useState, type ReactNode } from "react"
import { CheckIcon, EyeIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { StatusBadge, Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface PaymentRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  invoice_id: string | null
  provider: string
  method: string
  external_reference: string
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
  received_at: string
  processed_at: string
  processing_error?: string | null
}

// Matches the backend's admPaymentStatuses allow-list.
const PAYMENT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "expired",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-medium">{value}</span>
    </div>
  )
}

export default function BillingPaymentsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const list = usePagedList<PaymentRow>(
    "/admin/payments",
    statusFilter === "all" ? {} : { status: statusFilter },
  )

  // Provider filtering is applied on the loaded page because the list
  // endpoint does not accept a provider query param.
  const providers = useMemo(() => {
    const set = new Set<string>()
    for (const row of list.rows) {
      if (row.provider) set.add(row.provider)
    }
    return Array.from(set).sort()
  }, [list.rows])

  const visibleRows = useMemo(
    () =>
      providerFilter === "all"
        ? list.rows
        : list.rows.filter((row) => row.provider === providerFilter),
    [list.rows, providerFilter],
  )

  const [detail, setDetail] = useState<PaymentRow | null>(null)
  const [events, setEvents] = useState<PaymentEvent[] | null>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  const bulk = useBulkSelection<PaymentRow>((payment) => payment.id)
  const [bulkApproving, setBulkApproving] = useState(false)

  const openDetail = (row: PaymentRow) => {
    setDetail(row)
    setEvents(null)
    if (!row.invoice_id) return
    setEventsLoading(true)
    apiGet<{ payment_events: PaymentEvent[] }>(`/admin/invoices/${row.invoice_id}`)
      .then((envelope) => {
        const all = envelope.data?.payment_events ?? []
        setEvents(all.filter((event) => event.payment_id === row.id))
      })
      .catch(() => setEvents([]))
      .finally(() => setEventsLoading(false))
  }

  const confirmBulkApprove = async () => {
    const targets = bulk.resolve(visibleRows).filter((row) => row.status === "pending")
    if (targets.length === 0) return
    setBulkApproving(true)
    try {
      for (const payment of targets) {
        await apiPost(`/admin/payments/${payment.id}/approve`)
      }
      toast.success(
        `${targets.length} pending payment${targets.length > 1 ? "s" : ""} approved`,
      )
      bulk.clear()
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Failed to approve payments",
      )
    } finally {
      setBulkApproving(false)
    }
  }

  const columns: Array<SimpleColumn<PaymentRow>> = [
    {
      key: "public_id",
      header: "Payment",
      render: (row) => <span className="font-mono text-xs">{row.public_id}</span>,
    },
    { key: "org_slug", header: "Organization" },
    { key: "provider", header: "Provider" },
    {
      key: "method",
      header: "Method",
      render: (row) => row.method || "—",
    },
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
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.paid_at)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Details for ${row.public_id}`}
          onClick={() => openDetail(row)}
        >
          <EyeIcon />
        </Button>
      ),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Wallet topups and invoice settlements across providers."
        actions={
          <div className="flex min-w-0 items-center gap-2">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PAYMENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={(value) => setProviderFilter(value)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {providerFilter !== "all" ? (
        <p className="-mt-3 text-xs text-muted-foreground">
          Provider filter applies to the current page (API has no server-side
          provider filter).
        </p>
      ) : null}

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkApproving}
        actions={[
          {
            key: "approve",
            label: "Approve selected",
            onClick: () => void confirmBulkApprove(),
          },
        ]}
      />

      <SimpleDataTable
        columns={columns}
        rows={visibleRows}
        loading={list.loading}
        error={list.error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No payments match these filters."
        skeletonRows={6}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment detail</DialogTitle>
            <DialogDescription>{detail?.public_id}</DialogDescription>
          </DialogHeader>

          {detail ? (
            <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
              <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-4">
                <DetailField label="Status" value={<StatusBadge status={detail.status} />} />
                <DetailField label="Amount" value={formatMoney(detail.amount, detail.currency)} />
                <DetailField label="Fee" value={formatMoney(detail.fee, detail.currency)} />
                <DetailField label="Provider" value={detail.provider || "—"} />
                <DetailField label="Method" value={detail.method || "—"} />
                <DetailField
                  label="External reference"
                  value={detail.external_reference || "—"}
                />
                <DetailField label="Organization" value={`${detail.org_slug}`} />
                <DetailField
                  label="Invoice"
                  value={
                    detail.invoice_id ? (
                      <span className="font-mono text-xs">{detail.invoice_id}</span>
                    ) : (
                      "— (wallet topup)"
                    )
                  }
                />
                <DetailField label="Created" value={formatDateTime(detail.created_at)} />
                <DetailField label="Paid at" value={formatDateTime(detail.paid_at)} />
              </div>

              {detail?.status === "pending" ? (
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={approving}
                    onClick={async () => {
                      if (!detail) return
                      setApproving(true)
                      try {
                        await apiPost(`/admin/payments/${detail.id}/approve`)
                        toast.success(`Payment ${detail.public_id} approved`)
                        setDetail(null)
                        list.reload()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Approve failed")
                      } finally {
                        setApproving(false)
                      }
                    }}
                  >
                    {approving ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                    Approve pending
                  </Button>
                </div>
              ) : null}

              {detail.invoice_id ? (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">Webhook events</h3>
                    {eventsLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Loading events…
                      </p>
                    ) : events && events.length > 0 ? (
                      <ul className="space-y-1 text-sm">
                        {events.map((event) => (
                          <li
                            key={String(event.id)}
                            className="flex min-w-0 items-center justify-between gap-4 rounded-md border px-3 py-1.5"
                          >
                            <span>{event.event_type}</span>
                            <span className="text-muted-foreground">
                              {formatDateTime(event.received_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No webhook events recorded for this payment.
                      </p>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
