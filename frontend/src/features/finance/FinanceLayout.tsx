import {
  CreditCardIcon,
  GiftIcon,
  PackageIcon,
  PieChartIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  TagIcon,
  WalletIcon,
} from "lucide-react"
import {
  ConsoleLayout,
  type ConsoleNavSection,
} from "@/components/shared/ConsoleLayout"

const sections: ConsoleNavSection[] = [
  {
    title: "Finance",
    items: [
      { title: "Summary", url: "/finance", icon: PieChartIcon },
      { title: "Orders", url: "/finance/orders", icon: ShoppingBagIcon },
      { title: "Invoices", url: "/finance/invoices", icon: ReceiptTextIcon },
      { title: "Payments", url: "/finance/payments", icon: CreditCardIcon },
      { title: "Wallets", url: "/finance/wallets", icon: WalletIcon },
    ],
  },
  {
    title: "Commercial",
    items: [
      { title: "Coupons", url: "/finance/coupons", icon: TagIcon },
      { title: "Catalog", url: "/finance/catalog", icon: PackageIcon },
      { title: "Affiliate", url: "/finance/affiliate", icon: GiftIcon },
    ],
  },
]

export default function FinanceLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="Finance console"
      navSections={sections}
    />
  )
}
