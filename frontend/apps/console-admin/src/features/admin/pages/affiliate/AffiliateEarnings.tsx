// Admin affiliate earnings browser: GET /admin/affiliate/earnings with status
// filter + pagination, and reversal (POST .../:earning_id/reverse) behind a
// confirmation. The backend only accepts approved|paid|reversed for ?status=
// and only reverses earnings whose status is still approved; it takes no body,
// so there is no reason field here.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { RotateCcwIcon } from "lucide-react"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import type { PagedMeta } from "@/lib/types"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
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
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge, PaginationBar } from "../shared"
import { formatDateTime, formatMoney } from "../format"

interface EarningRow {
  id: string
  referrer_email: string
  referee_email: string
  invoice_number: string
  base_amount: number
  commission_amount: number
  currency: string
  status: string
  paid_at?: string | null
  created_at: string
}

// Verified against the live backend: any other value answers 400.
const EARNING_STATUSES = ["approved", "paid", "reversed"] as const

const PER_PAGE = 20

export default function AffiliateEarningsPage() {
  const [rows, setRows] = useState<EarningRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [reverseTarget, setReverseTarget] = useState<EarningRow | null>(null)
  const [reversing, setReversing] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    apiGet<EarningRow[]>("/admin/affiliate/earnings", {
      query: {
        page,
        per_page: PER_PAGE,
        ...(statusFilter === "all" ? {} : { status: statusFilter }),
      },
    })
      .then((envelope) => {
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [page, statusFilter])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  const changeStatus = (value: string) => {
    setStatusFilter(value)
    setPage(1)
  }

  const confirmReverse = async () => {
    if (!reverseTarget) return
    setReversing(true)
    try {
      await apiPost(`/admin/affiliate/earnings/${reverseTarget.id}/reverse`)
      toast.success(`Commission for ${reverseTarget.referrer_email} reversed`)
      setReverseTarget(null)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to reverse earning.",
      )
    } finally {
      setReversing(false)
    }
  }

  const columns: Array<SimpleColumn<EarningRow>> = [
    {
      key: "referrer_email",
      header: "Referrer",
      render: (row) => (
        <span className="min-w-0 block max-w-40 truncate" title={row.referrer_email}>
          {row.referrer_email}
        </span>
      ),
    },
    {
      key: "referee_email",
      header: "Referred user",
      render: (row) => (
        <span className="min-w-0 block max-w-40 truncate" title={row.referee_email}>
          {row.referee_email}
        </span>
      ),
    },
    {
      key: "invoice_number",
      header: "Invoice",
      render: (row) => (
        <span className="block max-w-40 break-all font-mono text-xs">
          {row.invoice_number || "—"}
        </span>
      ),
    },
    {
      key: "base_amount",
      header: "Invoice total",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.base_amount, row.currency),
    },
    {
      key: "commission_amount",
      header: "Commission",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(row.commission_amount, row.currency),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "paid_at",
      header: "Paid at",
      className: "hidden lg:table-cell",
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.paid_at ?? null)}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (
        row,
      ) => <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-12",
      render: (row) =>
        row.status === "approved" ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Reverse commission for ${row.referrer_email}`}
            onClick={() => setReverseTarget(row)}
          >
            <RotateCcwIcon />
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/billing/affiliate-config">Affiliate program</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Earnings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>Affiliate earnings</CardTitle>
          <Select value={statusFilter} onValueChange={changeStatus}>
            <SelectTrigger className="w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EARNING_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  <StatusBadge status={status} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-4">
          <SimpleDataTable
            columns={columns}
            rows={rows}
            loading={loading}
            error={error}
            getRowKey={(row) => row.id}
            emptyMessage={
              statusFilter === "all"
                ? "No affiliate earnings recorded yet."
                : `No ${statusFilter} earnings.`
            }
            skeletonRows={6}
          />
          <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
        </CardContent>
      </Card>

      <AlertDialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reversing) setReverseTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this commission?</AlertDialogTitle>
            <AlertDialogDescription>
              {reverseTarget
                ? `The ${formatMoney(reverseTarget.commission_amount, reverseTarget.currency)} commission for ${reverseTarget.referrer_email} will be marked reversed. Only approved earnings can be reversed — this cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={reversing}
              onClick={(event) => {
                event.preventDefault()
                void confirmReverse()
              }}
            >
              {reversing ? "Reversing…" : "Reverse earning"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
