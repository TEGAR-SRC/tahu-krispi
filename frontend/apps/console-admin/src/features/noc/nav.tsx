// NOC console navigation. Provider sub-pages and entity detail routes are
// reached from the provider hub and list pages.
import type { ConsoleNavSection } from "@/components/shared/ConsoleLayout"
import {
  CloudCogIcon,
  GaugeIcon,
  LifeBuoyIcon,
  ScrollTextIcon,
  ServerIcon,
  ShieldHalfIcon,
  WorkflowIcon,
} from "lucide-react"

export const nocNav: ConsoleNavSection[] = [
  {
    title: "Monitoring",
    items: [{ title: "Dashboard", url: "/noc", icon: GaugeIcon }],
  },
  {
    title: "Compute",
    items: [
      { title: "Instances", url: "/noc/instances", icon: ServerIcon },
      { title: "Jobs", url: "/noc/jobs", icon: WorkflowIcon },
    ],
  },
  {
    title: "Providers",
    items: [{ title: "Providers", url: "/noc/providers", icon: CloudCogIcon }],
  },
  {
    title: "Operations",
    items: [
      { title: "Tickets", url: "/noc/tickets", icon: LifeBuoyIcon },
      { title: "Security", url: "/noc/security", icon: ShieldHalfIcon },
      { title: "Landing content", url: "/noc/landing", icon: ScrollTextIcon },
    ],
  },
]
