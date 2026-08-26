import { lazy, Suspense } from "react"
import type { ReactNode } from "react"
import { Navigate, Route, Routes, Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { homePathFor, useAuth, type AppRole } from "@/lib/auth"

// ---- Lazy role layouts ------------------------------------------------------
const AdminLayout = lazy(() => import("@/features/admin/AdminLayout"))
const NocLayout = lazy(() => import("@/features/noc/NocLayout"))
const FinanceLayout = lazy(() => import("@/features/finance/FinanceLayout"))
const CustomerLayout = lazy(() => import("@/features/customer/CustomerLayout"))

// ---- Lazy pages: auth --------------------------------------------------------
const LoginPage = lazy(() => import("@/features/auth/LoginPage"))
const SignupPage = lazy(() => import("@/features/auth/SignupPage"))

// ---- Lazy pages: admin -------------------------------------------------------
const AdminDashboard = lazy(() => import("@/features/admin/pages/Dashboard"))
const AdminUsers = lazy(() => import("@/features/admin/pages/Users"))
const UserDetail = lazy(() => import("@/features/admin/pages/UserDetail"))
const Organizations = lazy(() => import("@/features/admin/pages/Organizations"))
const OrganizationDetail = lazy(() =>
  import("@/features/admin/pages/OrganizationDetail"),
)
const Orphans = lazy(() => import("@/features/admin/pages/Orphans"))
const AdminTickets = lazy(() => import("@/features/admin/pages/Tickets"))
const TicketThread = lazy(() => import("@/features/admin/pages/TicketThread"))
const AuditLogs = lazy(() => import("@/features/admin/pages/AuditLogs"))
const Security = lazy(() => import("@/features/admin/pages/Security"))
const SecurityIncidents = lazy(() =>
  import("@/features/admin/pages/security/Incidents"),
)
const BlockedNetworks = lazy(() =>
  import("@/features/admin/pages/security/BlockedNetworks"),
)
const FeatureFlags = lazy(() =>
  import("@/features/admin/pages/security/FeatureFlags"),
)
const AppSettings = lazy(() =>
  import("@/features/admin/pages/security/AppSettings"),
)

const AdminInstances = lazy(() => import("@/features/admin/pages/Instances"))
const AdminInstanceDetail = lazy(() =>
  import("@/features/admin/pages/InstanceDetail"),
)
const AdminJobs = lazy(() => import("@/features/admin/pages/Jobs"))
const AdminJobDetail = lazy(() => import("@/features/admin/pages/JobDetail"))
const Providers = lazy(() => import("@/features/admin/pages/Providers"))
const ProviderDetail = lazy(() =>
  import("@/features/admin/pages/providers/ProviderDetail"),
)
const ProviderNodes = lazy(() =>
  import("@/features/admin/pages/providers/Nodes"),
)
const ProviderNodeDetail = lazy(() =>
  import("@/features/admin/pages/providers/NodeDetail"),
)
const ProviderStorages = lazy(() =>
  import("@/features/admin/pages/providers/Storages"),
)
const ProviderBackupJobs = lazy(() =>
  import("@/features/admin/pages/providers/BackupJobs"),
)
const ProviderHa = lazy(() => import("@/features/admin/pages/providers/Ha"))
const ProviderFirewall = lazy(() =>
  import("@/features/admin/pages/providers/Firewall"),
)
const ProviderSdn = lazy(() => import("@/features/admin/pages/providers/Sdn"))
const ProviderCeph = lazy(() =>
  import("@/features/admin/pages/providers/Ceph"),
)
const ProviderContainers = lazy(() =>
  import("@/features/admin/pages/providers/Containers"),
)
const ProviderPools = lazy(() =>
  import("@/features/admin/pages/providers/Pools"),
)
const VmwareInventory = lazy(() =>
  import("@/features/admin/pages/providers/VmwareInventory"),
)
const GuestPerf = lazy(() =>
  import("@/features/admin/pages/providers/GuestPerf"),
)
const RegionsPools = lazy(() => import("@/features/admin/pages/RegionsPools"))
const StorageBackends = lazy(() =>
  import("@/features/admin/pages/StorageBackends"),
)
const StorageBackendDetail = lazy(() =>
  import("@/features/admin/pages/StorageBackendDetail"),
)
const DokployHub = lazy(() => import("@/features/admin/pages/DokployHub"))
const DokployEntity = lazy(() =>
  import("@/features/admin/pages/dokploy/DokployEntity"),
)

const BillingFinanceSummary = lazy(() =>
  import("@/features/admin/billing/pages/FinanceSummary"),
)
const BillingReports = lazy(() =>
  import("@/features/admin/billing/pages/Reports"),
)
const BillingOrders = lazy(() => import("@/features/admin/billing/pages/Orders"))
const BillingOrderDetail = lazy(() =>
  import("@/features/admin/billing/pages/OrderDetail"),
)
const BillingInvoices = lazy(() =>
  import("@/features/admin/billing/pages/Invoices"),
)
const BillingInvoiceDetail = lazy(() =>
  import("@/features/admin/billing/pages/InvoiceDetail"),
)
const BillingPayments = lazy(() =>
  import("@/features/admin/billing/pages/Payments"),
)
const BillingWallets = lazy(() =>
  import("@/features/admin/billing/pages/Wallets"),
)
const BillingOrgWallet = lazy(() =>
  import("@/features/admin/billing/pages/OrgWallet"),
)
const BillingCoupons = lazy(() =>
  import("@/features/admin/billing/pages/Coupons"),
)
const BillingCouponDetail = lazy(() =>
  import("@/features/admin/billing/pages/CouponDetail"),
)
const BillingProductsPlans = lazy(() =>
  import("@/features/admin/billing/pages/ProductsPlans"),
)
const BillingProductDetail = lazy(() =>
  import("@/features/admin/billing/pages/ProductDetail"),
)
const PlanPricesPage = lazy(() =>
  import("@/features/admin/billing/pages/PlanPrices"),
)
const BillingCustomRates = lazy(() =>
  import("@/features/admin/billing/pages/CustomRates"),
)
const AffiliateConfig = lazy(() =>
  import("@/features/admin/billing/pages/AffiliateConfig"),
)
const AffiliateSettings = lazy(() =>
  import("@/features/admin/pages/affiliate/AffiliateSettings"),
)
const AffiliateEarnings = lazy(() =>
  import("@/features/admin/pages/affiliate/AffiliateEarnings"),
)

// ---- Lazy pages: noc ----------------------------------------------------------
const NocDashboard = lazy(() => import("@/features/noc/pages/Dashboard"))
const NocInstances = lazy(() => import("@/features/noc/pages/Instances"))
const NocInstanceDetail = lazy(() =>
  import("@/features/noc/pages/InstanceDetail"),
)
const NocJobs = lazy(() => import("@/features/noc/pages/Jobs"))
const NocJobDetail = lazy(() => import("@/features/noc/pages/JobDetail"))
const NocProviders = lazy(() => import("@/features/noc/pages/Providers"))
const NocProviderDetail = lazy(() =>
  import("@/features/noc/pages/providers/ProviderDetail"),
)
const NocProviderCluster = lazy(() =>
  import("@/features/noc/pages/providers/Cluster"),
)
const NocProviderNodes = lazy(() =>
  import("@/features/noc/pages/providers/Nodes"),
)
const NocProviderNodeDetail = lazy(() =>
  import("@/features/noc/pages/providers/NodeDetail"),
)
const NocProviderStorages = lazy(() =>
  import("@/features/noc/pages/providers/Storages"),
)
const NocProviderBackupJobs = lazy(() =>
  import("@/features/noc/pages/providers/BackupJobs"),
)
const NocProviderFirewall = lazy(() =>
  import("@/features/noc/pages/providers/Firewall"),
)
const NocProviderServices = lazy(() =>
  import("@/features/noc/pages/providers/Services"),
)
const NocTickets = lazy(() => import("@/features/noc/pages/Tickets"))
const NocTicketThread = lazy(() => import("@/features/noc/pages/TicketThread"))
const NocSecurity = lazy(() => import("@/features/noc/pages/Security"))

// ---- Lazy pages: finance ------------------------------------------------------
const FinanceSummary = lazy(() => import("@/features/finance/pages/Summary"))
const FinanceReports = lazy(() => import("@/features/finance/pages/Reports"))
const FinanceOrders = lazy(() => import("@/features/finance/pages/Orders"))
const FinanceOrderDetail = lazy(() =>
  import("@/features/finance/pages/OrderDetail"),
)
const FinanceInvoices = lazy(() => import("@/features/finance/pages/Invoices"))
const FinanceInvoiceDetail = lazy(() =>
  import("@/features/finance/pages/InvoiceDetail"),
)
const FinancePayments = lazy(() => import("@/features/finance/pages/Payments"))
const FinanceWallets = lazy(() => import("@/features/finance/pages/Wallets"))
const FinanceOrgWallet = lazy(() =>
  import("@/features/finance/pages/OrgWallet"),
)
const FinanceCoupons = lazy(() => import("@/features/finance/pages/Coupons"))
const FinanceCouponDetail = lazy(() =>
  import("@/features/finance/pages/CouponDetail"),
)
const FinanceCatalog = lazy(() => import("@/features/finance/pages/Catalog"))
const FinanceRates = lazy(() => import("@/features/finance/pages/Rates"))
const FinanceRegions = lazy(() => import("@/features/finance/pages/Regions"))
const FinanceAffiliate = lazy(() =>
  import("@/features/finance/pages/Affiliate"),
)
const FinanceAffiliateSettings = lazy(() =>
  import("@/features/finance/pages/AffiliateSettings"),
)
const FinanceAffiliateEarnings = lazy(() =>
  import("@/features/finance/pages/AffiliateEarnings"),
)

// ---- Lazy pages: customer -----------------------------------------------------
const CustomerOverview = lazy(() => import("@/features/customer/pages/Overview"))
const CustomerInstances = lazy(() =>
  import("@/features/customer/pages/Instances"),
)
const CreateInstance = lazy(() =>
  import("@/features/customer/pages/CreateInstance"),
)
const InstanceOverview = lazy(() =>
  import("@/features/customer/pages/instances/Overview"),
)
const InstanceMetrics = lazy(() =>
  import("@/features/customer/pages/instances/Metrics"),
)
const InstanceConsole = lazy(() =>
  import("@/features/customer/pages/instances/Console"),
)
const InstanceFirewall = lazy(() =>
  import("@/features/customer/pages/instances/Firewall"),
)
const InstanceAgent = lazy(() =>
  import("@/features/customer/pages/instances/Agent"),
)
const InstanceNetworkPage = lazy(() =>
  import("@/features/customer/pages/instances/Network"),
)
const InstanceNotesTags = lazy(() =>
  import("@/features/customer/pages/instances/NotesTags"),
)
const InstanceSnapshots = lazy(() =>
  import("@/features/customer/pages/instances/Snapshots"),
)
const CustomerIso = lazy(() => import("@/features/customer/pages/Iso"))
const IsoDetail = lazy(() => import("@/features/customer/pages/IsoDetail"))
const CustomerBackups = lazy(() =>
  import("@/features/customer/pages/Backups"),
)
const CustomerNetwork = lazy(() =>
  import("@/features/customer/pages/Network"),
)
const ObjectStorage = lazy(() =>
  import("@/features/customer/pages/ObjectStorage"),
)
const CatalogPage = lazy(() => import("@/features/customer/pages/Catalog"))

const CustomerWallet = lazy(() => import("@/features/customer/pages/Wallet"))
const Topup = lazy(() => import("@/features/customer/pages/Topup"))
const CustomerOrders = lazy(() => import("@/features/customer/pages/Orders"))
const CustomerOrderDetail = lazy(() =>
  import("@/features/customer/pages/OrderDetail"),
)
const CustomerInvoices = lazy(() => import("@/features/customer/pages/Invoices"))
const CustomerInvoiceDetail = lazy(() =>
  import("@/features/customer/pages/InvoiceDetail"),
)
const Subscriptions = lazy(() =>
  import("@/features/customer/pages/Subscriptions"),
)

const CustomerAffiliate = lazy(() =>
  import("@/features/customer/pages/Affiliate"),
)

const CustomerTickets = lazy(() => import("@/features/customer/pages/Tickets"))
const CustomerTicketThread = lazy(() =>
  import("@/features/customer/pages/TicketDetail"),
)
const CustomerOrganizations = lazy(() =>
  import("@/features/customer/pages/Organizations"),
)
const NotificationsCenter = lazy(() =>
  import("@/features/customer/pages/account/Notifications"),
)
const AccountProfileHub = lazy(() =>
  import("@/features/customer/pages/Profile"),
)
const AccountProfile = lazy(() =>
  import("@/features/customer/pages/account/Profile"),
)
const AccountSecurity = lazy(() =>
  import("@/features/customer/pages/account/Security"),
)
const AccountAddresses = lazy(() =>
  import("@/features/customer/pages/account/Addresses"),
)
const ApiKeysPage = lazy(() =>
  import("@/features/customer/pages/account/ApiKeys"),
)
const SshKeysPage = lazy(() =>
  import("@/features/customer/pages/account/SshKeys"),
)
const StartupScripts = lazy(() =>
  import("@/features/customer/pages/StartupScripts"),
)
const Webhooks = lazy(() =>
  import("@/features/customer/pages/account/Webhooks"),
)
const MyAuditLogs = lazy(() =>
  import("@/features/customer/pages/account/AuditLogs"),
)

// ---- Guards -------------------------------------------------------------------

interface RequireRoleProps {
  allow?: AppRole
  children: ReactNode
}

/** Redirects to /login when signed out, or to the user's home on role mismatch. */
export function RequireRole({ allow, children }: RequireRoleProps) {
  const { token, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!token || !role) {
    return <Navigate to="/login" replace />
  }

  if (allow && role !== allow) {
    return <Navigate to={homePathFor(role)} replace />
  }

  return <>{children}</>
}

function RootRedirect() {
  const { token, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (token && role) {
    return <Navigate to={homePathFor(role)} replace />
  }
  return <Navigate to="/login" replace />
}

function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight">404</p>
      <p className="text-muted-foreground">The page you are looking for does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  )
}

// ---- Route tree ----------------------------------------------------------------

export default function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Spinner className="size-6" />
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route
          path="/admin"
          element={
            <RequireRole allow={"admin"}>
              <AdminLayout />
            </RequireRole>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:userId" element={<UserDetail />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="organizations/:orgId" element={<OrganizationDetail />} />
          <Route path="orphans" element={<Orphans />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="tickets/:ticketId" element={<TicketThread />} />
          <Route path="audit-logs" element={<AuditLogs />} />

          <Route path="security" element={<Security />} />
          <Route path="security/incidents" element={<SecurityIncidents />} />
          <Route path="security/blocked-networks" element={<BlockedNetworks />} />
          <Route path="security/feature-flags" element={<FeatureFlags />} />
          <Route path="security/app-settings" element={<AppSettings />} />

          <Route path="instances" element={<AdminInstances />} />
          <Route path="instances/:instanceId" element={<AdminInstanceDetail />} />
          <Route path="jobs" element={<AdminJobs />} />
          <Route path="jobs/:jobId" element={<AdminJobDetail />} />
          <Route path="providers" element={<Providers />} />
          <Route path="providers/:providerId" element={<ProviderDetail />} />
          <Route path="providers/:providerId/nodes" element={<ProviderNodes />} />
          <Route
            path="providers/:providerId/nodes/:node"
            element={<ProviderNodeDetail />}
          />
          <Route
            path="providers/:providerId/storages"
            element={<ProviderStorages />}
          />
          <Route
            path="providers/:providerId/backup-jobs"
            element={<ProviderBackupJobs />}
          />
          <Route path="providers/:providerId/ha" element={<ProviderHa />} />
          <Route
            path="providers/:providerId/firewall"
            element={<ProviderFirewall />}
          />
          <Route path="providers/:providerId/sdn" element={<ProviderSdn />} />
          <Route path="providers/:providerId/ceph" element={<ProviderCeph />} />
          <Route
            path="providers/:providerId/containers"
            element={<ProviderContainers />}
          />
          <Route path="providers/:providerId/pools" element={<ProviderPools />} />
          <Route
            path="providers/:providerId/inventory"
            element={<VmwareInventory />}
          />
          <Route path="providers/:providerId/perf" element={<GuestPerf />} />
          <Route path="regions-pools" element={<RegionsPools />} />
          <Route path="storage-backends" element={<StorageBackends />} />
          <Route
            path="storage-backends/:code"
            element={<StorageBackendDetail />}
          />
          <Route path="dokploy" element={<DokployHub />} />
          <Route path="dokploy/:entity" element={<DokployEntity />} />

          <Route path="billing/summary" element={<BillingFinanceSummary />} />
          <Route path="billing/reports" element={<BillingReports />} />
          <Route path="billing/orders" element={<BillingOrders />} />
          <Route path="billing/orders/:orderId" element={<BillingOrderDetail />} />
          <Route path="billing/invoices" element={<BillingInvoices />} />
          <Route
            path="billing/invoices/:invoiceId"
            element={<BillingInvoiceDetail />}
          />
          <Route path="billing/payments" element={<BillingPayments />} />
          <Route path="billing/wallets" element={<BillingWallets />} />
          <Route path="billing/wallets/:orgId" element={<BillingOrgWallet />} />
          <Route path="billing/coupons" element={<BillingCoupons />} />
          <Route
            path="billing/coupons/:couponId"
            element={<BillingCouponDetail />}
          />
          <Route path="billing/products-plans" element={<BillingProductsPlans />} />
          <Route
            path="billing/products/:productId"
            element={<BillingProductDetail />}
          />
          <Route path="billing/plans/:planId" element={<PlanPricesPage />} />
          <Route path="billing/custom-rates" element={<BillingCustomRates />} />
          <Route
            path="billing/affiliate-config"
            element={<AffiliateConfig />}
          />
          <Route path="affiliate/settings" element={<AffiliateSettings />} />
          <Route path="affiliate/earnings" element={<AffiliateEarnings />} />
        </Route>

        <Route
          path="/noc"
          element={
            <RequireRole allow={"noc"}>
              <NocLayout />
            </RequireRole>
          }
        >
          <Route index element={<NocDashboard />} />
          <Route path="instances" element={<NocInstances />} />
          <Route path="instances/:instanceId" element={<NocInstanceDetail />} />
          <Route path="jobs" element={<NocJobs />} />
          <Route path="jobs/:jobId" element={<NocJobDetail />} />
          <Route path="providers" element={<NocProviders />} />
          <Route path="providers/:providerId" element={<NocProviderDetail />} />
          <Route
            path="providers/:providerId/cluster"
            element={<NocProviderCluster />}
          />
          <Route
            path="providers/:providerId/nodes"
            element={<NocProviderNodes />}
          />
          <Route
            path="providers/:providerId/nodes/:node"
            element={<NocProviderNodeDetail />}
          />
          <Route
            path="providers/:providerId/storages"
            element={<NocProviderStorages />}
          />
          <Route
            path="providers/:providerId/backup-jobs"
            element={<NocProviderBackupJobs />}
          />
          <Route
            path="providers/:providerId/firewall"
            element={<NocProviderFirewall />}
          />
          <Route
            path="providers/:providerId/services"
            element={<NocProviderServices />}
          />
          <Route path="tickets" element={<NocTickets />} />
          <Route path="tickets/:ticketId" element={<NocTicketThread />} />
          <Route path="security" element={<NocSecurity />} />
        </Route>

        <Route
          path="/finance"
          element={
            <RequireRole allow={"finance"}>
              <FinanceLayout />
            </RequireRole>
          }
        >
          <Route index element={<FinanceSummary />} />
          <Route path="reports" element={<FinanceReports />} />
          <Route path="orders" element={<FinanceOrders />} />
          <Route path="orders/:orderId" element={<FinanceOrderDetail />} />
          <Route path="invoices" element={<FinanceInvoices />} />
          <Route path="invoices/:invoiceId" element={<FinanceInvoiceDetail />} />
          <Route path="payments" element={<FinancePayments />} />
          <Route path="wallets" element={<FinanceWallets />} />
          <Route path="wallets/:orgId" element={<FinanceOrgWallet />} />
          <Route path="coupons" element={<FinanceCoupons />} />
          <Route path="coupons/:couponId" element={<FinanceCouponDetail />} />
          <Route path="catalog" element={<FinanceCatalog />} />
          <Route path="rates" element={<FinanceRates />} />
          <Route path="regions" element={<FinanceRegions />} />
          <Route path="affiliate" element={<FinanceAffiliate />} />
          <Route
            path="affiliate/settings"
            element={<FinanceAffiliateSettings />}
          />
          <Route
            path="affiliate/earnings"
            element={<FinanceAffiliateEarnings />}
          />
        </Route>

        <Route
          path="/app"
          element={
            <RequireRole>
              <CustomerLayout />
            </RequireRole>
          }
        >
          <Route index element={<CustomerOverview />} />
          <Route path="instances" element={<CustomerInstances />} />
          <Route path="instances/new" element={<CreateInstance />} />
          <Route path="instances/:instanceId" element={<InstanceOverview />} />
          <Route
            path="instances/:instanceId/metrics"
            element={<InstanceMetrics />}
          />
          <Route
            path="instances/:instanceId/console"
            element={<InstanceConsole />}
          />
          <Route
            path="instances/:instanceId/firewall"
            element={<InstanceFirewall />}
          />
          <Route
            path="instances/:instanceId/agent"
            element={<InstanceAgent />}
          />
          <Route
            path="instances/:instanceId/network"
            element={<InstanceNetworkPage />}
          />
          <Route
            path="instances/:instanceId/notes-tags"
            element={<InstanceNotesTags />}
          />
          <Route
            path="instances/:instanceId/snapshots"
            element={<InstanceSnapshots />}
          />
          <Route path="iso" element={<CustomerIso />} />
          <Route path="iso/:isoId" element={<IsoDetail />} />
          <Route path="backups" element={<CustomerBackups />} />
          <Route path="network" element={<CustomerNetwork />} />
          <Route path="storage" element={<ObjectStorage />} />
          <Route path="catalog" element={<CatalogPage />} />

          <Route path="wallet" element={<CustomerWallet />} />
          <Route path="wallet/topup" element={<Topup />} />
          <Route path="orders" element={<CustomerOrders />} />
          <Route path="orders/:orderId" element={<CustomerOrderDetail />} />
          <Route path="invoices" element={<CustomerInvoices />} />
          <Route path="invoices/:invoiceId" element={<CustomerInvoiceDetail />} />
          <Route path="subscriptions" element={<Subscriptions />} />

          <Route path="affiliate" element={<CustomerAffiliate />} />

          <Route path="tickets" element={<CustomerTickets />} />
          <Route path="tickets/:ticketId" element={<CustomerTicketThread />} />
          <Route path="organizations" element={<CustomerOrganizations />} />

          <Route path="account/notifications" element={<NotificationsCenter />} />
          <Route path="profile" element={<AccountProfileHub />} />
          <Route path="account/profile" element={<AccountProfile />} />
          <Route path="account/security" element={<AccountSecurity />} />
          <Route path="account/addresses" element={<AccountAddresses />} />
          <Route path="account/api-keys" element={<ApiKeysPage />} />
          <Route path="account/ssh-keys" element={<SshKeysPage />} />
          <Route path="startup-scripts" element={<StartupScripts />} />
          <Route path="account/webhooks" element={<Webhooks />} />
          <Route path="account/audit-logs" element={<MyAuditLogs />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
