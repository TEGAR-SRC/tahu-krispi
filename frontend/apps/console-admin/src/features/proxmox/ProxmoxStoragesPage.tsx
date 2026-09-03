import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import type {
  ClusterPayload,
  ClusterStorage,
  FileRestoreEntry,
  PveNodeStatus,
  StorageContentItem,
} from "@/features/admin/pages/providers/types"

const STORAGE_TYPES = ["dir", "lvmthin", "lvm", "zfspool", "nfs", "cifs", "rbd", "cephfs", "pbs", "iscsi"]

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—"
  let value = bytes
  let unit = 0
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

function parseApiDate(raw?: string | null): Date | null {
  if (!raw) return null
  const t = raw.trim()
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2}(?::?\d{2})?|Z)?$/.exec(t)
  if (!m) {
    const f = new Date(t)
    return Number.isNaN(f.getTime()) ? null : f
  }
  const [, d, tm, off] = m
  let offset = ""
  if (off && off !== "Z") {
    const sign = off.startsWith("-") ? "-" : "+"
    const dig = off.replace(/[+-]/g, "").replace(":", "")
    offset = `${sign}${dig.slice(0, 2)}:${dig.slice(2, 4) || "00"}`
  }
  const [hms, frac] = tm.split(".")
  const millis = frac ? `.${frac.slice(0, 3).padEnd(3, "0")}` : ""
  const p = new Date(`${d}T${hms}${millis}${offset || "Z"}`)
  return Number.isNaN(p.getTime()) ? null : p
}

function formatDateTime(raw?: string | null): string {
  const p = parseApiDate(raw)
  return p ? p.toLocaleString() : "—"
}

function epochToIso(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const n = Number(value)
  if (!Number.isNaN(n) && n > 0) return new Date(n * 1000).toISOString()
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function isBackupVolume(c: StorageContentItem): boolean {
  const volid = String(c.volid ?? "")
  return (
    volid.includes("/backup/") ||
    c.format === "pbs-vm" ||
    c.format === "pbs-ct" ||
    ["tar", "tar.zst", "tgz", "vma", "vma.zst", "zst"].includes(String(c.format ?? ""))
  )
}

export default function ProxmoxStoragesPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [storages, setStorages] = useState<ClusterStorage[]>([])
  const [storagesLoading, setStoragesLoading] = useState(true)
  const [storagesError, setStoragesError] = useState<unknown>(null)
  const [storagesTick, setStoragesTick] = useState(0)

  const [nodes, setNodes] = useState<PveNodeStatus[]>([])
  const [nodesLoading, setNodesLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ClusterStorage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClusterStorage | null>(null)
  const [busy, setBusy] = useState(false)
  const [browsing, setBrowsing] = useState<ClusterStorage | null>(null)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setStoragesLoading(true)
    apiGet<ClusterStorage[]>(`${base}/cluster-storages`)
      .then((env) => {
        if (!cancelled) {
          setStorages(Array.isArray(env.data) ? env.data : [])
          setStoragesError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) setStoragesError(cause)
      })
      .finally(() => {
        if (!cancelled) setStoragesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, base, storagesTick])

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setNodesLoading(true)
    apiGet<ClusterPayload>(`${base}/cluster`)
      .then((env) => {
        if (!cancelled) setNodes(env.data?.nodes ?? [])
      })
      .catch(() => {
        if (!cancelled) setNodes([])
      })
      .finally(() => {
        if (!cancelled) setNodesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, base])

  const reloadStorages = () => setStoragesTick((v) => v + 1)

  const runMutation = async (action: () => Promise<unknown>, success: string, after?: () => void): Promise<void> => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reloadStorages()
      after?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  const nodeNames = nodes.map((n) => n.node ?? n.name ?? "").filter(Boolean) as string[]

  return (
    <ProviderShell
      providerId={providerId}
      title="Storages"
      description="Cluster storage definitions (per-provider) with a content browser per node. Admin: create/edit/delete; NOC: read-only."
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
                <p className="min-w-0 truncate font-mono text-sm font-medium">{row.storage || "—"}</p>
                {row.path ? <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.path}</p> : null}
              </div>
            ),
          },
          { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type || "—"}</Badge> },
          { key: "content", header: "Content types", render: (row) => row.content || "—" },
          { key: "nodes", header: "Nodes", className: "hidden md:table-cell", render: (row) => row.nodes || "all nodes" },
          { key: "shared", header: "Shared", className: "hidden lg:table-cell", render: (row) => (row.shared ? "yes" : "no") },
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
        rows={storages}
        loading={storagesLoading}
        error={storagesError}
        getRowKey={(row) => String(row.storage ?? "?")}
        emptyMessage="No cluster storages defined."
        skeletonRows={5}
      />

      {browsing && browsing.storage ? (
        <ContentBrowser
          providerId={providerId}
          storage={String(browsing.storage)}
          nodes={nodeNames}
          nodesLoading={nodesLoading}
          onDeleted={reloadStorages}
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
        body="Removes the storage definition from the cluster configuration. Volumes already written are not destroyed, but guests referencing the storage will lose it."
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
            Storage and type are mandatory; everything else goes in the JSON field. Example: path/content/nodes/shared.
          </DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 gap-3">
          <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ps-name">Storage id *</Label>
              <Input id="ps-name" value={name} placeholder="local-backup" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-type">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="ps-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORAGE_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-extra">Extra options (JSON)</Label>
            <Textarea
              id="ps-extra"
              className="font-mono text-xs"
              rows={4}
              value={extraJson}
              onChange={(e) => setExtraJson(e.target.value)}
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
}

function EditStorageDialog({ open, busy, target, onOpenChange, onSubmit }: EditStorageProps) {
  const [json, setJson] = useState(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(target).filter(([k]) => k === "content" || k === "nodes" || k === "comment" || k === "path" || k === "disable"),
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
          <DialogDescription>Any subset of PVE storage options (content, nodes, path, comment, disable).</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ps-edit-json">Options (JSON)</Label>
          <Textarea id="ps-edit-json" className="font-mono text-xs" rows={6} value={json} onChange={(e) => setJson(e.target.value)} />
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

function ContentBrowser({
  providerId,
  storage,
  nodes,
  nodesLoading,
  onDeleted,
  onClose,
}: {
  providerId: string
  storage: string
  nodes: string[]
  nodesLoading: boolean
  onDeleted: () => void
  onClose: () => void
}) {
  const [node, setNode] = useState(nodes[0] ?? "")
  const effectiveNode = node || nodes[0] || ""
  const [rows, setRows] = useState<StorageContentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const [deleteVolume, setDeleteVolume] = useState<StorageContentItem | null>(null)

  useEffect(() => {
    if (!effectiveNode || !storage) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<StorageContentItem[]>(`/admin/proxmox/${providerId}/storages/${encodeURIComponent(storage)}/content`, {
      query: { node: effectiveNode },
    })
      .then((env) => {
        if (!cancelled) setRows(Array.isArray(env.data) ? env.data : [])
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
  }, [providerId, storage, effectiveNode, tick])

  useEffect(() => {
    if (!node && nodes[0]) setNode(nodes[0])
  }, [nodes, node])

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
          <div className="flex min-w-0 items-center gap-2">
            <Select value={effectiveNode} onValueChange={setNode}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={nodesLoading ? "Loading nodes…" : "Pick a node"} />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
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
          <p className="text-sm text-muted-foreground">Cluster reports no nodes — content cannot be queried (?node= is required).</p>
        ) : !effectiveNode ? (
          <p className="text-sm text-muted-foreground">Pick a node to list content.</p>
        ) : (
          <>
            <SimpleDataTable<StorageContentItem>
              columns={[
                { key: "volid", header: "Volume", render: (c) => <span className="font-mono text-xs">{c.volid || "—"}</span> },
                { key: "format", header: "Format" },
                { key: "size", header: "Size", render: (c) => formatBytes(c.size) },
                { key: "vmid", header: "VMID", render: (c) => (c.vmid ?? "—" as unknown as string) },
                { key: "ctime", header: "Created", render: (c) => formatDateTime(epochToIso(c.ctime)) },
                {
                  key: "actions",
                  header: "",
                  className: "w-40 text-right",
                  render: (c) => (
                    <div className="flex justify-end gap-2">
                      {isBackupVolume(c) ? (
                        <FileRestoreBrowser providerId={providerId} storage={storage} node={effectiveNode} volume={String(c.volid)} />
                      ) : null}
                      <Button variant="destructive" size="sm" disabled={!c.volid} onClick={() => setDeleteVolume(c)}>
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={rows}
              loading={loading}
              error={error}
              getRowKey={(c, i) => String(c.volid ?? i)}
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
                    await apiDelete(`/admin/proxmox/${providerId}/storages/${encodeURIComponent(storage)}/content`, {
                      query: { node: effectiveNode, volume: String(target.volid) },
                    })
                    toast.success(`Deletion of ${target.volid} queued`)
                    setTick((v) => v + 1)
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
  const [entries, setEntries] = useState<FileRestoreEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<FileRestoreEntry[]>(`/admin/proxmox/${providerId}/storages/${encodeURIComponent(storage)}/file-restore`, {
      query: { node, volume, path },
    })
      .then((env) => {
        if (!cancelled) setEntries(Array.isArray(env.data) ? env.data : [])
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
  }, [open, providerId, storage, node, volume, path])

  const parentOf = (cur: string) => {
    const t = cur.replace(/\/+$/, "")
    const idx = t.lastIndexOf("/")
    return idx <= 0 ? "/" : t.slice(0, idx)
  }

  return (
    <div className="space-y-2 text-right">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        Browse files
      </Button>
      {open ? (
        <div className="space-y-2 rounded-md border p-3 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/etc" className="w-64 font-mono text-xs" />
            <Button variant="ghost" size="sm" disabled={path === "/"} onClick={() => setPath(parentOf(path))}>
              Up one level
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error instanceof ApiError ? error.message : String(error)}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Listing {path}…</p>
          ) : entries.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">Nothing at this path.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-auto">
              {entries.map((entry, i) => (
                <li key={`${entry.filepath ?? i}`} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-mono">
                    {entry.type === "d" ? "📁 " : entry.type === "l" ? "🔗 " : "📄 "}
                    {entry.filepath || entry.text}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{entry.type !== "d" ? formatBytes(entry.size) : ""}</span>
                  {entry.type === "d" && entry.filepath ? (
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setPath(entry.filepath as string)}>
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
