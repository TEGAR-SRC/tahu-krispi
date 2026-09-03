import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Badge } from "@/components/ui/badge"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@/components/ui/switch"

interface RegionRow {
  id: string
  provider_id: string
  code: string
  name: string
  enabled: boolean
  currency?: string
}

interface OrgRow {
  id: string
  public_id: string
  slug: string
  name: string
  status: string
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

type AdjustForm = {
  direction: "credit" | "debit"
  amount: string
  currency: string
  description: string
}

function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—"
  const code = (currency ?? "IDR").trim().toUpperCase() || "IDR"
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "IDR" ? 0 : 2,
    }).format(amount)
  } catch {
    return `${code} ${amount.toLocaleString()}`
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—"
  const normalized = value.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

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

export default function OnidelWalletPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()

  const [regions, setRegions] = useState<RegionRow[]>([])
  const [regionsLoading, setRegionsLoading] = useState(true)
  const [regionsError, setRegionsError] = useState<unknown>(null)

  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [orgsError, setOrgsError] = useState<unknown>(null)

  const [wallets, setWallets] = useState<Map<string, WalletInfo | null>>(new Map())
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [balanceTick, setBalanceTick] = useState(0)

  const [hideZero, setHideZero] = useState(false)
  const [search, setSearch] = useState("")

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

  const [txnTarget, setTxnTarget] = useState<OrgRow | null>(null)
  const [txns, setTxns] = useState<WalletTransaction[]>([])
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [txnsError, setTxnsError] = useState<unknown>(null)
  const [txnsPage, setTxnsPage] = useState(1)

  const reloadBalances = useCallback(() => setBalanceTick((t) => t + 1), [])

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setRegionsLoading(true)
    setRegionsError(null)
    apiGet<RegionRow[]>("/admin/regions", { query: { per_page: 100 } })
      .then(({ data }) => {
        if (cancelled) return
        const rows = Array.isArray(data) ? data : []
        setRegions(rows.filter((r) => r.provider_id === providerId))
      })
      .catch((cause) => {
        if (!cancelled) setRegionsError(cause)
      })
      .finally(() => {
        if (!cancelled) setRegionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  useEffect(() => {
    let cancelled = false
    setOrgsLoading(true)
    setOrgsError(null)
    apiGet<OrgRow[]>("/admin/organizations", { query: { per_page: 100 } })
      .then(({ data }) => {
        if (cancelled) return
        setOrgs(Array.isArray(data) ? data : [])
      })
      .catch((cause) => {
        if (!cancelled) setOrgsError(cause)
      })
      .finally(() => {
        if (!cancelled) setOrgsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (orgs.length === 0) {
      setWallets(new Map())
      setWalletsLoading(false)
      return
    }
    let cancelled = false
    setWalletsLoading(true)
    Promise.all(orgs.map((o) => fetchOrgWallet(o.id)))
      .then((pairs) => {
        if (cancelled) return
        setWallets(new Map(pairs))
        setWalletsLoading(false)
      })
      .catch(() => {
        if (!cancelled) setWalletsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgs, balanceTick])

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = orgs
    if (q) {
      rows = rows.filter(
        (o) =>
          o.slug.toLowerCase().includes(q) ||
          (o.name ?? "").toLowerCase().includes(q) ||
          o.public_id.toLowerCase().includes(q),
      )
    }
    if (hideZero) {
      rows = rows.filter((o) => {
        const w = wallets.get(o.id)
        if (!w) return false
        return (w.balance ?? 0) !== 0 || (w.reserved_balance ?? 0) !== 0
      })
    }
    return rows
  }, [orgs, search, hideZero, wallets])

  const onidelRegionSummary = useMemo(() => {
    const enabled = regions.filter((r) => r.enabled)
    return { total: regions.length, enabled: enabled.length, enabledRows: enabled }
  }, [regions])

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

  const submitAdjust = () => {
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
        `Wallet ${adjustTarget.slug}: ${form.direction === "credit" ? "credited" : "debited"} ${formatMoney(Number(form.amount), form.currency.trim().toUpperCase())}`,
      )
      setConfirmOpen(false)
      setAdjustTarget(null)
      reloadBalances()
      if (txnTarget?.id === adjustTarget.id) {
        setTxnsPage(1)
        setBalanceTick((t) => t + 1)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to adjust wallet")
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!txnTarget) return
    let cancelled = false
    setTxnsLoading(true)
    setTxnsError(null)
    apiGet<WalletTransaction[]>("/wallet/transactions", {
      headers: { "X-Organization-ID": txnTarget.id },
      query: { page: txnsPage, per_page: 10 },
    })
      .then((envelope) => {
        if (cancelled) return
        setTxns(Array.isArray(envelope.data) ? envelope.data : [])
      })
      .catch((cause) => {
        if (cancelled) return
        setTxns([])
        setTxnsError(cause)
      })
      .finally(() => {
        if (!cancelled) setTxnsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [txnTarget, txnsPage])

  const columns: Array<SimpleColumn<OrgRow>> = [
    {
      key: "org",
      header: "Organization",
      render: (org) => (
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/admin/billing/wallets/${org.id}`}
            className="font-medium underline-offset-4 hover:underline"
            title="Open billing wallet detail"
          >
            {org.name || org.slug}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {org.slug} · {org.public_id} · {org.status}
          </span>
        </div>
      ),
    },
    {
      key: "onidel_region",
      header: "Onidel regions",
      render: () => (
        <span className="text-xs text-muted-foreground">
          {onidelRegionSummary.enabled === 0 ? "no enabled regions" : `${onidelRegionSummary.enabled} enabled`}
        </span>
      ),
    },
    {
      key: "currency",
      header: "Currency",
      render: (org) => wallets.get(org.id)?.currency ?? (walletsLoading ? "…" : "—"),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right tabular-nums",
      render: (org) => {
        const w = wallets.get(org.id)
        if (!w) return walletsLoading ? "…" : "—"
        return formatMoney(w.balance, w.currency)
      },
    },
    {
      key: "reserved",
      header: "Reserved",
      className: "hidden sm:table-cell text-right tabular-nums",
      render: (org) => {
        const w = wallets.get(org.id)
        if (!w) return walletsLoading ? "…" : "—"
        return formatMoney(w.reserved_balance, w.currency)
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-48 text-right",
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
            Transactions
          </Button>
        </div>
      ),
    },
  ]

  const loading = orgsLoading || regionsLoading
  const error = orgsError ?? regionsError

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel wallets"
      description="Wallets per organization for Onidel regions — read via GET /wallet with X-Organization-ID and adjust via POST /admin/wallets/:org_id/adjust. Admin can credit/debit and attach to any org; NOC can read; finance billing only."
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onidel regions for this provider</CardTitle>
          <CardDescription>
            Regions whose provider_id matches this Onidel provider. Wallet balances below are per organization; region scope is shown as context for provisioning.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {regionsError ? <ErrorBanner error={regionsError} /> : null}
          {regionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading regions…</p>
          ) : onidelRegionSummary.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No regions registered for this Onidel provider yet. Create one in Regions &amp; Pools with this provider.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {onidelRegionSummary.enabledRows.map((r) => (
                <Badge key={r.id} variant={r.enabled ? "default" : "outline"}>
                  {r.name} ({r.code})
                </Badge>
              ))}
              {onidelRegionSummary.enabled === 0 ? (
                <span className="text-xs text-amber-600">All {onidelRegionSummary.total} region(s) are disabled.</span>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization wallets</CardTitle>
          <CardDescription>
            Balances are loaded per org via <span className="font-mono">GET /v1/wallet</span> with{" "}
            <span className="font-mono">X-Organization-ID</span>. Adjustments use{" "}
            <span className="font-mono">POST /v1/admin/wallets/:org_id/adjust</span> (billing — admin + finance only; NOC read-only).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Filter by org slug or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <div className="flex items-center gap-2">
              <Switch id="hide-zero" checked={hideZero} onCheckedChange={setHideZero} />
              <Label htmlFor="hide-zero" className="text-sm font-normal">
                Hide zero balances
              </Label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={reloadBalances} disabled={walletsLoading}>
                Refresh balances
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/billing/wallets">Billing wallets</Link>
              </Button>
            </div>
          </div>

          <SimpleDataTable
            columns={columns}
            rows={filteredOrgs}
            loading={loading || walletsLoading}
            error={error}
            getRowKey={(row) => row.id}
            emptyMessage={orgs.length === 0 ? "No organizations yet." : "No wallets match the current filter."}
            skeletonRows={6}
          />
        </CardContent>
      </Card>

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
                ? `Manual ledger entry for ${adjustTarget.name || adjustTarget.slug}. Creates the wallet if missing and records the description on the transaction.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="onidel-wallet-direction">Direction</Label>
              <Select
                value={form.direction}
                onValueChange={(v) => setForm((c) => ({ ...c, direction: v as AdjustForm["direction"] }))}
              >
                <SelectTrigger id="onidel-wallet-direction">
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
                <Label htmlFor="onidel-wallet-amount">Amount *</Label>
                <Input
                  id="onidel-wallet-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))}
                  placeholder="50000"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="onidel-wallet-currency">Currency *</Label>
                <Input
                  id="onidel-wallet-currency"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => setForm((c) => ({ ...c, currency: e.target.value.toUpperCase() }))}
                  placeholder="IDR"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="onidel-wallet-description">Description *</Label>
              <Input
                id="onidel-wallet-description"
                value={form.description}
                onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                placeholder="Reason stored on the ledger entry"
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button disabled={submitting} onClick={submitAdjust}>
              {submitting ? "Applying…" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && !submitting && setConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {form.direction === "credit" ? "Credit" : "Debit"} this wallet?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {adjustTarget
                ? `${formatMoney(Number(form.amount), form.currency)} will be ${form.direction === "credit" ? "added to" : "removed from"} the wallet of ${adjustTarget.name || adjustTarget.slug} (${adjustTarget.slug}) with description "${form.description.trim()}". This attaches/creates the wallet for that org if it does not exist.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault()
                void applyAdjust()
              }}
            >
              {submitting ? "Applying…" : "Apply adjustment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={txnTarget !== null} onOpenChange={(o) => !o && setTxnTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Wallet transactions</DialogTitle>
            <DialogDescription>
              {txnTarget ? `${txnTarget.name || txnTarget.slug} · newest first · page ${txnsPage}` : ""}
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
                    render: (t) => <Badge variant={t.direction === "credit" ? "default" : "secondary"}>{t.direction}</Badge>,
                  },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums",
                    render: (t) => formatMoney(t.direction === "debit" ? -t.amount : t.amount, wallets.get(txnTarget?.id ?? "")?.currency ?? "IDR"),
                  },
                  {
                    key: "balance_after",
                    header: "Balance after",
                    className: "text-right tabular-nums",
                    render: (t) => formatMoney(t.balance_after, wallets.get(txnTarget?.id ?? "")?.currency ?? "IDR"),
                  },
                  {
                    key: "description",
                    header: "Description",
                    render: (t) => <span className="line-clamp-1 text-muted-foreground">{t.description || t.reference_type || "—"}</span>,
                  },
                  { key: "created_at", header: "At", render: (t) => formatDateTime(t.created_at) },
                ]}
                rows={txns}
                loading={txnsLoading}
                getRowKey={(t) => t.id}
                emptyMessage="No transactions yet."
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Transactions are read via GET /wallet/transactions with X-Organization-ID.</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={txnsPage <= 1 || txnsLoading} onClick={() => setTxnsPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={txnsLoading} onClick={() => setTxnsPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
