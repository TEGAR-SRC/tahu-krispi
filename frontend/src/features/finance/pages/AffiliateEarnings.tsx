// Affiliate earnings ledger: status-filtered paged list of referral
// commissions with a confirmed reverse action per row.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Undo2Icon } from "lucide-react"
import {
  FilterChips,
  formatDateTime,
  formatMoney,
  StatusBadge,
  TablePagination,
} from "../lib"

interface AffiliateEarning {
  id: string
  referrer_email: string
  referee_email: string
  invoice_number: string
  base_amount: string | number
  commission_amount: string | number
  currency: string
  status: string
  paid_at: string
  created_at: string
}

const EARNING_STATUSES = ["pending", "paid", "reversed"] as const
const PER_PAGE = 10

export default function FinanceAffiliateEarningsPage() {
  const [earnings, setEarnings] = useState<AffiliateEarning[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [status, setStatus] = useState<(typeof EARNING_STATUSES)[number] | "all">("all")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [reverseTarget, setReverseTarget] = useState<AffiliateEarning | null>(null)
  const [reversing, setReversing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<AffiliateEarning[]>("/admin/affiliate/earnings", {
        query: { page, per_page: PER_PAGE, status: status === "all" ? undefined : status },
      })
      setEarnings(envelope.data)
      setMeta(envelope.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const reverseEarning = useCallback(async () => {
    if (!reverseTarget) return
    setReversing(true)
    try {
      await apiPost(`/admin/affiliate/earnings/${reverseTarget.id}/reverse`)
      toast.success(`Commission on ${reverseTarget.invoice_number} reversed`)
      setReverseTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to reverse earning")
    } finally {
      setReversing(false)
    }
  }, [reverseTarget, load])

  const columns: Array<SimpleColumn<AffiliateEarning>> = [
    { key: "referrer_email", header: "Referrer" },
    { key: "referee_email", header: "Referred customer" },
    { key: "invoice_number", header: "Invoice" },
    {
      key: "base_amount",
      header: "Base",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.base_amount), row.currency),
    },
    {
      key: "commission_amount",
      header: "Commission",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.commission_amount), row.currency),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    { key: "paid_at", header: "Paid at", render: (row) => formatDateTime(row.paid_at) },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      render: (row) =>
        row.status === "reversed" ? null : (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => setReverseTarget(row)}
          >
            <Undo2Icon /> Reverse
          </Button>
        ),
    },
  ]

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
              <Link to="/finance/affiliate">Affiliate program</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Earnings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title="Affiliate earnings"
        description="Referral commissions generated when referred invoices are settled."
      />

      <FilterChips
        options={EARNING_STATUSES}
        value={status}
        allLabel="All statuses"
        onChange={(next) => {
          setPage(1)
          setStatus(next)
        }}
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : (
        <>
          <SimpleDataTable
            columns={columns}
            rows={earnings}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyMessage="No affiliate earnings recorded for this filter."
          />
          <TablePagination meta={meta} onPageChange={setPage} />
        </>
      )}

      <AlertDialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReverseTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this commission?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatMoney(Number(reverseTarget?.commission_amount ?? 0))} earned by{" "}
              {reverseTarget?.referrer_email} on invoice {reverseTarget?.invoice_number} will be
              reversed and deducted from their affiliate balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep commission</AlertDialogCancel>
            <AlertDialogAction
              disabled={reversing}
              onClick={(event) => {
                event.preventDefault()
                void reverseEarning()
              }}
            >
              {reversing ? "Reversing…" : "Reverse"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
