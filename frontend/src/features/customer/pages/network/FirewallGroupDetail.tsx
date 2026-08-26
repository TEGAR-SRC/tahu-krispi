import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function FirewallGroupDetailPage() {
  const firewallId = useParams().firewallId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Firewall group" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /app/network/firewall/:firewallId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {firewallId}</p>
    </div>
  )
}
