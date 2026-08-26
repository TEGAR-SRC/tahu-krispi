import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function NocTicketThreadPage() {
  const ticketId = useParams().ticketId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ticket thread" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /noc/tickets/:ticketId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {ticketId}</p>
    </div>
  )
}
