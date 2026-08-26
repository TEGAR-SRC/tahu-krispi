// Account settings hub: cards linking to every /app/account/* section plus
// the identity header (avatar + logout shortcut). The individual settings
// pages live in ./account/.
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  BellIcon,
  ChevronRightIcon,
  FileClockIcon,
  GlobeIcon,
  FileCodeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MapPinIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
  UserCircleIcon,
  WebhookIcon,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { apiGet } from "@/lib/api"
import { useAuth, type MeProfile } from "@/lib/auth"

const SECTIONS = [
  {
    to: "/app/account/profile",
    icon: UserCircleIcon,
    title: "Profile",
    description: "Name, company, tax identity, avatar and verification documents.",
  },
  {
    to: "/app/account/security",
    icon: ShieldCheckIcon,
    title: "Security",
    description: "Password, sessions, MFA (TOTP, passkeys) and recovery codes.",
  },
  {
    to: "/app/account/addresses",
    icon: MapPinIcon,
    title: "Addresses",
    description: "Billing and shipping addresses with a default selection.",
  },
  {
    to: "/app/account/api-keys",
    icon: KeyRoundIcon,
    title: "API keys",
    description: "Scoped API keys with IP allowlists and one-time secrets.",
  },
  {
    to: "/app/account/ssh-keys",
    icon: TerminalSquareIcon,
    title: "SSH keys",
    description: "Public keys deployed onto your instances at provision time.",
  },
  {
    to: "/app/startup-scripts",
    icon: FileCodeIcon,
    title: "Startup scripts",
    description: "Cloud-init style scripts run when an instance boots.",
  },
  {
    to: "/app/account/webhooks",
    icon: WebhookIcon,
    title: "Webhooks",
    description: "HTTP endpoints receiving signed event deliveries.",
  },
  {
    to: "/app/account/notifications",
    icon: BellIcon,
    title: "Notifications",
    description: "Inbox of platform events and per-channel preferences.",
  },
  {
    to: "/app/account/audit-logs",
    icon: FileClockIcon,
    title: "Audit logs",
    description: "Organization activity trail recorded by the platform.",
  },
] as const

function initialsFor(profile: MeProfile | null): string {
  const source = profile?.full_name || profile?.display_name || profile?.email
  if (!source) return "?"
  const parts = source.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join("")
}

export default function CustomerProfileHubPage() {
  const { profile, logout } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarChecked, setAvatarChecked] = useState(false)

  // The avatar is served as a presigned URL by GET /me/avatar; 404 simply
  // means no avatar was uploaded yet.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await apiGet<{ url?: string }>("/me/avatar")
        if (!cancelled && typeof data?.url === "string") setAvatarUrl(data.url)
      } catch {
        // No avatar (404) or storage unavailable — fall back to initials.
      } finally {
        if (!cancelled) setAvatarChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          {avatarChecked ? (
            <Avatar className="size-16 border">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="Your avatar" /> : null}
              <AvatarFallback className="text-lg font-semibold">
                {initialsFor(profile)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Skeleton className="size-16 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold">
              {profile?.full_name || profile?.display_name || profile?.email || "Account"}
            </p>
            <p className="truncate text-sm text-muted-foreground">{profile?.email}</p>
          </div>
          <Button variant="outline" onClick={logout}>
            <LogOutIcon /> Sign out
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.to} to={section.to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardContent className="flex items-start gap-3">
                <section.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium group-hover:text-primary">{section.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
                </div>
                <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GlobeIcon className="size-3.5" />
        Organization membership is managed on the{" "}
        <Link to="/app/organizations" className="text-primary hover:underline">
          organizations
        </Link>{" "}
        page; switching the active organization lives in the top bar.
      </p>
    </div>
  )
}
