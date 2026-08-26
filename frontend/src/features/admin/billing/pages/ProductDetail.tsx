import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function BillingProductDetailPage() {
  const productId = useParams().productId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Product detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/billing/products/:productId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {productId}</p>
    </div>
  )
}
