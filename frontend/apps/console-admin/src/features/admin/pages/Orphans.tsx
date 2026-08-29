// Admin orphan-resource triage (GET /admin/orphans + POST .../resolve).
// Resolving requires a resolution note — the backend rejects an empty
// `{resolution}` body with a validation error, so the dialog enforces it.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "./shared"
import { formatDateTime } from "./format"

interface OrphanRow {
  id: string
  provider_id: string
  provider_code: string
  resource_type: string
  external_resource_id: string
  first_seen_at: string
  last_seen_at: string
  resolved_at: string
  resolution: string
}

const PER_PAGE = 20

export default function OrphansPage() {
  const [rows, setRows] = useState<OrphanRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Row currently opened in the resolve dialog.
  const [resolving, setResolving] = useState<OrphanRow | null>(null)
  const [resolutionNote, setResolutionNote] = useState("")
  const [resolvingBusy, setResolvingBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<OrphanRow[]>("/admin/orphans", { query: { page, per_page: PER_PAGE } })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
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
  }, [page, reloadTick])

  const resolveOrphan = useCallback(async () => {
    if (!resolving) return
    if (resolutionNote.trim() === "") {
      toast.error("A resolution note is required")
      return
    }
    setResolvingBusy(true)
    try {
      await apiPost(`/admin/orphans/${resolving.id}/resolve`, {
        resolution: resolutionNote.trim(),
      })
      toast.success("Orphan resolved")
      setResolving(null)
      setResolutionNote("")
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to resolve orphan")
    } finally {
      setResolvingBusy(false)
    }
  }, [resolving, resolutionNote])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Orphan resources"
        description="Provider-side resources no longer referenced by any platform instance."
      />

      <SimpleDataTable<OrphanRow>
        columns={[
          {
            key: "resource_type",
            header: "Resource",
            render: (row) => (
              <div className="min-w-0">
                <p className="min-w-0 truncate font-medium capitalize">{row.resource_type || "—"}</p>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {row.external_resource_id}
                </p>
              </div>
            ),
          },
          {
            key: "provider_code",
            header: "Provider",
            render: (row) => <span>{row.provider_code}</span>,
          },
          {
            key: "first_seen_at",
            header: "First seen",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.first_seen_at)}</span>
            ),
          },
          {
            key: "last_seen_at",
            header: "Last seen",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.last_seen_at)}</span>
            ),
          },
          {
            key: "resolved_at",
            header: "State",
            render: (row) =>
              row.resolved_at ? (
                <StatusBadge status="resolved" />
              ) : (
                <StatusBadge status="open" />
              ),
          },
          {
            key: "resolution",
            header: "Resolution",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="line-clamp-1 text-muted-foreground" title={row.resolution}>
                {row.resolution || "—"}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-28 text-right",
            render: (row) =>
              row.resolved_at ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    setResolving(row)
                    setResolutionNote("")
                  }}
                >
                  Resolve
                </Button>
              ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No orphan resources detected — infrastructure is clean."
        skeletonRows={6}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog
        open={resolving !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResolving(null)
            setResolutionNote("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve orphan resource?</AlertDialogTitle>
            <AlertDialogDescription>
              {resolving ? `${resolving.resource_type} ${resolving.external_resource_id}` : ""}
              {" — mark it as handled on the provider side. A resolution note is required by the API."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={3}
            placeholder="What was done with this resource? (required)"
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resolvingBusy}
              onClick={(event) => {
                event.preventDefault() // keep the dialog open until the call settles
                void resolveOrphan()
              }}
            >
              {resolvingBusy ? "Resolving…" : "Resolve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
