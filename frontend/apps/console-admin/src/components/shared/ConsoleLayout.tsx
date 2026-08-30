// Shared shell for the four role consoles (admin, NOC, finance, customer):
// sidebar navigation + header with the signed-in user menu + routed Outlet.
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import type { LucideIcon } from "lucide-react"
import { LogOutIcon, SettingsIcon, TerminalIcon } from "lucide-react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { useAuth, homePathFor } from "@/lib/auth"

export interface ConsoleNavItem {
  title: string
  url: string
  icon?: LucideIcon
}

export interface ConsoleNavSection {
  title?: string
  items: ConsoleNavItem[]
}

interface ConsoleLayoutProps {
  brand: string
  brandTagline?: string
  navSections: ConsoleNavSection[]
}

function initialsFor(email: string | undefined): string {
  if (!email) return "?"
  const [first] = email.split("@")
  return first.slice(0, 2).toUpperCase()
}

export function ConsoleLayout({ brand, brandTagline, navSections }: ConsoleLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, role, logout } = useAuth()

  // Only the longest matching nav item is active — prevents parent + child
  // both being highlighted (e.g. /admin and /admin/users on /admin/users).
  // For duplicate URLs (e.g. /admin/dokploy appears twice) only the first
  // occurrence is considered active.
  const flatItems = navSections.flatMap((s) => s.items)
  const activeItem = (() => {
    const candidates = flatItems.filter(
      (item) => location.pathname === item.url || (item.url !== "/" && location.pathname.startsWith(`${item.url}/`)),
    )
    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.url.length - a.url.length)
    return candidates[0]
  })()
  const isActive = (item: ConsoleNavItem) => item === activeItem

  const handleLogout = () => {
    logout()
    navigate("/login", { replace: true })
  }

  // Role labels come from the detected console role; the profile supplies the
  // signed-in identity (JWT claims carry no email/role).
  const email = profile?.email
  const roleLabels: Record<string, string> = {
    admin: "Platform admin",
    noc: "NOC engineer",
    finance: "Finance",
    customer: "Customer",
  }
  const roleLabel = role ? (roleLabels[role] ?? role) : "user"

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <TerminalIcon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="grid w-full max-w-full min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="min-w-0 truncate font-medium">{brand}</span>
                    {brandTagline ? (
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {brandTagline}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {navSections.map((section, sectionIndex) => (
            <SidebarGroup key={section.title ?? sectionIndex}>
              {section.title ? (
                <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={`${item.url}-${item.title}`}>
                        <SidebarMenuButton isActive={isActive(item)} asChild>
                          <Link to={item.url}>
                            {Icon ? <Icon aria-hidden="true" /> : null}
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
                    <div className="grid w-full max-w-full min-w-0 flex-1 text-left text-sm leading-tight">
                      <span className="min-w-0 truncate font-medium">{email || "Signed in"}</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">{roleLabel}</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{email || "Signed in"}</p>
                      <p className="text-xs text-muted-foreground">{roleLabel}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(`${homePathFor(role)}/account/profile`)
                    }
                  >
                    <SettingsIcon aria-hidden="true" />
                    Account settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOutIcon aria-hidden="true" />
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
          <span className="text-sm font-medium">{brand}</span>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
