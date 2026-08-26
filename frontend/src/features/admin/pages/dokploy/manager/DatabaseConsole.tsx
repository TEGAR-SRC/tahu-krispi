import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function DokployDatabaseConsole() {

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dokploy databases" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/dokploy/manager/database."/>
    </div>
  )
}
