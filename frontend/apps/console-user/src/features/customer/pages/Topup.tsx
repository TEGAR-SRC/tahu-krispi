// Standalone top-up flow: amount presets + custom input, payment method,
// checkout redirect and a pending state that polls the wallet balance until
// the gateway credits it (same pattern as the Wallet page ledger).
import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ExternalLinkIcon, Loader2Icon, WalletIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface WalletBalance {
  wallet_id?: string
  currency: string
  balance: number
  reserved_balance: number
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

const METHODS = ["qris"] as const

export default function CustomerTopupPage() {
  const { orgId } = useOrg()
  const [balance, setBalance] = useState<WalletBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<string>("qris")
  const [creating, setCreating] = useState(false)

  // Pending top-up: poll the balance until it rises above the snapshot taken
  // at creation (the gateway webhook credits the wallet asynchronously).
  const [pending, setPending] = useState<TopupResult | null>(null)
  const balanceAtTopup = useRef(0)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadBalance = useCallback(
    async (showLoading = true) => {
      if (!orgId) return
      try {
        const { data } = await apiGet<WalletBalance>("/wallet", { headers: orgHeaders(orgId) })
        setBalance(data)
      } catch (cause) {
        setError(cause)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [orgId],
  )

  useEffect(() => {
    const t = setTimeout(() => void loadBalance(), 0)
    return () => clearTimeout(t)
  }, [loadBalance])

  useEffect(() => {
    if (!pending || pending.status !== "pending") return
    let elapsed = 0
    pollTimer.current = setInterval(() => {
      elapsed += 5
      void loadBalance(false)
      // Stop silently after ~5 minutes; the Wallet ledger still shows any
      // late credit.
      if (elapsed >= 300 && pollTimer.current) {
        clearInterval(pollTimer.current)
        setPending((prev) => (prev ? { ...prev, status: "timeout" } : prev))
      }
    }, 5000)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [pending, loadBalance])

  useEffect(() => {
    if (!pending || pending.status !== "pending") return
    if ((balance?.balance ?? 0) > balanceAtTopup.current) {
      setPending(null)
      toast.success("Top-up credited to your wallet")
    }
  }, [balance, pending])

  const currency = balance?.currency ?? "IDR"
  const presets =
    currency === "IDR" ? ["50000", "100000", "500000", "1000000"] : ["10", "25", "50", "100"]

  const normalizeCheckoutUrl = (url: string) =>
    url
      .replace("https://payment.kilat-cloud.com/topup/", "https://pay.sumopod.com/pay/")
      .replace("https://payment.kilat-cloud.com", "https://pay.sumopod.com")
      .replace("http://payment.kilat-cloud.com", "https://pay.sumopod.com")

  const createTopup = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter an amount greater than zero")
      return
    }
    setCreating(true)
    try {
      const { data } = await apiPost<TopupResult>(
        "/wallet/topup",
        { amount: value, currency, method },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Top-up order created — complete the payment at the checkout URL")
      balanceAtTopup.current = balance?.balance ?? 0
      setPending(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create top-up")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/wallet">Wallet</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Top up</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader title="Wallet top-up" description="Add prepaid balance for invoices and hourly resources." />

      <ErrorBanner error={error} />

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
        <StatCard label="Current balance" value={formatMoney(balance?.balance ?? 0, currency)} icon={<WalletIcon />} />
        <StatCard label="Reserved" value={formatMoney(balance?.reserved_balance ?? 0, currency)} hint="Held for running resources" />
      </div>

      {loading && !balance ? (
        <Card>
          <CardContent className="px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Loading wallet…
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 px-4">
            <div className="space-y-1.5">
              <Label htmlFor="topup-amount">Amount ({currency}) *</Label>
              <Input
                id="topup-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="100000"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {presets.map((preset) => (
                  <Button key={preset} type="button" size="sm" variant="outline" onClick={() => setAmount(preset)}>
                    {preset}
                  </Button>
                ))}
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

            <Button onClick={() => void createTopup()} disabled={creating || amount.trim() === ""}>
              {creating ? <Loader2Icon className="animate-spin" /> : null} Create top-up
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Pending state with checkout link + live polling */}
      {pending && pending.status === "pending" ? (
        <Card className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/5">
          <CardContent className="space-y-3 px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Loader2Icon className="size-4 animate-spin text-amber-600" />
                Top-up of <strong>{formatMoney(pending.amount, pending.currency)}</strong> awaiting
                payment confirmation — polling every 5 s…
              </span>
              <Button asChild size="sm" variant="outline">
                <a href={normalizeCheckoutUrl(pending.checkout_url)} target="_blank" rel="noopener noreferrer">
                  Open checkout <ExternalLinkIcon />
                </a>
              </Button>
            </div>
            <Progress value={Math.min(100, ((balance?.balance ?? 0) / Math.max(pending.amount, 1)) * 100)} />
            <p className="text-xs text-muted-foreground">
              Reference <span className="font-mono">{pending.public_id}</span> · this page stops
              watching after ~5 minutes; check the Wallet ledger for late credits.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {pending && pending.status === "timeout" ? (
        <div className="rounded-md border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Still waiting for the gateway to confirm{" "}
          <span className="font-mono">{pending.public_id}</span>. The balance updates automatically
          once the webhook lands — see the{" "}
          <Link to="/app/wallet" className="underline">
            Wallet
          </Link>{" "}
          transactions.
        </div>
      ) : null}
    </div>
  )
}
