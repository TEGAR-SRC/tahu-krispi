// Cluster storage console: inventory CRUD over /cluster-storages plus a
// per-storage content browser (list + delete volumes) and a PBS file-restore
// archive browser. Mutations are platform-admin-only server side and each one
// is confirmed; 403s surface as toasts.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  apiDelete,
  apiPost,
  apiPut,
  ApiError,
} from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "../format"
import {
  ConfirmDialog,
  ProviderShell,
  type ClusterPayload,
  type ClusterStorage,
  type FileRestoreEntry,
  type PveNodeStatus,
  type StorageContentItem,
} from "./shared"
import { formatBytes, useInfraGet } from "./infra"

const STORAGE_TYPES = [
  "dir",
  "lvmthin",
  "lvm",
  "zfspool",
  "nfs",
  "cifs",
  "rbd",
  "cephfs",
  "pbs",
  "iscsi",
]

export default function ProviderStoragesPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = `/admin/providers/${providerId}`

  const storages = useInfraGet<ClusterStorage[]>(
    providerId ? `${base}/cluster-storages` : null,
  )
  const cluster = useInfraGet<ClusterPayload>(
    providerId ? `${base}/cluster` : null,
  )
  const nodes: PveNodeStatus[] = cluster.data?.nodes ?? []

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ClusterStorage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClusterStorage | null>(null)
  const [busy, setBusy] = useState(false)

  // Content browser selection.
  const [browsing, setBrowsing] = useState<ClusterStorage | null>(null)

  const runMutation = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ): Promise<void> => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      storages.reload()
      after?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Cluster storages"
      description="Storage definitions visible cluster-wide, with content browsing and file-restore."
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          Add storage…
        </Button>
      }
    >
      <SimpleDataTable<ClusterStorage>
        columns={[
          {
            key: "storage",
            header: "Storage",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium">{row.storage || "—"}</p>
                {row.path ? (
                  <p className="truncate font-mono text-xs text-muted-foreground">{row.path}</p>
                ) : null}
              </div>
            ),
          },
          { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type}</Badge> },
          { key: "content", header: "Content types", render: (row) => row.content || "—" },
          {
            key: "nodes",
            header: "Nodes",
            className: "hidden md:table-cell",
            render: (row) => row.nodes || "all nodes",
          },
          {
            key: "shared",
            header: "Shared",
            className: "hidden lg:table-cell",
            render: (row) => (row.shared ? "yes" : "no"),
          },
          {
            key: "actions",
            header: "",
            className: "w-52 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!row.storage}
                  onClick={() => setBrowsing(browsing?.storage === row.storage ? null : row)}
                >
                  Browse
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditTarget(row)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={storages.data ?? []}
        loading={storages.loading}
        error={storages.error}
        getRowKey={(row) => String(row.storage ?? "?")}
        emptyMessage="No cluster storages defined."
        skeletonRows={5}
      />

      {/* Per-storage content browser with node picker + file-restore. */}
      {browsing && browsing.storage ? (
        <ContentBrowser
          providerId={providerId}
          storage={browsing.storage}
          nodes={nodes.map((node) => node.node ?? node.name ?? "").filter(Boolean)}
          nodesLoading={cluster.loading}
          onDeleted={() => storages.reload()}
          onClose={() => setBrowsing(null)}
        />
      ) : null}

      <CreateStorageDialog
        open={createOpen}
        busy={busy}
        onOpenChange={setCreateOpen}
        onSubmit={(body, done) =>
          void runMutation(() => apiPost(`${base}/cluster-storages`, body), `Storage ${String(body.storage)} created`, done)
        }
      />

      {editTarget?.storage ? (
        <EditStorageDialog
          open
          target={editTarget}
          busy={busy}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSubmit={(body, done) =>
            void runMutation(
              () => apiPut(`${base}/cluster-storages/${encodeURIComponent(String(editTarget.storage))}`, body),
              `Storage ${editTarget.storage} updated`,
              done,
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete storage "${deleteTarget?.storage}"?`}
        body="Removes the storage definition from the cluster configuration. Volumes already written are not destroyed by this call, but guests referencing the storage will lose it."
        confirmLabel="Delete storage"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target?.storage) return
          void runMutation(
            () => apiDelete(`${base}/cluster-storages/${encodeURIComponent(target.storage as string)}`),
            `Storage ${target.storage} deletion queued`,
          )
        }}
      />
    </ProviderShell>
  )
}

interface StorageDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

/** Create dialog: storage+type required by the API, extras via raw JSON. */
function CreateStorageDialog({ open, busy, onOpenChange, onSubmit }: StorageDialogProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState("dir")
  const [extraJson, setExtraJson] = useState("{}")

  const submit = () => {
    let extra: Record<string, unknown>
    try {
      extra = JSON.parse(extraJson || "{}") as Record<string, unknown>
    } catch {
      toast.error("Extra options must be valid JSON.")
      return
    }
    if (!name.trim() || !type.trim()) {
      toast.error("Storage name and type are required.")
      return
    }
    onSubmit({ ...extra, storage: name.trim(), type: type.trim() }, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add cluster storage</DialogTitle>
          <DialogDescription>
            The API accepts free-form PVE storage options flattened onto the request — storage
            and type are mandatory, everything else goes in the JSON field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cs-name">Storage id *</Label>
              <Input
                id="cs-name"
                value={name}
                placeholder="local-backup"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cs-type">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="cs-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORAGE_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-extra">Extra options (JSON)</Label>
            <Textarea
              id="cs-extra"
              className="font-mono text-xs"
              rows={4}
              value={extraJson}
              onChange={(event) => setExtraJson(event.target.value)}
              placeholder='{"path":"/srv/backup","content":"backup","nodes":"pve1,pve2"}'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Create storage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface EditStorageProps extends StorageDialogProps {
  target: ClusterStorage
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

/** Update dialog accepts any subset of options for PUT :name. */
function EditStorageDialog({
  open,
  busy,
  target,
  onOpenChange,
  onSubmit,
}: EditStorageProps) {
  const [json, setJson] = useState(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(target).filter(
          ([key]) => key === "content" || key === "nodes" || key === "comment" || key === "path" || key === "disable",
        ),
      ),
      null,
      2,
    ),
  )

  const submit = () => {
    try {
      const parsed = JSON.parse(json || "{}") as Record<string, unknown>
      if (Object.keys(parsed).length === 0) {
        toast.error("Provide at least one option to update.")
        return
      }
      onSubmit(parsed, () => onOpenChange(false))
    } catch {
      toast.error("Options must be valid JSON.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit storage {target.storage}</DialogTitle>
          <DialogDescription>
            Any subset of PVE storage options (content, nodes, path, comment, disable…).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cs-edit-json">Options (JSON)</Label>
          <Textarea
            id="cs-edit-json"
            className="font-mono text-xs"
            rows={6}
            value={json}
            onChange={(event) => setJson(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ContentBrowserProps {
  providerId: string
  storage: string
  nodes: string[]
  nodesLoading: boolean
  onDeleted: () => void
  onClose: () => void
}

function ContentBrowser({
  providerId,
  storage,
  nodes,
  nodesLoading,
  onDeleted,
  onClose,
}: ContentBrowserProps) {
  const [node, setNode] = useState(nodes[0] ?? "")
  // Fall back to the first fetched node once the list arrives.
  const effectiveNode = node || nodes[0] || ""
  const content = useInfraGet<StorageContentItem[]>(
    effectiveNode
      ? `/admin/providers/${providerId}/storages/${encodeURIComponent(storage)}/content`
      : null,
    { node: effectiveNode || null },
  )
  const [deleteVolume, setDeleteVolume] = useState<StorageContentItem | null>(null)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Content of <span className="font-mono">{storage}</span>
            </CardTitle>
            <CardDescription>Volumes reported by the provider for one node.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={effectiveNode} onValueChange={setNode}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={nodesLoading ? "Loading nodes…" : "Pick a node"} />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!nodesLoading && nodes.length === 0 ? (
          <EmptyState message="Node picker unavailable." description="The cluster endpoint returned no nodes, so content cannot be queried (?node= is mandatory)." />
        ) : !effectiveNode ? (
          <p className="text-sm text-muted-foreground">Pick a node to list content.</p>
        ) : (
          <>
            <SimpleDataTable<StorageContentItem>
              columns={[
                { key: "volid", header: "Volume", render: (c) => c.volid || "—" },
                { key: "format", header: "Format" },
                { key: "size", header: "Size", render: (c) => formatBytes(c.size) },
                { key: "vmid", header: "VMID", render: (c) => c.vmid ?? "—" },
                {
                  key: "ctime",
                  header: "Created",
                  render: (c) => formatDateTime(epochToIso(c.ctime)),
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-40 text-right",
                  render: (c) => (
                    <div className="flex justify-end gap-2">
                      {isBackupVolume(c) ? (
                        <FileRestoreBrowser providerId={providerId} storage={storage} node={effectiveNode} volume={String(c.volid)} />
                      ) : null}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!c.volid}
                        onClick={() => setDeleteVolume(c)}
                      >
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={content.data ?? []}
              loading={content.loading}
              error={content.error}
              getRowKey={(c, index) => String(c.volid ?? index)}
              emptyMessage="This storage holds no volumes on that node."
              skeletonRows={4}
            />
            <ConfirmDialog
              open={deleteVolume !== null}
              onOpenChange={(open) => !open && setDeleteVolume(null)}
              title={`Delete volume "${deleteVolume?.volid}"?`}
              body="The volume is removed at the provider asynchronously (202). Backup archives cannot be recovered once deleted."
              confirmLabel="Delete volume"
              onConfirm={() => {
                const target = deleteVolume
                setDeleteVolume(null)
                if (!target?.volid) return
                void (async () => {
                  try {
                    await apiDelete(
                      `/admin/providers/${providerId}/storages/${encodeURIComponent(storage)}/content`,
                      { query: { node: effectiveNode, volume: String(target.volid) } },
                    )
                    toast.success(`Deletion of ${target.volid} queued`)
                    content.reload()
                    onDeleted()
                  } catch (cause) {
                    toast.error(cause instanceof ApiError ? cause.message : "Request failed")
                  }
                })()
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function isBackupVolume(content: StorageContentItem): boolean {
  const volid = String(content.volid ?? "")
  return volid.includes("/backup/") || content.format === "pbs-vm" || content.format === "pbs-ct" ||
    ["tar", "tar.zst", "tgz", "vma", "vma.zst", "zst"].includes(String(content.format ?? ""))
}

function epochToIso(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const num = Number(value)
  if (!Number.isNaN(num) && num > 0) return new Date(num * 1000).toISOString()
  const direct = new Date(String(value))
  return Number.isNaN(direct.getTime()) ? undefined : direct.toISOString()
}

/** Path-traversal UI over GET …/file-restore?node=&volume=&path=. */
function FileRestoreBrowser({
  providerId,
  storage,
  node,
  volume,
}: {
  providerId: string
  storage: string
  node: string
  volume: string
}) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState("/")
  const listing = useInfraGet<FileRestoreEntry[]>(
    open
      ? `/admin/providers/${providerId}/storages/${encodeURIComponent(storage)}/file-restore`
      : null,
    { node, volume, path },
  )

  const entries = listing.data ?? []
  const parentOf = (current: string) => {
    const trimmed = current.replace(/\/+$/, "")
    const index = trimmed.lastIndexOf("/")
    return index <= 0 ? "/" : trimmed.slice(0, index)
  }

  return (
    <div className="space-y-2 text-right">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        Browse files
      </Button>
      {open ? (
        <div className="space-y-2 rounded-md border p-3 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/etc"
              className="w-64 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" disabled={path === "/"} onClick={() => setPath(parentOf(path))}>
              Up one level
            </Button>
          </div>
          {listing.error ? <ErrorBanner error={listing.error} /> : null}
          {listing.loading ? (
            <p className="text-sm text-muted-foreground">Listing {path}…</p>
          ) : entries.length === 0 && !listing.error ? (
            <p className="text-sm text-muted-foreground">Nothing at this path.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-auto">
              {entries.map((entry, index) => (
                <li key={`${entry.filepath ?? index}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono">
                    {entry.type === "d" ? "📁 " : entry.type === "l" ? "🔗 " : "📄 "}
                    {entry.filepath || entry.text}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {entry.type !== "d" ? formatBytes(entry.size) : ""}
                  </span>
                  {entry.type === "d" && entry.filepath ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => setPath(entry.filepath as string)}
                    >
                      Open
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
