// Platform-admin console navigation. Detail routes (e.g. /admin/users/:id)
// are intentionally absent here — they are reached from their list pages.
import type { ConsoleNavSection } from "@/components/shared/ConsoleLayout"
import {
  BoxesIcon,
  BuildingIcon,
  CloudCogIcon,
  CoinsIcon,
  CreditCardIcon,
  DatabaseIcon,
  FileClockIcon,
  GiftIcon,
  GlobeIcon,
  HardDriveIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  PackageIcon,
  PieChartIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
} from "lucide-react"

export const adminNav: ConsoleNavSection[] = [
  {
    title: "Platform",
    items: [
      { title: "Dashboard", url: "/admin", icon: LayoutDashboardIcon },
      { title: "Users", url: "/admin/users", icon: UsersIcon },
      { title: "Organizations", url: "/admin/organizations", icon: BuildingIcon },
      { title: "Orphan resources", url: "/admin/orphans", icon: BoxesIcon },
      { title: "Tickets", url: "/admin/tickets", icon: LifeBuoyIcon },
      { title: "Audit logs", url: "/admin/audit-logs", icon: ScrollTextIcon },
    ],
  },
  {
    title: "Security",
    items: [
      { title: "Security hub", url: "/admin/security", icon: ShieldCheckIcon },
      { title: "Incidents", url: "/admin/security/incidents", icon: ShieldCheckIcon },
      { title: "Blocked networks", url: "/admin/security/blocked-networks", icon: GlobeIcon },
      { title: "Feature flags", url: "/admin/security/feature-flags", icon: FileClockIcon },
      { title: "App settings", url: "/admin/security/app-settings", icon: FileClockIcon },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { title: "Instances", url: "/admin/instances", icon: ServerIcon },
      { title: "Jobs", url: "/admin/jobs", icon: WorkflowIcon },
      { title: "Providers", url: "/admin/providers", icon: CloudCogIcon },
      { title: "Regions & pools", url: "/admin/regions-pools", icon: GlobeIcon },
      { title: "Storage backends", url: "/admin/storage-backends", icon: HardDriveIcon },
      { title: "Dokploy PaaS", url: "/admin/dokploy", icon: DatabaseIcon },
    ],
  },
  {
    title: "Billing",
    items: [
      { title: "Summary", url: "/admin/billing/summary", icon: PieChartIcon },
      { title: "Reports", url: "/admin/billing/reports", icon: PieChartIcon },
      { title: "Orders", url: "/admin/billing/orders", icon: ShoppingBagIcon },
      { title: "Invoices", url: "/admin/billing/invoices", icon: ReceiptTextIcon },
      { title: "Payments", url: "/admin/billing/payments", icon: CreditCardIcon },
      { title: "Wallets", url: "/admin/billing/wallets", icon: WalletIcon },
      { title: "Coupons", url: "/admin/billing/coupons", icon: TagIcon },
      { title: "Products & plans", url: "/admin/billing/products-plans", icon: PackageIcon },
      { title: "Custom rates", url: "/admin/billing/custom-rates", icon: CoinsIcon },
    ],
  },
  {
    title: "Dokploy",
    items: [
      { title: "Dokploy hub", url: "/admin/dokploy", icon: DatabaseIcon },
      { title: "App home", url: "/admin/dokploy/app/home", icon: LayoutDashboardIcon },
      { title: "Projects", url: "/admin/dokploy/app/projects", icon: BoxesIcon },
      { title: "Overview", url: "/admin/dokploy/app/overview", icon: GlobeIcon },
      { title: "Docker", url: "/admin/dokploy/app/docker", icon: HardDriveIcon },
      { title: "Monitoring", url: "/admin/dokploy/app/monitoring", icon: FileClockIcon },
      { title: "Requests", url: "/admin/dokploy/app/requests", icon: InboxIcon },
      { title: "Schedules", url: "/admin/dokploy/app/schedules", icon: WorkflowIcon },
      { title: "Traefik files", url: "/admin/dokploy/app/traefik", icon: ServerIcon },
      { title: "Settings (Dokploy)", url: "/admin/dokploy/app/settings/profile", icon: ShieldCheckIcon },
    ],
  },
  {
    title: "Affiliate program",
    items: [
      { title: "Configuration", url: "/admin/billing/affiliate-config", icon: GiftIcon },
      { title: "Settings", url: "/admin/affiliate/settings", icon: GiftIcon },
      { title: "Earnings", url: "/admin/affiliate/earnings", icon: GiftIcon },
    ],
  },
]
