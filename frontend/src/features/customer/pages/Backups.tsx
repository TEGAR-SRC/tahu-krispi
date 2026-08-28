// Snapshots & backups: per-instance restore points with create / restore /
// download / delete. Download links are short-lived; proxmox backups stream
// through the backend, so downloads fetch the body with the bearer token.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  ClockIcon,
  DownloadIcon,
  HistoryIcon,
  Loader2Icon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { getToken, apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatBytes, formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import type { CustomerInstance } from "../instances/types"

interface SnapshotRow {
  id: string
  public_id?: string
  name: string
  status: string
  size?: number
  created_at?: string
}

interface BackupRow {
  id: string
  name: string
  status: string
  size?: number
  instance_id: string
  created_at?: string
}

type RestoreTarget = { kind: "snapshot"; row: SnapshotRow } | { kind: "backup"; row: BackupRow } | null

export default function CustomerBackupsPage() {
  const { orgId } = useOrg()
  const [instances, setInstances] = useState<CustomerInstance[]>([])
  const [instanceId, setInstanceId] = useState<string>("all")
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null)
  const [deleteSnapshot, setDeleteSnapshot] = useState<SnapshotRow | null>(null)
  const [busy, setBusy] = useState(false)
  // Snapshots are keyed to an instance on the API, so creation needs one.
  const effectiveInstance = instanceId === "all" ? (instances[0]?.id ?? "") : instanceId

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const instancesRes = await apiGet<CustomerInstance[]>("/instances", {
        headers: orgHeaders(orgId),
      })
      const list = instancesRes.data ?? []
      setInstances(list)
      const query =
        instanceId !== "all"
          ? { instance_id: instanceId }
          : undefined
      // Snapshots can fail independently of backups (e.g. provider hiccup);
      // settle them separately so one broken source never blanks the page.
      let firstError: unknown = null
      let snaps: SnapshotRow[] = []
      let baks: BackupRow[] = []
      await Promise.all([
        apiGet<SnapshotRow[]>("/snapshots", { headers: orgHeaders(orgId), query })
          .then(({ data }) => {
            snaps = data ?? []
          })
          .catch((cause) => {
            firstError = cause
          }),
        apiGet<BackupRow[]>("/backups", { headers: orgHeaders(orgId), query })
          .then(({ data }) => {
            baks = data ?? []
          })
          .catch((cause) => {
            firstError = firstError ?? cause
          }),
      ])
      setSnapshots(snaps)
      setBackups(baks)
      if (firstError) throw firstError
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, instanceId])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  const instanceName = useMemo(() => {
    const map = new Map(instances.map((instance) => [instance.id, instance.name]))
    return (id: string) => map.get(id) ?? id.slice(0, 8)
  }, [instances])

  /** Downloads via short-lived link JSON or a proxied binary stream. */
  const download = async (kind: "snapshot" | "backup", id: string, name: string) => {
    try {
      const response = await fetch(`/api/v1/${kind}s/${id}/download-url`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      })
      const contentType = response.headers.get("content-type") ?? ""
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new ApiError(
          payload?.error?.code ?? "download_failed",
          payload?.error?.message ?? `Download failed (${response.status})`,
          response.status,
        )
      }
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { url?: string }
        if (!payload.url) throw new Error("No download URL returned")
        window.open(payload.url, "_blank", "noopener,noreferrer")
        toast.success("Download link opened")
      } else {
        // Provider streams the raw file through this backend.
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = objectUrl
        anchor.download = name || `${kind}-${id}`
        anchor.click()
        URL.revokeObjectURL(objectUrl)
        toast.success("Download started")
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Download failed")
    }
  }

  const runRestore = async () => {
    if (!restoreTarget || !effectiveInstance) return
    setBusy(true)
    try {
      if (restoreTarget.kind === "snapshot") {
        await apiPost(
          `/instances/${effectiveInstance}/restore-snapshot`,
          { snapshot_id: restoreTarget.row.id },
          { headers: orgHeaders(orgId) },
        )
      } else {
        await apiPost(
          `/instances/${effectiveInstance}/restore-backup`,
          { backup_id: restoreTarget.row.id },
          { headers: orgHeaders(orgId) },
        )
      }
      toast.success("Restore started — the instance will reboot into the restore point")
      setRestoreTarget(null)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Restore failed")
    } finally {
      setBusy(false)
    }
  }

  const runDeleteSnapshot = async () => {
    if (!deleteSnapshot) return
    setBusy(true)
    try {
      await apiDelete(`/snapshots/${deleteSnapshot.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Snapshot "${deleteSnapshot.name}" deleted`)
      setDeleteSnapshot(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete snapshot")
    } finally {
      setBusy(false)
    }
  }

  const snapshotColumns: Array<SimpleColumn<SnapshotRow>> = [
    {
      key: "name",
      header: "Snapshot",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.public_id ?? row.id}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "size", header: "Size", render: (row) => formatBytes(row.size ?? 0) },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-36",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            title="Restore…"
            disabled={!effectiveInstance}
            onClick={() => setRestoreTarget({ kind: "snapshot", row })}
          >
            <RotateCcwIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Download"
            onClick={() => void download("snapshot", row.id, row.name)}
          >
            <DownloadIcon />
          </Button>
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteSnapshot(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  const backupColumns: Array<SimpleColumn<BackupRow>> = [
    {
      key: "name",
      header: "Backup",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            Instance: {instanceName(row.instance_id)}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "size", header: "Size", render: (row) => formatBytes(row.size ?? 0) },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            title="Restore…"
            disabled={!effectiveInstance}
            onClick={() => setRestoreTarget({ kind: "backup", row })}
          >
            <RotateCcwIcon />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Download"
            onClick={() => void download("backup", row.id, row.name)}
          >
            <DownloadIcon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Backups & snapshots"
        description="Restore points for your instances. Downloads are short-lived links."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/measured-boot">
                <ShieldCheckIcon /> Measured boot images
              </Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)} disabled={instances.length === 0}>
              <PlusIcon /> New snapshot
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="backup-instance" className="text-sm text-muted-foreground">
          Instance
        </Label>
        <Select value={instanceId} onValueChange={setInstanceId}>
          <SelectTrigger id="backup-instance" className="w-64">
            <SelectValue placeholder="Choose instance" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All instances</SelectItem>
            {instances.map((instance) => (
              <SelectItem key={instance.id} value={instance.id}>
                {instance.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loading ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClockIcon className="size-3.5" />
            {snapshots.length} snapshots · {backups.length} backups
          </span>
        ) : null}
      </div>

      <ErrorBanner error={error} />

      <Tabs defaultValue="snapshots">
        <TabsList>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
        </TabsList>
        <TabsContent value="snapshots">
          <SimpleDataTable
            columns={snapshotColumns}
            rows={snapshots}
            loading={loading}
            error={null}
            emptyMessage={
              error ? undefined : instanceId === "all" && instances.length > 0
                ? "No snapshots yet."
                : "No snapshots for this instance."
            }
            getRowKey={(row) => row.id}
          />
        </TabsContent>
        <TabsContent value="backups">
          <SimpleDataTable
            columns={backupColumns}
            rows={backups}
            loading={loading}
            error={null}
            emptyMessage={
              error ? undefined : instanceId === "all" && instances.length > 0
                ? "No backups yet."
                : "No backups for this instance."
            }
            getRowKey={(row) => row.id}
          />
        </TabsContent>
      </Tabs>

      <CreateSnapshotDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultInstanceId={effectiveInstance}
        onCreated={() => void load()}
      />

      {/* Restore confirmation */}
      <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {restoreTarget?.kind} “{restoreTarget?.row.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected instance will be reverted to this restore point. Any data written
              after it was taken is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runRestore()
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : <HistoryIcon />} Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Snapshot delete confirmation */}
      <AlertDialog open={deleteSnapshot !== null} onOpenChange={(open) => !open && setDeleteSnapshot(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snapshot “{deleteSnapshot?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This restore point cannot be recovered.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDeleteSnapshot()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateSnapshotDialog({
  open,
  onOpenChange,
  defaultInstanceId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultInstanceId: string
  onCreated: () => void
}) {
  const { orgId } = useOrg()
  const [instances, setInstances] = useState<CustomerInstance[]>([])
  const [instanceId, setInstanceId] = useState(defaultInstanceId)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setInstanceId(defaultInstanceId), 0)
    apiGet<CustomerInstance[]>("/instances", { headers: orgHeaders(orgId) })
      .then(({ data }) => setInstances(data ?? []))
      .catch(() => undefined)
    return () => clearTimeout(t)
  }, [open, defaultInstanceId, orgId])

  const submit = async () => {
    if (!instanceId) {
      toast.error("Choose an instance")
      return
    }
    if (!name.trim()) {
      toast.error("Snapshot name is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        `/instances/${instanceId}/snapshot`,
        { name: name.trim(), desc: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Snapshot creation started")
      setName("")
      setDescription("")
      onOpenChange(false)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create snapshot")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New snapshot</DialogTitle>
          <DialogDescription>Captures the instance disk state as a restore point.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Instance *</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose instance" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((instance) => (
                  <SelectItem key={instance.id} value={instance.id}>
                    {instance.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="snap-name">Name *</Label>
            <Input
              id="snap-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="pre-upgrade-2026-08"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="snap-desc">Description</Label>
            <Textarea
              id="snap-desc"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
