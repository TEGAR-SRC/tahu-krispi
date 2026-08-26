import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function DokployApplicationServicePage() {
  const projectId = useParams().projectId
  const environmentId = useParams().environmentId
  const applicationId = useParams().applicationId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Application" />
      <EmptyState
        message="This page has not been wired to the upstream API yet."
        description="Implementation pending for route /admin/dokploy/app/p/:projectId/e/:environmentId/services/application/:applicationId."/>
      <p className="text-sm text-muted-foreground">Route parameters: {projectId}, {environmentId}, {applicationId}</p>
    </div>
  )
}
