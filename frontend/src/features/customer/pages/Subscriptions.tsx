// Subscriptions: recurring services with expandable detail rows (fetched live
// from GET /subscriptions/:id) and cancellation — at period end or
// immediately — behind a confirmation dialog.
import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import type { PagedMeta } from "@/lib/types"
import { Pagination } from "../Pagination"
import { StatusBadge } from "../components"
import { formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface Subscription {
  id: string
  public_id: string
  product_id: string
  plan_id?: string | null
  status: string
  billing_period: string
  currency: string
  recurring_amount: number
  current_period_start?: string | null
  current_period_end?: string | null
  next_invoice_at?: string | null
  grace_until?: string | null
  cancel_at_period_end: boolean
  cancelled_at?: string | null
  created_at: string
}

interface Plan {
  id: string
  name: string
}

const PER_PAGE = 20

export default function SubscriptionsPage() {
  const { orgId } = useOrg()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [meta, setMeta] = useState<PagedMeta | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Which row is expanded; the detail payload is fetched on demand.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Cancel flow state.
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [cancelMode, setCancelMode] = useState("period_end")
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [subRes, planRes] = await Promise.all([
        apiGet<Subscription[]>("/subscriptions", {
          headers: orgHeaders(orgId),
          query: { page, per_page: PER_PAGE },
        }),
        apiGet<Plan[]>("/plans"),
      ])
      setSubscriptions(subRes.data ?? [])
      setMeta(subRes.meta)
      setPlans(planRes.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, page])

  useEffect(() => {
    void load()
  }, [load])

  const toggleRow = async (subscription: Subscription) => {
    if (expandedId === subscription.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(subscription.id)
    setDetailLoading(true)
    try {
      // Refresh the expanded row straight from the detail endpoint so the
      // panel always shows current server state.
      const { data } = await apiGet<Subscription>(`/subscriptions/${subscription.id}`, {
        headers: orgHeaders(orgId),
      })
      setSubscriptions((prev) => prev.map((s) => (s.id === data.id ? data : s)))
    } catch {
      // Keep showing the list-row data if the detail call fails.
    } finally {
      setDetailLoading(false)
    }
  }

  const cancelSubscription = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await apiPost(
        `/subscriptions/${cancelTarget.id}/cancel`,
        { at_period_end: cancelMode === "period_end" },
        { headers: orgHeaders(orgId) },
      )
      toast.success(
        cancelMode === "period_end"
          ? "Subscription will end when the current period closes"
          : "Subscription cancelled immediately",
      )
      setCancelTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to cancel subscription")
    } finally {
      setCancelling(false)
    }
  }

  const planName = (planId?: string | null): string => {
    if (!planId) return "—"
    const match = plans.find((p) => p.id === planId)
    return match?.name ?? `${planId.slice(0, 8)}…`
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Subscriptions"
        description="Recurring services and their billing cycles."
      />

      <ErrorBanner error={error} />

      {loading ? (
        <div className="space-y-2">
          <Spinner className="size-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? null : subscriptions.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No active subscriptions yet.
        </div>
      ) : (
        <div className="space-y-0 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Subscription</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan / period</TableHead>
                <TableHead>Recurring</TableHead>
                <TableHead>Next invoice</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => (
                <SubRows
                  key={sub.id}
                  sub={sub}
                  expanded={expandedId === sub.id}
                  detailLoading={expandedId === sub.id && detailLoading}
                  onToggle={() => void toggleRow(sub)}
                  onCancel={() => {
                    setCancelTarget(sub)
                    // at_period_end is only accepted for active/past_due.
                    setCancelMode(["active", "past_due"].includes(sub.status) ? "period_end" : "immediate")
                  }}
                  planName={planName(sub.plan_id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {meta ? (
        <Pagination page={page} perPage={meta.per_page} total={meta.total} onPageChange={setPage} />
      ) : null}

      {/* Cancel confirm */}
      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose whether the service should keep running until the end of the paid period or be
              stopped immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">When</p>
            <Select value={cancelMode} onValueChange={setCancelMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="period_end">At end of current period</SelectItem>
                <SelectItem value="immediate">Immediately</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault()
                void cancelSubscription()
              }}
            >
              {cancelling ? <Loader2Icon className="animate-spin" /> : null} Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SubRows({
  sub,
  expanded,
  detailLoading,
  onToggle,
  onCancel,
  planName,
}: {
  sub: Subscription
  expanded: boolean
  detailLoading: boolean
  onToggle: () => void
  onCancel: () => void
  planName: string
}) {
  const cancellable =
    !sub.cancelled_at && !["cancelled", "expired"].includes(sub.status)

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          {expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </TableCell>
        <TableCell>
          <span className="font-mono text-xs">{sub.public_id}</span>
        </TableCell>
        <TableCell>
          <StatusBadge status={sub.status} />
          {sub.cancel_at_period_end && !sub.cancelled_at ? (
            <span className="ml-2 text-xs text-muted-foreground">ends at period close</span>
          ) : null}
        </TableCell>
        <TableCell>
          <div>
            <p>{planName}</p>
            <p className="text-xs capitalize text-muted-foreground">{sub.billing_period}</p>
          </div>
        </TableCell>
        <TableCell className="tabular-nums">{formatMoney(sub.recurring_amount, sub.currency)}</TableCell>
        <TableCell>{formatDateTime(sub.next_invoice_at ?? sub.current_period_end)}</TableCell>
        <TableCell className="text-right">
          <Button
            size="icon"
            variant="ghost"
            title="Refresh"
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
          >
            <RefreshCwIcon />
          </Button>
          {cancellable ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation()
                onCancel()
              }}
            >
              Cancel…
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/40">
            {detailLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Spinner className="size-4" /> Loading details…
              </div>
            ) : (
              <dl className="grid gap-x-8 gap-y-3 px-2 py-3 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Plan">{planName}</Detail>
                <Detail label="Billing period">
                  <span className="capitalize">{sub.billing_period}</span>
                </Detail>
                <Detail label="Recurring amount">
                  {formatMoney(sub.recurring_amount, sub.currency)}
                </Detail>
                <Detail label="Period start">{formatDateTime(sub.current_period_start)}</Detail>
                <Detail label="Period end">{formatDateTime(sub.current_period_end)}</Detail>
                <Detail label="Next invoice">{formatDateTime(sub.next_invoice_at)}</Detail>
                <Detail label="Grace until">{formatDateTime(sub.grace_until)}</Detail>
                <Detail label="Created">{formatDateTime(sub.created_at)}</Detail>
                <Detail label="Cancelled at">{formatDateTime(sub.cancelled_at)}</Detail>
                <Detail label="Product ID">
                  <span className="font-mono text-xs break-all">{sub.product_id}</span>
                </Detail>
                <Detail label="Plan ID">
                  <span className="font-mono text-xs break-all">{sub.plan_id ?? "—"}</span>
                </Detail>
                <Detail label="Ends at period close">
                  {sub.cancel_at_period_end ? "Yes" : "No"}
                </Detail>
              </dl>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}
