// Shared types and helpers for the NOC provider infrastructure pages. Every
// shape below mirrors what the backend actually serializes: PVE observability
// endpoints pass through go-proxmox structs verbatim (hence some PascalCase
// payloads like the node detail or LXC container rows), while others are
// wrapped in fiber.Map envelopes ({provider_id, code, nodes, resources}).
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { apiGet } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { InfoIcon } from "lucide-react"

// ---- Typed fetch hook ----------------------------------------------------------

interface TypedQuery {
  [key: string]: string | number | boolean | null | undefined
}

/** Fetches one NOC-readable endpoint into a typed payload, reload-able. */
export function useTyped<T>(
  path: string,
  opts?: { query?: TypedQuery; enabled?: boolean },
): { data: T | null; loading: boolean; error: unknown; reload: () => void } {
  const queryKey = JSON.stringify(opts?.query ?? {})
  const enabled = opts?.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<T>(path, {
      query: JSON.parse(queryKey) as Record<string, string | number | boolean>,
    })
      .then((envelope) => {
        if (!cancelled) setData(envelope.data)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, queryKey, enabled, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}

// ---- Provider row ------------------------------------------------------------

export interface NocProvider {
  id: string
  code: string
  name: string
  kind: "onidel" | "proxmox" | "vmware" | "dokploy" | "xcpng" | "hyperv" | "custom"
  api_base_url: string
  enabled: boolean
  health_status: string
  has_credentials: boolean
  created_at: string
}

/** Resolves one provider row through GET /admin/providers (no single GET). */
export function useNocProvider(providerId: string | undefined): {
  provider: NocProvider | null
  loading: boolean
  error: unknown
} {
  const [provider, setProvider] = useState<NocProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<NocProvider[]>("/admin/providers")
      .then((envelope) => {
        if (cancelled) return
        setProvider(envelope.data.find((row) => row.id === providerId) ?? null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  return { provider, loading, error }
}

// ---- PVE payload types ---------------------------------------------------------

/** go-proxmox NodeStatus as served by GET .../cluster (`nodes`). */
export interface PveNode {
  id?: string
  node?: string
  name?: string
  status?: string
  online?: number
  local?: number
  nodeid?: number
  ip?: string
  level?: string
  type?: string
  maxcpu?: number
  cpu?: number
  maxmem?: number
  mem?: number
  maxdisk?: number
  disk?: number
  uptime?: number
}

/** go-proxmox ClusterResource as served by GET .../cluster (`resources`). */
export interface PveResource {
  id?: string
  type?: string
  name?: string
  node?: string
  status?: string
  pool?: string
  vmid?: number
  template?: number
  content?: string
  pluginType?: string
  storage?: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  hastate?: string
  tags?: string
}

/** GET .../cluster-storages rows (go-proxmox ClusterStorage). */
export interface PveClusterStorage {
  storage?: string
  type?: string
  content?: string
  digest?: string
  shared?: number
  nodes?: string
  path?: string
  thinpool?: string
  vgname?: string
}

/** GET .../nodes/:node/storages rows (go-proxmox Storage). */
export interface PveNodeStorage {
  node?: string
  storage?: string
  type?: string
  content?: string
  enabled?: number
  active?: number
  shared?: number
  total?: number
  used?: number
  avail?: number
  used_fraction?: number
}

/** go-proxmox Task as served by cluster/tasks and nodes/:node/tasks. */
export interface PveTask {
  UPID?: string
  ID?: string
  Type?: string
  User?: string
  Status?: string
  Node?: string
  ExitStatus?: string
  Saved?: string
  IsCompleted?: boolean
  IsRunning?: boolean
  IsFailed?: boolean
  IsSuccessful?: boolean
}

/** go-proxmox ClusterLogEntry as served by cluster/log. */
export interface PveLogEntry {
  node?: string
  time?: number
  uid?: number
  user?: string
  pri?: number
  tag?: string
  pid?: number
  msg?: string
  upid?: string
}

/** go-proxmox FirewallSecurityGroup. */
export interface PveFwGroup {
  group?: string
  comment?: string
}

/** go-proxmox FirewallRule (security-group and cluster-level). */
export interface PveFwRule {
  pos?: number
  type?: string
  action?: string
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  enable?: number
  macro?: string
  iface?: string
  log?: string
  "icmp-type"?: string
  comment?: string
}

/** go-proxmox ClusterBackup as served by GET .../backup-jobs. */
export interface PveBackupJob {
  id?: string
  enabled?: boolean | number | string
  schedule?: string
  next_run?: number
  "next-run"?: number
  mode?: string
  storage?: string
  node?: string
  pool?: string
  vmid?: string
  all?: boolean | number | string
  exclude?: string
  mailto?: string
  mailnotification?: string
  "notes-template"?: string
  "prune-backups"?: string
  bwlimit?: number
  comment?: string
}

/** provider.VMState — LXC inventory rows keep Go field names in JSON. */
export interface PveContainer {
  ExternalID?: string
  Name?: string
  Status?: string
  PowerStatus?: string
  MainIPv4?: string
  Template?: string
  VCPU?: number
  RAM?: number
  Disk?: number
}

/** go-proxmox VNet (sdn/vnets). */
export interface PveVnet {
  vnet?: string
  zone?: string
  type?: string
  alias?: string
  tag?: number
  vlanaware?: number
}

/** go-proxmox SDNZone (sdn/zones). */
export interface PveZone {
  zone?: string
  type?: string
  state?: string
  pending?: boolean
  nodes?: string
  ipam?: string
  mtu?: number
  dhcp?: string
  dns?: string
  dnszone?: string
}

/** go-proxmox Pool (pools). */
export interface PvePool {
  poolid?: string
  comment?: string
  members?: PveResource[]
}

/** go-proxmox QEMUCPUModel (cpu-models). */
export interface PveCpuModel {
  name?: string
  vendor?: string
  custom?: boolean
  abstract?: boolean
}

/** go-proxmox Disk (nodes/:node/disks). */
export interface PveDisk {
  devpath?: string
  type?: string
  model?: string
  serial?: string
  size?: number
  used?: string
  health?: string
  wearout?: string
  vendor?: string
  wwn?: string
  osdid?: number
  mounted?: string
  gpt?: boolean | number
  rpm?: number
}

/** go-proxmox NodeCertificate (nodes/:node/certs). */
export interface PveCert {
  filename?: string
  subject?: string
  issuer?: string
  fingerprint?: string
  "not-before"?: string
  "not-after"?: string
  "public-key-type"?: string
  "public-key-bits"?: number
  san?: string[]
  pem?: string
}

/** go-proxmox StorageContent (storages/:storage/content). */
export interface PveContentItem {
  volid?: string
  format?: string
  size?: number
  used?: number
  ctime?: string | number
  vmid?: number
  notes?: string
  protected?: boolean | number
  encrypted?: string
}

/** go-proxmox StorageFileRestoreEntry (file-restore browser). */
export interface PveFileRestoreEntry {
  filepath?: string
  text?: string
  type?: string // "f" file, "d" directory, "l" link
  size?: number
  mtime?: number
  leaf?: boolean | number
}

/** GET .../cluster envelope. */
export interface PveClusterPayload {
  provider_id?: string
  code?: string
  nodes?: PveNode[]
  resources?: PveResource[]
}

// ---- Formatting ------------------------------------------------------------------

export function fmtUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function fmtEpoch(seconds?: number | string | null): string {
  const n = typeof seconds === "string" ? Number(seconds) : seconds
  if (!n || n <= 0 || Number.isNaN(n)) return "—"
  return new Date(n * 1000).toLocaleString()
}

/** Renders a 0..1 fraction as a percentage, tolerating missing values. */
export function fmtFraction(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—"
  return `${Math.round(value * 100)}%`
}

/** Coerces PVE IntOrBool columns (true/1/"1") to a display value. */
export function flagLabel(value: boolean | number | string | undefined, on = "yes", off = "no"): string {
  return value === true || value === 1 || value === "1" ? on : off
}

// ---- Small building blocks ---------------------------------------------------------

/**
 * Explains why every PVE surface answers 501/503 when the selected provider is
 * not a credentialed Proxmox — keeps empty states honest instead of looking
 * like bugs.
 */
export function ProviderSurfaceNote({ kind }: { kind?: string }) {
  if (!kind || kind === "proxmox") return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <p>
        This provider reports kind <span className="font-medium">{kind}</span>. The Proxmox
        cluster observability endpoints answer <code>501</code> for non-PVE kinds, so the
        sections below are expected to stay empty until a proxmox provider is selected.
      </p>
    </div>
  )
}

/** Muted inline hint used wherever platform-admin-only mutations were hidden. */
export function AdminOnlyHint({ children }: { children?: ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground">
      {children ?? "Write operations on this surface are restricted to platform admins."}
    </p>
  )
}

export function HealthBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase()
  const variant =
    s === "online" || s === "ok" || s === "healthy"
      ? "default"
      : s === "offline" || s === "unavailable" || s === "failed"
        ? "destructive"
        : s === ""
          ? "outline"
          : "secondary"
  return <Badge variant={variant} className="capitalize">{status || "—"}</Badge>
}
