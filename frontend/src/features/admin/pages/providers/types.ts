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
