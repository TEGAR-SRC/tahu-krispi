// Mirror browser for one Dokploy entity: reads the local mirror via
// GET /admin/dokploy/db/:entity?limit=&offset= and renders auto-generated
// columns from the first row's keys (the RawResourceTable approach — the
// upstream shapes are heterogeneous and undocumented). Rows are read-only
// mirrors; deleting one only removes the local copy.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ChevronLeftIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { apiDelete, apiGet, ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
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
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  describeSyncResult,
  findDokployEntity,
  syncDokployEntity,
} from "./entities"

/** One mirror row: string columns plus the parsed raw upstream object under `data`. */
type RawMirrorRow = Record<string, unknown>

const PAGE_SIZE = 20

interface MirrorPage {
  entity: string
  items: RawMirrorRow[]
  limit: number
  offset: number
  total: number
}

export default function DokployEntityPage() {
  const entity = findDokployEntity(useParams().entity)

  if (!entity) {
    return <UnknownEntity />
  }
  return <EntityBrowser key={entity.name} entityName={entity.name} />
}

function UnknownEntity() {
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy">Dokploy PaaS</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Unknown entity</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <EmptyState
        message="Unknown Dokploy mirror entity."
        description="Pick one of the entities on the Dokploy PaaS hub."
      />
    </div>
  )
}

function EntityBrowser({ entityName }: { entityName: string }) {
  const [items, setItems] = useState<RawMirrorRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [offset, setOffset] = useState(0)
  const [reloadTick, setReloadTick] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RawMirrorRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    apiGet<MirrorPage>(`/admin/dokploy/db/${entityName}`, {
      query: { limit: PAGE_SIZE, offset },
    })
      .then((envelope) => {
        setItems(envelope.data.items ?? [])
        setTotal(typeof envelope.data.total === "number" ? envelope.data.total : 0)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [entityName, offset])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  const runSync = async () => {
    setSyncing(true)
    try {
      const result = await syncDokployEntity(entityName)
      toast.success(`Sync ${entityName}: ${describeSyncResult(result)}`)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : `Failed to sync ${entityName}.`,
      )
    } finally {
      setSyncing(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const remoteId = String(deleteTarget.remote_id ?? "")
    setDeleting(true)
    try {
      await apiDelete(`/admin/dokploy/db/${entityName}/${encodeURIComponent(remoteId)}`)
      toast.success(`Mirror row ${remoteId.slice(0, 12)}… removed`)
      setDeleteTarget(null)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove row.")
    } finally {
      setDeleting(false)
    }
  }

  const columns: Array<SimpleColumn<RawMirrorRow>> = [
    ...autoColumns(items),
    {
      key: "__actions",
      header: "",
      className: "w-12",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          aria-label={`Remove mirror row ${String(row.remote_id ?? "")}`}
          onClick={() => setDeleteTarget(row)}
        >
          <Trash2Icon />
        </Button>
      ),
    },
  ]

  const shownFrom = total === 0 ? 0 : offset + 1
  const shownTo = Math.min(offset + items.length, total)

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy">Dokploy PaaS</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono">{entityName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="font-mono text-xl">{entityName}</CardTitle>
            <CardDescription>
              Local mirror rows — upserted from Dokploy by sync.{" "}
              <Badge variant="outline" className="align-middle font-mono text-xs">
                {total.toLocaleString()} total
              </Badge>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => setReloadTick((tick) => tick + 1)}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
            <Button size="sm" disabled={syncing || loading} onClick={() => void runSync()}>
              {syncing ? "Syncing…" : "Sync from Dokploy"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <SimpleDataTable
            columns={columns}
            rows={items}
            loading={loading}
            error={error}
            getRowKey={(row, index) => String(row.remote_id ?? row.id ?? index)}
            emptyMessage={`No ${entityName} mirrored yet — run a sync first.`}
            skeletonRows={6}
          />
        </CardContent>
        {!loading && !error && items.length > 0 ? (
          <CardFooter className="justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {shownFrom.toLocaleString()}–{shownTo.toLocaleString()} of{" "}
              {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset <= 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeftIcon />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </CardFooter>
        ) : null}
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this mirror row?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the local mirror copy (remote_id{" "}
              <span className="break-all font-mono text-xs">
                {deleteTarget ? String(deleteTarget.remote_id ?? "") : ""}
              </span>
              ) is deleted — nothing is sent to the Dokploy server. A later full
              sync restores it while it still exists upstream.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? "Removing…" : "Remove row"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---- Auto-generated columns ---------------------------------------------------

/** Derives display columns from the first row's keys; primitives come first. */
function autoColumns(rows: RawMirrorRow[]): Array<SimpleColumn<RawMirrorRow>> {
  const first = rows[0]
  if (!first) return []
  let keys = Object.keys(first).filter((key) => {
    const value = first[key]
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (keys.length === 0) keys = Object.keys(first)
  return keys.slice(0, 7).map((key) => ({
    key,
    header: key.replace(/_/g, " "),
    className: key === "data" ? "hidden lg:table-cell max-w-56" : undefined,
    render: (row: RawMirrorRow) => <CellPreview value={row[key]} />,
  }))
}

function CellPreview({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value)
  return (
    <span className="block max-w-64 truncate font-mono text-xs" title={text}>
      {text.length > 120 ? `${text.slice(0, 117)}…` : text}
    </span>
  )
}
