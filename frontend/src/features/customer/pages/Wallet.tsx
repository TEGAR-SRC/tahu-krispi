// Wallet: balance card, transaction ledger and the entry point into the
// standalone top-up flow at /app/wallet/topup.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Pagination } from "../Pagination"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface WalletBalance {
  wallet_id?: string
  currency: string
  balance: number
  reserved_balance: number
}

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

export default function CustomerWalletPage() {
  const { orgId } = useOrg()
  const [balance, setBalance] = useState<WalletBalance | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(
    async (showLoading = true) => {
      if (!orgId) return
      try {
        const [balanceRes, txRes] = await Promise.all([
          apiGet<WalletBalance>("/wallet", { headers: orgHeaders(orgId) }),
          apiGet<WalletTransaction[]>("/wallet/transactions", {
            headers: orgHeaders(orgId),
            query: { page, per_page: 20 },
          }),
        ])
        setBalance(balanceRes.data)
        setTransactions(txRes.data ?? [])
        setMeta(txRes.meta)
      } catch (cause) {
        setError(cause)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [orgId, page],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const columns: Array<SimpleColumn<WalletTransaction>> = [
    {
      key: "direction",
      header: "Direction",
      render: (row) => <StatusBadge status={row.direction === "credit" ? "active" : "suspended"} />,
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => (
        <span className={`tabular-nums ${row.direction === "credit" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
          {row.direction === "credit" ? "+" : "−"}
          {formatMoney(row.amount, balance?.currency)}
        </span>
      ),
    },
    {
      key: "balance_after",
      header: "Balance after",
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.balance_after !== undefined ? formatMoney(row.balance_after, balance?.currency) : "—"}
        </span>
      ),
    },
    { key: "description", header: "Description", render: (row) => row.description || row.reference_type || "—" },
    { key: "created_at", header: "Date", render: (row) => formatDateTime(row.created_at) },
  ]

  const currency = balance?.currency ?? "IDR"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallet"
        description="Prepaid balance used to pay invoices and hourly instances."
        actions={
          <Button asChild>
            <Link to="/app/wallet/topup">
              <PlusIcon /> Top up
            </Link>
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Balance" value={formatMoney(balance?.balance ?? 0, currency)} icon={<PlusIcon />} />
        <StatCard label="Reserved" value={formatMoney(balance?.reserved_balance ?? 0, currency)} hint="Held for running resources" />
        <StatCard label="Available" value={formatMoney((balance?.balance ?? 0) - (balance?.reserved_balance ?? 0), currency)} />
        <StatCard label="Currency" value={currency} />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Transactions</h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/wallet/transactions">View all transactions</Link>
          </Button>
        </div>
        <SimpleDataTable
          columns={columns}
          rows={transactions}
          loading={loading}
          error={error}
          emptyMessage={error ? undefined : "No transactions yet — top up to get started."}
          getRowKey={(row) => row.id}
        />
        {meta ? (
          <Pagination page={page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} />
        ) : null}
      </div>
    </div>
  )
}

