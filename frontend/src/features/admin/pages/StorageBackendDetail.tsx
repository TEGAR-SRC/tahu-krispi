import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function StorageBackendDetailPage() {
  const code = useParams().code
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Storage backend detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/storage-backends/:code."/>
      <p className="text-sm text-muted-foreground">Route parameter: {code}</p>
    </div>
  )
}
