import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function JobsQueueBoardPage() {
  const queue = useParams().queue
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader title="Job queue board" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/jobs/queue/:queue."/>
      <p className="text-sm text-muted-foreground">Route parameter: {queue}</p>
    </div>
  )
}
