// Wallet oversight: the API has no admin wallet listing, so organizations are
// derived from real billing rows (orders/invoices/payments) and each wallet is
// read via GET /wallet with the org context header. Includes a transaction
// drill-down and a credit/debit adjustment action (POST /admin/wallets/:org/adjust).
import { useCallback, useEffect, useMemo, useState } from "react"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { HistoryIcon, WalletIcon } from "lucide-react"
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  StatusBadge,
  TablePagination,
} from "../lib"
import type { AdminInvoiceRow, AdminOrderRow, AdminPaymentRow, FinanceSummaryData, OrgWallet } from "../lib"

interface OrgRef {
  organization_id: string
  org_public_id: string
  org_slug: string
}

interface WalletRow extends OrgRef {
  balance: number
  reserved_balance: number
  currency: string
  loadError?: string
}

interface WalletTransaction {
  id: string
  direction: string
  amount: string | number
  balance_before: string | number
  balance_after: string | number
  description?: string
  reference_type?: string
  created_at: string
}

/** Runs async work over items with limited concurrency. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export default function FinanceWalletsPage() {
  const [rows, setRows] = useState<WalletRow[]>([])
  const [totalBalance, setTotalBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [txOrg, setTxOrg] = useState<WalletRow | null>(null)
  const [txRows, setTxRows] = useState<WalletTransaction[]>([])
  const [txMeta, setTxMeta] = useState<{ page: number; per_page: number; total?: number } | null>(
    null,
  )
  const [txPage, setTxPage] = useState(1)
  const [txLoading, setTxLoading] = useState(false)

  const [adjustOrg, setAdjustOrg] = useState<WalletRow | null>(null)
  const [confirmAdjust, setConfirmAdjust] = useState(false)
  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [adjusting, setAdjusting] = useState(false)

  const loadWallets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Union of orgs seen across billing lists (real data, no admin orgs endpoint).
      const [ordersRes, invoicesRes, paymentsRes, summaryRes] = await Promise.all([
        apiGet<AdminOrderRow[]>("/admin/orders", { query: { per_page: 100 } }),
        apiGet<AdminInvoiceRow[]>("/admin/invoices", { query: { per_page: 100 } }),
        apiGet<AdminPaymentRow[]>("/admin/payments", { query: { per_page: 100 } }),
        apiGet<FinanceSummaryData>("/admin/finance/summary", { query: { days: 30 } }),
      ])
      setTotalBalance(summaryRes.data.wallet_balance_total)

      const orgs = new Map<string, OrgRef>()
      for (const row of ordersRes.data)
        orgs.set(row.organization_id, {
          organization_id: row.organization_id,
          org_public_id: row.org_public_id,
          org_slug: row.org_slug,
        })
      for (const row of invoicesRes.data)
        orgs.set(row.organization_id, {
          organization_id: row.organization_id,
          org_public_id: row.org_public_id,
          org_slug: row.org_slug,
        })
      for (const row of paymentsRes.data)
        orgs.set(row.organization_id, {
          organization_id: row.organization_id,
          org_public_id: row.org_public_id,
          org_slug: row.org_slug,
        })

      const refs = [...orgs.values()].slice(0, 50)
      const wallets = await mapLimited(refs, 8, async (ref): Promise<WalletRow> => {
        try {
          const envelope = await apiGet<OrgWallet>("/wallet", {
            headers: { "X-Organization-ID": ref.organization_id },
          })
          return {
            ...ref,
            balance: Number(envelope.data.balance ?? 0),
            reserved_balance: Number(envelope.data.reserved_balance ?? 0),
            currency: envelope.data.currency || "IDR",
          }
        } catch (cause) {
          return {
            ...ref,
            balance: 0,
            reserved_balance: 0,
            currency: "IDR",
            loadError: cause instanceof Error ? cause.message : "Failed to load wallet",
          }
        }
      })
      setRows(wallets.sort((a, b) => b.balance - a.balance))
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWallets()
  }, [loadWallets])

  const loadTransactions = useCallback(async () => {
    if (!txOrg) return
    setTxLoading(true)
    try {
      const envelope = await apiGet<WalletTransaction[]>("/wallet/transactions", {
        query: { page: txPage, per_page: 10 },
        headers: { "X-Organization-ID": txOrg.organization_id },
      })
      setTxRows(envelope.data)
      setTxMeta(envelope.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setTxLoading(false)
    }
  }, [txOrg, txPage])

  useEffect(() => {
    if (txOrg) void loadTransactions()
  }, [txOrg, loadTransactions])

  const submitAdjust = useCallback(async () => {
    if (!adjustOrg) return
    const numeric = Number(amount)
    if (!amount || !Number.isFinite(numeric) || numeric <= 0) {
      toast.error("Amount must be greater than zero")
      return
    }
    if (!description.trim()) {
      toast.error("Description is required")
      return
    }
    setAdjusting(true)
    try {
      await apiPost(`/admin/wallets/${adjustOrg.organization_id}/adjust`, {
        direction,
        amount: numeric,
        description: description.trim(),
      })
      toast.success(
        `Wallet ${direction === "credit" ? "credited" : "debited"} by ${formatMoney(numeric)} for ${adjustOrg.org_slug}`,
      )
      setConfirmAdjust(false)
      setAdjustOrg(null)
      setAmount("")
      setDescription("")
      await loadWallets()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Adjustment failed")
    } finally {
      setAdjusting(false)
    }
  }, [adjustOrg, direction, amount, description, loadWallets])

  const columns = useMemo<Array<SimpleColumn<WalletRow>>>(
    () => [
      {
        key: "org",
        header: "Organization",
        render: (row) => (
          <div>
            <p className="font-medium">{row.org_slug}</p>
            <p className="font-mono text-xs text-muted-foreground">{row.org_public_id}</p>
          </div>
        ),
      },
      {
        key: "balance",
        header: "Balance",
        className: "text-right tabular-nums",
        render: (row) =>
          row.loadError ? (
            <span className="text-xs text-destructive">{row.loadError}</span>
          ) : (
            formatMoney(row.balance, row.currency)
          ),
      },
      {
        key: "reserved_balance",
        header: "Reserved",
        className: "text-right tabular-nums",
        render: (row) => formatMoney(row.reserved_balance, row.currency),
      },
      {
        key: "actions",
        header: "",
        className: "w-56 text-right",
        render: (row) => (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTxPage(1)
                setTxRows([])
                setTxMeta(null)
                setTxOrg(row)
              }}
            >
              <HistoryIcon /> Transactions
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdjustOrg(row)}>
              Adjust
            </Button>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallets"
        description="Balances per organization, discovered from billing activity."
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadWallets()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {loading && totalBalance === null ? (
        <StatCard label="Wallet balances" value="…" hint="Loading summary…" icon={<WalletIcon />} />
      ) : (
        <StatCard
          label="Wallet balances (all orgs)"
          value={totalBalance === null ? "—" : formatMoney(totalBalance)}
          hint="From the finance summary endpoint"
          icon={<WalletIcon />}
        />
      )}

      {error && rows.length === 0 ? <ErrorBanner error={error} /> : null}

      <SimpleDataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getRowKey={(row) => row.organization_id}
        emptyMessage={
          loading ? "Loading wallets…" : "No organizations found in recent billing activity."
        }
      />

      {/* Transaction drill-down */}
      <Dialog
        open={txOrg !== null}
        onOpenChange={(open) => {
          if (!open) setTxOrg(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Wallet transactions</DialogTitle>
            <DialogDescription>
              {txOrg?.org_slug} ({txOrg?.currency})
            </DialogDescription>
          </DialogHeader>
          {error ? <ErrorBanner error={error} /> : null}
          <SimpleDataTable
            columns={[
              {
                key: "created_at",
                header: "Date",
                render: (row) => formatDateTime(row.created_at),
              },
              {
                key: "direction",
                header: "Direction",
                render: (row) => <StatusBadge status={row.direction} />,
              },
              {
                key: "amount",
                header: "Amount",
                className: "text-right tabular-nums",
                render: (row) =>
                  `${row.direction === "debit" ? "−" : "+"}${formatMoney(Number(row.amount))}`,
              },
              {
                key: "balance_after",
                header: "Balance after",
                className: "text-right tabular-nums",
                render: (row) => formatNumber(Number(row.balance_after)),
              },
              {
                key: "description",
                header: "Description",
                render: (row) => row.description || "—",
              },
            ]}
            rows={txRows}
            loading={txLoading}
            skeletonRows={3}
            getRowKey={(row) => row.id}
            emptyMessage="No transactions yet."
          />
          <TablePagination meta={txMeta} onPageChange={setTxPage} />
        </DialogContent>
      </Dialog>

      {/* Adjustment form */}
      <Dialog
        open={adjustOrg !== null}
        onOpenChange={(open) => {
          if (!open) setAdjustOrg(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust wallet</DialogTitle>
            <DialogDescription>
              Manual credit or debit for {adjustOrg?.org_slug}. Requires a description and is
              recorded in the ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adj-direction">Direction</Label>
              <Select value={direction} onValueChange={(value) => setDirection(value as "credit" | "debit")}>
                <SelectTrigger id="adj-direction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (add funds)</SelectItem>
                  <SelectItem value="debit">Debit (remove funds)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-amount">Amount</Label>
              <Input
                id="adj-amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="e.g. 50000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-description">Description</Label>
              <Textarea
                id="adj-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Reason for this adjustment…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdjustOrg(null)}>
                Cancel
              </Button>
              <Button onClick={() => setConfirmAdjust(true)} disabled={adjusting}>
                Review adjustment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAdjust} onOpenChange={setConfirmAdjust}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              {direction === "credit" ? "Credit" : "Debit"}{" "}
              {formatMoney(Number(amount) || 0)} {direction === "credit" ? "to" : "from"}{" "}
              {adjustOrg?.org_slug}&apos;s wallet. Description: &ldquo;{description.trim()}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={adjusting}
              onClick={(event) => {
                event.preventDefault()
                void submitAdjust()
              }}
            >
              {adjusting ? "Applying…" : "Apply adjustment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
