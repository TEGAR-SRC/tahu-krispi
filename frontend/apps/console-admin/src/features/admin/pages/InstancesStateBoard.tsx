import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function InstancesStateBoardPage() {
  const state = useParams().state
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader title="Instances by state" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/instances/state/:state."/>
      <p className="text-sm text-muted-foreground">Route parameter: {state}</p>
    </div>
  )
}
