// Admin billing: wallet balances per organization. There is no admin
// wallet-list endpoint, so balances are resolved per org via GET /v1/wallet
// with X-Organization-ID (staff tokens may read any org context). Admin
// credit/debit goes through POST /admin/wallets/:org_id/adjust; the ledger
// drill-down uses GET /v1/wallet/transactions.
import { useCallback, useEffect, useState } from "react"
import { ListIcon, ScaleIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge, Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface OrgRow {
  id: string
  public_id: string
  slug: string
  name: string
  status: string
  member_count: number
  created_at: string
}

interface WalletInfo {
  wallet_id: string
  organization_id: string
  currency: string
  balance: number
  reserved_balance: number
}

interface WalletTransaction {
  id: string
  direction: string
  amount: number
  balance_before: number
  balance_after: number
  reference_type?: string
  description?: string
  created_at: string
}

interface AdjustForm {
  direction: "credit" | "debit"
  amount: string
  currency: string
  description: string
}

/** Loads one org's wallet; resolves to null when the read fails so sibling
 * rows still render their balances. */
async function fetchOrgWallet(orgId: string): Promise<[string, WalletInfo | null]> {
  try {
    const envelope = await apiGet<WalletInfo>("/wallet", {
      headers: { "X-Organization-ID": orgId },
    })
    return [orgId, envelope.data]
  } catch {
    return [orgId, null]
  }
}

export default function BillingWalletsPage() {
  const list = usePagedList<OrgRow>("/admin/organizations")
  const [wallets, setWallets] = useState<Map<string, WalletInfo | null>>(new Map())
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [balanceTick, setBalanceTick] = useState(0)

  // Adjust dialog state
  const [adjustTarget, setAdjustTarget] = useState<OrgRow | null>(null)
  const [form, setForm] = useState<AdjustForm>({
    direction: "credit",
    amount: "",
    currency: "IDR",
    description: "",
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Transactions drill-down state
  const [txnTarget, setTxnTarget] = useState<OrgRow | null>(null)
  const [txns, setTxns] = useState<WalletTransaction[]>([])
  const [txnsMeta, setTxnsMeta] = useState<{ page: number; total?: number } | null>(null)
  const [txnsPage, setTxnsPage] = useState(1)
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [txnsError, setTxnsError] = useState<unknown>(null)

  const reloadBalances = useCallback(() => setBalanceTick((tick) => tick + 1), [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setWalletsLoading(true)
      Promise.all(list.rows.map((org) => fetchOrgWallet(org.id))).then((pairs) => {
        if (cancelled) return
        setWallets(new Map(pairs))
        setWalletsLoading(false)
      })
    })
    return () => {
      cancelled = true
    }
  }, [list.rows, balanceTick])

  const openAdjust = (org: OrgRow) => {
    const known = wallets.get(org.id)
    setForm({
      direction: "credit",
      amount: "",
      currency: known?.currency ?? "IDR",
      description: "",
    })
    setFormError(null)
    setAdjustTarget(org)
  }

  const submitAdjust = async () => {
    if (!adjustTarget) return
    const amount = Number(form.amount)
    const currency = form.currency.trim().toUpperCase()
    if (!form.amount.trim() || Number.isNaN(amount) || amount <= 0) {
      setFormError("Amount must be a number greater than 0.")
      return
    }
    if (currency.length !== 3) {
      setFormError("Currency must be a 3-letter ISO code (e.g. IDR).")
      return
    }
    if (!form.description.trim()) {
      setFormError("Description is required.")
      return
    }
    // Every manual ledger entry gets an explicit confirmation.
    setFormError(null)
    setConfirmOpen(true)
  }

  const applyAdjust = async () => {
    if (!adjustTarget) return
    setSubmitting(true)
    try {
      await apiPost(`/admin/wallets/${adjustTarget.id}/adjust`, {
        direction: form.direction,
        amount: Number(form.amount),
        currency: form.currency.trim().toUpperCase(),
        description: form.description.trim(),
      })
      toast.success(
        `Wallet for ${adjustTarget.slug}: ${form.direction === "credit" ? "credited" : "debited"} ${formatMoney(Number(form.amount), form.currency.trim().toUpperCase())}`,
      )
      setConfirmOpen(false)
      setAdjustTarget(null)
      reloadBalances()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to adjust wallet.",
      )
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!txnTarget) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setTxnsLoading(true)
      setTxnsError(null)
      apiGet<WalletTransaction[]>("/wallet/transactions", {
        headers: { "X-Organization-ID": txnTarget.id },
        query: { page: txnsPage, per_page: 10 },
      })
        .then((envelope) => {
          if (cancelled) return
          setTxns(Array.isArray(envelope.data) ? envelope.data : [])
          setTxnsMeta({ page: txnsPage, total: envelope.meta?.total })
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setTxns([])
          setTxnsError(cause)
        })
        .finally(() => {
          if (!cancelled) setTxnsLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [txnTarget, txnsPage])

  const columns: Array<SimpleColumn<OrgRow>> = [
    {
      key: "slug",
      header: "Organization",
      render: (org) => (
        <div className="flex flex-col">
          <span className="font-medium">{org.name || org.slug}</span>
          <span className="text-xs text-muted-foreground">{org.public_id}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (org) => <StatusBadge status={org.status} />,
    },
    {
      key: "member_count",
      header: "Members",
      className: "text-right tabular-nums",
    },
    {
      key: "currency",
      header: "Currency",
      render: (org) => wallets.get(org.id)?.currency ?? "…",
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right tabular-nums",
      render: (org) => {
        const wallet = wallets.get(org.id)
        if (!wallet) return walletsLoading ? "…" : "—"
        return formatMoney(wallet.balance, wallet.currency)
      },
    },
    {
      key: "reserved",
      header: "Reserved",
      className: "text-right tabular-nums",
      render: (org) => {
        const wallet = wallets.get(org.id)
        if (!wallet) return walletsLoading ? "…" : "—"
        return formatMoney(wallet.reserved_balance, wallet.currency)
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-44 text-right",
      render: (org) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => openAdjust(org)}>
            Adjust
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTxnTarget(org)
              setTxnsPage(1)
            }}
          >
            <ListIcon /> Transactions
          </Button>
        </div>
      ),
    },
  ]

  const lastTxnsPage =
    txnsMeta?.total !== undefined ? Math.max(1, Math.ceil(txnsMeta.total / 10)) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallets"
        description="Per-organization prepaid balances. Balances are read per organization because the API exposes no admin-wide wallet listing."
      />

      <SimpleDataTable
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        getRowKey={(org) => org.id}
        emptyMessage="No organizations yet."
        skeletonRows={6}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      {/* Adjustment dialog */}
      <Dialog
        open={adjustTarget !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setAdjustTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust wallet</DialogTitle>
            <DialogDescription>
              {adjustTarget
                ? `Manual ledger entry for ${adjustTarget.name || adjustTarget.slug}. The description is stored on the transaction.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wallet-direction">Direction</Label>
              <Select
                value={form.direction}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    direction: value as AdjustForm["direction"],
                  }))
                }
              >
                <SelectTrigger id="wallet-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit (add funds)</SelectItem>
                  <SelectItem value="debit">Debit (remove funds)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[3fr_2fr] gap-3">
              <div className="grid gap-2">
                <Label htmlFor="wallet-amount">Amount</Label>
                <Input
                  id="wallet-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wallet-currency">Currency</Label>
                <Input
                  id="wallet-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, currency: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="wallet-description">Description</Label>
              <Input
                id="wallet-description"
                placeholder="Reason for the manual adjustment"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>

            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button disabled={submitting} onClick={() => void submitAdjust()}>
              {submitting ? "Applying…" : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment confirmation */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {form.direction === "credit" ? "Credit" : "Debit"} this wallet?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {adjustTarget
                ? `${formatMoney(Number(form.amount), form.currency)} will be ${form.direction === "credit" ? "added to" : "removed from"} the wallet of ${adjustTarget.name || adjustTarget.slug} with description "${form.description.trim()}".`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault()
                void applyAdjust()
              }}
            >
              {submitting ? "Applying…" : "Apply adjustment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transactions drill-down */}
      <Dialog
        open={txnTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTxnTarget(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Wallet transactions</DialogTitle>
            <DialogDescription>
              {txnTarget ? `${txnTarget.name || txnTarget.slug} · newest first` : ""}
            </DialogDescription>
          </DialogHeader>

          {txnsError ? <ErrorBanner error={txnsError} /> : null}

          {!txnsError ? (
            <>
              <SimpleDataTable
                columns={[
                  {
                    key: "direction",
                    header: "Direction",
                    render: (txn) => (
                      <span className="flex items-center gap-1.5">
                        <ScaleIcon className="size-3.5 text-muted-foreground" />
                        {txn.direction}
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums",
                    render: (txn) =>
                      formatMoney(
                        txn.direction === "debit" ? -txn.amount : txn.amount,
                        wallets.get(txnTarget?.id ?? "")?.currency ?? "IDR",
                      ),
                  },
                  {
                    key: "balance_after",
                    header: "Balance after",
                    className: "text-right tabular-nums",
                    render: (txn) =>
                      formatMoney(
                        txn.balance_after,
                        wallets.get(txnTarget?.id ?? "")?.currency ?? "IDR",
                      ),
                  },
                  {
                    key: "description",
                    header: "Description",
                    render: (txn) => (
                      <span className="line-clamp-1 text-muted-foreground">
                        {txn.description || txn.reference_type || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "created_at",
                    header: "At",
                    render: (txn) => formatDateTime(txn.created_at),
                  },
                ]}
                rows={txns}
                loading={txnsLoading}
                getRowKey={(txn) => txn.id}
                emptyMessage="No transactions yet."
              />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {txnsMeta?.page ?? txnsPage}
                  {txnsMeta?.total !== undefined ? ` of ${txnsMeta.total} entries` : ""}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={txnsPage <= 1 || txnsLoading}
                    onClick={() => setTxnsPage((page) => page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      txnsLoading ||
                      (lastTxnsPage !== null && txnsPage >= lastTxnsPage)
                    }
                    onClick={() => setTxnsPage((page) => page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
