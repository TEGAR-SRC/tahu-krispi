import { lazy, Suspense, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Navigate, Route, Routes, Link, useLocation, useParams } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { homePathFor, useAuth, type AppRole } from "@/lib/auth"

// ---- Lazy role layouts ------------------------------------------------------
const AdminLayout = lazy(() => import("@/features/admin/AdminLayout"))
const NocLayout = lazy(() => import("@/features/noc/NocLayout"))
const FinanceLayout = lazy(() => import("@/features/finance/FinanceLayout"))

// ---- Lazy pages: auth (only OAuthCallback is served locally; the rest
// redirect to the standalone auth console) -----------------------------------
const OAuthCallbackPage = lazy(() =>
  import("@/features/auth/OAuthCallbackPage"),
)

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
const LandingContent = lazy(() => import("@/features/admin/pages/Landing"))
const DocsPage = lazy(() => import("@/features/admin/pages/Docs"))
const BlogPage = lazy(() => import("@/features/admin/pages/Blog"))
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
const ProxmoxClonePage = lazy(() => import("@/features/proxmox/ProxmoxClonePage"))
const ProxmoxNodeReportPage = lazy(() => import("@/features/proxmox/ProxmoxNodeReportPage"))
const ProxmoxNodeTimePage = lazy(() => import("@/features/proxmox/ProxmoxNodeTimePage"))
const ProxmoxPrunePage = lazy(() => import("@/features/proxmox/ProxmoxPrunePage"))
const ProxmoxCertsUploadPage = lazy(() => import("@/features/proxmox/ProxmoxCertsUploadPage"))
const ProxmoxPoolsPage = lazy(() => import("@/features/proxmox/ProxmoxPoolsPage"))
const ProxmoxQemuPerNodePage = lazy(() => import("@/features/proxmox/ProxmoxQemuPerNodePage"))
const ProxmoxRrdPage = lazy(() => import("@/features/proxmox/ProxmoxRrdPage"))
const ProxmoxRrdPerVmPage = lazy(() => import("@/features/proxmox/ProxmoxRrdPerVmPage"))
const ProxmoxCloudInitPage = lazy(() => import("@/features/proxmox/ProxmoxCloudInitPage"))
const ProxmoxDiagnosticsPage = lazy(() => import("@/features/proxmox/ProxmoxDiagnosticsPage"))
const ProxmoxAccessPage = lazy(() => import("@/features/proxmox/ProxmoxAccessPage"))
const ProxmoxTemplatesPage = lazy(() => import("@/features/proxmox/ProxmoxTemplatesPage"))
const ProxmoxSnapshotsPage = lazy(() => import("@/features/proxmox/ProxmoxSnapshotsPage"))
const ProxmoxQemuSnapshotPage = lazy(() => import("@/features/proxmox/ProxmoxQemuSnapshotPage"))
const LxcMigratePage = lazy(() => import("@/features/proxmox/LxcMigratePage"))
const ProxmoxQemuConfigPage = lazy(() => import("@/features/proxmox/ProxmoxQemuConfigPage"))
const ProxmoxQemuTagsPage = lazy(() => import("@/features/proxmox/ProxmoxQemuTagsPage"))
const ProxmoxQemuNotesPage = lazy(() => import("@/features/proxmox/ProxmoxQemuNotesPage"))
const ProxmoxFwAliasesPage = lazy(() => import("@/features/proxmox/ProxmoxFwAliasesPage"))
const ProxmoxSerialProxyPage = lazy(() => import("@/features/proxmox/ProxmoxSerialProxyPage"))
const ProxmoxQemuResetPage = lazy(() => import("@/features/proxmox/ProxmoxQemuResetPage"))
const ProxmoxQemuResumePage = lazy(() => import("@/features/proxmox/ProxmoxQemuResumePage"))
const ProxmoxQemuPausePage = lazy(() => import("@/features/proxmox/ProxmoxQemuPausePage"))
const ProxmoxQemuHibernatePage = lazy(() => import("@/features/proxmox/ProxmoxQemuHibernatePage"))
const ProxmoxQemuMigratePage = lazy(() => import("@/features/proxmox/ProxmoxQemuMigratePage"))
const ProxmoxQemuFirewallPage = lazy(() => import("@/features/proxmox/ProxmoxQemuFirewallPage"))
const ProxmoxQemuAgentPage = lazy(() => import("@/features/proxmox/ProxmoxQemuAgentPage"))
const ProxmoxReplicationPage = lazy(() => import("@/features/proxmox/ProxmoxReplicationPage"))
const ProxmoxHaManagerStatusPage = lazy(() => import("@/features/proxmox/ProxmoxHaManagerStatusPage"))
const ProxmoxHaMigratePage = lazy(() => import("@/features/proxmox/ProxmoxHaMigratePage"))
const ProxmoxDisksPage = lazy(() => import("@/features/proxmox/ProxmoxDisksPage"))
const ProxmoxAclPage = lazy(() => import("@/features/proxmox/ProxmoxAclPage"))
const ProxmoxCephPoolDetailPage = lazy(() => import("@/features/proxmox/ProxmoxCephPoolDetailPage"))
const OnidelCatalog = lazy(() =>
  import("@/features/admin/pages/providers/OnidelCatalog"),
)
const CreateLxcPage = lazy(() =>
  import("@/features/admin/pages/providers/CreateLxcPage"),
)
const CreateVmPage = lazy(() =>
  import("@/features/admin/pages/providers/CreateVmPage"),
)
const CreateOnidelVmPage = lazy(() =>
  import("@/features/admin/pages/providers/CreateOnidelVmPage"),
)
const CreateVmwarePage = lazy(() =>
  import("@/features/admin/pages/providers/CreateVmwarePage"),
)
const VmwareMigratePage = lazy(() => import("@/features/vmware/VmwareMigratePage"))
const VmwareDatastoresPage = lazy(() => import("@/features/vmware/VmwareDatastoresPage"))
const VmwareDatastoreDetailPage = lazy(() => import("@/features/vmware/VmwareDatastoreDetailPage"))
const VmwareDatastoreBrowsePage = lazy(() => import("@/features/vmware/VmwareDatastoreBrowsePage"))
const VmwareHostsPage = lazy(() => import("@/features/vmware/VmwareHostsPage"))
const VmwareHostDetailPage = lazy(() => import("@/features/vmware/VmwareHostDetailPage"))
const VmwareClusterDetailPage = lazy(() => import("@/features/vmware/VmwareClusterDetailPage"))
const VmwarePoolDetailPage = lazy(() => import("@/features/vmware/VmwarePoolDetailPage"))
const VmwarePerfPage = lazy(() => import("@/features/vmware/VmwarePerfPage"))
const VmwarePerfDetailPage = lazy(() => import("@/features/vmware/VmwarePerfDetailPage"))
const VmwareSnapshotPage = lazy(() => import("@/features/vmware/VmwareSnapshotPage"))
const VmwareSnapshotRevertPage = lazy(() => import("@/features/vmware/VmwareSnapshotRevertPage"))
const VmwareNetworksPage = lazy(() => import("@/features/vmware/VmwareNetworksPage"))
const OnidelCreateChoices = lazy(() => import("@/features/onidel/OnidelCreateChoicesPage"))
const OnidelJobs = lazy(() =>
  import("@/features/onidel/OnidelJobsPage"),
)
const OnidelWallet = lazy(() =>
  import("@/features/onidel/OnidelWalletPage"),
)
const OnidelHealthDetail = lazy(() =>
  import("@/features/onidel/OnidelHealthDetailPage"),
)
const OnidelInstances = lazy(() => import("@/features/onidel/OnidelInstancesPage")
)
const OnidelInstanceDetail = lazy(() => import("@/features/onidel/OnidelInstanceDetailPage")
)
const OnidelBillingSync = lazy(() => import("@/features/onidel/OnidelBillingSyncPage"))
const OnidelOrders = lazy(() => import("@/features/onidel/OnidelOrdersPage"))
const OnidelInvoices = lazy(() => import("@/features/onidel/OnidelInvoicesPage"))
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
const DokployLogsPage = lazy(() => import("@/features/dokploy/DokployLogsPage"))
const DokployLogsRealtimePage = lazy(() => import("@/features/dokploy/DokployLogsRealtimePage"))
const DokployProjectDetailPage = lazy(() => import("@/features/dokploy/DokployProjectDetailPage"))

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
const FinanceCustomRatesHistory = lazy(() => import("@/features/finance/pages/FinanceCustomRatesHistoryPage"))
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

// ---- Lazy pages: wave 3 --------------------------------------------------------
const StaffProfile = lazy(() => import("@/features/staff-account/ProfilePage"))
const StaffSecurity = lazy(() =>
  import("@/features/staff-account/SecurityPage"),
)
const StaffApiKeys = lazy(() =>
  import("@/features/staff-account/ApiKeysPage"),
)
const StaffNotifications = lazy(() =>
  import("@/features/staff-account/NotificationsPage"),
)

const DokployProjectConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/ProjectConsole"),
)
const DokployApplicationConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/ApplicationConsole"),
)
const DokployDatabaseConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/DatabaseConsole"),
)
const DokployDomainConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/DomainConsole"),
)
const DokployDeploymentConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/DeploymentConsole"),
)
const DokployCertificateConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/CertificateConsole"),
)
const DokployRegistryConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/RegistryConsole"),
)
const DokployServerConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/ServerConsole"),
)
const DokploySshKeyConsole = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/SshKeyConsole"),
)

const JobsQueueBoard = lazy(() =>
  import("@/features/admin/pages/JobsQueueBoard"),
)
const InstancesStateBoard = lazy(() =>
  import("@/features/admin/pages/InstancesStateBoard"),
)

// ---- Lazy pages: wave 4 — Dokploy parity --------------------------------------
const DokployHome = lazy(() => import("@/features/admin/pages/dokploy/app/Home"))
const DokployProjects = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Projects"),
)
const DokployEnvironmentBoard = lazy(() =>
  import("@/features/admin/pages/dokploy/app/EnvironmentBoard"),
)
const DokployOverview = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Overview"),
)
const DokployDockerPage = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Docker"),
)
const DokployMonitoring = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Monitoring"),
)
const DokployRequests = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Requests"),
)
const DokploySchedules = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Schedules"),
)
const DokployTraefik = lazy(() =>
  import("@/features/admin/pages/dokploy/app/Traefik"),
)
const DokployApplicationService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/ApplicationService"),
)
const DokployComposeService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/ComposeService"),
)
const DokployPostgresService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/PostgresService"),
)
const DokployMysqlService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/MysqlService"),
)
const DokployMariadbService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/MariadbService"),
)
const DokployMongoService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/MongoService"),
)
const DokployRedisService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/RedisService"),
)
const DokployLibsqlService = lazy(() =>
  import("@/features/admin/pages/dokploy/app/services/LibsqlService"),
)
const DokploySettingsProfile = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Profile"),
)
const DokploySettingsUsers = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Users"),
)
const DokploySettingsSessions = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Sessions"),
)
const DokploySettingsSshKeys = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/SshKeys"),
)
const DokploySettingsGitProviders = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/GitProviders"),
)
const DokploySettingsRegistry = lazy(() =>
  import("@/features/admin/pages/dokploy/manager/RegistryConsole"),
)
const DokploySettingsNotifications = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Notifications"),
)
const DokploySettingsDestinations = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Destinations"),
)
const DokploySettingsCertificates = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Certificates"),
)
const DokploySettingsTags = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Tags"),
)
const DokploySettingsServerLocal = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/ServerLocal"),
)
const DokploySettingsServers = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Servers"),
)
const DokploySettingsDeploymentsCfg = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/DeploymentsCfg"),
)
const DokploySettingsSecrets = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Secrets"),
)
const DokploySettingsDns = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Dns"),
)
const DokploySettingsAuditLogs = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/AuditLogs"),
)
const DokploySettingsAi = lazy(() =>
  import("@/features/admin/pages/dokploy/app/settings/Ai"),
)
const DokployCloudOnly = lazy(() =>
  import("@/features/admin/pages/dokploy/app/CloudOnly"),
)

// ---- Auth is hosted on the standalone auth console (auth.kilat-cloud.com) ----
const AUTH_BASE =
  (import.meta.env.VITE_AUTH_CONSOLE_URL as string) || "https://auth.kilat-cloud.com"

/** Hard-redirect a legacy auth route to the auth console, preserving query. */
function AuthRedirect({ path }: { path: string }) {
  useEffect(() => {
    window.location.replace(`${AUTH_BASE}${path}${window.location.search}`)
  }, [path])
  return null
}

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

// ---- Legacy /admin/providers/:id/* -> per-provider redirect ---------------------

type ProviderKind = "proxmox" | "onidel" | "vmware" | "dokploy" | string

const LEGACY_SUFFIX_TO_NEW: Array<{ match: (s: string) => boolean; build: (id: string, suffix: string) => string }> = [
  { match: (s) => s === "" || s === "/", build: (id) => `/admin/proxmox/${id}` },
  { match: (s) => s.startsWith("/nodes"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/storages"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/backup-jobs"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s === "/ha" || s.startsWith("/ha/"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/firewall"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/sdn"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/ceph"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/containers"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/pools"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/access"), build: (id, s) => `/admin/proxmox/${id}${s}` },
  { match: (s) => s.startsWith("/inventory"), build: (id) => `/admin/vmware/${id}/inventory` },
  { match: (s) => s.startsWith("/onidel"), build: (id) => `/admin/onidel/${id}/onidel` },
  { match: (s) => s.startsWith("/perf"), build: (id, s) => `/admin/proxmox/${id}${s}` },
]

function legacyTarget(providerId: string, suffix: string, kind?: ProviderKind): string {
  if (kind === "onidel") {
    if (suffix === "" || suffix === "/") return `/admin/onidel/${providerId}/onidel`
    return `/admin/onidel/${providerId}${suffix}`
  }
  if (kind === "vmware") {
    if (suffix === "" || suffix === "/") return `/admin/vmware/${providerId}/inventory`
    return `/admin/vmware/${providerId}${suffix}`
  }
  if (kind === "dokploy") {
    if (suffix === "" || suffix === "/") return `/admin/dokploy`
    return `/admin/dokploy${suffix}`
  }
  if (kind === "proxmox") {
    if (suffix === "" || suffix === "/") return `/admin/proxmox/${providerId}`
    return `/admin/proxmox/${providerId}${suffix}`
  }
  for (const rule of LEGACY_SUFFIX_TO_NEW) {
    if (rule.match(suffix)) return rule.build(providerId, suffix)
  }
  return `/admin/proxmox/${providerId}`
}

function LegacyProviderRedirect() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const location = useLocation()
  const prefix = `/admin/providers/${providerId}`
  let suffix = location.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length) : ""
  if (suffix === "") suffix = "/"
  const search = location.search ?? ""
  const [kind, setKind] = useState<ProviderKind | undefined>(undefined)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<Array<{ id: string; kind: string }>>("/admin/providers")
      .then((env) => {
        if (cancelled) return
        const row = Array.isArray(env.data) ? env.data.find((r) => r.id === providerId) : undefined
        if (row?.kind) setKind(row.kind)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return <Navigate to={`${legacyTarget(providerId, suffix, kind)}${search}`} replace />
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
        <Route path="/login" element={<AuthRedirect path="/login" />} />
        <Route path="/signup" element={<AuthRedirect path="/signup" />} />
        <Route path="/forgot-password" element={<AuthRedirect path="/forgot-password" />} />
        <Route path="/reset-password" element={<AuthRedirect path="/reset-password" />} />
        <Route path="/verify-email" element={<AuthRedirect path="/verify-email" />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/terms" element={<AuthRedirect path="/terms" />} />
        <Route path="/privacy" element={<AuthRedirect path="/privacy" />} />

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
          <Route path="landing" element={<LandingContent />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="blog" element={<BlogPage />} />

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
          {/* Legacy universal /admin/providers/:id/* -> per-provider redirect */}
          <Route path="providers/:providerId/*" element={<LegacyProviderRedirect />} />

          {/* Per-provider trees: proxmox / onidel / vmware are prefix-isolated */}
          <Route path="proxmox/:providerId" element={<ProviderDetail />} />
          <Route path="proxmox/:providerId/nodes" element={<ProviderNodes />} />
          <Route path="proxmox/:providerId/nodes/:node" element={<ProviderNodeDetail />} />
          <Route path="proxmox/:providerId/nodes/:node/report" element={<ProxmoxNodeReportPage />} />
          <Route path="proxmox/:providerId/nodes/:node/time" element={<ProxmoxNodeTimePage />} />
          <Route path="proxmox/:providerId/nodes/:node/certs" element={<ProxmoxCertsUploadPage />} />
          <Route path="proxmox/:providerId/nodes/:node/prune" element={<ProxmoxPrunePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu" element={<ProxmoxQemuPerNodePage />} />
          <Route path="proxmox/:providerId/nodes/:node/disks" element={<ProxmoxDisksPage />} />
          <Route path="proxmox/:providerId/storages" element={<ProviderStorages />} />
          <Route path="proxmox/:providerId/backup-jobs" element={<ProviderBackupJobs />} />
          <Route path="proxmox/:providerId/ha" element={<ProviderHa />} />
          <Route path="proxmox/:providerId/firewall" element={<ProviderFirewall />} />
          <Route path="proxmox/:providerId/sdn" element={<ProviderSdn />} />
          <Route path="proxmox/:providerId/ceph" element={<ProviderCeph />} />
          <Route path="proxmox/:providerId/containers" element={<ProviderContainers />} />
          <Route path="proxmox/:providerId/containers/new" element={<CreateLxcPage />} />
          <Route path="proxmox/:providerId/vms/new" element={<CreateVmPage />} />
          <Route path="proxmox/:providerId/pools" element={<ProviderPools />} />
          <Route path="proxmox/:providerId/pools/:pool" element={<ProxmoxPoolsPage />} />
          <Route path="proxmox/:providerId/perf" element={<GuestPerf />} />
          <Route path="proxmox/:providerId/nodes/:node/rrd" element={<ProxmoxRrdPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/rrd" element={<ProxmoxRrdPerVmPage />} />
          <Route path="proxmox/:providerId/clone" element={<ProxmoxClonePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/cloud-init" element={<ProxmoxCloudInitPage />} />
          <Route path="proxmox/:providerId/diagnostics" element={<ProxmoxDiagnosticsPage />} />
          <Route path="proxmox/:providerId/access" element={<ProxmoxAccessPage />} />
          <Route path="proxmox/:providerId/templates" element={<ProxmoxTemplatesPage />} />
          <Route path="proxmox/:providerId/snapshots" element={<ProxmoxSnapshotsPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/snapshot" element={<ProxmoxQemuSnapshotPage />} />
          <Route path="proxmox/:providerId/nodes/:node/lxc/:vmid/migrate" element={<LxcMigratePage />} />
          <Route path="proxmox/:providerId/nodes/:node/serial-proxy" element={<ProxmoxSerialProxyPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/config" element={<ProxmoxQemuConfigPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/tags" element={<ProxmoxQemuTagsPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/notes" element={<ProxmoxQemuNotesPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/reset" element={<ProxmoxQemuResetPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/resume" element={<ProxmoxQemuResumePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/pause" element={<ProxmoxQemuPausePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/hibernate" element={<ProxmoxQemuHibernatePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/migrate" element={<ProxmoxQemuMigratePage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/firewall" element={<ProxmoxQemuFirewallPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/agent" element={<ProxmoxQemuAgentPage />} />
          <Route path="proxmox/:providerId/nodes/:node/qemu/:vmid/agent/*" element={<ProxmoxQemuAgentPage />} />
          <Route path="proxmox/:providerId/replication" element={<ProxmoxReplicationPage />} />
          <Route path="proxmox/:providerId/ha-resources/:sid/migrate" element={<ProxmoxHaMigratePage />} />
          <Route path="proxmox/:providerId/ha/manager-status" element={<ProxmoxHaManagerStatusPage />} />
          <Route path="proxmox/:providerId/fw-aliases" element={<ProxmoxFwAliasesPage />} />
          <Route path="proxmox/:providerId/access/acl" element={<ProxmoxAclPage />} />
          <Route path="proxmox/:providerId/ceph/pools/:pool" element={<ProxmoxCephPoolDetailPage />} />

          <Route path="onidel/:providerId/onidel" element={<OnidelCatalog />} />
          <Route path="onidel/:providerId/jobs" element={<OnidelJobs />} />
          <Route path="onidel/:providerId/wallets" element={<OnidelWallet />} />
          <Route path="onidel/:providerId/create" element={<CreateOnidelVmPage />} />
          <Route path="onidel/:providerId/create-choices" element={<OnidelCreateChoices />} />
          <Route path="onidel/:providerId/health/detail" element={<OnidelHealthDetail />} />
          <Route path="onidel/:providerId/instances" element={<OnidelInstances />} />
          <Route path="onidel/:providerId/instances/:instanceId" element={<OnidelInstanceDetail />} />
          <Route path="onidel/:providerId/orders" element={<OnidelOrders />} />
          <Route path="onidel/:providerId/invoices" element={<OnidelInvoices />} />
          <Route path="onidel/:providerId/regions/sync" element={<OnidelBillingSync />} />

          <Route path="vmware/:providerId/inventory" element={<VmwareInventory />} />
          <Route path="vmware/:providerId/datastores" element={<VmwareDatastoresPage />} />
          <Route path="vmware/:providerId/datastores/:ds/browse" element={<VmwareDatastoreBrowsePage />} />
          <Route path="vmware/:providerId/datastores/:ds" element={<VmwareDatastoreDetailPage />} />
          <Route path="vmware/:providerId/hosts" element={<VmwareHostsPage />} />
          <Route path="vmware/:providerId/hosts/:host" element={<VmwareHostDetailPage />} />
          <Route path="vmware/:providerId/clusters/:cluster" element={<VmwareClusterDetailPage />} />
          <Route path="vmware/:providerId/pools/:pool" element={<VmwarePoolDetailPage />} />
          <Route path="vmware/:providerId/perf" element={<VmwarePerfPage />} />
          <Route path="vmware/:providerId/perf/:vmid" element={<VmwarePerfDetailPage />} />
          <Route path="vmware/:providerId/snapshots" element={<VmwareSnapshotPage />} />
          <Route path="vmware/:providerId/snapshots/revert" element={<VmwareSnapshotRevertPage />} />
          <Route path="vmware/:providerId/snapshots/:snap/revert" element={<VmwareSnapshotRevertPage />} />
          <Route path="vmware/:providerId/migrate" element={<VmwareMigratePage />} />
          <Route path="vmware/:providerId/networks" element={<VmwareNetworksPage />} />
          <Route path="vmware/:providerId/create" element={<CreateVmwarePage />} />

          {/* Dokploy is its own tree: /admin/dokploy/* (kept below) */}

          <Route path="regions-pools" element={<RegionsPools />} />
          <Route path="storage-backends" element={<StorageBackends />} />
          <Route
            path="storage-backends/:code"
            element={<StorageBackendDetail />}
          />
          <Route path="dokploy" element={<DokployHub />} />
          <Route path="dokploy/logs" element={<DokployLogsPage />} />
          <Route path="dokploy/logs-realtime" element={<DokployLogsRealtimePage />} />
          <Route path="dokploy/projects/:id" element={<DokployProjectDetailPage />} />
          <Route path="dokploy/:entity" element={<DokployEntity />} />

          <Route path="dokploy/app" element={<DokployHome />} />
          <Route path="dokploy/app/home" element={<DokployHome />} />
          <Route path="dokploy/app/projects" element={<DokployProjects />} />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId"
            element={<DokployEnvironmentBoard />}
          />
          <Route path="dokploy/app/overview" element={<DokployOverview />} />
          <Route
            path="dokploy/app/deployments"
            element={<Navigate to="/admin/dokploy/app/overview?tab=deployments" replace />}
          />
          <Route path="dokploy/app/docker" element={<DokployDockerPage />} />
          <Route
            path="dokploy/app/networks"
            element={<Navigate to="/admin/dokploy/app/docker?tab=networks" replace />}
          />
          <Route
            path="dokploy/app/swarm"
            element={<Navigate to="/admin/dokploy/app/docker?tab=swarm" replace />}
          />
          <Route
            path="dokploy/app/monitoring"
            element={<DokployMonitoring />}
          />
          <Route path="dokploy/app/requests" element={<DokployRequests />} />
          <Route path="dokploy/app/schedules" element={<DokploySchedules />} />
          <Route path="dokploy/app/traefik" element={<DokployTraefik />} />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/application/:applicationId"
            element={<DokployApplicationService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/compose/:composeId"
            element={<DokployComposeService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/postgres/:serviceId"
            element={<DokployPostgresService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/mysql/:serviceId"
            element={<DokployMysqlService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/mariadb/:serviceId"
            element={<DokployMariadbService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/mongo/:serviceId"
            element={<DokployMongoService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/redis/:serviceId"
            element={<DokployRedisService />}
          />
          <Route
            path="dokploy/app/p/:projectId/e/:environmentId/services/libsql/:serviceId"
            element={<DokployLibsqlService />}
          />

          <Route
            path="dokploy/app/settings/profile"
            element={<DokploySettingsProfile />}
          />
          <Route
            path="dokploy/app/settings/users"
            element={<DokploySettingsUsers />}
          />
          <Route
            path="dokploy/app/settings/sessions"
            element={<DokploySettingsSessions />}
          />
          <Route
            path="dokploy/app/settings/ssh-keys"
            element={<DokploySettingsSshKeys />}
          />
          <Route
            path="dokploy/app/settings/git-providers"
            element={<DokploySettingsGitProviders />}
          />
          <Route
            path="dokploy/app/settings/registry"
            element={<DokploySettingsRegistry />}
          />
          <Route
            path="dokploy/app/settings/notifications"
            element={<DokploySettingsNotifications />}
          />
          <Route
            path="dokploy/app/settings/destinations"
            element={<DokploySettingsDestinations />}
          />
          <Route
            path="dokploy/app/settings/certificates"
            element={<DokploySettingsCertificates />}
          />
          <Route
            path="dokploy/app/settings/tags"
            element={<DokploySettingsTags />}
          />
          <Route
            path="dokploy/app/settings/server"
            element={<DokploySettingsServerLocal />}
          />
          <Route
            path="dokploy/app/settings/servers"
            element={<DokploySettingsServers />}
          />
          <Route
            path="dokploy/app/settings/deployments"
            element={<DokploySettingsDeploymentsCfg />}
          />
          <Route
            path="dokploy/app/settings/secrets"
            element={<DokploySettingsSecrets />}
          />
          <Route
            path="dokploy/app/settings/dns"
            element={<DokploySettingsDns />}
          />
          <Route
            path="dokploy/app/settings/audit-logs"
            element={<DokploySettingsAuditLogs />}
          />
          <Route path="dokploy/app/settings/ai" element={<DokploySettingsAi />} />
          <Route
            path="dokploy/app/cloud/billing"
            element={<DokployCloudOnly />}
          />
          <Route
            path="dokploy/app/cloud/invoices"
            element={<DokployCloudOnly />}
          />
          <Route
            path="dokploy/app/cloud/license"
            element={<DokployCloudOnly />}
          />
          <Route path="dokploy/app/cloud/sso" element={<DokployCloudOnly />} />
          <Route
            path="dokploy/app/cloud/whitelabeling"
            element={<DokployCloudOnly />}
          />

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

          <Route path="account/profile" element={<StaffProfile />} />
          <Route path="account/security" element={<StaffSecurity />} />
          <Route path="account/api-keys" element={<StaffApiKeys />} />
          <Route path="account/notifications" element={<StaffNotifications />} />

          <Route
            path="dokploy/manager/project"
            element={<DokployProjectConsole />}
          />
          <Route
            path="dokploy/manager/application"
            element={<DokployApplicationConsole />}
          />
          <Route
            path="dokploy/manager/database"
            element={<DokployDatabaseConsole />}
          />
          <Route
            path="dokploy/manager/domain"
            element={<DokployDomainConsole />}
          />
          <Route
            path="dokploy/manager/deployment"
            element={<DokployDeploymentConsole />}
          />
          <Route
            path="dokploy/manager/certificate"
            element={<DokployCertificateConsole />}
          />
          <Route
            path="dokploy/manager/registry"
            element={<DokployRegistryConsole />}
          />
          <Route
            path="dokploy/manager/server"
            element={<DokployServerConsole />}
          />
          <Route
            path="dokploy/manager/sshkey"
            element={<DokploySshKeyConsole />}
          />
          <Route path="jobs/queue/:queue" element={<JobsQueueBoard />} />
          <Route
            path="instances/state/:state"
            element={<InstancesStateBoard />}
          />
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
          <Route path="account/profile" element={<StaffProfile />} />
          <Route path="account/security" element={<StaffSecurity />} />
          <Route path="account/api-keys" element={<StaffApiKeys />} />
          <Route path="account/notifications" element={<StaffNotifications />} />
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
          <Route path="landing" element={<LandingContent />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="blog" element={<BlogPage />} />
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
          <Route path="account/profile" element={<StaffProfile />} />
          <Route path="account/security" element={<StaffSecurity />} />
          <Route path="account/api-keys" element={<StaffApiKeys />} />
          <Route path="account/notifications" element={<StaffNotifications />} />
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
          <Route path="rates/history" element={<FinanceCustomRatesHistory />} />
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

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
