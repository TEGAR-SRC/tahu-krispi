// Shared plumbing for the admin provider infrastructure consoles: a GET
// loader hook, the breadcrumb shell every sub-page starts with, small number
// formatters and a controlled destructive-confirmation dialog. Payload shapes
// mirror the go-proxmox SDK structs the backend serializes verbatim.
import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { apiGet } from "@/lib/api"

/** A row of GET /v1/admin/providers (no single-provider endpoint exists). */
export interface ProviderRow {
  id: string
  code: string
  name: string
  kind: string
  api_base_url: string
  enabled: boolean
  health_status: string
  has_credentials: boolean
  created_at: string
}

export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: unknown
}

/**
 * Generic GET loader; `path === null` means idle (no request). Query objects
 * are compared by value so call sites can pass fresh literals.
 */
export function useInfraGet<T>(
  path: string | null,
  query?: Record<string, string | number | null | undefined>,
): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  })
  const [tick, setTick] = useState(0)
  const queryKey = JSON.stringify(query ?? null)
  useEffect(() => {
    if (!path) {
      const t = setTimeout(() => setState({ data: null, loading: false, error: null }), 0)
      return () => clearTimeout(t)
    }
    let cancelled = false
    apiGet<T>(path, { query: query ?? undefined })
      .then((envelope) => {
        if (!cancelled) setState({ data: envelope.data, loading: false, error: null })
      })
      .catch((cause) => {
        if (!cancelled) setState({ data: null, loading: false, error: cause })
      })
    return () => {
      cancelled = true
    }
  }, [path, tick, queryKey])
  return { ...state, reload: () => setTick((value) => value + 1) }
}

interface ProviderShellProps {
  providerId: string
  /** Trailing crumb + h1; the provider name is resolved automatically. */
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

/**
 * Breadcrumb shell shared by every provider sub-page. The provider display
 * name comes from the providers list (the API has no GET-by-id route); while
 * it loads the raw id is shown instead.
 */
export function ProviderShell({
  providerId,
  title,
  description,
  actions,
  children,
}: ProviderShellProps) {
  const provider = useInfraGet<ProviderRow[]>(`/admin/providers`)
  const match = provider.data?.find((row) => row.id === providerId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/providers">Providers</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/admin/providers/${providerId}`}>
                {match ? match.code : providerId.slice(0, 8)}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children}
    </div>
  )
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

/** Human-readable byte size ("1.5 GB"); "—" for null/NaN inputs. */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—"
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** Seconds → compact humanized uptime ("3d 4h", "12m"); "—" when absent. */
export function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** 0..1 fraction → percent string with one decimal; "—" otherwise. */
export function formatPercent(fraction?: number | null): string {
  if (fraction === undefined || fraction === null || Number.isNaN(fraction)) {
    return "—"
  }
  return `${(fraction * 100).toFixed(1)}%`
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  /** Optional extra controls (e.g. a purge checkbox) under the description. */
  children?: ReactNode
  onConfirm: () => void
}

/** Controlled confirmation dialog used for every destructive mutation. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  destructive = true,
  busy = false,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={
              destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---- Payload types mirroring the backend (go-proxmox SDK JSON) ---------------

/** One entry of GET …/cluster → nodes[] (SDK NodeStatus). */
export interface PveNodeStatus {
  node?: string
  name?: string
  status?: string
  level?: string
  online?: number
  local?: number
  nodeid?: number
  ip?: string
  type?: string
  maxcpu?: number
  cpu?: number
  maxmem?: number
  mem?: number
  maxdisk?: number
  disk?: number
  uptime?: number
  ssl_fingerprint?: string
  [key: string]: unknown
}

/** One entry of GET …/cluster → resources[] (SDK ClusterResource). */
export interface PveClusterResource {
  id: string
  type: string
  node?: string
  status?: string
  name?: string
  vmid?: number
  template?: number
  pool?: string
  pluginType?: string
  maxcpu?: number
  cpu?: number
  maxmem?: number
  mem?: number
  maxdisk?: number
  disk?: number
  uptime?: number
  storage?: string
  content?: string
  [key: string]: unknown
}

export interface ClusterPayload {
  provider_id: string
  code: string
  nodes?: PveNodeStatus[]
  resources?: PveClusterResource[]
}

/** One entry of GET …/cluster-storages (SDK ClusterStorage). */
export interface ClusterStorage {
  storage?: string
  type?: string
  content?: string
  digest?: string
  shared?: number
  nodes?: string
  thinpool?: string
  path?: string
  vgname?: string
  [key: string]: unknown
}

/** One entry of GET …/storages/:storage/content?node= (SDK StorageContent). */
export interface StorageContentItem {
  volid?: string
  format?: string
  size?: number
  used?: number
  ctime?: number | string
  vmid?: number
  notes?: string
  encrypted?: string
  protection?: number | boolean
  parent?: string
  verification?: { state?: string; upid?: string } | null
  [key: string]: unknown
}

/** One entry of the backup file-restore browser (SDK StorageFileRestoreEntry). */
export interface FileRestoreEntry {
  filepath?: string
  text?: string
  type?: string // "f" file, "d" directory, "l" link
  size?: number
  mtime?: number
  leaf?: number | boolean
  [key: string]: unknown
}

/** Scheduled vzdump job from GET …/backup-jobs (SDK ClusterBackup). */
export interface BackupJobRow {
  id?: string
  schedule?: string
  enabled?: number | boolean
  repeat_missed?: number | boolean
  all?: number | boolean
  notes_template?: string
  mailnotification?: string
  mailto?: string
  mode?: string
  type?: string
  next_run?: number
  storage?: string
  vmid?: string
  exclude?: string
  node?: string
  pool?: string
  bwlimit?: number
  comment?: string
  prune_backups?: string
  [key: string]: unknown
}

/** HA-managed guest from GET …/ha-resources (SDK HAResource). */
export interface HAResource {
  sid?: string
  type?: string
  group?: string
  comment?: string
  digest?: string
  state?: string
  failback?: number | boolean
  max_relocate?: number
  max_restart?: number
  [key: string]: unknown
}

/** Firewall rule (security-group or cluster level; SDK FirewallRule). */
export interface FirewallRule {
  type?: string
  action?: string
  pos?: number
  comment?: string
  dest?: string
  dport?: string
  enable?: number
  icmp_type?: string
  iface?: string
  log?: string
  macro?: string
  proto?: string
  source?: string
  sport?: string
  [key: string]: unknown
}

/** Security group from GET …/fw-groups (SDK FirewallSecurityGroup). */
export interface FirewallGroup {
  group?: string
  comment?: string
  rules?: FirewallRule[]
  [key: string]: unknown
}

/** Pool entry from GET …/pools (SDK Pool). */
export interface PoolRow {
  poolid?: string
  comment?: string
  members?: PveClusterResource[]
  [key: string]: unknown
}

/** SDN zone from GET …/sdn/zones (SDK SDNZone). */
export interface SdnZone {
  zone?: string
  type?: string
  dhcp?: string
  dns?: string
  dnszone?: string
  ipam?: string
  mtu?: number
  nodes?: string
  peers?: string
  pending?: boolean
  reversedns?: string
  state?: string
  [key: string]: unknown
}

/** SDN vnet from GET …/sdn/vnets (SDK VNet). */
export interface SdnVnet {
  vnet?: string
  type?: string
  zone?: string
  alias?: string
  vlanaware?: number
  tag?: number
  [key: string]: unknown
}

/** Ceph health check entry inside ClusterCephStatus.health.checks. */
export interface CephHealthCheck {
  detail?: Array<{ message?: string }>
  muted?: boolean
  severity?: string
  summary?: { count?: number; message?: string }
}

/** GET …/ceph-status payload (SDK ClusterCephStatus). */
export interface CephStatusPayload {
  election_epoch?: number
  fsid?: string
  health?: {
    checks?: Record<string, CephHealthCheck>
    mutes?: unknown[]
    status?: string
  }
  osdmap?: {
    epoch?: number
    num_in_osds?: number
    num_osds?: number
    num_remapped_pgs?: number
    num_up_osds?: number
    osd_in_since?: number
    osd_up_since?: number
  }
  pgmap?: {
    bytes_avail?: number
    bytes_total?: number
    bytes_used?: number
    data_bytes?: number
    num_objects?: number
    num_pgs?: number
    num_pools?: number
    pgs_by_state?: Array<{ count?: number; state_name?: string }>
    read_bytes_sec?: number
    read_op_per_sec?: number
    write_bytes_sec?: number
    write_op_per_sec?: number
  }
  quorum_names?: string[]
  monmap?: {
    created?: string
    modified?: string
    mons?: Array<{
      addr?: string
      name?: string
      rank?: number
      weight?: number
      public_addr?: string
    }>
  }
  [key: string]: unknown
}

/**
 * LXC inventory rows come from the adapter's VMState struct which has no JSON
 * tags, so Go exports the fields with their Go names verbatim.
 */
export interface ContainerRow {
  ExternalID?: string
  Name?: string
  Status?: string
  PowerStatus?: string
  MainIPv4?: string
  MainIPv6?: string
  Template?: string
  VCPU?: number
  RAM?: number
  Disk?: number
  BWUsed?: number
  RecurringAmount?: number
  Currency?: string
  [key: string]: unknown
}
