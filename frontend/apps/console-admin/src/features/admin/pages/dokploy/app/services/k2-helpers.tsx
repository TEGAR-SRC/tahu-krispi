/* eslint-disable react-refresh/only-export-components */
// Shared plumbing for the K2 application-service detail page. Mirrors the
// conventions established by the settings wave (settings/helpers.tsx) on top
// of the universal proxy in ../shared.ts.
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { UpstreamError } from "../shared"
import { toErrorMessage } from "../shared"

/** Upstream rows arrive as plain JSON — treat them as loose records. */
export type Row = Record<string, unknown>

export function s(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

export function bool(value: unknown): boolean {
  return value === true || value === "true"
}

export function numOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Formats an ISO date for table cells; passes through junk untouched. */
export function fmtDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Maps a relayed upstream zod validation error onto `{ field: message }`.
 * Proxy error bodies look like
 * `{ data: { zodError: { fieldErrors: { field: [msgs] } } }, issues: [...] }`.
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

  for (const candidate of [body["data"], body]) {
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

/**
 * Runs a mutation with toasts; returns the upstream field-error map when the
 * failure was a zod validation relay.
 */
export async function runMutation(
  action: () => Promise<unknown>,
  opts: { success?: string; onDone?: () => void },
): Promise<{ ok: boolean; fieldErrors: Record<string, string>; message: string }> {
  try {
    await action()
    if (opts.success) toast.success(opts.success)
    opts.onDone?.()
    return { ok: true, fieldErrors: {}, message: "" }
  } catch (cause) {
    toast.error(toErrorMessage(cause))
    return {
      ok: false,
      fieldErrors: extractFieldErrors(cause),
      message: toErrorMessage(cause),
    }
  }
}

/**
 * SimpleDataTable/ErrorBanner only render `Error` instances verbatim; wrap
 * proxy failures so the upstream message (with status prefix) shows as-is.
 */
export function asDisplayError(error: unknown): Error | null {
  if (!error) return null
  if (error instanceof Error) return error
  return new Error(toErrorMessage(error))
}

/** Error banner rendering `toErrorMessage(error)` verbatim. */
export function K2ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {toErrorMessage(error)}
    </div>
  )
}

interface ConfirmActionProps {
  trigger: ReactNode
  title: string
  description?: string
  confirmLabel?: string
  /** Destructive actions render a red confirm button. */
  destructive?: boolean
  onConfirm: () => Promise<void> | void
}

/** Confirmation behind AlertDialog, mirroring upstream DialogAction. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={running}
            onClick={async () => {
              setRunning(true)
              try {
                await onConfirm()
                setOpen(false)
              } finally {
                setRunning(false)
              }
            }}
          >
            {running ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
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

/** Small labeled form row used across the K2 dialogs. */
export function FieldRow({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-1.5">
      <label className="text-sm leading-none font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      <FieldErrorText>{error}</FieldErrorText>
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-emerald-500",
  idle: "bg-slate-400",
  done: "bg-emerald-500",
  error: "bg-red-500",
  exited: "bg-red-500",
}

/** Colored status dot + label used in the header and deployment cards. */
export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-amber-500"
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium capitalize">
      <span className={`size-2 rounded-full ${color}`} aria-hidden />
      {status || "unknown"}
    </span>
  )
}

export function StatusDot({ status }: { status: string }) {
  const descriptions: Record<string, string> = {
    idle: "Service created but never deployed or stopped.",
    running: "Application is running.",
    error: "Last deployment failed or the service crashed.",
    updating: "A deployment is in progress.",
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1.5">
          <StatusBadge status={status} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {descriptions[status] ?? `Status reported by the server: ${status}`}
      </TooltipContent>
    </Tooltip>
  )
}

/** Section card header shared by the advanced sub-views. */
export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex min-w-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** Inline save button with pending state, right-aligned. */
export function SaveButton({
  saving,
  label = "Save",
  onClick,
}: {
  saving: boolean
  label?: string
  onClick: () => void
}) {
  return (
    <div className="flex justify-end">
      <Button size="sm" disabled={saving} onClick={onClick}>
        {saving ? "Saving…" : label}
      </Button>
    </div>
  )
}
