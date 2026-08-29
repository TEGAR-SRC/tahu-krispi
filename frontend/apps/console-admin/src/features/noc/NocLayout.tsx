import { ConsoleLayout } from "@/components/shared/ConsoleLayout"
import { nocNav } from "./nav"

export default function NocLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="NOC console"
      navSections={nocNav}
    />
  )
}
