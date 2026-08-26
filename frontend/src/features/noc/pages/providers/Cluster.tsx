import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function NocProviderClusterPage() {
  const providerId = useParams().providerId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Cluster" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /noc/providers/:providerId/cluster."/>
      <p className="text-sm text-muted-foreground">Route parameter: {providerId}</p>
    </div>
  )
}
