// Admin per-organization wallet page (route /admin/billing/wallets/:orgId).
// There is no admin wallet-by-id endpoint, so the balance is read through
// GET /wallet with the X-Organization-ID header (staff tokens may use any
// org context). Manual credit/debit goes through
// POST /admin/wallets/:org_id/adjust behind a confirmation dialog, and the
// ledger comes from GET /wallet/transactions. The organization name is
// resolved from GET /admin/organizations because no org-detail endpoint
// exists.
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import type { PagedMeta } from "@/lib/types"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { StatCard } from "@/components/shared/StatCard"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { DetailBreadcrumbs } from "./detailShared"
import { useApiDetail } from "./use-api-detail"
import { Pager, StatusBadge, formatDateTime, formatMoney } from "./shared"

interface WalletInfo {
  wallet_id: string
  organization_id: string
  currency: string
  balance: number
  reserved_balance: number
}

interface OrgRow {
  id: string
  public_id: string
  slug: string
  name: string
  status: string
}

interface WalletTransaction {
  id: string
  direction: string
  amount: number
  balance_before: number
  balance_after: number
  reference_type?: string
  reference_id?: string
  description?: string
  created_at: string
}

const TXN_PAGE_SIZE = 10

export default function BillingOrgWalletPage() {
  const { orgId } = useParams()
  const wallet = useApiDetail<WalletInfo>(
    orgId ? "/wallet" : null,
    orgId ? { "X-Organization-ID": orgId } : {},
  )

  const [orgName, setOrgName] = useState<string | null>(null)
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    // The org list is the only admin read; walk its pages until the id shows up.
    void (async () => {
      try {
        for (let page = 1; ; page += 1) {
          const envelope = await apiGet<OrgRow[]>("/admin/organizations", {
            query: { page, per_page: 100 },
          })
          if (cancelled) return
          const found = envelope.data.find((org) => org.id === orgId)
          if (found) {
            setOrgName(found.name || found.slug)
            return
          }
          const total = envelope.meta?.total
          if (total !== undefined && page * 100 >= total) return
        }
      } catch {
        // Name resolution is cosmetic; the raw id still identifies the org.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // ---- Adjustment form -------------------------------------------------------
  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ---- Transactions ----------------------------------------------------------
  const [txns, setTxns] = useState<WalletTransaction[]>([])
  const [txnsMeta, setTxnsMeta] = useState<PagedMeta | null>(null)
  const [txnsPage, setTxnsPage] = useState(1)
  const [txnsLoading, setTxnsLoading] = useState(true)
  const [txnsError, setTxnsError] = useState<unknown>(null)
  const [txnTick, setTxnTick] = useState(0)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setTxnsLoading(true)
      setTxnsError(null)
      apiGet<WalletTransaction[]>("/wallet/transactions", {
        headers: { "X-Organization-ID": orgId },
        query: { page: txnsPage, per_page: TXN_PAGE_SIZE },
      })
        .then((envelope) => {
          if (cancelled) return
          setTxns(Array.isArray(envelope.data) ? envelope.data : [])
          setTxnsMeta(envelope.meta ?? null)
          setTxnsLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          setTxns([])
          setTxnsError(cause)
          setTxnsLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [orgId, txnsPage, txnTick])

  const reloadAll = () => {
    wallet.reload()
    setTxnsPage(1)
    setTxnTick((tick) => tick + 1)
  }

  const submitAdjust = async () => {
    if (!orgId) return
    const parsedAmount = Number(amount)
    if (!amount.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError("Amount must be a number greater than 0.")
      return
    }
    if (!description.trim()) {
      setFormError("Description is required — it is stored on the ledger entry.")
      return
    }
    setFormError(null)
    setConfirmOpen(true)
  }

  const applyAdjust = async () => {
    if (!orgId) return
    setSubmitting(true)
    try {
      await apiPost(`/admin/wallets/${orgId}/adjust`, {
        direction,
        amount: Number(amount),
        description: description.trim(),
      })
      toast.success(
        `Wallet ${direction === "credit" ? "credited" : "debited"} ${formatMoney(Number(amount), wallet.data?.currency ?? "IDR")}`,
      )
      setConfirmOpen(false)
      setAmount("")
      setDescription("")
      reloadAll()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to adjust wallet.",
      )
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  const heading =
    orgName ?? wallet.data?.organization_id ?? orgId ?? "…"
  const currency = wallet.data?.currency

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Wallets", to: "/admin/billing/wallets" },
          { label: heading },
        ]}
      />

      <PageHeader
        title={`Wallet · ${heading}`}
        description={
          orgId
            ? `Organization ${orgId}. Balances are read via /wallet with the X-Organization-ID header.`
            : undefined
        }
        actions={
          <Button variant="outline" onClick={reloadAll} disabled={wallet.loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />

      {wallet.error ? <ErrorBanner error={wallet.error} /> : null}
      {!wallet.error && wallet.loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : null}

      {wallet.data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Balance"
            value={formatMoney(wallet.data.balance, wallet.data.currency)}
            hint="Available funds"
          />
          <StatCard
            label="Reserved"
            value={formatMoney(wallet.data.reserved_balance, wallet.data.currency)}
            hint="Held against pending usage"
          />
          <StatCard label="Currency" value={wallet.data.currency} hint={`Wallet ${wallet.data.wallet_id}`} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Manual adjustment</CardTitle>
          <CardDescription>
            Credits add funds, debits remove them. Every entry needs a
            description and lands immediately on the ledger below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[200px_200px_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="adjust-direction">Direction</Label>
              <Select
                value={direction}
                onValueChange={(value) =>
                  setDirection(value as "credit" | "debit")
                }
              >
                <SelectTrigger id="adjust-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">
                    <span className="flex items-center gap-2">
                      <ArrowUpIcon className="size-3.5" /> Credit (add)
                    </span>
                  </SelectItem>
                  <SelectItem value="debit">
                    <span className="flex items-center gap-2">
                      <ArrowDownIcon className="size-3.5" /> Debit (remove)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adjust-amount">Amount *</Label>
              <Input
                id="adjust-amount"
                type="number"
                min="0"
                step="any"
                placeholder={currency === "IDR" ? "50000" : "100"}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adjust-description">Description *</Label>
              <Input
                id="adjust-description"
                placeholder="Reason stored on the ledger entry"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div>
            <Button onClick={() => void submitAdjust()}>Apply adjustment</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {txnsError ? <ErrorBanner error={txnsError} /> : null}
          {!txnsError ? (
            <>
              <SimpleDataTable
                columns={[
                  {
                    key: "direction",
                    header: "Direction",
                    render: (txn) => <StatusBadge status={txn.direction} />,
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums",
                    render: (txn) =>
                      formatMoney(
                        txn.direction === "debit" ? -txn.amount : txn.amount,
                        currency,
                      ),
                  },
                  {
                    key: "balance_after",
                    header: "Balance after",
                    className: "text-right tabular-nums",
                    render: (txn) => formatMoney(txn.balance_after, currency),
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
                    render: (txn) => (
                      <span className="whitespace-nowrap">{formatDateTime(txn.created_at)}</span>
                    ),
                  },
                ]}
                rows={txns}
                loading={txnsLoading}
                getRowKey={(txn) => txn.id}
                emptyMessage="No transactions yet."
                skeletonRows={5}
              />

              <Pager
                page={txnsMeta?.page ?? txnsPage}
                meta={txnsMeta}
                onPage={setTxnsPage}
                disabled={txnsLoading}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {direction === "credit" ? "Credit" : "Debit"} this wallet?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {formatMoney(Number(amount), currency)} will be{" "}
              {direction === "credit" ? "added to" : "removed from"} the wallet of{" "}
              {heading} (current balance: {formatMoney(wallet.data?.balance, currency)}) with
              description "{description.trim()}".
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
    </div>
  )
}
