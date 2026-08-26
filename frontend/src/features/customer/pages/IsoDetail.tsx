import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function IsoDetailPage() {
  const isoId = useParams().isoId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ISO detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /app/iso/:isoId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {isoId}</p>
    </div>
  )
}
