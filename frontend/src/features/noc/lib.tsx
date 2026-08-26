// Shared types and helpers for the NOC console pages. All shapes below were
// verified against the live backend with a NOC token (see docs/API_ENDPOINTS.md
// "Admin — Provider instances & infrastructure operations").
import { Badge } from "@/components/ui/badge"
import { ApiError } from "@/lib/api"
import { toast } from "sonner"
import type { ReactNode } from "react"

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

// ---- Formatting ----------------------------------------------------------------

/** Humanized local timestamp, or an em-dash for blank values. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

/** Money formatter; currency comes from the API field when present. */
export function formatMoney(amount?: number | null, currency?: string | null): string {
  if (amount === null || amount === undefined) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency && currency.length === 3 ? currency : "USD",
    }).format(amount)
  } catch {
    return `${amount} ${currency ?? ""}`.trim()
  }
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

// ---- Status badges --------------------------------------------------------------

const BAD_STATUSES = new Set([
  "failed",
  "cancelled",
  "dead",
  "error",
  "disabled",
  "unavailable",
  "deleted",
  "deleting",
])
const BUSY_STATUSES = new Set([
  "queued",
  "running",
  "retry",
  "provisioning",
  "pending",
  "pending_payment",
  "waiting_customer",
  "waiting_staff",
  "investigating",
  "unknown",
])

export function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase()
  if (BAD_STATUSES.has(s)) return "destructive"
  if (BUSY_STATUSES.has(s)) return "secondary"
  if (s === "" || s === "—") return "outline"
  return "default"
}

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

// ---- Error toasts ----------------------------------------------------------------

/** Toast helper for mutations; calls out 403 explicitly since NOC is scoped. */
export function toastApiError(error: unknown, fallback = "Request failed"): void {
  if (error instanceof ApiError) {
    const suffix = error.status === 403 ? " — not permitted for the NOC role" : ""
    toast.error(`${error.message || fallback}${suffix}`, {
      description: `${error.code} · HTTP ${error.status}`,
    })
  } else {
    toast.error(fallback)
  }
}

// ---- Misc ------------------------------------------------------------------------

/** Renders `value` when it is a plain string, else a compact JSON preview. */
export function previewValue(value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
