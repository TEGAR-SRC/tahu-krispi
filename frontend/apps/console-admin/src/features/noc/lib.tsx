// Shared types and helpers for the NOC console pages. All shapes below were
// verified against the live backend with a NOC token (see docs/API_ENDPOINTS.md
// "Admin — Provider instances & infrastructure operations").
import { Badge } from "@/components/ui/badge"
import { statusBadgeVariant } from "./lib-utils"

// ---- API row shapes ----------------------------------------------------------

export interface Provider {
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

export interface InstanceRow {
  id: string
  public_id: string
  organization_id: string
  org_public_id: string
  org_slug: string
  name: string
  status: string
  power_status: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  suspended_at: string
  termination_requested_at: string
  created_at: string
}

/** Subset of the instance detail payload the UI renders. */
export interface InstanceDetail extends InstanceRow {
  hostname: string
  provider_id: string
  region_id: string | null
  primary_ipv4: string
  primary_ipv6: string
  pricing_mode: string
  billing_period: string
  currency: string
  recurring_amount: number
  sync_status: string
  last_synced_at: string
  auto_backup_enabled: boolean
  updated_at: string
  subscription?: {
    id: string
    status: string
    [key: string]: unknown
  } | null
  organization?: { id: string; public_id: string; slug: string; name: string }
  provider_actions?: string[]
  jobs?: JobRow[]
  child_counts?: Record<string, number>
}

export interface JobRow {
  id: string
  queue: string
  job_type: string
  organization_id: string | null
  resource_type: string
  resource_id: string
  status: "queued" | "running" | "retry" | "success" | "failed" | "cancelled"
  attempts: number
  max_attempts: number
  run_after: string
  locked_by: string
  last_error: string
  created_at: string
  completed_at: string
}

export interface TicketRow {
  id: string
  ticket_number: string
  organization_id: string
  org_slug: string
  subject: string
  category: string
  status: string
  priority: string
  assigned_to: string
  created_at: string
  last_reply_at: string
  closed_at: string
}

export interface TicketMessage {
  id: string
  author_type: string
  author_user_id: string
  body: string
  created_at: string
  attachments: Array<{ id: string; filename: string; size_bytes: number; content_type: string }>
}

export interface BlockedNetwork {
  id: string
  network: string
  reason: string
  expires_at: string
  created_by: string
  created_at: string
}

export interface SecurityIncident {
  id: string
  [key: string]: unknown
}

// ---- Status badges --------------------------------------------------------------

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusBadgeVariant(status)} className="capitalize">
      {status || "—"}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge variant="outline" className="uppercase">{kind}</Badge>
}
