// Customer console shell: sidebar navigation, organization switcher in the
// header and the routed Outlet. The active organization id flows to every
// page through useOrg() so org-scoped requests carry X-Organization-ID.
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import {
  BuildingIcon,
  ChevronsUpDownIcon,
  DiscIcon,
  GiftIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  LogOutIcon,
  NetworkIcon,
  ServerIcon,
  TerminalIcon,
  UserCircleIcon,
  WalletIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"
import { OrgProvider, useOrg, type Organization } from "./useOrg"

interface NavItem {
  title: string
  url: string
  icon?: LucideIcon
}

interface NavSection {
  title?: string
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    title: "Cloud",
    items: [
      { title: "Overview", url: "/app", icon: LayoutDashboardIcon },
      { title: "Instances", url: "/app/instances", icon: ServerIcon },
      { title: "ISO", url: "/app/iso", icon: DiscIcon },
      { title: "Backups", url: "/app/backups", icon: HistoryIcon },
      { title: "Network", url: "/app/network", icon: NetworkIcon },
    ],
  },
  {
    title: "Account",
    items: [
      { title: "Tickets", url: "/app/tickets", icon: LifeBuoyIcon },
      { title: "Wallet", url: "/app/wallet", icon: WalletIcon },
      { title: "Affiliate", url: "/app/affiliate", icon: GiftIcon },
      { title: "Profile", url: "/app/profile", icon: UserCircleIcon },
    ],
  },
]

function initialsFor(email: string | undefined): string {
  if (!email) return "?"
  const [first] = email.split("@")
  return first.slice(0, 2).toUpperCase()
}

function OrgSwitcher() {
  const { organizations, organization, loading, selectOrg } = useOrg()

  if (loading && !organization) {
    return <Spinner className="size-4 text-muted-foreground" />
  }

  if (organizations.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">No organization</span>
    )
  }

  const label = (org: Organization | null) => org?.name || "Select organization"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BuildingIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-w-48 truncate">{label(organization)}</span>
          {organization?.status ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {organization.status}
            </Badge>
          ) : null}
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => selectOrg(org.id)}>
            <span className={org.id === organization?.id ? "font-semibold" : ""}>
              {org.name}
            </span>
            {org.slug ? (
              <span className="ml-auto text-xs text-muted-foreground">{org.slug}</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CustomerShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { claims, logout } = useAuth()

  const isActive = (url: string) => {
    if (location.pathname === url) return true
    return url !== "/" && location.pathname.startsWith(`${url}/`)
  }

  const handleLogout = () => {
    logout()
    navigate("/login", { replace: true })
  }

  const email = typeof claims?.email === "string" ? claims.email : ""

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/app">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <TerminalIcon className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Kilat Cloud</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Customer console
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {sections.map((section, sectionIndex) => (
            <SidebarGroup key={section.title ?? sectionIndex}>
              {section.title ? <SidebarGroupLabel>{section.title}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton isActive={isActive(item.url)} asChild>
                          <Link to={item.url}>
                            {Icon ? <Icon /> : null}
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg">
                        {initialsFor(email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{email || "Signed in"}</span>
                      <span className="truncate text-xs text-muted-foreground">Customer</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{email || "Signed in"}</p>
                      <p className="text-xs text-muted-foreground">Customer account</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/app/profile")}>
                    <UserCircleIcon />
                    Profile settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOutIcon />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-4" />
          <OrgSwitcher />
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function CustomerLayout() {
  return (
    <OrgProvider>
      <CustomerShell />
    </OrgProvider>
  )
}
