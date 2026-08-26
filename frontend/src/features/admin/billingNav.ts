// Navigation contract for the admin billing section. The billing agent fills
// these in; AdminLayout renders every section below its own nav groups.
export const billingNav: Array<{
  title: string
  items: Array<{ title: string; url: string }>
}> = [
  {
    title: "Billing",
    items: [
      { title: "Finance Summary", url: "/admin/billing/summary" },
      { title: "Orders", url: "/admin/billing/orders" },
      { title: "Invoices", url: "/admin/billing/invoices" },
      { title: "Payments", url: "/admin/billing/payments" },
      { title: "Wallets", url: "/admin/billing/wallets" },
    ],
  },
  {
    title: "Pricing & Catalog",
    items: [
      { title: "Products & Plans", url: "/admin/billing/products-plans" },
      { title: "Custom Rates", url: "/admin/billing/custom-rates" },
      { title: "Coupons", url: "/admin/billing/coupons" },
    ],
  },
  {
    title: "Growth",
    items: [
      { title: "Affiliate Config", url: "/admin/billing/affiliate-config" },
    ],
  },
]
