// Snapshots & backups for one instance: snapshot create/list/restore/download
// (presigned {url} or proxied binary stream), delete with confirmation, plus a
// restore-backup section over the instance-filtered backup list.
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import {
  CameraIcon,
  DownloadIcon,
  HistoryIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CopyButton, ExpiryCountdown } from "./shared"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { StatusBadge } from "../../components"
import { formatBytes, formatDateTime } from "../../format"
import { toast } from "sonner"
import { API_BASE, apiDelete, apiGet, apiPost, authHeaders, ApiError } from "@/lib/api"
import { orgHeaders, useOrg } from "../../useOrg"
import { InstanceBreadcrumb, useInstance } from "./shared"

interface Snapshot {
  id: string
  public_id?: string
  name?: string
  status?: string
  size?: number
  created_at?: string
}

interface Backup {
  id: string
  name?: string
  status?: string
  size?: number
  instance_id?: string
  created_at?: string
}

export default function InstanceSnapshotsPage() {
  const { instanceId } = useParams()
  const { instance } = useInstance(instanceId)

  return (
    <div className="flex flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance?.name} section="Snapshots & backups" />
      <CreateSnapshotCard instanceId={instanceId} />
      <SnapshotListCard instanceId={instanceId} />
      <BackupsCard instanceId={instanceId} />
    </div>
  )
}

// ---- Create ---------------------------------------------------------------------

function CreateSnapshotCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!instanceId || !orgId) return
    if (!name.trim()) {
      toast.error("Snapshot name is required")
      return
    }
    setSubmitting(true)
    try {
      await apiPost(
        `/instances/${instanceId}/snapshot`,
        { name: name.trim(), desc: desc.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Snapshot queued — it appears in the list once the provider accepts it")
      setName("")
      setDesc("")
      window.setTimeout(() => window.dispatchEvent(new Event("kilat:snapshots-changed")), 1500)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create snapshot")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CameraIcon className="size-4" /> Take a snapshot
        </CardTitle>
        <CardDescription>
          Point-in-time copy of the whole instance. Restores replace the disk contents.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="snap-name">Name *</Label>
          <Input
            id="snap-name"
            className="w-64"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="pre-upgrade-2026-08"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="snap-desc">Description</Label>
          <Input
            id="snap-desc"
            className="w-80"
            value={desc}
            onChange={(event) => setDesc(event.target.value)}
            placeholder="before kernel upgrade"
          />
        </div>
        <Button onClick={() => void submit()} disabled={submitting}>
          {submitting ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Create snapshot
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- Snapshot list -----------------------------------------------------------------

function SnapshotListCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Snapshot | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<{ url: string; expireAt: number | null } | null>(
    null,
  )

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      // GET /snapshots is organization-wide — the API exposes no per-instance
      // filter or linkage field, so this list shows all snapshots of the org.
      const { data } = await apiGet<Snapshot[]>("/snapshots", {
        headers: orgHeaders(orgId),
      })
      setSnapshots(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    const handler = () => void load()
    window.addEventListener("kilat:snapshots-changed", handler)
    return () => window.removeEventListener("kilat:snapshots-changed", handler)
  }, [load])

  const restore = async () => {
    if (!restoreTarget || !instanceId || !orgId) return
    try {
      await apiPost(
        `/instances/${instanceId}/restore-snapshot`,
        { snapshot_id: restoreTarget.id },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`Restore of "${restoreTarget.name || restoreTarget.id}" queued`)
      setRestoreTarget(null)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to queue restore")
    }
  }

  const remove = async () => {
    if (!deleteTarget || !orgId) return
    try {
      await apiDelete(`/snapshots/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success("Snapshot deleted")
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete snapshot")
    }
  }

  const requestDownload = async (snapshot: Snapshot) => {
    if (!orgId) return
    try {
      const { data } = await apiPost<{ url?: string }>(
        `/snapshots/${snapshot.id}/download-url`,
        {},
        { headers: orgHeaders(orgId) },
      )
      if (!data?.url) {
        toast.error("The backend returned no download URL")
        return
      }
      setDownloadUrl({ url: data.url, expireAt: null })
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to generate download URL")
    }
  }

  const columns: Array<SimpleColumn<Snapshot>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name || row.id}</p>
          {row.public_id ? (
            <p className="truncate text-xs text-muted-foreground">{row.public_id}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "size",
      header: "Size",
      render: (row) => (
        <span className="tabular-nums">{row.size ? formatBytes(row.size) : "—"}</span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => <span className="text-sm">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-64",
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRestoreTarget(row)}
            title="Restore this instance from the snapshot"
          >
            <HistoryIcon /> Restore…
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void requestDownload(row)}
            title="Get a short-lived download URL"
          >
            <DownloadIcon /> URL
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={`Delete ${row.name || row.id}…`}
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
      <CardHeader>
        <CardTitle>Snapshots</CardTitle>
        <CardDescription>
          The API lists snapshots organization-wide without an instance link — restores always
          target the instance you opened this page from.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={columns}
          rows={snapshots}
          loading={loading}
          error={error}
          skeletonRows={3}
          emptyMessage={
            error
              ? undefined
              : "No snapshots yet — take one above."
          }
          getRowKey={(row) => row.id}
        />

        {/* Restore confirm */}
        <AlertDialog
          open={restoreTarget !== null}
          onOpenChange={(open) => !open && setRestoreTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Restore “{restoreTarget?.name || restoreTarget?.id}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This instance's disk will be overwritten with the snapshot contents. The job
                runs asynchronously at the provider.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void restore()
                }}
              >
                Restore snapshot
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete confirm */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleteTarget?.name || deleteTarget?.id}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Deleted snapshots cannot be recovered.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault()
                  void remove()
                }}
              >
                Delete snapshot
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Download URL dialog */}
        <Dialog
          open={downloadUrl !== null}
          onOpenChange={(open) => !open && setDownloadUrl(null)}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Download URL</DialogTitle>
              <DialogDescription>
                Short-lived link to the stored snapshot file.
              </DialogDescription>
            </DialogHeader>
            {downloadUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1 rounded-md border bg-muted/30 px-3 py-2">
                  <a
                    href={downloadUrl.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-sm underline-offset-4 hover:underline"
                  >
                    {downloadUrl.url}
                  </a>
                  <CopyButton value={downloadUrl.url} label="Copy download URL" />
                </div>
                <p className="text-sm text-muted-foreground">
                  The link expires after about 15 minutes.
                  {downloadUrl.expireAt ? (
                    <>
                      {" "}
                      (<ExpiryCountdown expireAt={downloadUrl.expireAt} />)
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ---- Backups -----------------------------------------------------------------------

function BackupsCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null)

  const load = useCallback(async () => {
    if (!instanceId || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<Backup[]>("/backups", {
        headers: orgHeaders(orgId),
        query: { instance_id: instanceId },
      })
      setBackups(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId, orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const restoreBackup = async () => {
    if (!restoreTarget || !instanceId || !orgId) return
    try {
      await apiPost(
        `/instances/${instanceId}/restore-backup`,
        { backup_id: restoreTarget.id },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`Restore of "${restoreTarget.name || restoreTarget.id}" queued`)
      setRestoreTarget(null)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to queue restore")
    }
  }

  /**
   * POST /backups/:id/download-url answers either JSON `{url}` (presigned
   * providers) or the raw backup as an octet-stream proxy. lib/api helpers
   * cannot express a binary response, so this uses fetch directly with the
   * shared auth/org headers and falls back to a blob download.
   */
  const downloadBackup = async (backup: Backup) => {
    if (!orgId) return
    try {
      const response = await fetch(`${API_BASE}/backups/${backup.id}/download-url`, {
        method: "POST",
        headers: { ...authHeaders(), ...orgHeaders(orgId), Accept: "*/*" },
      })
      if (!response.ok) {
        let message = `Request failed with status ${response.status}`
        try {
          const payload = (await response.json()) as { error?: { message?: string } }
          if (payload?.error?.message) message = payload.error.message
        } catch {
          // Not JSON — keep the status-based message.
        }
        throw new ApiError("download_failed", message, response.status)
      }
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { data?: { url?: string }; url?: string }
        const url = payload.data?.url ?? payload.url
        if (!url) {
          toast.error("The backend returned no download URL")
          return
        }
        window.open(url, "_blank", "noopener")
        toast.success("Download URL opened in a new tab")
      } else {
        const disposition = response.headers.get("content-disposition") ?? ""
        const match = /filename="?([^";]+)"?/.exec(disposition)
        const filename =
          match?.[1] ?? `${backup.name || backup.id}.backup`
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = objectUrl
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(objectUrl)
        toast.success(`Downloading ${filename}`)
      }
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to start backup download",
      )
    }
  }

  const columns: Array<SimpleColumn<Backup>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => <span className="font-medium">{row.name || row.id}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "size",
      header: "Size",
      render: (row) => (
        <span className="tabular-nums">{row.size ? formatBytes(row.size) : "—"}</span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => <span className="text-sm">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-56",
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRestoreTarget(row)}
            title="Restore this instance from the backup"
          >
            <HistoryIcon /> Restore…
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void downloadBackup(row)}
            title="Download the backup file"
          >
            <DownloadIcon /> Download
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backups</CardTitle>
        <CardDescription>
          Server-side backups of this instance ({`GET /backups?instance_id=…`}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={columns}
          rows={backups}
          loading={loading}
          error={error}
          skeletonRows={2}
          emptyMessage="No backups exist for this instance yet."
          getRowKey={(row) => row.id}
        />

        <AlertDialog
          open={restoreTarget !== null}
          onOpenChange={(open) => !open && setRestoreTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Restore “{restoreTarget?.name || restoreTarget?.id}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This instance's disk will be overwritten with the backup contents. The job runs
                asynchronously at the provider.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void restoreBackup()
                }}
              >
                Restore backup
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
