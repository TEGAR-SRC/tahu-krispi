// Wallet: balance card, topup flow (creates a pending payment and polls the
// balance until the gateway webhook credits it) and the paginated transaction
// ledger.
import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLinkIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
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

interface TopupResult {
  id: string
  public_id: string
  status: string
  amount: number
  currency: string
  method?: string
  checkout_url: string
}

const METHODS = ["bank_transfer", "va", "ewallet", "credit_card"] as const

export default function CustomerWalletPage() {
  const { orgId } = useOrg()
  const [balance, setBalance] = useState<WalletBalance | null>(null)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [topupOpen, setTopupOpen] = useState(false)
  // Active topup being polled after creation: we watch for the wallet balance
  // to rise above the value captured at creation (the payment webhook credits
  // the wallet asynchronously).
  const [pendingTopup, setPendingTopup] = useState<TopupResult | null>(null)
  const balanceAtTopup = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(
    async (showLoading = true) => {
      if (!orgId) return
      if (showLoading) setLoading(true)
      setError(null)
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
    void load()
  }, [load])

  // Poll the wallet while a topup is pending; when the balance rises above the
  // snapshot taken at order creation the payment has been credited.
  useEffect(() => {
    if (!pendingTopup || pendingTopup.status !== "pending") return
    let elapsed = 0
    pollTimer.current = setInterval(() => {
      elapsed += 5
      void load(false)
      // Give up silently after ~5 minutes; the transactions ledger still shows
      // any late credit on next visit.
      if (elapsed >= 300 && pollTimer.current) {
        clearInterval(pollTimer.current)
        setPendingTopup(null)
      }
    }, 5000)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [pendingTopup, load])

  useEffect(() => {
    if (!pendingTopup) return
    if ((balance?.balance ?? 0) > balanceAtTopup.current) {
      setPendingTopup(null)
      toast.success("Top-up credited to your wallet")
    }
  }, [balance, pendingTopup])

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
          <Button onClick={() => setTopupOpen(true)}>
            <PlusIcon /> Top up
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

      {pendingTopup && pendingTopup.status === "pending" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Loader2Icon className="size-4 animate-spin text-amber-600" />
            <span>
              Top-up of{" "}
              <strong>{formatMoney(pendingTopup.amount, pendingTopup.currency)}</strong> awaiting
              payment confirmation — polling every 5 s…
            </span>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={pendingTopup.checkout_url} target="_blank" rel="noopener noreferrer">
              Open checkout <ExternalLinkIcon />
            </a>
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
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

      <TopupDialog
        open={topupOpen}
        onOpenChange={setTopupOpen}
        currency={currency}
        onCreated={(result) => {
          setTopupOpen(false)
          balanceAtTopup.current = balance?.balance ?? 0
          setPendingTopup(result)
          void load(false)
        }}
      />
    </div>
  )
}

function TopupDialog({
  open,
  onOpenChange,
  currency,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  onCreated: (result: TopupResult) => void
}) {
  const { orgId } = useOrg()
  const [amount, setAmount] = useState("100000")
  const [method, setMethod] = useState<string>("bank_transfer")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter an amount greater than zero")
      return
    }
    setBusy(true)
    try {
      const { data } = await apiPost<TopupResult>(
        "/wallet/topup",
        { amount: value, currency, method },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Top-up order created")
      onCreated(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create top-up")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Top up wallet</DialogTitle>
          <DialogDescription>
            A pending payment is created and credited automatically once the gateway confirms it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="topup-amount">Amount ({currency}) *</Label>
            <Input
              id="topup-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(currency === "IDR" ? ["50000", "100000", "500000", "1000000"] : ["10", "25", "50", "100"]).map(
                (preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAmount(preset)}
                  >
                    {preset}
                  </Button>
                ),
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((item) => (
                  <SelectItem key={item} value={item} className="capitalize">
                    {item.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create top-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
