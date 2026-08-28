import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  ArrowRightIcon,
  BoxesIcon,
  DatabaseBackupIcon,
  FlameKindlingIcon,
  HardDriveIcon,
  LayersIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldHalfIcon,
} from "lucide-react"
import { type Provider, KindBadge, StatusBadge } from "../lib"
import { fmtDateTime, toastApiError } from "../lib-utils"

/** NOC-readable launchpad surfaces per provider kind; routes live in routes.tsx. */
const PROXMOX_SURFACES = [
  { to: "cluster", label: "Cluster", icon: LayersIcon },
  { to: "nodes", label: "Nodes", icon: HardDriveIcon },
  { to: "storages", label: "Storages", icon: BoxesIcon },
  { to: "backup-jobs", label: "Backup jobs", icon: DatabaseBackupIcon },
  { to: "firewall", label: "Firewall", icon: ShieldHalfIcon },
  { to: "services", label: "Services", icon: FlameKindlingIcon },
] as const

export default function NocProvidersPage() {
  const [rows, setRows] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const envelope = await apiGet<Provider[]>("/admin/providers")
      setRows(envelope.data)
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const sync = useCallback(async (provider: Provider) => {
    setSyncingId(provider.id)
    try {
      await apiPost(`/admin/providers/${provider.id}/sync`)
      toast.success(`Sync job queued for ${provider.name}`)
    } catch (cause) {
      toastApiError(cause, "Could not queue the sync job")
    } finally {
      setSyncingId(null)
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Compute platforms and their NOC-readable infrastructure surfaces."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <ErrorBanner error={error} />
      ) : loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-4 text-center text-sm text-muted-foreground sm:p-6">
          No providers registered yet.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((provider) => (
            <article
              key={provider.id}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
            >
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to={`/noc/providers/${provider.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {provider.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {provider.code}
                    {provider.api_base_url ? ` · ${provider.api_base_url}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <KindBadge kind={provider.kind} />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Trigger sync for ${provider.name}`}
                    disabled={syncingId !== null}
                    onClick={() => void sync(provider)}
                  >
                    {syncingId === provider.id ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <RefreshCwIcon />
                    )}
                  </Button>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={provider.health_status} />
                <StatusBadge status={provider.enabled ? "enabled" : "disabled"} />
                {provider.has_credentials ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <ShieldCheckIcon className="size-3" /> credentials configured
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <LockIcon className="size-3" /> credentials not set
                  </span>
                )}
                <span className="text-muted-foreground">
                  registered {fmtDateTime(provider.created_at)}
                </span>
              </div>

              <footer className="mt-auto space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Open a surface</p>
                <nav className="flex flex-wrap gap-x-4 gap-y-1.5">
                  <LaunchLink to={`/noc/providers/${provider.id}`} label="Overview" primary />
                  {provider.kind === "proxmox"
                    ? PROXMOX_SURFACES.map((surface) => (
                        <LaunchLink
                          key={surface.to}
                          to={`/noc/providers/${provider.id}/${surface.to}`}
                          label={surface.label}
                          icon={<surface.icon />}
                        />
                      ))
                    : null}
                </nav>
                {provider.kind === "vmware" ? (
                  <p className="text-xs text-muted-foreground">
                    VMware inventory and guest metrics are platform-admin surfaces on this backend;
                    the NOC role receives HTTP 403 on them.
                  </p>
                ) : null}
                {provider.kind === "dokploy" ? (
                  <p className="text-xs text-muted-foreground">
                    All Dokploy operations — proxy, mirror database and sync — are platform-admin
                    only on this backend.
                  </p>
                ) : null}
                {provider.kind !== "proxmox" &&
                provider.kind !== "vmware" &&
                provider.kind !== "dokploy" ? (
                  <p className="text-xs text-muted-foreground">
                    No cluster observability surfaces for kind {provider.kind}; only the overview
                    and the provider-level sync above.
                  </p>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function LaunchLink({
  to,
  label,
  icon,
  primary = false,
}: {
  to: string
  label: string
  icon?: React.ReactNode
  primary?: boolean
}) {
  return (
    <Link
      to={to}
      className={
        primary
          ? "flex items-center gap-1 text-sm font-medium hover:underline"
          : "flex items-center gap-1 text-xs hover:underline [&_svg]:size-3"
      }
    >
      {icon}
      {label}
      <ArrowRightIcon className={primary ? "size-3.5" : "size-3"} />
    </Link>
  )
}
