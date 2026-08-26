// Measured boot images: upload (multipart, ≤512 MB), list, delete, and the
// attach / detach pickers that bind an image to an instance. The instances
// payload does not expose current attachments, so bindings are write-only
// from this console's point of view.
import { useCallback, useEffect, useState } from "react"
import {
  CloudUploadIcon,
  LinkIcon,
  Loader2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
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
import { formatBytes, formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"
import { uploadMultipart } from "../upload"
import type { CustomerInstance } from "../instances/types"

interface MeasuredBootImage {
  id?: string
  external_id?: string
  name: string
  filename?: string
  description?: string
  size_bytes: number
  created_at?: string
}

export default function MeasuredBootPage() {
  const { orgId } = useOrg()
  const [images, setImages] = useState<MeasuredBootImage[]>([])
  const [instances, setInstances] = useState<CustomerInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [deleteTarget, setDeleteTarget] = useState<MeasuredBootImage | null>(null)
  const [busy, setBusy] = useState(false)

  // Upload dialog state.
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDesc, setUploadDesc] = useState("")
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      // Instances load independently — a failure there must not blank the
      // image table (attach/detach just degrade to disabled).
      let instanceList: CustomerInstance[] = []
      await Promise.all([
        apiGet<MeasuredBootImage[]>("/measured-boot-images", { headers: orgHeaders(orgId) }).then(
          ({ data }) => {
            setImages(data ?? [])
          },
        ),
        apiGet<CustomerInstance[]>("/instances", { headers: orgHeaders(orgId) })
          .then(({ data }) => {
            instanceList = data ?? []
          })
          .catch(() => undefined),
      ])
      setInstances(instanceList)
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

  const startUpload = async () => {
    if (!uploadFile) {
      toast.error("Choose an image file first")
      return
    }
    if (uploadFile.size > 512 * 1024 * 1024) {
      toast.error("Measured boot images are limited to 512 MB")
      return
    }
    setUploadPercent(0)
    try {
      const form = new FormData()
      form.append("file", uploadFile)
      if (uploadDesc.trim()) form.append("description", uploadDesc.trim())
      await uploadMultipart("/measured-boot-images", form, setUploadPercent)
      toast.success("Measured boot image uploaded")
      setUploadOpen(false)
      setUploadFile(null)
      setUploadDesc("")
      void load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Upload failed")
    } finally {
      setUploadPercent(null)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget?.id || !orgId) return
    setBusy(true)
    try {
      await apiDelete(`/measured-boot-images/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Image "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete image")
    } finally {
      setBusy(false)
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
      className: "w-16",
      render: (row) =>
        row.id ? (
          <div className="flex justify-end">
            <Button
              size="icon"
              variant="ghost"
              title="Delete…"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2Icon />
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Measured boot images"
        description="Verified-boot images (max 512 MB) that instances can boot with attestation."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <CloudUploadIcon /> Upload image
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <SimpleDataTable
        columns={columns}
        rows={images}
        loading={loading}
        error={error}
        emptyMessage={
          error ? undefined : "No measured boot images yet — upload one to get started."
        }
        getRowKey={(row) => row.id ?? row.external_id ?? row.name}
      />

      <AttachDetachCard images={images} instances={instances} onChanged={() => void load()} />

      {/* Upload dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => uploadPercent === null && setUploadOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload measured boot image</DialogTitle>
            <DialogDescription>Maximum 512 MB per image.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mb-file">Image file *</Label>
              <Input
                id="mb-file"
                type="file"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
              {uploadFile ? (
                <p className="text-xs text-muted-foreground">{formatBytes(uploadFile.size)}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb-desc">Description</Label>
              <Input
                id="mb-desc"
                value={uploadDesc}
                onChange={(event) => setUploadDesc(event.target.value)}
              />
            </div>
            {uploadPercent !== null ? (
              <div className="space-y-1">
                <Progress value={uploadPercent} />
                <p className="text-xs tabular-nums text-muted-foreground">
                  {uploadPercent}% uploaded
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploadPercent !== null}>
              Cancel
            </Button>
            <Button onClick={() => void startUpload()} disabled={!uploadFile || uploadPercent !== null}>
              {uploadPercent !== null ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <CloudUploadIcon />
              )}{" "}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
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
              disabled={busy}
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

// ---- Attach / detach ------------------------------------------------------------

function AttachDetachCard({
  images,
  instances,
  onChanged,
}: {
  images: MeasuredBootImage[]
  instances: CustomerInstance[]
  onChanged: () => void
}) {
  const { orgId } = useOrg()
  const [attachInstanceId, setAttachInstanceId] = useState("")
  const [attachImageId, setAttachImageId] = useState("")
  const [detachInstanceId, setDetachInstanceId] = useState("")
  const [detachImageId, setDetachImageId] = useState("")
  const [busy, setBusy] = useState<"attach" | "detach" | null>(null)

  const attach = async () => {
    if (!orgId || !attachInstanceId || !attachImageId) return
    setBusy("attach")
    try {
      await apiPost(
        `/instances/${attachInstanceId}/attach-measured-boot`,
        { image_id: attachImageId },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Measured boot image attached to instance")
      setAttachInstanceId("")
      setAttachImageId("")
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Attach failed")
    } finally {
      setBusy(null)
    }
  }

  const detach = async () => {
    if (!orgId || !detachInstanceId) return
    setBusy("detach")
    try {
      await apiPost(
        `/instances/${detachInstanceId}/detach-measured-boot`,
        detachImageId ? { image_id: detachImageId } : {},
        { headers: orgHeaders(orgId) },
      )
      toast.success("Measured boot image detached from instance")
      setDetachInstanceId("")
      setDetachImageId("")
      onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Detach failed")
    } finally {
      setBusy(null)
    }
  }

  const canAttach = Boolean(attachInstanceId && attachImageId) && busy === null
  const canDetach = Boolean(detachInstanceId) && busy === null

  return (
    <Card>
      <CardContent className="space-y-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-muted-foreground" />
          <h2 className="font-semibold">Bind to instance</h2>
        </div>

        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No instances available to bind. Create an instance first.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <LinkIcon className="size-3.5 text-muted-foreground" /> Attach image
              </p>
              <div className="space-y-1.5">
                <Label>Instance *</Label>
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
              </div>
              <div className="space-y-1.5">
                <Label>Image *</Label>
                <Select value={attachImageId} onValueChange={setAttachImageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose image" />
                  </SelectTrigger>
                  <SelectContent>
                    {images
                      .filter((image) => image.id)
                      .map((image) => (
                        <SelectItem key={image.id} value={image.id as string}>
                          {image.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {images.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Upload an image first.</p>
                ) : null}
              </div>
              <Button size="sm" disabled={!canAttach} onClick={() => void attach()}>
                {busy === "attach" ? <Loader2Icon className="animate-spin" /> : <LinkIcon />} Attach
              </Button>
            </div>

            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <UnlinkIcon className="size-3.5 text-muted-foreground" /> Detach image
              </p>
              <div className="space-y-1.5">
                <Label>Instance *</Label>
                <Select value={detachInstanceId} onValueChange={setDetachInstanceId}>
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
                <Label>Image</Label>
                <Select value={detachImageId || "none"} onValueChange={(value) => setDetachImageId(value === "none" ? "" : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="(optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">(none)</SelectItem>
                    {images
                      .filter((image) => image.id)
                      .map((image) => (
                        <SelectItem key={image.id} value={image.id as string}>
                          {image.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" disabled={!canDetach} onClick={() => void detach()}>
                {busy === "detach" ? <Loader2Icon className="animate-spin" /> : <UnlinkIcon />} Detach
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          The API does not expose which image is currently attached per instance, so existing
          bindings cannot be listed here — use detach before attaching a different image.
        </p>
      </CardContent>
    </Card>
  )
}
