import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function DokploySettingsServersPage() {

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Servers (Dokploy)" />
      <EmptyState
        message="This page has not been wired to the upstream API yet."
        description="Implementation pending for route /admin/dokploy/app/settings/servers."/>
    </div>
  )
}
