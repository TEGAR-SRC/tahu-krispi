// Finance console navigation. Entity detail routes are reached from lists.
import type { ConsoleNavSection } from "@/components/shared/ConsoleLayout"
import {
  CreditCardIcon,
  CoinsIcon,
  GiftIcon,
  GlobeIcon,
  PackageIcon,
  PieChartIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  TagIcon,
  WalletIcon,
} from "lucide-react"

export const financeNav: ConsoleNavSection[] = [
  {
    title: "Billing",
    items: [
      { title: "Summary", url: "/finance", icon: PieChartIcon },
      { title: "Reports", url: "/finance/reports", icon: PieChartIcon },
      { title: "Orders", url: "/finance/orders", icon: ShoppingBagIcon },
      { title: "Invoices", url: "/finance/invoices", icon: ReceiptTextIcon },
      { title: "Payments", url: "/finance/payments", icon: CreditCardIcon },
      { title: "Wallets", url: "/finance/wallets", icon: WalletIcon },
      { title: "Coupons", url: "/finance/coupons", icon: TagIcon },
      { title: "Products plans", url: "/finance/catalog", icon: PackageIcon },
      { title: "Custom rates", url: "/finance/rates", icon: CoinsIcon },
      { title: "Regions", url: "/finance/regions", icon: GlobeIcon },
    ],
  },
  {
    title: "Affiliate program",
    items: [
      { title: "Overview", url: "/finance/affiliate", icon: GiftIcon },
      { title: "Settings", url: "/finance/affiliate/settings", icon: GiftIcon },
      { title: "Earnings", url: "/finance/affiliate/earnings", icon: GiftIcon },
    ],
  },
]
