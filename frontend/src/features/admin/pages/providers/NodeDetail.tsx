import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function ProviderNodeDetailPage() {
  const providerId = useParams().providerId
  const node = useParams().node
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Node detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/providers/:providerId/nodes/:node."/>
      <p className="text-sm text-muted-foreground">Route parameters: {providerId}, {node}</p>
    </div>
  )
}
