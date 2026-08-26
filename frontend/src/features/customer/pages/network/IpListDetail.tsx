// IP list detail: single GET /ip-lists/:list_id answers both the list meta
// ({ip_list}) and its entries, so one load drives the PATCH meta editor and
// the entries table (add via POST, remove behind a confirm dialog).
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

interface IpListMeta {
  id: string
  name: string
  description: string
  entry_count: number
  created_at?: string
}

interface IpListEntry {
  id: string
  type: string
  value: string
  created_at?: string
}

/** GET /ip-lists/:list_id → `{ entries, ip_list }`. */
interface IpListDetailPayload {
  entries: IpListEntry[] | null
  ip_list: IpListMeta
}

export default function IpListDetailPage() {
  const { listId } = useParams()
  const { orgId } = useOrg()
  const [meta, setMeta] = useState<IpListMeta | null>(null)
  const [entries, setEntries] = useState<IpListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!orgId || !listId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<IpListDetailPayload>(`/ip-lists/${listId}`, {
        headers: orgHeaders(orgId),
      })
      setMeta(data?.ip_list ?? null)
      setEntries(data?.entries ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, listId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/network">Network</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {meta ? (
              <BreadcrumbPage>{meta.name}</BreadcrumbPage>
            ) : (
              <BreadcrumbPage>…</BreadcrumbPage>
            )}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && !meta ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error ? (
        <>
          <PageHeader title="IP list" />
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load IP list."}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </>
      ) : !meta ? (
        <>
          <PageHeader title="IP list" />
          <p className="text-sm text-muted-foreground">
            IP list not found.{" "}
            <Link to="/app/network" className="underline underline-offset-2">
              Back to network
            </Link>
          </p>
        </>
      ) : (
        <>
          <PageHeader title={meta.name} description={meta.description || undefined} />
          <MetaEditor meta={meta} onSaved={() => void load()} />
          <EntriesCard listId={meta.id} entries={entries} loading={loading} error={error} onChanged={() => void load()} />
        </>
      )}
    </div>
  )
}

// ---- Meta editor ----------------------------------------------------------------

function MetaEditor({ meta, onSaved }: { meta: IpListMeta; onSaved: () => void }) {
  const { orgId } = useOrg()
  const [name, setName] = useState(meta.name)
  const [description, setDescription] = useState(meta.description)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setName(meta.name)
      setDescription(meta.description)
    }, 0)
    return () => clearTimeout(t)
  }, [meta.id, meta.name, meta.description])

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    setSaving(true)
    try {
      await apiPatch(
        `/ip-lists/${meta.id}`,
        { name: name.trim(), description: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("IP list updated")
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update IP list")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            Created <span className="tabular-nums">{formatDateTime(meta.created_at)}</span>
          </span>
          <span>
            Entries <span className="tabular-nums">{meta.entry_count ?? 0}</span>
          </span>
        </div>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ipld-name">Name *</Label>
            <Input
              id="ipld-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ipld-desc">Description</Label>
            <Input
              id="ipld-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : null} Save changes
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- Entries ----------------------------------------------------------------------

function EntriesCard({
  listId,
  entries,
  loading,
  error,
  onChanged,
}: {
  listId: string
  entries: IpListEntry[]
  loading: boolean
  error: unknown
  onChanged: () => void
}) {
  const { orgId } = useOrg()
  const [value, setValue] = useState("")
  const [description, setDescription] = useState("")
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<IpListEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  const addEntry = async () => {
    if (!value.trim()) {
      toast.error("IP or CIDR is required")
      return
    }
    setAdding(true)
    try {
      await apiPost(
        `/ip-lists/${listId}/entries`,
        { value: value.trim(), description: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Entry added")
      setValue("")
      setDescription("")
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to add entry")
    } finally {
      setAdding(false)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget || !orgId) return
    setDeleting(true)
    try {
      await apiDelete(`/ip-lists/${listId}/entries/${deleteTarget.id}`, {
        headers: orgHeaders(orgId),
      })
      toast.success(`Entry ${deleteTarget.value} removed`)
      setDeleteTarget(null)
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove entry")
    } finally {
      setDeleting(false)
    }
  }

  const columns: Array<SimpleColumn<IpListEntry>> = [
    {
      key: "value",
      header: "Address",
      render: (row) => <span className="font-mono text-sm">{row.value}</span>,
    },
    { key: "type", header: "Type" },
    { key: "created_at", header: "Added", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-14",
      render: (row) => (
        <div className="flex justify-end">
          <Button
            size="icon"
            variant="ghost"
            title="Remove…"
            onClick={() => setDeleteTarget(row)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardContent className="space-y-4 px-4 py-4">
        <h2 className="font-semibold">Entries</h2>

        <SimpleDataTable
          columns={columns}
          rows={entries}
          loading={loading}
          error={error}
          skeletonRows={3}
          emptyMessage={
            error ? undefined : "No entries yet — addresses added here feed firewall references."
          }
          getRowKey={(row) => row.id}
        />

        {/* Add form */}
        <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="iplde-value">IP / CIDR *</Label>
            <Input
              id="iplde-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="203.0.113.7 or 198.51.100.0/24"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="iplde-desc">Comment</Label>
            <Input
              id="iplde-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => void addEntry()} disabled={adding} className="w-full">
              {adding ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.value}?</AlertDialogTitle>
            <AlertDialogDescription>
              The address stops matching wherever this list is referenced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
