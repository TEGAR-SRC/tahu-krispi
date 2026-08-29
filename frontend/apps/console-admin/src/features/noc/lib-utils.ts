// Non-component helpers extracted from lib.tsx so that file only exports
// components + types (react-refresh/only-export-components).
import { ApiError } from "@/lib/api"
import { toast } from "sonner"
import type { ReactNode } from "react"

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

/** Humanized local timestamp, or an em-dash for blank values. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

/** Money formatter; currency comes from the API field when present. */
export function formatMoney(amount?: number | null, currency?: string | null): string {
  if (amount === null || amount === undefined) return "—"
  const code = currency && currency.length === 3 ? currency : "IDR"
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "IDR" || code === "VND" ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${code}`.trim()
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

export function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase()
  if (BAD_STATUSES.has(s)) return "destructive"
  if (BUSY_STATUSES.has(s)) return "secondary"
  if (s === "" || s === "—") return "outline"
  return "default"
}

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

/** Renders `value` when it is a plain string, else a compact JSON preview. */
export function previewValue(value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
