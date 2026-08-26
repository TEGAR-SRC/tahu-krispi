import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import { CloudIcon, LockKeyholeIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const PAGES: Record<string, { title: string; badge: string; description: string; ops: string[] }> = {
  billing: {
    title: "Billing",
    badge: "Dokploy Cloud",
    description:
      "Plans, checkout, customer portal and subscription upgrades are only available on Dokploy Cloud.",
    ops: [
      "stripe.getProducts",
      "stripe.getCurrentPlan",
      "stripe.createCheckoutSession",
      "stripe.createCustomerPortalSession",
      "stripe.upgradeSubscription",
    ],
  },
  invoices: {
    title: "Invoices",
    badge: "Dokploy Cloud",
    description: "Hosted invoice listing and invoice-notification settings are Cloud-only.",
    ops: ["stripe.getInvoices", "stripe.updateInvoiceNotifications"],
  },
  license: {
    title: "Enterprise license",
    badge: "Enterprise add-on",
    description:
      "License-key activation and enterprise settings are proprietary enterprise features, not CE dashboard parity.",
    ops: [
      "licenseKey.activate",
      "licenseKey.deactivate",
      "licenseKey.validate",
      "licenseKey.getEnterpriseSettings",
    ],
  },
  sso: {
    title: "SSO / SCIM",
    badge: "Enterprise add-on",
    description:
      "OIDC/SAML SSO, forward-auth gates and SCIM provisioning are enterprise-gated in Dokploy.",
    ops: ["sso.*", "forwardAuth.*", "scim.*", "settings.updateEnforceSSO"],
  },
  whitelabeling: {
    title: "Whitelabeling",
    badge: "Enterprise add-on",
    description:
      "Logo, CSS and public error-page customization are enterprise-gated and intentionally disabled here.",
    ops: ["whitelabeling.get", "whitelabeling.update", "whitelabeling.reset", "whitelabeling.getPublic"],
  },
}

export default function DokployCloudOnlyPage() {
  const location = useLocation()
  const segment = useMemo(() => location.pathname.split("/").filter(Boolean).at(-1) ?? "billing", [location.pathname])
  const page = PAGES[segment] ?? PAGES.billing

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={page.title}
        description="This Console build targets Dokploy CE parity through the universal upstream proxy."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {page.badge.includes("Cloud") ? (
              <CloudIcon className="size-4 text-muted-foreground" />
            ) : (
              <LockKeyholeIcon className="size-4 text-muted-foreground" />
            )}
            {page.title}
            <Badge variant="secondary">{page.badge}</Badge>
          </CardTitle>
          <CardDescription>{page.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            No mock data is rendered for this route. The upstream manifest classifies it as cloud or
            enterprise-only, so CE installations should not see fake billing, SSO, license or branding state.
          </p>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 font-medium text-foreground">Related upstream operations</p>
            <ul className="list-disc space-y-1 pl-5">
              {page.ops.map((op) => (
                <li key={op}>
                  <code>{op}</code>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
