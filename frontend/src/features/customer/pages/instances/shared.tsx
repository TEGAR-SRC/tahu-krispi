/* eslint-disable react-refresh/only-export-components */
// Shared helpers for the per-instance deep-dive pages: detail hook, typed
// payload shapes probed against the live backend, and small UI utilities
// (breadcrumb, copy button, expiry countdown).
import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { apiGet, ApiError } from "@/lib/api"
import { orgHeaders, useOrg } from "../../useOrg"
import type { CustomerInstance } from "../../instances/types"

// ---- Payload shapes (verified against the live API / provider adapters) ------

/** GET /instances/:id — the list row fields plus detail-only extras. */
export interface InstanceDetail extends CustomerInstance {
  subscription_id?: string
  billing_period?: string
  child_counts?: { snapshots?: number; backups?: number }
}

/**
 * One firewall rule of the PVE-native per-VM firewall. The backend marshals
 * `provider.ProviderFirewallRule` without JSON tags, so the keys keep Go's
 * capitalization; lowercase fallbacks are accepted defensively.
 */
export interface FirewallRule {
  Pos?: number
  pos?: number
  Enabled?: boolean
  enabled?: boolean
  Type?: string
  type?: string
  Action?: string
  action?: string
  Source?: string
  source?: string
  Destination?: string
  destination?: string
  Proto?: string
  proto?: string
  DestPort?: string
  dest_port?: string
  SourcePort?: string
  source_port?: string
  Comment?: string
  comment?: string
}

export interface FirewallIPSet {
  Name?: string
  name?: string
  Comment?: string
  comment?: string
}

export interface IPSetEntry {
  CIDR?: string
  cidr?: string
  Comment?: string
  comment?: string
}

/** Reverse DNS row: `ip` carries the address with its prefix length. */
export interface RdnsEntry {
  ip: string
  domain: string
}

/** Guest agent payloads are proxied verbatim from qga (kebab-case keys). */
export interface AgentOsInfo {
  pretty_name?: string
  "pretty-name"?: string
  name?: string
  version?: string
  "version-id"?: string
  id?: string
  kernel_release?: string
  "kernel-release"?: string
  kernel_version?: string
  "kernel-version"?: string
  machine?: string
  [key: string]: unknown
}

export interface AgentFsInfo {
  name?: string
  mountpoint?: string
  type?: string
  "used-bytes"?: number
  used_bytes?: number
  "total-bytes"?: number
  total_bytes?: number
  [key: string]: unknown
}

export interface AgentInfo {
  version?: string
  supported_commands?: Array<{ name?: string; enabled?: boolean }>
  [key: string]: unknown
}

// ---- Detail hook -------------------------------------------------------------

interface UseInstanceResult {
  instance: InstanceDetail | null
  loading: boolean
  error: unknown
  reload: () => Promise<void>
}

/** Loads GET /instances/:id for the active organization. */
export function useInstance(instanceId: string | undefined): UseInstanceResult {
  const { orgId } = useOrg()
  const [instance, setInstance] = useState<InstanceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!instanceId || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<InstanceDetail>(`/instances/${instanceId}`, {
        headers: orgHeaders(orgId),
      })
      setInstance(data ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId, orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  return { instance, loading, error, reload: load }
}

/** True when an ApiError means "this provider feature does not exist here". */
export function isUnsupportedFeature(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  // VM-only routes answer 501 on container instances; unmapped instances 409.
  return error.status === 501 || error.status === 409 || error.status === 404
}

// ---- Small shared UI ----------------------------------------------------------

export function InstanceBreadcrumb({
  instanceName,
  section,
}: {
  instanceName?: string
  section?: string
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/app/instances">Instances</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {instanceName ? (
            <BreadcrumbLink asChild>
              <Link to="/app/instances">{instanceName}</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>…</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {section ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{section}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** Copy-to-clipboard icon button with toast-free visual feedback. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard may be unavailable (insecure context); fall back silently.
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label ?? "Copy"}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "expired"
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

/**
 * Live countdown to a unix-seconds timestamp; renders "expired" once passed.
 */
export function ExpiryCountdown({ expireAt }: { expireAt: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    )
    return () => window.clearInterval(interval)
  }, [])

  if (!expireAt) return null
  return (
    <span className="tabular-nums">
      expires in {formatCountdown(expireAt - now)}
    </span>
  )
}


