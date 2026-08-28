// Full-page coupon detail: the coupon configuration plus its redemption ledger
// from GET /admin/coupons/:id (redemptions embedded in the payload).
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardDescription,
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
import { TagIcon } from "lucide-react"
import { DetailRow, StatusBadge } from "../lib"
import { formatDateTime, formatMoney } from "../lib-utils"

interface CouponDetailData {
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
  duration_value?: number | null
  redeemed_count?: number
  enabled: boolean
  created_at?: string
  redemptions: CouponRedemption[]
}

interface CouponRedemption {
  id: string
  organization_id: string
  organization_public_id: string
  organization_name: string
  user_email?: string | null
  order_id: string
  order_public_id?: string | null
  discount_amount: number
  created_at: string
}

const redemptionColumns: Array<SimpleColumn<CouponRedemption>> = [
  {
    key: "organization_name",
    header: "Organization",
    render: (row) => (
      <div>
        <p className="font-medium">{row.organization_name}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.organization_public_id}</p>
      </div>
    ),
  },
  {
    key: "user_email",
    header: "Redeemed by",
    render: (row) => row.user_email ?? "—",
  },
  {
    key: "order_public_id",
    header: "Order",
    render: (row) =>
      row.order_public_id ? (
        <Link
          to={`/finance/orders/${row.order_id}`}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {row.order_public_id}
        </Link>
      ) : (
        "—"
      ),
  },
  {
    key: "discount_amount",
    header: "Discount given",
    className: "text-right tabular-nums",
    render: (row) => `−${formatMoney(row.discount_amount)}`,
  },
  {
    key: "created_at",
    header: "Used at",
    render: (row) => formatDateTime(row.created_at),
  },
]

export default function FinanceCouponDetailPage() {
  const couponId = useParams().couponId
  const [detail, setDetail] = useState<CouponDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!couponId) return
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<CouponDetailData>(`/admin/coupons/${couponId}`)
      setDetail(envelope.data)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [couponId])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  return (
    <div className="flex flex-col gap-6">
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
              <Link to="/finance/coupons">Coupons</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{detail?.code ?? "Coupon"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={detail ? `Coupon ${detail.code}` : "Coupon"}
        description={
          detail?.description
            ? detail.description
            : detail
              ? "Discount code configuration and usage."
              : "Loading…"
        }
      />

      {error ? (
        <>
          <ErrorBanner error={error} />
          <button
            type="button"
            className="w-fit rounded-md border px-3 py-1.5 text-sm"
            onClick={() => void load()}
          >
            Retry
          </button>
        </>
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : detail ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TagIcon className="size-4 text-muted-foreground" />
                <span className="font-mono">{detail.code}</span>
                {detail.enabled ? (
                  <StatusBadge status="active" />
                ) : (
                  <StatusBadge status="void" />
                )}
              </CardTitle>
              <CardDescription className="font-mono text-xs">{detail.id}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-8 lg:grid-cols-2">
              <div>
                <DetailRow label="Discount">
                  {detail.discount_type === "percent"
                    ? `${Number(detail.discount_value)}%`
                    : formatMoney(Number(detail.discount_value), detail.currency)}
                  {detail.duration_value
                    ? ` · applies for ${detail.duration_value} billing period(s)`
                    : ""}
                </DetailRow>
                <DetailRow label="Min order amount">
                  {Number(detail.min_order_amount) > 0
                    ? formatMoney(Number(detail.min_order_amount), detail.currency)
                    : "—"}
                </DetailRow>
                <DetailRow label="Max discount cap">
                  {detail.max_discount != null && Number(detail.max_discount) > 0
                    ? formatMoney(Number(detail.max_discount), detail.currency)
                    : "—"}
                </DetailRow>
                <DetailRow label="Max redemptions">
                  {detail.max_redemptions ?? "Unlimited"}
                </DetailRow>
                <DetailRow label="Per-user limit">
                  {detail.per_user_limit ?? "Unlimited"}
                </DetailRow>
              </div>
              <div>
                <DetailRow label="Valid from">{formatDateTime(detail.starts_at)}</DetailRow>
                <DetailRow label="Valid until">
                  {formatDateTime(detail.ends_at) !== "—"
                    ? formatDateTime(detail.ends_at)
                    : "No limit"}
                </DetailRow>
                <DetailRow label="Redeemed">{detail.redeemed_count ?? 0} time(s)</DetailRow>
                <DetailRow label="Currency">{detail.currency || "—"}</DetailRow>
                <DetailRow label="Created">{formatDateTime(detail.created_at)}</DetailRow>
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Redemptions</h3>
            <SimpleDataTable
              columns={redemptionColumns}
              rows={detail.redemptions}
              getRowKey={(row) => row.id}
              emptyMessage="This coupon has not been redeemed yet."
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}
