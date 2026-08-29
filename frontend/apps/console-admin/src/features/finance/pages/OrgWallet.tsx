// Per-organization wallet page: live balance via GET /wallet (org context
// header), credit/debit adjustments through POST /admin/wallets/:org_id/adjust
// behind a confirmation, and the transaction ledger pager.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { ArrowDownIcon, ArrowUpIcon, WalletIcon } from "lucide-react"
import {
  StatusBadge,
  TablePagination,
} from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"
import type { AdminOrderRow, OrgWallet } from "../lib"

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

const TX_PER_PAGE = 10

export default function FinanceOrgWalletPage() {
  const orgId = useParams().orgId

  const [wallet, setWallet] = useState<OrgWallet | null>(null)
  const [walletError, setWalletError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [orgLabel, setOrgLabel] = useState<string>("")

  const [txRows, setTxRows] = useState<WalletTransaction[]>([])
  const [txMeta, setTxMeta] = useState<{ page: number; per_page: number; total?: number } | null>(
    null,
  )
  const [txPage, setTxPage] = useState(1)
  const [txLoading, setTxLoading] = useState(true)
  const [txError, setTxError] = useState<unknown>(null)

  const [direction, setDirection] = useState<"credit" | "debit">("credit")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [confirmAdjust, setConfirmAdjust] = useState(false)
  const [adjusting, setAdjusting] = useState(false)

  const loadWallet = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setWalletError(null)
    try {
      const envelope = await apiGet<OrgWallet>("/wallet", {
        headers: { "X-Organization-ID": orgId },
      })
      setWallet(envelope.data)
    } catch (cause) {
      setWalletError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Best effort: find the org slug on recent billing rows so the page shows a
  // readable name instead of a bare UUID.
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    void (async () => {
      try {
        const envelope = await apiGet<AdminOrderRow[]>("/admin/orders", {
          query: { per_page: 100 },
        })
        const match = envelope.data.find((row) => row.organization_id === orgId)
        if (!cancelled && match) setOrgLabel(match.org_slug)
      } catch {
        // Label stays empty; the raw org ID is shown instead.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const loadTransactions = useCallback(async () => {
    if (!orgId) return
    setTxLoading(true)
    setTxError(null)
    try {
      const envelope = await apiGet<WalletTransaction[]>("/wallet/transactions", {
        query: { page: txPage, per_page: TX_PER_PAGE },
        headers: { "X-Organization-ID": orgId },
      })
      setTxRows(envelope.data)
      setTxMeta(envelope.meta ?? null)
    } catch (cause) {
      setTxError(cause)
    } finally {
      setTxLoading(false)
    }
  }, [orgId, txPage])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await loadTransactions()
        } catch {
          if (!cancelled) setTxError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [loadTransactions])

  const submitAdjust = useCallback(async () => {
    if (!orgId) return
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
      await apiPost(`/admin/wallets/${orgId}/adjust`, {
        direction,
        amount: numeric,
        description: description.trim(),
      })
      toast.success(
        `Wallet ${direction === "credit" ? "credited" : "debited"} by ${formatMoney(numeric)}`,
      )
      setConfirmAdjust(false)
      setAmount("")
      setDescription("")
      await Promise.all([loadWallet(), loadTransactions()])
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Adjustment failed")
    } finally {
      setAdjusting(false)
    }
  }, [orgId, direction, amount, description, loadWallet, loadTransactions])

  const txColumns: Array<SimpleColumn<WalletTransaction>> = [
    { key: "created_at", header: "Date", render: (row) => formatDateTime(row.created_at) },
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
        `${row.direction === "debit" ? "−" : "+"}${formatMoney(Number(row.amount), wallet?.currency)}`,
    },
    {
      key: "balance_after",
      header: "Balance after",
      className: "text-right tabular-nums",
      render: (row) => formatMoney(Number(row.balance_after), wallet?.currency),
    },
    { key: "reference_type", header: "Type", render: (row) => row.reference_type || "—" },
    { key: "description", header: "Description", render: (row) => row.description || "—" },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
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
              <Link to="/finance/wallets">Wallets</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{orgLabel || orgId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title="Organization wallet"
        description={orgLabel ? `${orgLabel} · ${orgId}` : (orgId ?? "")}
      />

      {walletError ? (
        <>
          <ErrorBanner error={walletError} />
          <Button variant="outline" size="sm" onClick={() => void loadWallet()} disabled={loading}>
            Retry
          </Button>
        </>
      ) : loading && !wallet ? (
        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : wallet ? (
        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <StatCard
            label="Available balance"
            value={formatMoney(wallet.balance, wallet.currency)}
            hint={`Wallet ${wallet.wallet_id}`}
            icon={<WalletIcon />}
          />
          <StatCard
            label="Reserved balance"
            value={formatMoney(wallet.reserved_balance, wallet.currency)}
            hint="Held against unpaid usage"
            icon={<ArrowDownIcon />}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Adjust balance</CardTitle>
          <CardDescription>
            Manual credit or debit recorded in the ledger. A description is required and shown in
            the transaction history below.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid w-full max-w-full min-w-0 max-w-xl gap-3">
          <div className="space-y-2">
            <Label htmlFor="orgwallet-direction">Direction</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as "credit" | "debit")}
            >
              <SelectTrigger id="orgwallet-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ArrowUpIcon className="size-3.5" /> Credit (add funds)
                  </span>
                </SelectItem>
                <SelectItem value="debit">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ArrowDownIcon className="size-3.5" /> Debit (remove funds)
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgwallet-amount">Amount *</Label>
            <Input
              id="orgwallet-amount"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={`e.g. 50000${wallet?.currency ? ` (${wallet.currency})` : ""}`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="orgwallet-description">Description *</Label>
            <Textarea
              id="orgwallet-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Reason for this adjustment…"
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={() => setConfirmAdjust(true)} disabled={adjusting}>
            Review adjustment
          </Button>
        </CardFooter>
      </Card>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Transactions</h3>
        {txError ? (
          <ErrorBanner error={txError} />
        ) : (
          <>
            <SimpleDataTable
              columns={txColumns}
              rows={txRows}
              loading={txLoading}
              skeletonRows={4}
              getRowKey={(row) => row.id}
              emptyMessage="No transactions yet."
            />
            <TablePagination meta={txMeta} onPageChange={setTxPage} />
          </>
        )}
      </section>

      <AlertDialog open={confirmAdjust} onOpenChange={setConfirmAdjust}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              {direction === "credit" ? "Credit" : "Debit"} {formatMoney(Number(amount) || 0)}{" "}
              {direction === "credit" ? "to" : "from"} {orgLabel || orgId}&apos;s wallet.
              Description: &ldquo;{description.trim()}&rdquo;. This is recorded in the ledger and
              cannot be undone here.
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
