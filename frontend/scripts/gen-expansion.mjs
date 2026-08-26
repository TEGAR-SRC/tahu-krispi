// Expansion scaffold generator: creates compile-clean stub pages for every
// NEW route of the console expansion. Existing files are never overwritten.
// Usage: node scripts/gen-expansion.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// file: path under src/, route: router path, title: page header title
const PAGES = [
  // ---- ADMIN · identity & governance -------------------------------------
  { file: "features/admin/pages/UserDetail.tsx", route: "/admin/users/:userId", title: "User detail", component: "UserDetailPage" },
  { file: "features/admin/pages/Organizations.tsx", route: "/admin/organizations", title: "Organizations", component: "OrganizationsPage" },
  { file: "features/admin/pages/OrganizationDetail.tsx", route: "/admin/organizations/:orgId", title: "Organization detail", component: "OrganizationDetailPage" },
  { file: "features/admin/pages/Orphans.tsx", route: "/admin/orphans", title: "Orphan resources", component: "OrphansPage" },
  { file: "features/admin/pages/TicketThread.tsx", route: "/admin/tickets/:ticketId", title: "Ticket thread", component: "AdminTicketThreadPage" },
  { file: "features/admin/pages/security/Incidents.tsx", route: "/admin/security/incidents", title: "Security incidents", component: "SecurityIncidentsPage" },
  { file: "features/admin/pages/security/BlockedNetworks.tsx", route: "/admin/security/blocked-networks", title: "Blocked networks", component: "BlockedNetworksPage" },
  { file: "features/admin/pages/security/FeatureFlags.tsx", route: "/admin/security/feature-flags", title: "Feature flags", component: "FeatureFlagsPage" },
  { file: "features/admin/pages/security/AppSettings.tsx", route: "/admin/security/app-settings", title: "App settings", component: "AppSettingsPage" },
  // ---- ADMIN · infrastructure --------------------------------------------
  { file: "features/admin/pages/providers/ProviderDetail.tsx", route: "/admin/providers/:providerId", title: "Provider detail", component: "ProviderDetailPage" },
  { file: "features/admin/pages/providers/Nodes.tsx", route: "/admin/providers/:providerId/nodes", title: "Provider nodes", component: "ProviderNodesPage" },
  { file: "features/admin/pages/providers/NodeDetail.tsx", route: "/admin/providers/:providerId/nodes/:node", title: "Node detail", component: "ProviderNodeDetailPage" },
  { file: "features/admin/pages/providers/Storages.tsx", route: "/admin/providers/:providerId/storages", title: "Provider storages", component: "ProviderStoragesPage" },
  { file: "features/admin/pages/providers/BackupJobs.tsx", route: "/admin/providers/:providerId/backup-jobs", title: "Backup jobs", component: "ProviderBackupJobsPage" },
  { file: "features/admin/pages/providers/Ha.tsx", route: "/admin/providers/:providerId/ha", title: "HA resources", component: "ProviderHaPage" },
  { file: "features/admin/pages/providers/Firewall.tsx", route: "/admin/providers/:providerId/firewall", title: "Cluster firewall", component: "ProviderFirewallPage" },
  { file: "features/admin/pages/providers/Sdn.tsx", route: "/admin/providers/:providerId/sdn", title: "SDN", component: "ProviderSdnPage" },
  { file: "features/admin/pages/providers/Ceph.tsx", route: "/admin/providers/:providerId/ceph", title: "Ceph status", component: "ProviderCephPage" },
  { file: "features/admin/pages/providers/Containers.tsx", route: "/admin/providers/:providerId/containers", title: "Containers (LXC)", component: "ProviderContainersPage" },
  { file: "features/admin/pages/providers/Pools.tsx", route: "/admin/providers/:providerId/pools", title: "PVE pools", component: "ProviderPoolsPage" },
  { file: "features/admin/pages/providers/VmwareInventory.tsx", route: "/admin/providers/:providerId/inventory", title: "vCenter inventory", component: "VmwareInventoryPage" },
  { file: "features/admin/pages/providers/GuestPerf.tsx", route: "/admin/providers/:providerId/perf", title: "Guest performance", component: "GuestPerfPage" },
  { file: "features/admin/pages/InstanceDetail.tsx", route: "/admin/instances/:instanceId", title: "Instance detail", component: "AdminInstanceDetailPage" },
  { file: "features/admin/pages/JobDetail.tsx", route: "/admin/jobs/:jobId", title: "Job detail", component: "AdminJobDetailPage" },
  { file: "features/admin/pages/StorageBackendDetail.tsx", route: "/admin/storage-backends/:code", title: "Storage backend detail", component: "StorageBackendDetailPage" },
  // ---- ADMIN · billing ----------------------------------------------------
  { file: "features/admin/billing/pages/OrderDetail.tsx", route: "/admin/billing/orders/:orderId", title: "Order detail", component: "BillingOrderDetailPage" },
  { file: "features/admin/billing/pages/InvoiceDetail.tsx", route: "/admin/billing/invoices/:invoiceId", title: "Invoice detail", component: "BillingInvoiceDetailPage" },
  { file: "features/admin/billing/pages/CouponDetail.tsx", route: "/admin/billing/coupons/:couponId", title: "Coupon detail", component: "BillingCouponDetailPage" },
  { file: "features/admin/billing/pages/OrgWallet.tsx", route: "/admin/billing/wallets/:orgId", title: "Organization wallet", component: "BillingOrgWalletPage" },
  { file: "features/admin/billing/pages/ProductDetail.tsx", route: "/admin/billing/products/:productId", title: "Product detail", component: "BillingProductDetailPage" },
  { file: "features/admin/billing/pages/PlanPrices.tsx", route: "/admin/billing/plans/:planId", title: "Plan prices", component: "PlanPricesPage" },
  { file: "features/admin/billing/pages/Reports.tsx", route: "/admin/billing/reports", title: "Billing reports", component: "BillingReportsPage" },
  // ---- ADMIN · dokploy & affiliate ----------------------------------------
  { file: "features/admin/pages/DokployHub.tsx", route: "/admin/dokploy", title: "Dokploy PaaS", component: "DokployHubPage" },
  { file: "features/admin/pages/dokploy/DokployEntity.tsx", route: "/admin/dokploy/:entity", title: "Dokploy mirror", component: "DokployEntityPage" },
  { file: "features/admin/pages/affiliate/AffiliateSettings.tsx", route: "/admin/affiliate/settings", title: "Affiliate settings", component: "AffiliateSettingsPage" },
  { file: "features/admin/pages/affiliate/AffiliateEarnings.tsx", route: "/admin/affiliate/earnings", title: "Affiliate earnings", component: "AffiliateEarningsPage" },

  // ---- NOC -----------------------------------------------------------------
  { file: "features/noc/pages/InstanceDetail.tsx", route: "/noc/instances/:instanceId", title: "Instance detail", component: "NocInstanceDetailPage" },
  { file: "features/noc/pages/JobDetail.tsx", route: "/noc/jobs/:jobId", title: "Job detail", component: "NocJobDetailPage" },
  { file: "features/noc/pages/TicketThread.tsx", route: "/noc/tickets/:ticketId", title: "Ticket thread", component: "NocTicketThreadPage" },
  { file: "features/noc/pages/providers/ProviderDetail.tsx", route: "/noc/providers/:providerId", title: "Provider detail", component: "NocProviderDetailPage" },
  { file: "features/noc/pages/providers/Cluster.tsx", route: "/noc/providers/:providerId/cluster", title: "Cluster", component: "NocProviderClusterPage" },
  { file: "features/noc/pages/providers/Nodes.tsx", route: "/noc/providers/:providerId/nodes", title: "Nodes", component: "NocProviderNodesPage" },
  { file: "features/noc/pages/providers/NodeDetail.tsx", route: "/noc/providers/:providerId/nodes/:node", title: "Node detail", component: "NocProviderNodeDetailPage" },
  { file: "features/noc/pages/providers/Storages.tsx", route: "/noc/providers/:providerId/storages", title: "Storages", component: "NocProviderStoragesPage" },
  { file: "features/noc/pages/providers/BackupJobs.tsx", route: "/noc/providers/:providerId/backup-jobs", title: "Backup jobs", component: "NocProviderBackupJobsPage" },
  { file: "features/noc/pages/providers/Firewall.tsx", route: "/noc/providers/:providerId/firewall", title: "Cluster firewall", component: "NocProviderFirewallPage" },
  { file: "features/noc/pages/providers/Services.tsx", route: "/noc/providers/:providerId/services", title: "Cluster services", component: "NocProviderServicesPage" },

  // ---- FINANCE ---------------------------------------------------------------
  { file: "features/finance/pages/OrderDetail.tsx", route: "/finance/orders/:orderId", title: "Order detail", component: "FinanceOrderDetailPage" },
  { file: "features/finance/pages/InvoiceDetail.tsx", route: "/finance/invoices/:invoiceId", title: "Invoice detail", component: "FinanceInvoiceDetailPage" },
  { file: "features/finance/pages/CouponDetail.tsx", route: "/finance/coupons/:couponId", title: "Coupon detail", component: "FinanceCouponDetailPage" },
  { file: "features/finance/pages/OrgWallet.tsx", route: "/finance/wallets/:orgId", title: "Organization wallet", component: "FinanceOrgWalletPage" },
  { file: "features/finance/pages/Rates.tsx", route: "/finance/rates", title: "Custom rates", component: "FinanceRatesPage" },
  { file: "features/finance/pages/Regions.tsx", route: "/finance/regions", title: "Regions", component: "FinanceRegionsPage" },
  { file: "features/finance/pages/Reports.tsx", route: "/finance/reports", title: "Finance reports", component: "FinanceReportsPage" },
  { file: "features/finance/pages/AffiliateSettings.tsx", route: "/finance/affiliate/settings", title: "Affiliate settings", component: "FinanceAffiliateSettingsPage" },
  { file: "features/finance/pages/AffiliateEarnings.tsx", route: "/finance/affiliate/earnings", title: "Affiliate earnings", component: "FinanceAffiliateEarningsPage" },

  // ---- CUSTOMER · compute ------------------------------------------------------
  { file: "features/customer/pages/CreateInstance.tsx", route: "/app/instances/new", title: "Create instance", component: "CreateInstancePage" },
  { file: "features/customer/pages/instances/Overview.tsx", route: "/app/instances/:instanceId", title: "Instance overview", component: "InstanceOverviewPage" },
  { file: "features/customer/pages/instances/Metrics.tsx", route: "/app/instances/:instanceId/metrics", title: "Metrics", component: "InstanceMetricsPage" },
  { file: "features/customer/pages/instances/Console.tsx", route: "/app/instances/:instanceId/console", title: "Console", component: "InstanceConsolePage" },
  { file: "features/customer/pages/instances/Firewall.tsx", route: "/app/instances/:instanceId/firewall", title: "Instance firewall", component: "InstanceFirewallPage" },
  { file: "features/customer/pages/instances/Agent.tsx", route: "/app/instances/:instanceId/agent", title: "Guest agent", component: "InstanceAgentPage" },
  { file: "features/customer/pages/instances/Network.tsx", route: "/app/instances/:instanceId/network", title: "Instance network", component: "InstanceNetworkPage" },
  { file: "features/customer/pages/instances/NotesTags.tsx", route: "/app/instances/:instanceId/notes-tags", title: "Notes & tags", component: "InstanceNotesTagsPage" },
  { file: "features/customer/pages/instances/Snapshots.tsx", route: "/app/instances/:instanceId/snapshots", title: "Snapshots & restore", component: "InstanceSnapshotsPage" },
  // ---- CUSTOMER · billing / storage / catalog -----------------------------------
  { file: "features/customer/pages/Orders.tsx", route: "/app/orders", title: "Orders", component: "CustomerOrdersPage" },
  { file: "features/customer/pages/OrderDetail.tsx", route: "/app/orders/:orderId", title: "Order detail", component: "CustomerOrderDetailPage" },
  { file: "features/customer/pages/Invoices.tsx", route: "/app/invoices", title: "Invoices", component: "CustomerInvoicesPage" },
  { file: "features/customer/pages/InvoiceDetail.tsx", route: "/app/invoices/:invoiceId", title: "Invoice detail", component: "CustomerInvoiceDetailPage" },
  { file: "features/customer/pages/Subscriptions.tsx", route: "/app/subscriptions", title: "Subscriptions", component: "SubscriptionsPage" },
  { file: "features/customer/pages/ObjectStorage.tsx", route: "/app/storage", title: "Object storage", component: "ObjectStoragePage" },
  { file: "features/customer/pages/Catalog.tsx", route: "/app/catalog", title: "Catalog & pricing", component: "CatalogPage" },
  { file: "features/customer/pages/Topup.tsx", route: "/app/wallet/topup", title: "Wallet top-up", component: "TopupPage" },
  { file: "features/customer/pages/IsoDetail.tsx", route: "/app/iso/:isoId", title: "ISO detail", component: "IsoDetailPage" },
  // ---- CUSTOMER · account / org / support -----------------------------------------
  { file: "features/customer/pages/account/Profile.tsx", route: "/app/account/profile", title: "Account profile", component: "AccountProfilePage" },
  { file: "features/customer/pages/account/Security.tsx", route: "/app/account/security", title: "Account security", component: "AccountSecurityPage" },
  { file: "features/customer/pages/account/Addresses.tsx", route: "/app/account/addresses", title: "Addresses", component: "AccountAddressesPage" },
  { file: "features/customer/pages/account/ApiKeys.tsx", route: "/app/account/api-keys", title: "API keys", component: "ApiKeysPage" },
  { file: "features/customer/pages/account/SshKeys.tsx", route: "/app/account/ssh-keys", title: "SSH keys", component: "SshKeysPage" },
  { file: "features/customer/pages/StartupScripts.tsx", route: "/app/startup-scripts", title: "Startup scripts", component: "StartupScriptsPage" },
  { file: "features/customer/pages/account/Webhooks.tsx", route: "/app/account/webhooks", title: "Webhooks", component: "WebhooksPage" },
  { file: "features/customer/pages/account/Notifications.tsx", route: "/app/account/notifications", title: "Notifications", component: "NotificationsCenterPage" },
  { file: "features/customer/pages/account/AuditLogs.tsx", route: "/app/account/audit-logs", title: "Audit logs", component: "MyAuditLogsPage" },
  { file: "features/customer/pages/Organizations.tsx", route: "/app/organizations", title: "Organizations", component: "CustomerOrganizationsPage" },
  { file: "features/customer/pages/TicketDetail.tsx", route: "/app/tickets/:ticketId", title: "Ticket", component: "CustomerTicketThreadPage" },
]

let created = 0
let skipped = 0
for (const spec of PAGES) {
  const abs = join(root, "src", spec.file)
  if (existsSync(abs)) {
    skipped++
    continue
  }
  const params = [...spec.route.matchAll(/:(\w+)/g)].map((m) => m[1])
  const paramLines = params
    .map((p) => `  const ${p} = useParams().${p}`)
    .join("\n")
  const paramRender =
    params.length > 0
      ? `\n      <p className="text-sm text-muted-foreground">Route parameter${params.length > 1 ? "s" : ""}: ${params.map((p) => `{${p}}`).join(", ")}</p>`
      : ""
  const content = `import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"

export default function ${spec.component}() {
${paramLines}
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="${spec.title}" />
      <EmptyState
        message="This section has not been wired to the API yet."
        description="Implementation pending for route ${spec.route}."/>${paramRender}
    </div>
  )
}
`
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  created++
}

console.log(`created=${created} skipped=${skipped} total=${PAGES.length}`)
