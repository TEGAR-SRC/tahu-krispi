import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function PlanPricesPage() {
  const planId = useParams().planId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Plan prices" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/billing/plans/:planId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {planId}</p>
    </div>
  )
}
