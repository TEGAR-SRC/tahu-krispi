import { lazy, Suspense } from "react"
import type { ReactNode } from "react"
import { Navigate, Route, Routes, Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { homePathFor, useAuth, type AppRole } from "@/lib/auth"

// ---- Lazy role layout --------------------------------------------------------
const CustomerLayout = lazy(() => import("@/features/customer/CustomerLayout"))

// ---- Auth: redirected to the standalone auth console (auth.kilat-cloud.com) --
// The /oauth/callback route stays local — it is the handoff target where the
// auth console delivers the session token in the URL fragment.
const OAuthCallbackPage = lazy(() => import("@/features/auth/OAuthCallbackPage"))
import { RedirectToAuth } from "@/components/shared/RedirectToAuth"

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
const InstanceResize = lazy(() =>
  import("@/features/customer/pages/instances/Resize"),
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

const FirewallGroupDetail = lazy(() =>
  import("@/features/customer/pages/network/FirewallGroupDetail"),
)
const IpListDetail = lazy(() =>
  import("@/features/customer/pages/network/IpListDetail"),
)
const WalletTransactionsPage = lazy(() =>
  import("@/features/customer/pages/WalletTransactions"),
)
const MeasuredBootPage = lazy(() =>
  import("@/features/customer/pages/MeasuredBoot"),
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
        <Route path="/login" element={<RedirectToAuth path="/login" />} />
        <Route path="/signup" element={<RedirectToAuth path="/signup" />} />
        <Route path="/forgot-password" element={<RedirectToAuth path="/forgot-password" />} />
        <Route path="/reset-password" element={<RedirectToAuth path="/reset-password" />} />
        <Route path="/verify-email" element={<RedirectToAuth path="/verify-email" />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/terms" element={<RedirectToAuth path="/terms" />} />
        <Route path="/privacy" element={<RedirectToAuth path="/privacy" />} />

        <Route
          path="/app"
          element={
            <RequireRole allow={"customer"}>
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
          <Route
            path="instances/:instanceId/resize"
            element={<InstanceResize />}
          />
          <Route path="iso" element={<CustomerIso />} />
          <Route path="iso/:isoId" element={<IsoDetail />} />
          <Route path="backups" element={<CustomerBackups />} />
          <Route path="network" element={<CustomerNetwork />} />
          <Route path="storage" element={<ObjectStorage />} />
          <Route path="catalog" element={<CatalogPage />} />

          <Route path="wallet" element={<CustomerWallet />} />
          <Route path="wallet/topup" element={<Topup />} />
          <Route
            path="wallet/transactions"
            element={<WalletTransactionsPage />}
          />
          <Route path="measured-boot" element={<MeasuredBootPage />} />
          <Route
            path="network/firewall/:firewallId"
            element={<FirewallGroupDetail />}
          />
          <Route path="ip-lists/:listId" element={<IpListDetail />} />
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
