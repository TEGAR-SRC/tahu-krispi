// Admin billing: coupon management. POST /admin/coupons upserts by code, so
// create and edit share one form; DELETE /admin/coupons/:coupon_id removes;
// GET /admin/coupons/:coupon_id returns the row plus its redemption list.
// Note: as of writing GET /admin/coupons answers 500 on this environment
// (backend scan bug), which the page surfaces honestly via the error banner.
import { useState } from "react"
import { Link } from "react-router-dom"
import { PencilIcon, PlusIcon, TicketPercentIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge, Pager, formatDateTime, formatMoney, usePagedList } from "./shared"

interface CouponRow {
  id: string
  code: string
  description: string
  discount_type: "fixed" | "percent" | string
  discount_value: number
  currency: string
  max_discount?: number | null
  min_order_amount: number
  max_redemptions?: number | null
  per_user_limit?: number | null
  starts_at: string
  ends_at: string
  duration_value?: number | null
  duration_unit?: string
  redeemed_count: number
  enabled: boolean
  created_at: string
}

interface CouponRedemption {
  id: string
  organization_public_id: string
  organization_name: string
  user_email?: string | null
  order_public_id?: string | null
  discount_amount: number
  created_at: string
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
  use_duration: boolean
  duration_value: string
  duration_unit: "days" | "weeks" | "months" | "years"
  enabled: boolean
}

const EMPTY_FORM: CouponFormState = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "",
  currency: "IDR",
  max_discount: "",
  min_order_amount: "",
  max_redemptions: "",
  per_user_limit: "",
  starts_at: "",
  ends_at: "",
  use_duration: false,
  duration_value: "",
  duration_unit: "months",
  enabled: true,
}

function formFromCoupon(coupon: CouponRow): CouponFormState {
  return {
    code: coupon.code,
    description: coupon.description ?? "",
    discount_type:
      coupon.discount_type === "fixed" ? "fixed" : "percent",
    discount_value: String(coupon.discount_value ?? ""),
    currency: coupon.currency || "IDR",
    max_discount: coupon.max_discount != null ? String(coupon.max_discount) : "",
    min_order_amount: String(coupon.min_order_amount ?? ""),
    max_redemptions: coupon.max_redemptions != null ? String(coupon.max_redemptions) : "",
    per_user_limit: coupon.per_user_limit != null ? String(coupon.per_user_limit) : "",
    starts_at: coupon.starts_at ? coupon.starts_at.slice(0, 16) : "",
    ends_at: coupon.ends_at ? coupon.ends_at.slice(0, 16) : "",
    use_duration: Boolean(coupon.duration_value),
    duration_value: coupon.duration_value != null ? String(coupon.duration_value) : "",
    duration_unit:
      coupon.duration_unit === "days" ||
      coupon.duration_unit === "weeks" ||
      coupon.duration_unit === "years"
        ? coupon.duration_unit
        : "months",
    enabled: coupon.enabled,
  }
}

/** Optional numeric field: empty string -> undefined (kept null server-side). */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

export default function BillingCouponsPage() {
  const list = usePagedList<CouponRow>("/admin/coupons")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CouponRow | null>(null)
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CouponRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Detail dialog with redemptions
  const [detailOpenId, setDetailOpenId] = useState<string | null>(null)
  const [detailCoupon, setDetailCoupon] = useState<CouponRow | null>(null)
  const [redemptions, setRedemptions] = useState<CouponRedemption[] | null>(null)
  const [detailError, setDetailError] = useState<unknown>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (coupon: CouponRow) => {
    setEditing(coupon)
    setForm(formFromCoupon(coupon))
    setFormError(null)
    setFormOpen(true)
  }

  const openDetail = (coupon: CouponRow) => {
    setDetailOpenId(coupon.id)
    setDetailCoupon(null)
    setRedemptions(null)
    setDetailError(null)
    apiGet<CouponRow & { redemptions: CouponRedemption[] }>(
      `/admin/coupons/${coupon.id}`,
    )
      .then((envelope) => {
        setDetailCoupon(envelope.data)
        setRedemptions(envelope.data.redemptions ?? [])
      })
      .catch((cause: unknown) => setDetailError(cause))
  }

  const submitForm = async () => {
    const code = form.code.trim().toLowerCase()
    const discountValue = Number(form.discount_value)
    if (!code) {
      setFormError("Code is required.")
      return
    }
    if (!form.discount_value.trim() || Number.isNaN(discountValue) || discountValue <= 0) {
      setFormError("Discount value must be a number greater than 0.")
      return
    }
    if (form.discount_type === "percent" && discountValue > 100) {
      setFormError("Percent discounts cannot exceed 100.")
      return
    }
    const currency = form.currency.trim().toUpperCase()
    if (currency && currency.length !== 3) {
      setFormError("Currency must be a 3-letter ISO code (e.g. IDR).")
      return
    }
    const maxDiscount = optionalNumber(form.max_discount)
    if (maxDiscount !== undefined && maxDiscount < 0) {
      setFormError("Max discount must be >= 0.")
      return
    }
    const durationValue = optionalNumber(form.duration_value)
    if (form.use_duration && (durationValue === undefined || durationValue <= 0)) {
      setFormError("Duration limit needs a positive number of periods.")
      return
    }

    const body: Record<string, unknown> = {
      code,
      description: form.description.trim(),
      discount_type: form.discount_type,
      discount_value: discountValue,
      currency: currency || undefined,
      min_order_amount: optionalNumber(form.min_order_amount) ?? 0,
      max_redemptions: optionalNumber(form.max_redemptions),
      per_user_limit: optionalNumber(form.per_user_limit),
      starts_at: form.starts_at || "",
      // The backend derives ends_at from the duration when ends_at is blank.
      ends_at: form.ends_at || "",
      enabled: form.enabled,
    }
    if (maxDiscount !== undefined) body.max_discount = maxDiscount
    if (form.use_duration && durationValue !== undefined) {
      body.duration_value = durationValue
      body.duration_unit = form.duration_unit
    }

    setSaving(true)
    try {
      await apiPost("/admin/coupons", body)
      toast.success(editing ? `Coupon ${code} updated` : `Coupon ${code} created`)
      setFormOpen(false)
      list.reload()
    } catch (cause) {
      setFormError(
        cause instanceof ApiError ? cause.message : "Failed to save coupon.",
      )
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/admin/coupons/${deleteTarget.id}`)
      toast.success(`Coupon ${deleteTarget.code} deleted`)
      setDeleteTarget(null)
      list.reload()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to delete coupon.",
      )
    } finally {
      setDeleting(false)
    }
  }

  const columns: Array<SimpleColumn<CouponRow>> = [
    {
      key: "code",
      header: "Code",
      render: (coupon) => (
        <div className="flex flex-col">
          <Link
            to={`/admin/billing/coupons/${coupon.id}`}
            title="Open coupon detail page"
            className="font-mono text-xs font-medium uppercase underline-offset-4 hover:underline"
          >
            {coupon.code}
          </Link>
          {coupon.description ? (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {coupon.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "discount",
      header: "Discount",
      className: "tabular-nums",
      render: (coupon) =>
        coupon.discount_type === "percent"
          ? `${coupon.discount_value}%`
          : formatMoney(coupon.discount_value, coupon.currency || undefined),
    },
    {
      key: "min_order_amount",
      header: "Min spend",
      className: "text-right tabular-nums",
      render: (coupon) =>
        coupon.min_order_amount > 0
          ? formatMoney(coupon.min_order_amount, coupon.currency || undefined)
          : "—",
    },
    {
      key: "redeemed",
      header: "Redeemed",
      className: "text-right tabular-nums",
      render: (coupon) =>
        `${coupon.redeemed_count}${coupon.max_redemptions != null ? ` / ${coupon.max_redemptions}` : ""}`,
    },
    {
      key: "validity",
      header: "Valid until",
      render: (coupon) => formatDateTime(coupon.ends_at),
    },
    {
      key: "enabled",
      header: "Status",
      render: (coupon) => <StatusBadge status={coupon.enabled ? "active" : "disabled"} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      render: (coupon) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit ${coupon.code}`} onClick={() => openEdit(coupon)}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Redemptions for ${coupon.code}`} onClick={() => openDetail(coupon)}>
            <TicketPercentIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${coupon.code}`}
            onClick={() => setDeleteTarget(coupon)}
          >
            <Trash2Icon className="text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  const setField = <K extends keyof CouponFormState>(
    key: K,
    value: CouponFormState[K],
  ) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Coupons"
        description="Discount coupons applied at checkout. Saving with an existing code updates it."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon /> New coupon
          </Button>
        }
      />

      <SimpleDataTable
        columns={columns}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        getRowKey={(coupon) => coupon.id}
        emptyMessage="No coupons yet."
        skeletonRows={5}
      />

      <Pager
        page={list.page}
        meta={list.meta}
        onPage={list.setPage}
        disabled={list.loading}
      />

      {/* Create / edit dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setFormOpen(false)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit coupon ${editing.code}` : "New coupon"}</DialogTitle>
            <DialogDescription>
              Discount applies at checkout; percent values are capped at 100 (= free).
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="coupon-code">Code *</Label>
                <Input
                  id="coupon-code"
                  placeholder="WELCOME10"
                  value={form.code}
                  onChange={(event) => setField("code", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coupon-enabled">Enabled</Label>
                <Switch
                  id="coupon-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => setField("enabled", checked)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="coupon-description">Description</Label>
              <Textarea
                id="coupon-description"
                rows={2}
                value={form.description}
                onChange={(event) => setField("description", event.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="coupon-type">Discount type *</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(value) =>
                    setField("discount_type", value as CouponFormState["discount_type"])
                  }
                >
                  <SelectTrigger id="coupon-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coupon-value">
                  {form.discount_type === "percent" ? "Percent *" : "Amount *"}
                </Label>
                <Input
                  id="coupon-value"
                  type="number"
                  min="0"
                  step="any"
                  value={form.discount_value}
                  onChange={(event) => setField("discount_value", event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="coupon-currency">Currency</Label>
                <Input
                  id="coupon-currency"
                  maxLength={3}
                  placeholder="IDR"
                  value={form.currency}
                  onChange={(event) => setField("currency", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coupon-max-discount">Max discount</Label>
                <Input
                  id="coupon-max-discount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Cap on the discount amount"
                  value={form.max_discount}
                  onChange={(event) => setField("max_discount", event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="coupon-min-order">Minimum order amount</Label>
              <Input
                id="coupon-min-order"
                type="number"
                min="0"
                step="any"
                value={form.min_order_amount}
                onChange={(event) => setField("min_order_amount", event.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="coupon-max-redemptions">Max redemptions total</Label>
                <Input
                  id="coupon-max-redemptions"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Unlimited"
                  value={form.max_redemptions}
                  onChange={(event) => setField("max_redemptions", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coupon-per-user">Per-user limit</Label>
                <Input
                  id="coupon-per-user"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Unlimited"
                  value={form.per_user_limit}
                  onChange={(event) => setField("per_user_limit", event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="coupon-starts">Valid from</Label>
                <Input
                  id="coupon-starts"
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(event) => setField("starts_at", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coupon-ends">Valid until</Label>
                <Input
                  id="coupon-ends"
                  type="datetime-local"
                  value={form.ends_at}
                  disabled={form.use_duration}
                  onChange={(event) => setField("ends_at", event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={form.use_duration}
                  onCheckedChange={(checked) => setField("use_duration", checked)}
                />
                Limit subscription duration instead of a fixed end date
              </label>
              {form.use_duration ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  When no end date is set, the backend derives it as now + N periods.
                </p>
              ) : null}
              {form.use_duration ? (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="coupon-duration-value">Duration *</Label>
                    <Input
                      id="coupon-duration-value"
                      type="number"
                      min="1"
                      step="1"
                      value={form.duration_value}
                      onChange={(event) => setField("duration_value", event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="coupon-duration-unit">Unit</Label>
                    <Select
                      value={form.duration_unit}
                      onValueChange={(value) =>
                        setField("duration_unit", value as CouponFormState["duration_unit"])
                      }
                    >
                      <SelectTrigger id="coupon-duration-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="weeks">Weeks</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void submitForm()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redemptions detail */}
      <Dialog
        open={detailOpenId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailOpenId(null)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Coupon redemptions</DialogTitle>
            <DialogDescription>
              {detailCoupon ? `${detailCoupon.code.toUpperCase()} · ${formatDateTime(detailCoupon.created_at)}` : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          {detailError ? <ErrorBanner error={detailError} /> : null}

          {!detailError && detailCoupon ? (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span>
                  Discount:{" "}
                  <strong>
                    {detailCoupon.discount_type === "percent"
                      ? `${detailCoupon.discount_value}%`
                      : formatMoney(detailCoupon.discount_value, detailCoupon.currency || undefined)}
                  </strong>
                </span>
                <span>
                  Redeemed:{" "}
                  <strong>
                    {detailCoupon.redeemed_count}
                    {detailCoupon.max_redemptions != null
                      ? ` / ${detailCoupon.max_redemptions}`
                      : ""}
                  </strong>
                </span>
                <span>
                  Valid: {formatDateTime(detailCoupon.starts_at)} —{" "}
                  {formatDateTime(detailCoupon.ends_at)}
                </span>
              </div>

              <SimpleDataTable
                columns={[
                  { key: "organization_name", header: "Organization" },
                  {
                    key: "user_email",
                    header: "User",
                    render: (row) => row.user_email || "—",
                  },
                  {
                    key: "order_public_id",
                    header: "Order",
                    render: (row) => row.order_public_id || "—",
                  },
                  {
                    key: "discount_amount",
                    header: "Discounted",
                    className: "text-right tabular-nums",
                    render: (row) =>
                      formatMoney(row.discount_amount, detailCoupon.currency || undefined),
                  },
                  {
                    key: "created_at",
                    header: "At",
                    render: (row) => formatDateTime(row.created_at),
                  },
                ]}
                rows={redemptions ?? []}
                loading={redemptions === null}
                getRowKey={(row) => row.id}
                emptyMessage="This coupon has not been redeemed yet."
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Coupon ${deleteTarget.code.toUpperCase()} will be removed permanently. Existing orders that already used it keep their discount.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? "Deleting…" : "Delete coupon"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
