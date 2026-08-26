import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function UserDetailPage() {
  const userId = useParams().userId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="User detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/users/:userId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {userId}</p>
    </div>
  )
}
