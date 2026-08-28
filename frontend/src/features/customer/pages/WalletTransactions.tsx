// Wallet ledger: the paginated GET /wallet/transactions feed with a
// client-side direction filter and a CSV export that walks every page
// (capped) before streaming a Blob download. Currency comes from /wallet.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { apiGet, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { Pagination } from "../Pagination"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface WalletTransaction {
  id: string
  direction: string
  amount: number
  balance_before?: number
  balance_after?: number
  reference_type?: string
  description?: string
  created_at?: string
}

type DirectionFilter = "all" | "credit" | "debit"

/** Hard caps so a pathological total can never loop the exporter forever. */
const PER_PAGE = 50
const MAX_ROWS = 2000

export default function WalletTransactionsPage() {
  const { orgId } = useOrg()
  const [currency, setCurrency] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [direction, setDirection] = useState<DirectionFilter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [txRes, walletRes] = await Promise.all([
        apiGet<WalletTransaction[]>("/wallet/transactions", {
          headers: orgHeaders(orgId),
          query: { page, per_page: PER_PAGE },
        }),
        // Only needed for the currency symbol; failures here are non-fatal.
        apiGet<{ currency?: string }>("/wallet", { headers: orgHeaders(orgId) }).catch(
          () => undefined,
        ),
      ])
      setTransactions(txRes.data ?? [])
      setMeta(txRes.meta)
      if (walletRes?.data?.currency) setCurrency(walletRes.data.currency)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, page])

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

  /** Fetches every page (up to MAX_ROWS) and downloads them as CSV. */
  const exportCsv = async () => {
    if (!orgId) return
    setExporting(true)
    try {
      const rows: WalletTransaction[] = []
      for (let page_ = 1; rows.length < MAX_ROWS; page_ += 1) {
        const { data, meta: pageMeta } = await apiGet<WalletTransaction[]>(
          "/wallet/transactions",
          { headers: orgHeaders(orgId), query: { page: page_, per_page: PER_PAGE } },
        )
        rows.push(...(data ?? []))
        if (!data || data.length === 0) break
        if (pageMeta?.total !== undefined && rows.length >= pageMeta.total) break
      }
      if (rows.length === 0) {
        toast.info("Nothing to export — no transactions yet")
        return
      }
      const header = [
        "id",
        "date",
        "direction",
        `amount_${(currency ?? "").toLowerCase() || "cur"}`,
        "balance_before",
        "balance_after",
        "reference_type",
        "description",
      ]
      const lines = [header.join(",")]
      for (const row of rows) {
        lines.push(
          [
            row.id,
            row.created_at ?? "",
            row.direction,
            String(row.amount ?? ""),
            row.balance_before !== undefined ? String(row.balance_before) : "",
            row.balance_after !== undefined ? String(row.balance_after) : "",
            row.reference_type ?? "",
            row.description ?? "",
          ]
            .map(csvCell)
            .join(","),
        )
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `kilat-wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${rows.length} transactions`)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to export transactions",
      )
    } finally {
      setExporting(false)
    }
  }

  const visible =
    direction === "all" ? transactions : transactions.filter((row) => row.direction === direction)

  const columns: Array<SimpleColumn<WalletTransaction>> = [
    {
      key: "created_at",
      header: "Date",
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: "direction",
      header: "Direction",
      render: (row) => (
        <StatusBadge status={row.direction === "credit" ? "active" : "suspended"} />
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => (
        <span
          className={`font-medium tabular-nums ${
            row.direction === "credit" ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {row.direction === "credit" ? "+" : "−"}
          {formatMoney(row.amount, currency)}
        </span>
      ),
    },
    {
      key: "balances",
      header: "Balance →",
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {row.balance_before !== undefined
            ? `${formatMoney(row.balance_before, currency)} → ${formatMoney(row.balance_after ?? 0, currency)}`
            : "—"}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.description || "—"}</p>
          {row.reference_type ? (
            <p className="truncate text-xs text-muted-foreground">{row.reference_type}</p>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallet transactions"
        description="Every credit and debit against this organization's prepaid balance."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/wallet">
                <ArrowLeftIcon /> Wallet
              </Link>
            </Button>
            <Button onClick={() => void exportCsv()} disabled={exporting}>
              {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} Export CSV
            </Button>
          </>
        }
      />

      <ErrorBanner error={error} />

      <div className="flex flex-wrap items-center gap-3">
        <Label>Direction</Label>
        <Select value={direction} onValueChange={(value) => setDirection(value as DirectionFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="credit">Credit only</SelectItem>
            <SelectItem value="debit">Debit only</SelectItem>
          </SelectContent>
        </Select>
        {!loading && meta?.total !== undefined ? (
          <span className="text-sm text-muted-foreground tabular-nums">{meta.total} total</span>
        ) : null}
      </div>

      <SimpleDataTable
        columns={columns}
        rows={visible}
        loading={loading}
        error={null}
        emptyMessage={
          error
            ? undefined
            : direction === "all"
              ? "No transactions yet — top up to get started."
              : `No ${direction} transactions on this page.`
        }
        getRowKey={(row) => row.id}
      />

      {meta && direction === "all" ? (
        <Pagination page={page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} />
      ) : null}
    </div>
  )
}

/** RFC-4180-ish cell escaping: quote when special chars are present. */
function csvCell(raw: string): string {
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}
