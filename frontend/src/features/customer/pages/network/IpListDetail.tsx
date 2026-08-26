import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function IpListDetailPage() {
  const listId = useParams().listId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="IP list" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /app/ip-lists/:listId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {listId}</p>
    </div>
  )
}
