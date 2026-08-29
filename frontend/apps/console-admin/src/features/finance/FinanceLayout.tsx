import { ConsoleLayout } from "@/components/shared/ConsoleLayout"
import { financeNav } from "./nav"

export default function FinanceLayout() {
  return (
    <ConsoleLayout
      brand="Kilat Cloud"
      brandTagline="Finance console"
      navSections={financeNav}
    />
  )
}
