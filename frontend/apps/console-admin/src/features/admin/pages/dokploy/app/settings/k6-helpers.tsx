/* eslint-disable react-refresh/only-export-components */
// Shared plumbing for the K6 settings pages (Profile, Users, Sessions,
// AuditLogs, Ai, Secrets, Dns). Mirrors the upstream Dokploy settings UI on
// top of the universal proxy in ../shared.ts.
import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { UpstreamError } from "../shared"
import { toErrorMessage } from "../shared"

/** Formats an ISO date for table cells; passes through junk untouched. */
export function fmtDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
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

type ZodBody = {
  data?: { zodError?: { fieldErrors?: Record<string, string[]> } }
}

/** Extracts upstream zod field errors from a failed proxied call, if any. */
export function fieldErrorsFrom(error: unknown): Record<string, string[]> | null {
  const err = error as UpstreamError
  if (!err || typeof err.status !== "number" || typeof err.body !== "string") return null
  try {
    const parsed = JSON.parse(err.body) as ZodBody
    const fe = parsed?.data?.zodError?.fieldErrors
    if (fe && Object.keys(fe).length > 0) return fe
    return null
  } catch {
    return null
  }
}

export function K6Breadcrumbs({ current }: { current: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin/dokploy">Dokploy PaaS</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin/dokploy/app">App</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Settings · {current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

interface ConfirmActionProps {
  trigger: ReactNode
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => Promise<void> | void
  /** Disables the action button while the mutation runs. */
  busy?: boolean
}

/** Destructive-ish confirmation behind AlertDialog, mirroring DialogAction upstream. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  busy,
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
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || running}
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
            {busy || running ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Pretty-printed JSON viewer for opaque upstream payloads (metadata etc.). */
export function JsonViewerDialog({
  label = "View",
  value,
  title,
}: {
  label?: string
  value: unknown
  title: string
}) {
  const text =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.stringify(JSON.parse(value), null, 2)
          } catch {
            return value
          }
        })()
      : JSON.stringify(value, null, 2)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed break-all whitespace-pre-wrap">
          {text}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

/** Small labeled form row used by the settings dialogs. */
export function FieldRow({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-1.5">
      <label className="text-sm leading-none font-medium">{label}</label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}
