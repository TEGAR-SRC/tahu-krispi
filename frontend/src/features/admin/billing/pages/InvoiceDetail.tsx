import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function BillingInvoiceDetailPage() {
  const invoiceId = useParams().invoiceId
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoice detail" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route /admin/billing/invoices/:invoiceId."/>
      <p className="text-sm text-muted-foreground">Route parameter: {invoiceId}</p>
    </div>
  )
}
