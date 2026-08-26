import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function ForgotPasswordPage() {

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Forgot password" />
      <EmptyState
        message="This page has not been wired to the upstream API yet."
        description="Implementation pending for route /forgot-password."/>
    </div>
  )
}
