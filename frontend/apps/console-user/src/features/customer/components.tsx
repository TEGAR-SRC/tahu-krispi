// Small shared presentational helpers for the customer portal.
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

/** Maps a backend resource status onto a badge tone. */
function variantFor(status: string): BadgeVariant {
  switch (status) {
    case "active":
    case "running":
    case "paid":
    case "completed":
    case "synced":
    case "open":
      return "default"
    case "pending":
    case "provisioning":
    case "queued":
    case "starting":
    case "stopping":
    case "rebooting":
    case "waiting_customer":
    case "waiting_staff":
    case "processing":
    case "unpaid":
      return "secondary"
    case "failed":
    case "error":
    case "suspended":
    case "overdue":
    case "deleted":
    case "deleting":
    case "urgent":
      return "destructive"
    default:
      return "outline"
  }
}

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined
  className?: string
}) {
  const value = (status ?? "").trim()
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant={variantFor(value.toLowerCase())} className={cn("capitalize", className)}>
      {value.replace(/_/g, " ")}
    </Badge>
  )
}
