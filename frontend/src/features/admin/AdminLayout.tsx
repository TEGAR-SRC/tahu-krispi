import {
  DatabaseIcon,
  GlobeIcon,
  HardDriveIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldCheckIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react"
import {
  ConsoleLayout,
  type ConsoleNavSection,
} from "@/components/shared/ConsoleLayout"
import { billingNav } from "./billingNav"

// Core platform-admin navigation, grouped so infrastructure surfaces sit
// apart from governance ones. Billing groups arrive from the shared billing
// nav contract and render below these sections.
const sections: ConsoleNavSection[] = [
  {
    title: "Platform",
    items: [
      { title: "Dashboard", url: "/admin", icon: LayoutDashboardIcon },
      { title: "Users", url: "/admin/users", icon: UsersIcon },
      { title: "Tickets", url: "/admin/tickets", icon: LifeBuoyIcon },
      { title: "Audit Logs", url: "/admin/audit-logs", icon: ScrollTextIcon },
      { title: "Security", url: "/admin/security", icon: ShieldCheckIcon },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { title: "Instances", url: "/admin/instances", icon: ServerIcon },
      { title: "Jobs", url: "/admin/jobs", icon: WorkflowIcon },
      { title: "Providers", url: "/admin/providers", icon: DatabaseIcon },
      { title: "Regions & Pools", url: "/admin/regions-pools", icon: GlobeIcon },
      {
        title: "Storage Backends",
        url: "/admin/storage-backends",
        icon: HardDriveIcon,
      },
    ],
  },
]

export default function AdminLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="Platform admin console"
      navSections={[
        ...sections,
        // Billing groups arrive from the shared billing nav contract.
        ...billingNav.map((section) => ({
          title: section.title,
          items: section.items.map((item) => ({
            title: item.title,
            url: item.url,
          })),
        })),
      ]}
    />
  )
}
