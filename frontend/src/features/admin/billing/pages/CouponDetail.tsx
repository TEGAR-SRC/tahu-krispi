// Admin coupon detail (GET /admin/coupons/:coupon_id): the coupon rules plus
// its redemption list. Redemptions link back to the orders that used them.
// The API exposes no enable/disable or edit-by-id endpoint here (upsert by
// code happens from the Coupons list page), so this page is read-only.
import { Link, useParams } from "react-router-dom"
import { RefreshCwIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  DetailBreadcrumbs,
  DetailField,
} from "./detailShared"
import { useApiDetail } from "./use-api-detail"
import { StatusBadge, formatDateTime, formatMoney } from "./shared"

interface CouponRedemption {
  id: string
  organization_id?: string
  organization_public_id?: string
  organization_name: string
  user_email?: string | null
  order_id?: string | null
  order_public_id?: string | null
  discount_amount: number
  created_at: string
}

interface CouponDetailData {
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
  redemptions: CouponRedemption[]
}

export default function BillingCouponDetailPage() {
  const { couponId } = useParams()
  const detail = useApiDetail<CouponDetailData>(
    couponId ? `/admin/coupons/${couponId}` : null,
  )

  const coupon = detail.data
  const redemptionRatio =
    coupon && coupon.max_redemptions && coupon.max_redemptions > 0
      ? Math.min(100, Math.round((coupon.redeemed_count / coupon.max_redemptions) * 100))
      : null

  return (
    <div className="flex flex-col gap-6">
      <DetailBreadcrumbs
        trail={[
          { label: "Billing", to: "/admin/billing/summary" },
          { label: "Coupons", to: "/admin/billing/coupons" },
          { label: coupon ? coupon.code.toUpperCase() : (couponId ?? "…") },
        ]}
      />

      <PageHeader
        title={coupon ? `Coupon ${coupon.code.toUpperCase()}` : "Coupon detail"}
        description={coupon?.description || undefined}
        actions={
          <Button variant="outline" onClick={detail.reload} disabled={detail.loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />

      {detail.error ? <ErrorBanner error={detail.error} /> : null}
      {!detail.error && detail.loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : null}

      {coupon ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Rules{" "}
                <StatusBadge status={coupon.enabled ? "active" : "disabled"} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField
                label="Discount"
                value={
                  coupon.discount_type === "percent"
                    ? `${coupon.discount_value}%`
                    : formatMoney(coupon.discount_value, coupon.currency || undefined)
                }
              />
              <DetailField
                label="Min order amount"
                value={
                  coupon.min_order_amount > 0
                    ? formatMoney(coupon.min_order_amount, coupon.currency || undefined)
                    : "—"
                }
              />
              <DetailField
                label="Max discount cap"
                value={
                  coupon.max_discount != null
                    ? formatMoney(coupon.max_discount, coupon.currency || undefined)
                    : "—"
                }
              />
              <DetailField label="Currency" value={coupon.currency || "—"} />
              <DetailField label="Valid from" value={formatDateTime(coupon.starts_at)} />
              <DetailField label="Valid until" value={formatDateTime(coupon.ends_at)} />
              <DetailField
                label="Subscription limit"
                value={
                  coupon.duration_value
                    ? `${coupon.duration_value} ${coupon.duration_unit ?? "days"}`
                    : "—"
                }
              />
              <DetailField
                label="Per-user limit"
                value={coupon.per_user_limit != null ? String(coupon.per_user_limit) : "—"}
              />
              <DetailField label="Created" value={formatDateTime(coupon.created_at)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Redemptions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="tabular-nums">
                  Redeemed{" "}
                  <strong>
                    {coupon.redeemed_count}
                    {coupon.max_redemptions != null ? ` / ${coupon.max_redemptions}` : ""}
                  </strong>
                </span>
                {redemptionRatio !== null ? (
                  <Progress value={redemptionRatio} className="h-2 w-48" />
                ) : null}
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
                    render: (row) =>
                      row.order_id ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/admin/billing/orders/${row.order_id}`}>
                            <span className="font-mono text-xs">
                              {row.order_public_id || row.order_id}
                            </span>
                          </Link>
                        </Button>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "discount_amount",
                    header: "Discounted",
                    className: "text-right tabular-nums",
                    render: (row) =>
                      formatMoney(row.discount_amount, coupon.currency || undefined),
                  },
                  {
                    key: "created_at",
                    header: "At",
                    render: (row) => (
                      <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
                    ),
                  },
                ]}
                rows={coupon.redemptions ?? []}
                getRowKey={(row) => row.id}
                emptyMessage="This coupon has not been redeemed yet."
                skeletonRows={4}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
