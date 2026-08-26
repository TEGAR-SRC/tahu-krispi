import {
  CloudIcon,
  GaugeIcon,
  LifeBuoyIcon,
  ServerIcon,
  ShieldHalfIcon,
  WorkflowIcon,
} from "lucide-react"
import {
  ConsoleLayout,
  type ConsoleNavSection,
} from "@/components/shared/ConsoleLayout"

const sections: ConsoleNavSection[] = [
  {
    title: "NOC",
    items: [
      { title: "Dashboard", url: "/noc", icon: GaugeIcon },
      { title: "Instances", url: "/noc/instances", icon: ServerIcon },
      { title: "Jobs", url: "/noc/jobs", icon: WorkflowIcon },
      { title: "Providers", url: "/noc/providers", icon: CloudIcon },
      { title: "Tickets", url: "/noc/tickets", icon: LifeBuoyIcon },
      { title: "Security", url: "/noc/security", icon: ShieldHalfIcon },
    ],
  },
]

export default function NocLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="NOC console"
      navSections={sections}
    />
  )
}
