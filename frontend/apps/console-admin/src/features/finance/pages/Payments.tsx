// Admin payments ledger (read-only: the API exposes no admin payment
// mutations): status/provider filtered paged table with a row detail dialog.
import { useCallback, useEffect, useState } from "react"
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost } from "@/lib/api"
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
  DetailRow,
  FilterChips,
  StatusBadge,
  TablePagination,
} from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"
import type { AdminPaymentRow } from "../lib"

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

const PER_PAGE = 10

export default function FinancePaymentsPage() {
  const [status, setStatus] = useState<(typeof PAYMENT_STATUSES)[number] | "all">("all")
  const [search, setSearch] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AdminPaymentRow[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<AdminPaymentRow | null>(null)
  const [approving, setApproving] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AdminPaymentRow[]>("/admin/payments", {
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

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Incoming payments and settlements across all organizations."
      />

      <div className="flex w-full max-w-full min-w-0 flex-col gap-3">
        <FilterChips
          options={PAYMENT_STATUSES}
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
            placeholder="Search payment ID or reference…"
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
            header: "Payment",
            render: (row) => <span className="font-mono text-xs">{row.public_id}</span>,
          },
          { key: "org_slug", header: "Organization" },
          { key: "provider", header: "Provider", render: (row) => row.provider || "—" },
          {
            key: "amount",
            header: "Amount",
            className: "text-right tabular-nums",
            render: (row) =>
              `${formatMoney(row.amount, row.currency)}${row.fee > 0 ? ` (fee ${formatMoney(row.fee, row.currency)})` : ""}`,
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
          {
            key: "actions",
            header: "",
            className: "w-20",
            render: (row) => (
              <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                View
              </Button>
            ),
          },
        ] satisfies Array<SimpleColumn<AdminPaymentRow>>}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No payments match this filter."
      />

      <TablePagination meta={meta} onPageChange={setPage} />

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {selected?.public_id}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              {selected.status === "pending" ? (
                <div className="flex justify-end">
                  <Button
                    disabled={approving}
                    onClick={async () => {
                      if (!selected) return
                      setApproving(true)
                      try {
                        await apiPost(`/admin/payments/${selected.id}/approve`)
                        toast.success(`Payment ${selected.public_id} approved`)
                        setSelected(null)
                        await loadList()
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
              <DetailRow label="Status">
                <StatusBadge status={selected.status} />
              </DetailRow>
              <DetailRow label="Organization">
                {selected.org_slug} ({selected.org_public_id})
              </DetailRow>
              <DetailRow label="Provider">{selected.provider || "—"}</DetailRow>
              <DetailRow label="Method">{selected.method || "—"}</DetailRow>
              <DetailRow label="External reference">
                {selected.external_reference || "—"}
              </DetailRow>
              <DetailRow label="Linked invoice">
                {selected.invoice_id ? (
                  <span className="font-mono text-xs">{selected.invoice_id}</span>
                ) : (
                  "— (wallet top-up)"
                )}
              </DetailRow>
              <DetailRow label="Amount">
                {formatMoney(selected.amount, selected.currency)}
              </DetailRow>
              <DetailRow label="Fee">{formatMoney(selected.fee, selected.currency)}</DetailRow>
              <DetailRow label="Created">{formatDateTime(selected.created_at)}</DetailRow>
              <DetailRow label="Paid at">{formatDateTime(selected.paid_at)}</DetailRow>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
