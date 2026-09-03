// Provider overview: identity/health card plus quick cluster stats and a grid
// of links into every infrastructure console section for this provider.
// The API has no single-provider GET, so the row is resolved from the list.
import { Link, useParams } from "react-router-dom"
import {
  BoxesIcon,
  ClipboardListIcon,
  CoinsIcon,
  ContainerIcon,
  CpuIcon,
  DatabaseBackupIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  HeartPulseIcon,
  LayersIcon,
  NetworkIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "../shared"
import { formatDateTime } from "../format"
import { useInfraGet } from "./infra"
import type { ProviderRow } from "./types"

interface SectionLink {
  to: string
  title: string
  description: string
  icon: typeof CpuIcon
  /** Which provider kinds the underlying endpoints actually serve. */
  kinds: string[]
}

const SECTIONS: SectionLink[] = [
  {
    to: "nodes",
    title: "Nodes",
    description: "Cluster nodes, per-node detail, disks, certs, power commands.",
    icon: CpuIcon,
    kinds: ["proxmox"],
  },
  {
    to: "storages",
    title: "Cluster storages",
    description: "Storage inventory, content browser and backup file-restore.",
    icon: HardDriveIcon,
    kinds: ["proxmox"],
  },
  {
    to: "backup-jobs",
    title: "Backup jobs",
    description: "Scheduled vzdump jobs — create, edit, run now.",
    icon: DatabaseBackupIcon,
    kinds: ["proxmox"],
  },
  {
    to: "ha",
    title: "HA resources",
    description: "High-availability managed guests and the watchdog.",
    icon: HeartPulseIcon,
    kinds: ["proxmox"],
  },
  {
    to: "firewall",
    title: "Firewall",
    description: "Security groups with rules plus cluster-level firewall rules.",
    icon: ShieldCheckIcon,
    kinds: ["proxmox"],
  },
  {
    to: "sdn",
    title: "SDN",
    description: "Software-defined networking zones and VNets.",
    icon: NetworkIcon,
    kinds: ["proxmox"],
  },
  {
    to: "ceph",
    title: "Ceph",
    description: "Cluster health, OSDs, PG states and throughput.",
    icon: LayersIcon,
    kinds: ["proxmox"],
  },
  {
    to: "containers",
    title: "Containers",
    description: "LXC inventory across the whole cluster.",
    icon: ContainerIcon,
    kinds: ["proxmox"],
  },
  {
    to: "pools",
    description: "Resource pools with a VM/storage membership editor.",
    title: "Pools",
    icon: BoxesIcon,
    kinds: ["proxmox"],
  },
  {
    to: "access",
    title: "Access",
    description: "Users, groups and roles — POST/PUT/DELETE users, read groups/roles.",
    icon: ShieldCheckIcon,
    kinds: ["proxmox"],
  },
  {
    to: "clone",
    title: "Clone (VM+LXC)",
    description: "Full-copy clone for qemu VMs and LXC containers — POST /admin/proxmox/:id/clone.",
    icon: BoxesIcon,
    kinds: ["proxmox"],
  },
  {
    to: "hosts",
    title: "ESXi hosts",
    description: "ESXi hosts with thread count, memory and power state — GET /admin/vmware/:id/hosts (polls every 5s).",
    icon: CpuIcon,
    kinds: ["vmware"],
  },
  {
    to: "datastores",
    title: "Datastores",
    description: "Datastores with capacity/free and usage bar — GET /admin/vmware/:id/datastores (polls every 5s).",
    icon: HardDriveIcon,
    kinds: ["vmware"],
  },
  {
    to: "inventory",
    title: "vSphere inventory",
    description: "Hosts, datastores, clusters and resource pools (vmware only).",
    icon: DatabaseIcon,
    kinds: ["vmware"],
  },
  {
    to: "snapshots/revert",
    title: "Snapshot revert",
    description: "Revert a VM to its vSphere snapshot — POST /admin/vmware/:id/snapshots/:snap/revert (GET /snapshots polls every 5s).",
    icon: DatabaseBackupIcon,
    kinds: ["vmware"],
  },
  {
    to: "migrate",
    title: "Migrate (vMotion)",
    description: "vMotion a VM to another ESXi host — POST /admin/vmware/:id/migrate.",
    icon: ContainerIcon,
    kinds: ["vmware"],
  },
  {
    to: "perf",
    title: "Guest performance",
    description: "Metric charts for one guest; works across kinds.",
    icon: GaugeIcon,
    kinds: ["proxmox", "vmware", "onidel", "dokploy"],
  },
  {
    to: "onidel",
    title: "Onidel catalog",
    description: "Regions, instance types & OS templates synced from api.cloud.onidel.com.",
    icon: LayersIcon,
    kinds: ["onidel"],
  },
  {
    to: "wallets",
    title: "Onidel wallets",
    description: "Wallets per org for Onidel regions — balance, reserved, adjust and transactions.",
    icon: CoinsIcon,
    kinds: ["onidel"],
  },
  {
    to: "jobs",
    title: "Onidel jobs",
    description: "Jobs filtered to queue provider_sync — sync, provisioning and reconciliation.",
    icon: ClipboardListIcon,
    kinds: ["onidel"],
  },
]

export default function ProviderDetailPage() {
  const providerId = useParams().providerId ?? ""
  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = providers.data?.find((row) => row.id === providerId) ?? null

  if (!providerId) {
    return <EmptyState message="Provider id missing." />
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title={match ? `${match.name}` : `Provider ${providerId.slice(0, 8)}…`}
        description={
          match ? `Infrastructure consoles for ${match.code} (${match.kind}).` : undefined
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/providers">All providers</Link>
          </Button>
        }
      />

      {providers.error ? <ErrorBanner error={providers.error} /> : null}
      {providers.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !match ? (
        !providers.error ? (
          <EmptyState message="Provider not found." description="It may have been deleted." />
        ) : null
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {match.name}
                <Badge variant="outline">{match.kind}</Badge>
                {match.enabled ? (
                  <StatusBadge status="active" />
                ) : (
                  <StatusBadge status="disabled" />
                )}
                <StatusBadge status={match.health_status} />
              </CardTitle>
              <CardDescription>Provider registration</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-4">
                <div className="min-w-0 space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Code</dt>
                  <dd className="min-w-0 truncate font-mono text-sm">{match.code}</dd>
                </div>
                <div className="min-w-0 space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">API base URL</dt>
                  <dd className="min-w-0 truncate font-mono text-sm">{match.api_base_url || "—"}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Credentials</dt>
                  <dd className="text-sm">
                    {match.has_credentials ? "configured" : "not set"}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">Created</dt>
                  <dd className="text-sm">{formatDateTime(match.created_at)}</dd>
                </div>
              </dl>
              {!match.has_credentials && (match.kind === "proxmox" || match.kind === "vmware") ? (
                <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  This provider has no stored credentials yet — live infrastructure endpoints
                  answer HTTP 503 until an API key is configured via the provider editor.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Infrastructure sections</h2>
            <p className="text-xs text-muted-foreground">Routes now per-provider — no universal: proxmox → /admin/proxmox/:id/…, onidel → /admin/onidel/:id/…, vmware → /admin/vmware/:id/…, dokploy → /admin/dokploy/…</p>
            <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {SECTIONS.filter((section) => section.kinds.includes(match.kind)).map((section) => {
                const Icon = section.icon
                const prefix =
                  match.kind === "proxmox" ? `/admin/proxmox/${providerId}` :
                  match.kind === "onidel" ? `/admin/onidel/${providerId}` :
                  match.kind === "vmware" ? `/admin/vmware/${providerId}` :
                  match.kind === "dokploy" ? `/admin/dokploy` : `/admin/providers/${providerId}`
                return (
                  <Link
                    key={section.to}
                    to={`${prefix}/${section.to}`}
                    className="group"
                  >
                    <Card className="h-full transition-colors group-hover:border-primary/50">
                      <CardContent className="flex items-start gap-3 px-4">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                          <Icon />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium leading-tight">{section.title}</p>
                          <p className="text-xs text-muted-foreground">{section.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
