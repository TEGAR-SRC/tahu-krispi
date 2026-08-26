/* eslint-disable react-refresh/only-export-components */
// Local helpers for the Dokploy settings parity pages (scope K7). Kept here
// because src/components/shared and lib are frozen for this wave.
import type { ReactNode } from "react"
import { toast } from "sonner"
import { toErrorMessage, type UpstreamError } from "../shared"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Maps a relayed upstream zod validation error onto `{ field: message }`.
 * Upstream bodies look like
 * `{ data: { zodError: { fieldErrors: { field: [msgs] } } }, issues: [...] }`
 * with the `zodError` sometimes nested one level shallower.
 */
export function extractFieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const err = error as UpstreamError | undefined
  if (!err || typeof err.status !== "number" || !err.body) return out

  let body: unknown
  try {
    body = JSON.parse(err.body)
  } catch {
    return out
  }
  if (!isRecord(body)) return out

  const candidates = [
    body["data"],
    body,
    isRecord(body["data"]) ? (body["data"] as Record<string, unknown>)["error"] : undefined,
  ]
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const zod = candidate["zodError"]
    if (isRecord(zod) && isRecord(zod["fieldErrors"])) {
      for (const [key, messages] of Object.entries(zod["fieldErrors"])) {
        if (Array.isArray(messages) && messages.length > 0 && !(key in out)) {
          out[key] = messages.map(String).join("; ")
        }
      }
    }
  }

  if (Array.isArray(body["issues"])) {
    for (const issue of body["issues"]) {
      if (!isRecord(issue)) continue
      const path = issue["path"]
      const key = Array.isArray(path) && path.length > 0 ? String(path[0]) : ""
      const message = issue["message"]
      if (key !== "" && typeof message === "string" && !(key in out)) {
        out[key] = message
      }
    }
  }
  return out
}

/** Red inline validation text shown under an input. */
export function FieldErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p className="text-xs font-medium text-destructive">{children}</p>
}

/** Pretty-printed JSON viewer for opaque payloads. */
export function JsonBlock({ value }: { value: unknown }) {
  let text: string
  if (typeof value === "string") text = value
  else {
    try {
      text = JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed break-all whitespace-pre-wrap">
      {text}
    </pre>
  )
}

/**
 * Runs a mutation with toasts; returns the upstream field-error map when the
 * failure was a zod validation relay.
 */
export async function runMutation(
  action: () => Promise<unknown>,
  opts: { success: string; onDone?: () => void },
): Promise<{ ok: boolean; fieldErrors: Record<string, string>; message: string }> {
  try {
    await action()
    toast.success(opts.success)
    opts.onDone?.()
    return { ok: true, fieldErrors: {}, message: "" }
  } catch (cause) {
    toast.error(toErrorMessage(cause))
    return { ok: false, fieldErrors: extractFieldErrors(cause), message: toErrorMessage(cause) }
  }
}

/** Common event toggles shared by every notification provider form. */
export interface NotificationEvents {
  appDeploy: boolean
  appBuildError: boolean
  databaseBackup: boolean
  dokployBackup: boolean
  volumeBackup: boolean
  dokployRestart: boolean
  dockerCleanup: boolean
  serverThreshold: boolean
}

export const NOTIFICATION_EVENTS: Array<{ key: keyof NotificationEvents; label: string }> = [
  { key: "appDeploy", label: "App Deploy" },
  { key: "appBuildError", label: "App Build Error" },
  { key: "databaseBackup", label: "Database Backup" },
  { key: "dokployBackup", label: "Dokploy Backup" },
  { key: "volumeBackup", label: "Volume Backup" },
  { key: "dokployRestart", label: "Dokploy Restart" },
  { key: "dockerCleanup", label: "Docker Cleanup" },
  { key: "serverThreshold", label: "Server Threshold" },
]
