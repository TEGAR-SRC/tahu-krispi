import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function DokployHubPage() {

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dokploy PaaS" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/dokploy."/>
    </div>
  )
}
