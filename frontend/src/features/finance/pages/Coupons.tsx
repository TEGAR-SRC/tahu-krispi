// Coupon management: list + create (every field the API accepts) + delete.
// Redemptions are browsed through order details, the only endpoint that
// exposes coupon_redemption records today.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PlusIcon, RefreshCwIcon, TagIcon } from "lucide-react"
import {
  StatusBadge,
  TablePagination,
} from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"
import type { AdminOrderDetail, AdminOrderRow } from "../lib"

interface Coupon {
  id: string
  code: string
  description?: string
  discount_type: "fixed" | "percent"
  discount_value: string | number
  currency?: string
  max_discount?: string | number | null
  min_order_amount: string | number
  max_redemptions?: number | null
  per_user_limit?: number | null
  starts_at?: string
  ends_at?: string
  enabled: boolean
  created_at?: string
}

interface CouponFormState {
  code: string
  description: string
  discount_type: "fixed" | "percent"
  discount_value: string
  currency: string
  max_discount: string
  min_order_amount: string
  max_redemptions: string
  per_user_limit: string
  starts_at: string
  ends_at: string
  enabled: boolean
}

const EMPTY_FORM: CouponFormState = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "",
  currency: "",
  max_discount: "",
  min_order_amount: "",
  max_redemptions: "",
  per_user_limit: "",
  starts_at: "",
  ends_at: "",
  enabled: true,
}

interface RedemptionRow {
  orderPublicId: string
  orgSlug: string
  code: string
  discountAmount: number
  currency: string
  createdAt: string
}

export default function FinanceCouponsPage() {
  const [rows, setRows] = useState<Coupon[]>([])
  const [meta, setMeta] = useState<{ page: number; per_page: number; total?: number } | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([])
  const [redemptionsLoading, setRedemptionsLoading] = useState(false)

  const loadCoupons = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<Coupon[]>("/admin/coupons", {
        query: { page, per_page: 20 },
      })
      setRows(envelope.data)
      setMeta(envelope.meta ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    const t = setTimeout(() => void loadCoupons(), 0)
    return () => clearTimeout(t)
  }, [loadCoupons])

  // Scans recent orders for coupon redemptions exposed in order details.
  const loadRedemptions = useCallback(async () => {
    setRedemptionsLoading(true)
    try {
      const first = await apiGet<AdminOrderRow[]>("/admin/orders", { query: { page: 1, per_page: 100 } })
      const candidates = first.data.filter((row) => row.discount > 0).slice(0, 30)
      const details = await Promise.allSettled(
        candidates.map((row) => apiGet<AdminOrderDetail>(`/admin/orders/${row.id}`)),
      )
      const found: RedemptionRow[] = []
      for (const result of details) {
        if (result.status !== "fulfilled") continue
        const detail = result.value.data
        if (!detail.coupon_redemption) continue
        found.push({
          orderPublicId: detail.public_id,
          orgSlug: detail.org_slug,
          code: detail.coupon_redemption.code,
          discountAmount: Number(detail.coupon_redemption.discount_amount),
          currency: detail.currency,
          createdAt: detail.created_at,
        })
      }
      setRedemptions(found.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch {
      // Surfaced as an empty browser; the coupons tab carries the real error.
      setRedemptions([])
    } finally {
      setRedemptionsLoading(false)
    }
  }, [])

  const submitCreate = useCallback(async () => {
    const code = form.code.trim()
    const value = Number(form.discount_value)
    if (!code) {
      setFormError("Code is required")
      return
    }
    if (!form.discount_value || !Number.isFinite(value) || value <= 0) {
      setFormError("Discount value must be greater than zero")
      return
    }
    if (form.discount_type === "percent" && value > 100) {
      setFormError("Percent discount cannot exceed 100")
      return
    }
    if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at) {
      setFormError("End of validity must be after start")
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      await apiPost("/admin/coupons", {
        code,
        description: form.description.trim() || undefined,
        discount_type: form.discount_type,
        discount_value: value,
        currency: form.currency.trim() || undefined,
        max_discount: form.max_discount ? Number(form.max_discount) : undefined,
        min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : 0,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : undefined,
        per_user_limit: form.per_user_limit ? Number(form.per_user_limit) : undefined,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : undefined,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : undefined,
        enabled: form.enabled,
      })
      toast.success(`Coupon ${code.toUpperCase()} created`)
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      setPage(1)
      await loadCoupons()
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? `${cause.message} (${cause.code})` : "Failed to create coupon",
      )
    } finally {
      setSaving(false)
    }
  }, [form, loadCoupons])

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/admin/coupons/${deleteTarget.id}`)
      toast.success(`Coupon ${deleteTarget.code} deleted`)
      setDeleteTarget(null)
      await loadCoupons()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete coupon")
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadCoupons])

  const columns: Array<SimpleColumn<Coupon>> = [
    {
      key: "code",
      header: "Code",
      render: (row) => (
        <Link
          to={`/finance/coupons/${row.id}`}
          className="flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <TagIcon className="size-3.5 text-muted-foreground" />
          <span className="font-mono font-medium">{row.code}</span>
        </Link>
      ),
    },
    {
      key: "discount_value",
      header: "Discount",
      render: (row) =>
        row.discount_type === "percent"
          ? `${Number(row.discount_value)}%`
          : formatMoney(Number(row.discount_value), row.currency),
    },
    {
      key: "min_order_amount",
      header: "Min spend",
      className: "text-right tabular-nums",
      render: (row) =>
        Number(row.min_order_amount) > 0
          ? formatMoney(Number(row.min_order_amount), row.currency)
          : "—",
    },
    {
      key: "caps",
      header: "Usage caps",
      render: (row) => {
        const parts: string[] = []
        if (row.max_redemptions) parts.push(`max ${row.max_redemptions}`)
        if (row.per_user_limit) parts.push(`${row.per_user_limit}/user`)
        return parts.length > 0 ? parts.join(" · ") : "—"
      },
    },
    {
      key: "validity",
      header: "Validity",
      render: (row) =>
        row.starts_at || row.ends_at
          ? `${formatDateTime(row.starts_at)} → ${formatDateTime(row.ends_at)}`
          : "No limit",
    },
    {
      key: "enabled",
      header: "Enabled",
      render: (row) =>
        row.enabled ? (
          <StatusBadge status="active" />
        ) : (
          <StatusBadge status="void" />
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24 text-right",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => setDeleteTarget(row)}
        >
          Delete
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Coupons"
        description="Discount codes with usage caps and validity windows."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New coupon
          </Button>
        }
      />

      <Tabs defaultValue="coupons" onValueChange={(value) => {
        if (value === "redemptions" && redemptions.length === 0 && !redemptionsLoading) {
          void loadRedemptions()
        }
      }}>
        <TabsList>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
          <TabsTrigger value="redemptions">Redemptions</TabsTrigger>
        </TabsList>

        <TabsContent value="coupons" className="mt-4 space-y-4">
          {error ? <ErrorBanner error={error} /> : null}
          <SimpleDataTable
            columns={columns}
            rows={rows}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyMessage={
              error
                ? "Coupon list unavailable."
                : "No coupons yet. Create the first discount code."
            }
          />
          <TablePagination meta={meta} onPageChange={setPage} />
        </TabsContent>

        <TabsContent value="redemptions" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Redemptions recorded on recent orders (fetched from order details).
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadRedemptions()} disabled={redemptionsLoading}>
              <RefreshCwIcon /> Reload
            </Button>
          </div>
          <SimpleDataTable
            columns={[
              { key: "code", header: "Coupon", render: (row) => <span className="font-mono">{row.code}</span> },
              { key: "orgSlug", header: "Organization" },
              {
                key: "orderPublicId",
                header: "Order",
                render: (row) => <span className="font-mono text-xs">{row.orderPublicId}</span>,
              },
              {
                key: "discountAmount",
                header: "Discount given",
                className: "text-right tabular-nums",
                render: (row) => `−${formatMoney(row.discountAmount, row.currency)}`,
              },
              { key: "createdAt", header: "Used at", render: (row) => formatDateTime(row.createdAt) },
            ]}
            rows={redemptions}
            loading={redemptionsLoading}
            getRowKey={(row) => row.orderPublicId}
            emptyMessage={redemptionsLoading ? "Scanning recent orders…" : "No coupon redemptions found on recent orders."}
          />
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New coupon</DialogTitle>
            <DialogDescription>All fields except code and discount are optional.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="coupon-code">Code *</Label>
                <Input
                  id="coupon-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                  placeholder="WELCOME10"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(value) => setForm({ ...form, discount_type: value as "fixed" | "percent" })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-value">Value *</Label>
                <Input
                  id="coupon-value"
                  type="number"
                  min="0.0001"
                  step="any"
                  value={form.discount_value}
                  onChange={(event) => setForm({ ...form, discount_value: event.target.value })}
                  placeholder={form.discount_type === "percent" ? "10" : "50000"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-currency">Currency</Label>
                <Input
                  id="coupon-currency"
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                  placeholder="IDR"
                  maxLength={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-max-discount">Max discount</Label>
                <Input
                  id="coupon-max-discount"
                  type="number"
                  min="0"
                  step="any"
                  value={form.max_discount}
                  onChange={(event) => setForm({ ...form, max_discount: event.target.value })}
                  placeholder="Cap in currency units"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-min-spend">Min order amount</Label>
                <Input
                  id="coupon-min-spend"
                  type="number"
                  min="0"
                  step="any"
                  value={form.min_order_amount}
                  onChange={(event) => setForm({ ...form, min_order_amount: event.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-max-redemptions">Max redemptions</Label>
                <Input
                  id="coupon-max-redemptions"
                  type="number"
                  min="1"
                  step="1"
                  value={form.max_redemptions}
                  onChange={(event) => setForm({ ...form, max_redemptions: event.target.value })}
                  placeholder="Unlimited"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-per-user">Per-user limit</Label>
                <Input
                  id="coupon-per-user"
                  type="number"
                  min="1"
                  step="1"
                  value={form.per_user_limit}
                  onChange={(event) => setForm({ ...form, per_user_limit: event.target.value })}
                  placeholder="Unlimited"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-starts">Valid from</Label>
                <Input
                  id="coupon-starts"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupon-ends">Valid until</Label>
                <Input
                  id="coupon-ends"
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="coupon-description">Description</Label>
                <Input
                  id="coupon-description"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Internal note or public label"
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="coupon-enabled" className="cursor-pointer">
                  Enabled
                </Label>
                <Switch
                  id="coupon-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={saving}>
              {saving ? "Creating…" : "Create coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coupon {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The coupon will be removed permanently. Past orders keep their applied discounts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void submitDelete()
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
