// NOC storage console: cluster-level storage inventory plus read-only
// browsers for one storage's content volumes and PBS file-restore archives.
// Deleting volumes / creating storages is platform-admin only → not offered.
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FolderOpenIcon, FolderTreeIcon, RefreshCwIcon } from "lucide-react"
import { fmtDateTime, formatBytes } from "../../lib-utils"
import {
  AdminOnlyHint,
  type PveClusterStorage,
  type PveContentItem,
  type PveFileRestoreEntry,
  type PveClusterPayload,
  ProviderSurfaceNote,
} from "./pve"
import { fmtEpoch, useNocProvider, useTyped } from "./pve-utils"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

const isBackupVolume = (item: PveContentItem): boolean =>
  /\.(backup|pbs-vm|vma|vma\.zst|tar|tar\.gz|tar\.zst)$/i.test(item.volid ?? "") ||
  /^(pbs|pbs-vm)$/.test(item.format ?? "")

export default function NocProviderStoragesPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const base = `/admin/providers/${providerId}`

  const clusterStorages = useTyped<PveClusterStorage[]>(`${base}/cluster-storages`)
  const cluster = useTyped<PveClusterPayload>(`${base}/cluster`)

  const nodes = useMemo(
    () => (cluster.data?.nodes ?? []).map((row) => row.node ?? row.name ?? "").filter(Boolean),
    [cluster.data],
  )

  const [storageName, setStorageName] = useState("")
  const [nodeName, setNodeName] = useState("")
  const activeStorage = storageName || clusterStorages.data?.[0]?.storage || ""
  const activeNode = nodeName || nodes[0] || ""

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Storages" />
      <PageHeader
        title="Storages"
        description="Cluster storage inventory with a read-only content browser and PBS file-restore viewer."
        actions={
          <Button variant="outline" size="sm" onClick={clusterStorages.reload} disabled={clusterStorages.loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />
      <ProviderSurfaceNote
        kind={provider?.kind} />

      {clusterStorages.error ? (
        <ErrorBanner error={clusterStorages.error} />
      ) : (
        <SimpleDataTable<PveClusterStorage>
          columns={[
            { key: "storage", header: "Storage", render: (row) => row.storage ?? "—" },
            { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type ?? "—"}</Badge> },
            { key: "content", header: "Content types", render: (row) => row.content ?? "—" },
            {
              key: "nodes",
              header: "Nodes",
              render: (row) => (row.nodes ? row.nodes : "all"),
            },
            { key: "shared", header: "Shared", render: (row) => (row.shared === 1 ? "yes" : "no") },
            { key: "path", header: "Path / pool", render: (row) => row.path ?? row.vgname ?? row.thinpool ?? "—" },
          ]}
          rows={clusterStorages.data ?? []}
          loading={clusterStorages.loading}
          skeletonRows={4}
          emptyMessage="No cluster-level storages defined."
          getRowKey={(row) => row.storage ?? Math.random().toString()}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Content browser</h2>
        <AdminOnlyHint>
          Volume deletion on a storage answers to platform admins only; this browser is strictly read-only.
        </AdminOnlyHint>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="storage-select" className="text-xs text-muted-foreground">
              Storage
            </Label>
            <Select value={activeStorage} onValueChange={setStorageName}>
              <SelectTrigger id="storage-select" className="w-56">
                <SelectValue placeholder="Pick a storage…" />
              </SelectTrigger>
              <SelectContent>
                {(clusterStorages.data ?? [])
                  .filter((row) => row.storage)
                  .map((row) => (
                    <SelectItem key={row.storage} value={row.storage!}>
                      {row.storage} ({row.type ?? "?"})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="node-select" className="text-xs text-muted-foreground">
              Node
            </Label>
            <Select value={activeNode} onValueChange={setNodeName}>
              <SelectTrigger id="node-select" className="w-48">
                <SelectValue placeholder="Pick a node…" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {activeStorage && activeNode ? (
          <ContentBrowser providerId={providerId} storage={activeStorage} node={activeNode} />
        ) : (
          <EmptyState message="Choose a storage and node to browse its volumes." />
        )}
      </section>
    </div>
  )
}

function ContentBrowser({
  providerId,
  storage,
  node,
}: {
  providerId: string
  storage: string
  node: string
}) {
  const base = `/admin/providers/${providerId}/storages/${encodeURIComponent(storage)}`
  const content = useTyped<PveContentItem[]>(`${base}/content`, { query: { node } })

  const [restoreVolume, setRestoreVolume] = useState("")
  const [restorePath, setRestorePath] = useState("/")

  if (content.error) return <ErrorBanner error={content.error} />

  return (
    <div className="space-y-6">
      <SimpleDataTable<PveContentItem>
        columns={[
          { key: "volid", header: "Volume", render: (row) => <span className="font-mono text-xs break-all">{row.volid ?? "—"}</span> },
          { key: "format", header: "Format", render: (row) => <Badge variant="outline">{row.format ?? "—"}</Badge> },
          { key: "vmid", header: "VMID", render: (row) => row.vmid ?? "—" },
          { key: "size", header: "Size", render: (row) => formatBytes(row.size), className: "tabular-nums" },
          { key: "used", header: "Used", render: (row) => formatBytes(row.used), className: "tabular-nums" },
          {
            key: "ctime",
            header: "Created",
            render: (row) =>
              typeof row.ctime === "number"
                ? fmtDateTime(new Date(row.ctime * 1000).toISOString())
                : fmtDateTime(typeof row.ctime === "string" ? row.ctime : null),
          },
          {
            key: "browse",
            header: "",
            className: "w-36 text-right",
            render: (row) =>
              isBackupVolume(row) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRestoreVolume(row.volid ?? "")
                    setRestorePath("/")
                  }}
                >
                  <FolderTreeIcon /> Browse files
                </Button>
              ) : null,
          },
        ]}
        rows={content.data ?? []}
        loading={content.loading}
        skeletonRows={5}
        emptyMessage="This storage holds no content visible from the selected node."
        getRowKey={(row) => row.volid ?? Math.random().toString()}
      />

      {restoreVolume ? (
        <FileRestoreBrowser
          base={base}
          node={node}
          volume={restoreVolume}
          path={restorePath}
          onPathChange={setRestorePath}
          onClose={() => setRestoreVolume("")}
        />
      ) : null}
    </div>
  )
}

function FileRestoreBrowser({
  base,
  node,
  volume,
  path,
  onPathChange,
  onClose,
}: {
  base: string
  node: string
  volume: string
  path: string
  onPathChange: (path: string) => void
  onClose: () => void
}) {
  const restore = useTyped<PveFileRestoreEntry[]>(`${base}/file-restore`, {
    query: { node, volume, path },
  })

  const columns: Array<SimpleColumn<PveFileRestoreEntry>> = [
    {
      key: "text",
      header: "Name",
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.type === "d" || row.leaf === false ? (
            <FolderOpenIcon className="size-4 text-muted-foreground" />
          ) : (
            <FolderTreeIcon className="size-4 text-muted-foreground" />
          )}
          {row.text || row.filepath?.split("/").pop() || "—"}
        </span>
      ),
    },
    { key: "filepath", header: "Path", render: (row) => <span className="font-mono text-xs break-all">{row.filepath ?? "—"}</span> },
    {
      key: "size",
      header: "Size",
      render: (row) => (row.type === "d" || row.leaf === false ? "—" : formatBytes(row.size)),
    },
    { key: "mtime", header: "Modified", render: (row) => fmtEpoch(row.mtime) },
    {
      key: "enter",
      header: "",
      className: "w-24 text-right",
      render: (row) =>
        row.type === "d" || row.leaf === false ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPathChange(row.filepath ?? path)}
          >
            Open
          </Button>
        ) : null,
    },
  ]

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FolderTreeIcon className="size-4" /> File-restore archive
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{volume}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close browser
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 grow space-y-1">
          <Label htmlFor="fr-path" className="text-xs text-muted-foreground">
            Archive path
          </Label>
          <Input
            id="fr-path"
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            placeholder="/"
            className="font-mono"
          />
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          Directories listed below can be opened by editing this path or via “Open”.
        </p>
      </div>

      {restore.error ? (
        <ErrorBanner error={restore.error} />
      ) : (
        <SimpleDataTable<PveFileRestoreEntry>
          columns={columns}
          rows={restore.data ?? []}
          loading={restore.loading}
          skeletonRows={4}
          emptyMessage="The archive path holds no entries (file-restore needs PBS-backed volumes)."
          getRowKey={(row) => row.filepath ?? Math.random().toString()}
        />
      )}
    </section>
  )
}
