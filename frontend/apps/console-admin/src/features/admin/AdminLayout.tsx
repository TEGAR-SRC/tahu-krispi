import { ConsoleLayout } from "@/components/shared/ConsoleLayout"
import { adminNav } from "./nav"

export default function AdminLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="Platform admin console"
      navSections={adminNav}
    />
  )
}
