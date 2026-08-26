// Custom ISOs: list with live quota usage, add from URL, multipart upload with
// progress, retry of failed registrations, delete, and measured boot image
// management (upload / attach to instance / detach / delete).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  CloudUploadIcon,
  LinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatBytes, formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import { uploadMultipart } from "../upload"

interface IsoView {
  id?: string
  external_id?: string
  name: string
  filename?: string
  source_url?: string
  size_bytes: number
  status: string
  register_status?: string
  is_system?: boolean
  created_at?: string
}

interface IsoUsage {
  count: number
  used_bytes: number
  quota_bytes: number
  max_per_file: number
}

interface MeasuredBootImage {
  id?: string
  external_id?: string
  name: string
  filename?: string
  description?: string
  size_bytes: number
  created_at?: string
}

const MAX_ISOS = 10

export default function CustomerIsoPage() {
  const { orgId } = useOrg()
  const [isos, setIsos] = useState<IsoView[]>([])
  const [usage, setUsage] = useState<IsoUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [deleteTarget, setDeleteTarget] = useState<IsoView | null>(null)

  // Add-from-URL dialog state
  const [urlOpen, setUrlOpen] = useState(false)
  const [isoUrl, setIsoUrl] = useState("")
  const [isoName, setIsoName] = useState("")
  const [urlBusy, setUrlBusy] = useState(false)

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState("")
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const envelope = await apiGet<IsoView[]>("/isos", { headers: orgHeaders(orgId) })
      setIsos(envelope.data ?? [])
      // `usage` rides next to data/meta in the ISO envelope.
      const usageRaw = (envelope as unknown as { usage?: IsoUsage }).usage
      if (usageRaw) setUsage(usageRaw)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const addFromUrl = async () => {
    if (!isoUrl.trim()) {
      toast.error("URL is required")
      return
    }
    setUrlBusy(true)
    try {
      await apiPost<IsoView>(
        "/isos",
        { url: isoUrl.trim(), name: isoName.trim() || undefined },
        { headers: orgHeaders(orgId) },
      )
      toast.success("ISO registration started")
      setUrlOpen(false)
      setIsoUrl("")
      setIsoName("")
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to register ISO")
    } finally {
      setUrlBusy(false)
    }
  }

  const startUpload = async () => {
    if (!uploadFile) {
      toast.error("Choose an ISO file first")
      return
    }
    if (usage && uploadFile.size > usage.max_per_file) {
      toast.error(`File exceeds the ${formatBytes(usage.max_per_file)} per-file cap`)
      return
    }
    setUploadPercent(0)
    try {
      const form = new FormData()
      form.append("file", uploadFile)
      if (uploadName.trim()) form.append("name", uploadName.trim())
      await uploadMultipart("/isos/upload", form, setUploadPercent)
      toast.success("ISO uploaded — registration queued")
      setUploadOpen(false)
      setUploadFile(null)
      setUploadName("")
      void load()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Upload failed (object storage may be unavailable)",
      )
    } finally {
      setUploadPercent(null)
    }
  }

  const retryIso = async (iso: IsoView) => {
    try {
      await apiPost(`/isos/${iso.id}/retry`, {}, { headers: orgHeaders(orgId) })
      toast.success("Registration retry queued")
      setTimeout(() => void load(), 2000)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Retry failed")
    }
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/isos/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`ISO "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete ISO")
    }
  }

  const columns: Array<SimpleColumn<IsoView>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          {row.id ? (
            <Link
              to={`/app/iso/${row.id}`}
              className="block max-w-72 truncate font-medium underline-offset-2 hover:underline"
            >
              {row.name}
            </Link>
          ) : (
            <p className="truncate font-medium">{row.name}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">{row.filename ?? row.source_url ?? ""}</p>
        </div>
      ),
    },
    { key: "size_bytes", header: "Size", render: (row) => formatBytes(row.size_bytes) },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.status} />
          {row.register_status && row.register_status !== row.status ? (
            <StatusBadge status={row.register_status} />
          ) : null}
        </div>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => formatDateTime(row.created_at),
    },
    {
      key: "actions",
      header: "",
      className: "w-28",
      render: (row) =>
        row.id ? (
          <div className="flex justify-end gap-1">
            {row.register_status === "failed" ? (
              <Button size="icon" variant="ghost" title="Retry registration" onClick={() => void retryIso(row)}>
                <RefreshCwIcon />
              </Button>
            ) : null}
            <Button
              size="icon"
              variant="ghost"
              title="Delete"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : null,
    },
  ]

  const usedPercent = usage?.quota_bytes ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ISO images"
        description="Custom ISOs and measured boot images for your instances."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/measured-boot">
                <ShieldCheckIcon /> Measured boot page
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setUrlOpen(true)}>
              <LinkIcon /> Add from URL
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <CloudUploadIcon /> Upload ISO
            </Button>
          </>
        }
      />

      {/* Quota panel driven by the API's real usage values */}
      {usage ? (
        <Card>
          <CardContent className="space-y-3 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Storage quota{" "}
                <span className="tabular-nums text-muted-foreground">
                  {formatBytes(usage.used_bytes)} of {formatBytes(usage.quota_bytes)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Per-file cap {formatBytes(usage.max_per_file)}
              </span>
              <span>
                Images{" "}
                <span className="tabular-nums text-muted-foreground">
                  {usage.count} / {MAX_ISOS}
                </span>
              </span>
            </div>
            <Progress value={usedPercent} />
          </CardContent>
        </Card>
      ) : null}

      <ErrorBanner error={error} />

      <Tabs defaultValue="isos">
        <TabsList>
          <TabsTrigger value="isos">Custom ISOs</TabsTrigger>
          <TabsTrigger value="measured">Measured boot</TabsTrigger>
        </TabsList>

        <TabsContent value="isos" className="space-y-4">
          <SimpleDataTable
            columns={columns}
            rows={isos}
            loading={loading}
            error={error}
            emptyMessage={
              error ? undefined : "No custom ISOs yet — add one from a URL or upload a file."
            }
            getRowKey={(row) => row.id ?? row.external_id ?? row.name}
          />
        </TabsContent>

        <TabsContent value="measured">
          <MeasuredBootSection onUsageChanged={() => void load()} />
        </TabsContent>
      </Tabs>

      {/* Add from URL */}
      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add ISO from URL</DialogTitle>
            <DialogDescription>
              A reachable public http(s) URL. The file is probed and registered with the
              provider asynchronously.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="iso-url">URL *</Label>
              <Input
                id="iso-url"
                value={isoUrl}
                onChange={(event) => setIsoUrl(event.target.value)}
                placeholder="https://mirror.example.com/debian-12.iso"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iso-name">Display name</Label>
              <Input
                id="iso-name"
                value={isoName}
                onChange={(event) => setIsoName(event.target.value)}
                placeholder="Defaults to the file name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlOpen(false)} disabled={urlBusy}>
              Cancel
            </Button>
            <Button onClick={() => void addFromUrl()} disabled={urlBusy}>
              {urlBusy ? <Loader2Icon className="animate-spin" /> : null} Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File upload */}
      <Dialog open={uploadOpen} onOpenChange={(open) => uploadPercent === null && setUploadOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload ISO file</DialogTitle>
            <DialogDescription>
              Direct upload to object storage{usage ? `, max ${formatBytes(usage.max_per_file)} per file` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="iso-file">ISO file *</Label>
              <Input
                id="iso-file"
                type="file"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
              {uploadFile ? (
                <p className="text-xs text-muted-foreground">{formatBytes(uploadFile.size)}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iso-upload-name">Display name</Label>
              <Input
                id="iso-upload-name"
                value={uploadName}
                onChange={(event) => setUploadName(event.target.value)}
                placeholder="Defaults to the file name"
              />
            </div>
            {uploadPercent !== null ? (
              <div className="space-y-1">
                <Progress value={uploadPercent} />
                <p className="text-xs tabular-nums text-muted-foreground">{uploadPercent}% uploaded</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploadPercent !== null}>
              Cancel
            </Button>
            <Button onClick={() => void startUpload()} disabled={uploadPercent !== null}>
              {uploadPercent !== null ? <Loader2Icon className="animate-spin" /> : <CloudUploadIcon />} Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The ISO is removed from storage and detached from any provider team. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
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

// ---- Measured boot -----------------------------------------------------------

function MeasuredBootSection({ onUsageChanged }: { onUsageChanged: () => void }) {
  const { orgId } = useOrg()
  const [images, setImages] = useState<MeasuredBootImage[]>([])
  const [instances, setInstances] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [deleteTarget, setDeleteTarget] = useState<MeasuredBootImage | null>(null)
  const [attachTarget, setAttachTarget] = useState<MeasuredBootImage | null>(null)
  const [attachInstanceId, setAttachInstanceId] = useState("")
  const [busy, setBusy] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  // The API exposes attach/detach per instance but no read of current
  // attachments, so the UI can attach but not list existing bindings.
  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [imagesRes, instancesRes] = await Promise.all([
        apiGet<MeasuredBootImage[]>("/measured-boot-images", { headers: orgHeaders(orgId) }),
        apiGet<Array<{ id: string; name: string }>>("/instances", {
          headers: orgHeaders(orgId),
        }),
      ])
      setImages(imagesRes.data ?? [])
      setInstances(instancesRes.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (file: File, description: string) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append("file", file)
      if (description.trim()) form.append("description", description.trim())
      await uploadMultipart("/measured-boot-images", form)
      toast.success("Measured boot image uploaded")
      onUsageChanged()
      void load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  const attach = async () => {
    if (!attachTarget || !attachInstanceId) return
    setBusy(true)
    try {
      await apiPost(
        `/instances/${attachInstanceId}/attach-measured-boot`,
        { image_id: attachTarget.id },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Measured boot image attached")
      setAttachTarget(null)
      setAttachInstanceId("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Attach failed")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/measured-boot-images/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success("Measured boot image deleted")
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete failed")
    }
  }

  const columns: Array<SimpleColumn<MeasuredBootImage>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.filename ?? ""}</p>
        </div>
      ),
    },
    { key: "size_bytes", header: "Size", render: (row) => formatBytes(row.size_bytes) },
    { key: "description", header: "Description" },
    { key: "created_at", header: "Created", render: (row) => formatDateTime(row.created_at) },
    {
      key: "actions",
      header: "",
      className: "w-40",
      render: (row) =>
        row.id ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setAttachTarget(row)}>
              Attach…
            </Button>
            <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteTarget(row)}>
              <Trash2Icon />
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Verified-boot images (max 512 MB) that instances can boot with attestation.
        </p>
        <Button variant="outline" onClick={() => setUploadOpen(true)} disabled={busy}>
          <CloudUploadIcon /> Upload image
        </Button>
      </div>

      <SimpleDataTable
        columns={columns}
        rows={images}
        loading={loading}
        error={error}
        emptyMessage={error ? undefined : "No measured boot images uploaded yet."}
        getRowKey={(row) => row.id ?? row.external_id ?? row.name}
      />

      <MeasuredBootUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        busy={busy}
        onUpload={upload}
      />

      {/* Attach picker */}
      <Dialog open={attachTarget !== null} onOpenChange={(open) => !open && setAttachTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach “{attachTarget?.name}”</DialogTitle>
            <DialogDescription>Choose which instance should boot this image.</DialogDescription>
          </DialogHeader>
          <Select value={attachInstanceId} onValueChange={setAttachInstanceId}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachTarget(null)}>
              Cancel
            </Button>
            <Button disabled={!attachInstanceId || busy} onClick={() => void attach()}>
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The image is removed from the provider.</AlertDialogDescription>
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
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MeasuredBootUploadDialog({
  open,
  onOpenChange,
  busy,
  onUpload,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  onUpload: (file: File, description: string) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")

  const close = (next: boolean) => {
    if (!next) {
      setFile(null)
      setDescription("")
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload measured boot image</DialogTitle>
          <DialogDescription>Maximum 512 MB.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mb-file">Image file *</Label>
            <Input
              id="mb-file"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mb-desc">Description</Label>
            <Input
              id="mb-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!file || busy}
            onClick={() => {
              if (file) void onUpload(file, description).then(() => close(false))
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : null} Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
