import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function BillingCouponDetailPage() {
  const couponId = useParams().couponId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Coupon detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/billing/coupons/:couponId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {couponId}</p>
    </div>
  )
}
