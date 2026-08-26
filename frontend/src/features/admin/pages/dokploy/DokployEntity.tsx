import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function DokployEntityPage() {
  const entity = useParams().entity
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dokploy mirror" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/dokploy/:entity."/>
      <p className="text-sm text-muted-foreground">Route parameter: {entity}</p>
    </div>
  )
}
