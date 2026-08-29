// Shared plumbing for the admin provider infrastructure consoles: the
// breadcrumb shell every sub-page starts with and a controlled
// destructive-confirmation dialog. The GET loader hook and its formatters live
// in ./infra.ts, the payload types (go-proxmox SDK structs the backend
// serializes verbatim) in ./types.ts, so this module only exports components.
import { type ReactNode } from "react"
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
import { useInfraGet } from "./infra"
import type { ProviderRow } from "./types"

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
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
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
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
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
              destructive ? "bg-destructive text-primary-foreground hover:bg-destructive/90" : ""
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

