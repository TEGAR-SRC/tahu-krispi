// Security hub (/admin/security): overview cards linking to the four security
// sub-pages — incidents, blocked networks, feature flags and app settings,
// which each live on their own route under /admin/security/*.
import { Link } from "react-router-dom"
import {
  BanIcon,
  ChevronRightIcon,
  FlagIcon,
  SettingsIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface HubCard {
  to: string
  title: string
  description: string
  icon: typeof ShieldAlertIcon
}

const CARDS: HubCard[] = [
  {
    to: "/admin/security/incidents",
    title: "Incidents",
    description:
      "Security incidents across the platform with server-side status filtering and one-click resolve.",
    icon: ShieldAlertIcon,
  },
  {
    to: "/admin/security/blocked-networks",
    title: "Blocked networks",
    description: "CIDR blocklist for abusive traffic — add with a reason, unblock anytime.",
    icon: BanIcon,
  },
  {
    to: "/admin/security/feature-flags",
    title: "Feature flags",
    description:
      "Per-key runtime flags with an enabled switch and JSON rules. Lookup by key; saving creates.",
    icon: FlagIcon,
  },
  {
    to: "/admin/security/app-settings",
    title: "App settings",
    description:
      "Per-key platform configuration values stored as JSON, with secret masking handled by the API.",
    icon: SettingsIcon,
  },
]

export default function AdminSecurityPage() {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Security"
        description="Operational security surface: incidents, network blocklist, feature flags and platform settings."
      />

      <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
        {CARDS.map(({ to, title, description, icon: Icon }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="flex flex-row items-start gap-3">
                <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground group-hover:text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <CardTitle className="flex min-w-0 items-center gap-1 text-base font-semibold">
                    {title}
                    <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {description}
                  </CardDescription>
                </span>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
