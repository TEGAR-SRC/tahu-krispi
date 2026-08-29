// NOC provider overview: identity/health card, the NOC-permitted sync action
// and links into every read-only infrastructure sub-console.
import { useCallback, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiPost } from "@/lib/api"
import { toast } from "sonner"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { StatCard } from "@/components/shared/StatCard"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ActivityIcon,
  ArrowRightIcon,
  BoxesIcon,
  DatabaseBackupIcon,
  HardDriveIcon,
  KeyRoundIcon,
  Loader2Icon,
  MonitorCheckIcon,
  NetworkIcon,
  RefreshCwIcon,
  ServerCogIcon,
  ShieldHalfIcon,
} from "lucide-react"
import { KindBadge, StatusBadge } from "../../lib"
import { fmtDateTime, toastApiError } from "../../lib-utils"
import { AdminOnlyHint, HealthBadge } from "./pve"
import { useNocProvider } from "./pve-utils"

const SUBPAGES = [
  {
    to: "cluster",
    title: "Cluster",
    description: "Nodes, guest inventory, cluster log, tasks and CPU models.",
    icon: ServerCogIcon,
  },
  {
    to: "nodes",
    title: "Nodes",
    description: "Per-node health with drill-down into disks, certs, DNS and time.",
    icon: HardDriveIcon,
  },
  {
    to: "storages",
    title: "Storages",
    description: "Cluster storage inventory, content browser and file-restore viewer.",
    icon: DatabaseBackupIcon,
  },
  {
    to: "backup-jobs",
    title: "Backup jobs",
    description: "Scheduled vzdump/PBS jobs with schedule and next run.",
    icon: BoxesIcon,
  },
  {
    to: "firewall",
    title: "Firewall",
    description: "Security groups, their rules and cluster-level rules.",
    icon: ShieldHalfIcon,
  },
  {
    to: "services",
    title: "Services",
    description: "LXC containers, SDN zones/vnets, Ceph health and pools.",
    icon: NetworkIcon,
  },
] as const

export default function NocProviderDetailPage() {
  const providerId = useParams().providerId
  const { provider, loading, error } = useNocProvider(providerId)
  const [syncing, setSyncing] = useState(false)

  const sync = useCallback(async () => {
    if (!providerId) return
    setSyncing(true)
    try {
      await apiPost(`/admin/providers/${providerId}/sync`)
      toast.success("Catalog sync job queued")
    } catch (cause) {
      toastApiError(cause, "Could not queue the sync job")
    } finally {
      setSyncing(false)
    }
  }, [providerId])

  if (error) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <ProviderBreadcrumb name={null} />
        <ErrorBanner error={error} />
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <ProviderBreadcrumb name={provider?.name ?? null} />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : provider ? (
        <>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{provider.name}</h1>
              <KindBadge kind={provider.kind} />
            </div>
            <p className="text-sm text-muted-foreground">
              {provider.code} · {provider.api_base_url || "no API base URL"} · registered{" "}
              {fmtDateTime(provider.created_at)}
            </p>
          </div>

          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Health" value={<HealthBadge status={provider.health_status} />} hint="as reported by the last probe" icon={<ActivityIcon />} />
            <StatCard label="Enabled" value={<StatusBadge status={provider.enabled ? "enabled" : "disabled"} />} hint="create/delete stays platform-admin only" icon={<MonitorCheckIcon />} />
            <StatCard label="Credentials" value={provider.has_credentials ? "configured" : "not set"} hint={provider.has_credentials ? undefined : "cluster endpoints answer 503 until set"} icon={<KeyRoundIcon />} />
            <StatCard label="Consoles" value={SUBPAGES.length} hint="read-only infrastructure surfaces" icon={<ServerCogIcon />} />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Infrastructure consoles</h2>
              <Button size="sm" variant="outline" onClick={() => void sync()} disabled={syncing}>
                {syncing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Queue catalog sync
              </Button>
            </div>
            {!provider.has_credentials ? (
              <AdminOnlyHint>
                Cluster observability needs provider credentials ({provider.code} currently has none);
                every sub-page will surface the backend's PROVIDER_UNAVAILABLE error until they are set.
              </AdminOnlyHint>
            ) : null}
            <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SUBPAGES.map((sub) => (
                <Link
                  key={sub.to}
                  to={`/noc/providers/${provider.id}/${sub.to}`}
                  className="group rounded-md border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      <sub.icon className="size-4 text-muted-foreground" />
                      {sub.title}
                    </span>
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{sub.description}</p>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState message="Provider not found." description={`No provider row matches ${providerId}.`} />
      )}
    </div>
  )
}

export function ProviderBreadcrumb({ name }: { name: string | null }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/noc/providers">Providers</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {name ? (
            <BreadcrumbPage>{name}</BreadcrumbPage>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** Shared breadcrumb trail for every provider sub-console page. */
export function ProviderSubBreadcrumb({
  providerId,
  providerName,
  page,
}: {
  providerId?: string
  providerName?: string | null
  page: string
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/noc/providers">Providers</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={`/noc/providers/${providerId ?? ""}`}>
              {providerName ?? "Provider"}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{page}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
