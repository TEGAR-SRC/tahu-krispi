// Customer console navigation. Instance sub-pages, order/invoice/ticket
// detail routes and account sub-pages are reached from their list/hub pages.
import type { ConsoleNavSection } from "@/components/shared/ConsoleLayout"
import {
  BuildingIcon,
  CreditCardIcon,
  DiscIcon,
  GiftIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  NetworkIcon,
  PackageIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  UserCircleIcon,
  WalletIcon,
  WebhookIcon,
} from "lucide-react"

export const customerNav: ConsoleNavSection[] = [
  {
    title: "Cloud",
    items: [
      { title: "Overview", url: "/app", icon: LayoutDashboardIcon },
      { title: "Instances", url: "/app/instances", icon: ServerIcon },
      { title: "Catalog & pricing", url: "/app/catalog", icon: PackageIcon },
      { title: "ISO images", url: "/app/iso", icon: DiscIcon },
      { title: "Backups", url: "/app/backups", icon: HistoryIcon },
      { title: "Network", url: "/app/network", icon: NetworkIcon },
      { title: "Object storage", url: "/app/storage", icon: PackageIcon },
    ],
  },
  {
    title: "Billing",
    items: [
      { title: "Wallet", url: "/app/wallet", icon: WalletIcon },
      { title: "Orders", url: "/app/orders", icon: ShoppingBagIcon },
      { title: "Invoices", url: "/app/invoices", icon: ReceiptTextIcon },
      { title: "Subscriptions", url: "/app/subscriptions", icon: CreditCardIcon },
    ],
  },
  {
    title: "Growth",
    items: [{ title: "Affiliate", url: "/app/affiliate", icon: GiftIcon }],
  },
  {
    title: "Account",
    items: [
      { title: "Tickets", url: "/app/tickets", icon: LifeBuoyIcon },
      { title: "Organizations", url: "/app/organizations", icon: BuildingIcon },
      { title: "Notifications", url: "/app/account/notifications", icon: ScrollTextIcon },
      { title: "Profile", url: "/app/profile", icon: UserCircleIcon },
      { title: "Security", url: "/app/account/security", icon: ShieldCheckIcon },
      { title: "API keys", url: "/app/account/api-keys", icon: KeyRoundIcon },
      { title: "SSH keys", url: "/app/account/ssh-keys", icon: KeyRoundIcon },
      { title: "Webhooks", url: "/app/account/webhooks", icon: WebhookIcon },
      { title: "Audit logs", url: "/app/account/audit-logs", icon: ScrollTextIcon },
    ],
  },
]
