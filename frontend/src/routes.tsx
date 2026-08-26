import { lazy, Suspense, type ReactNode } from "react"
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
const AdminInstances = lazy(() => import("@/features/admin/pages/Instances"))
const AdminJobs = lazy(() => import("@/features/admin/pages/Jobs"))
const AdminProviders = lazy(() => import("@/features/admin/pages/Providers"))
const AdminRegionsPools = lazy(() => import("@/features/admin/pages/RegionsPools"))
const AdminStorageBackends = lazy(() =>
  import("@/features/admin/pages/StorageBackends"),
)
const AdminTickets = lazy(() => import("@/features/admin/pages/Tickets"))
const AdminAuditLogs = lazy(() => import("@/features/admin/pages/AuditLogs"))
const AdminSecurity = lazy(() => import("@/features/admin/pages/Security"))

const BillingFinanceSummary = lazy(() =>
  import("@/features/admin/billing/pages/FinanceSummary"),
)
const BillingOrders = lazy(() => import("@/features/admin/billing/pages/Orders"))
const BillingInvoices = lazy(() =>
  import("@/features/admin/billing/pages/Invoices"),
)
const BillingPayments = lazy(() =>
  import("@/features/admin/billing/pages/Payments"),
)
const BillingWallets = lazy(() =>
  import("@/features/admin/billing/pages/Wallets"),
)
const BillingCoupons = lazy(() =>
  import("@/features/admin/billing/pages/Coupons"),
)
const BillingProductsPlans = lazy(() =>
  import("@/features/admin/billing/pages/ProductsPlans"),
)
const BillingCustomRates = lazy(() =>
  import("@/features/admin/billing/pages/CustomRates"),
)
const BillingAffiliateConfig = lazy(() =>
  import("@/features/admin/billing/pages/AffiliateConfig"),
)

// ---- Lazy pages: noc ----------------------------------------------------------
const NocDashboard = lazy(() => import("@/features/noc/pages/Dashboard"))
const NocInstances = lazy(() => import("@/features/noc/pages/Instances"))
const NocJobs = lazy(() => import("@/features/noc/pages/Jobs"))
const NocProviders = lazy(() => import("@/features/noc/pages/Providers"))
const NocTickets = lazy(() => import("@/features/noc/pages/Tickets"))
const NocSecurity = lazy(() => import("@/features/noc/pages/Security"))

// ---- Lazy pages: finance ------------------------------------------------------
const FinanceSummary = lazy(() => import("@/features/finance/pages/Summary"))
const FinanceOrders = lazy(() => import("@/features/finance/pages/Orders"))
const FinanceInvoices = lazy(() => import("@/features/finance/pages/Invoices"))
const FinancePayments = lazy(() => import("@/features/finance/pages/Payments"))
const FinanceWallets = lazy(() => import("@/features/finance/pages/Wallets"))
const FinanceCoupons = lazy(() => import("@/features/finance/pages/Coupons"))
const FinanceCatalog = lazy(() => import("@/features/finance/pages/Catalog"))
const FinanceAffiliate = lazy(() => import("@/features/finance/pages/Affiliate"))

// ---- Lazy pages: customer -----------------------------------------------------
const CustomerOverview = lazy(() => import("@/features/customer/pages/Overview"))
const CustomerInstances = lazy(() =>
  import("@/features/customer/pages/Instances"),
)
const CustomerIso = lazy(() => import("@/features/customer/pages/Iso"))
const CustomerBackups = lazy(() => import("@/features/customer/pages/Backups"))
const CustomerNetwork = lazy(() => import("@/features/customer/pages/Network"))
const CustomerTickets = lazy(() => import("@/features/customer/pages/Tickets"))
const CustomerWallet = lazy(() => import("@/features/customer/pages/Wallet"))
const CustomerAffiliate = lazy(() =>
  import("@/features/customer/pages/Affiliate"),
)
const CustomerProfile = lazy(() => import("@/features/customer/pages/Profile"))

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
          <Route path="instances" element={<AdminInstances />} />
          <Route path="jobs" element={<AdminJobs />} />
          <Route path="providers" element={<AdminProviders />} />
          <Route path="regions-pools" element={<AdminRegionsPools />} />
          <Route path="storage-backends" element={<AdminStorageBackends />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="audit-logs" element={<AdminAuditLogs />} />
          <Route path="security" element={<AdminSecurity />} />

          <Route path="billing/summary" element={<BillingFinanceSummary />} />
          <Route path="billing/orders" element={<BillingOrders />} />
          <Route path="billing/invoices" element={<BillingInvoices />} />
          <Route path="billing/payments" element={<BillingPayments />} />
          <Route path="billing/wallets" element={<BillingWallets />} />
          <Route path="billing/coupons" element={<BillingCoupons />} />
          <Route path="billing/products-plans" element={<BillingProductsPlans />} />
          <Route path="billing/custom-rates" element={<BillingCustomRates />} />
          <Route path="billing/affiliate-config" element={<BillingAffiliateConfig />} />
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
          <Route path="jobs" element={<NocJobs />} />
          <Route path="providers" element={<NocProviders />} />
          <Route path="tickets" element={<NocTickets />} />
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
          <Route path="orders" element={<FinanceOrders />} />
          <Route path="invoices" element={<FinanceInvoices />} />
          <Route path="payments" element={<FinancePayments />} />
          <Route path="wallets" element={<FinanceWallets />} />
          <Route path="coupons" element={<FinanceCoupons />} />
          <Route path="catalog" element={<FinanceCatalog />} />
          <Route path="affiliate" element={<FinanceAffiliate />} />
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
          <Route path="iso" element={<CustomerIso />} />
          <Route path="backups" element={<CustomerBackups />} />
          <Route path="network" element={<CustomerNetwork />} />
          <Route path="tickets" element={<CustomerTickets />} />
          <Route path="wallet" element={<CustomerWallet />} />
          <Route path="affiliate" element={<CustomerAffiliate />} />
          <Route path="profile" element={<CustomerProfile />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
