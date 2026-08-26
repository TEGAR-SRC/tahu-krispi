import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function OrganizationDetailPage() {
  const orgId = useParams().orgId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organization detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/organizations/:orgId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {orgId}</p>
    </div>
  )
}
