import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function NocInstanceDetailPage() {
  const instanceId = useParams().instanceId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instance detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /noc/instances/:instanceId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {instanceId}</p>
    </div>
  )
}
