// Platform-admin object storage backends: per-category S3/R2/MinIO bucket
// configuration. PUT upserts by code; credentials are write-only. The DELETE
// endpoint only disables a backend (enabled=false), it never removes the row.
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPut, ApiError } from "@/lib/api"
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "./shared"

interface StorageBackendRow {
  id: string
  code: string
  name: string
  driver: string
  endpoint: string
  region?: string
  bucket_name: string
  has_credentials: boolean
  enabled: boolean
}

const DRIVERS = ["s3", "r2", "minio"]

export default function AdminStorageBackendsPage() {
  const [rows, setRows] = useState<StorageBackendRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editing, setEditing] = useState<StorageBackendRow | null>(null)
  const [disableTarget, setDisableTarget] = useState<StorageBackendRow | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<StorageBackendRow[]>("/admin/storage-backends")
      .then(({ data }) => {
        if (!cancelled) {
          setRows(data)
          setError(null)
        }
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
  }, [reloadTick])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Storage Backends"
        description="Object storage used for avatars, documents, ISOs, tickets and invoices."
      />

      <SimpleDataTable<StorageBackendRow>
        columns={[
          {
            key: "code",
            header: "Backend",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{row.code}</p>
              </div>
            ),
          },
          {
            key: "driver",
            header: "Driver",
            render: (row) => <Badge variant="outline">{row.driver}</Badge>,
          },
          {
            key: "bucket_name",
            header: "Bucket",
            render: (row) => <span className="font-mono text-xs">{row.bucket_name}</span>,
          },
          {
            key: "endpoint",
            header: "Endpoint",
            className: "hidden md:table-cell max-w-52 truncate font-mono text-xs",
            render: (row) => (
              <span className="text-muted-foreground">{row.endpoint || "AWS default"}</span>
            ),
          },
          {
            key: "region",
            header: "Region",
            className: "hidden lg:table-cell",
            render: (row) => row.region || "—",
          },
          {
            key: "has_credentials",
            header: "Credentials",
            render: (row) =>
              row.has_credentials ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">configured</span>
              ) : (
                <span className="text-xs text-muted-foreground">none</span>
              ),
          },
          {
            key: "enabled",
            header: "State",
            render: (row) =>
              row.enabled ? (
                <StatusBadge status="active" />
              ) : (
                <StatusBadge status="disabled" />
              ),
          },
          {
            key: "actions",
            header: "",
            className: "w-44 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!row.enabled}
                  onClick={() => setDisableTarget(row)}
                >
                  Disable
                </Button>
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No storage backends configured."
        skeletonRows={5}
      />

      {editing ? (
        <BackendEditorDialog
          backend={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            toast.success(message)
            setReloadTick((tick) => tick + 1)
          }}
        />
      ) : null}

      <AlertDialog
        open={disableTarget !== null}
        onOpenChange={(open) => !open && setDisableTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable "{disableTarget?.code}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Uploads that depend on this category (e.g. ticket attachments, invoice PDFs)
              will fail while it is disabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = disableTarget
                setDisableTarget(null)
                if (!target) return
                apiDelete(`/admin/storage-backends/${target.code}`)
                  .then(() => {
                    toast.success(`Backend ${target.code} disabled`)
                    setReloadTick((tick) => tick + 1)
                  })
                  .catch((cause) =>
                    toast.error(
                      cause instanceof ApiError ? cause.message : "Failed to disable",
                    ),
                  )
              }}
            >
              Disable backend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface BackendEditorDialogProps {
  backend: StorageBackendRow
  onClose: () => void
  onSaved: (message: string) => void
}

function BackendEditorDialog({ backend, onClose, onSaved }: BackendEditorDialogProps) {
  const [name, setName] = useState(backend.name)
  const [driver, setDriver] = useState(backend.driver || "s3")
  const [endpoint, setEndpoint] = useState(backend.endpoint ?? "")
  const [region, setRegion] = useState(backend.region ?? "")
  const [bucket, setBucket] = useState(backend.bucket_name)
  const [accessKey, setAccessKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [enabled, setEnabled] = useState(backend.enabled)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const submit = async () => {
    if (bucket.trim() === "") {
      setValidationError("Bucket name is required.")
      return
    }
    if ((accessKey === "") !== (secretKey === "")) {
      setValidationError("Access key and secret key must be provided together.")
      return
    }
    setSaving(true)
    try {
      await apiPut(`/admin/storage-backends/${backend.code}`, {
        name: name.trim(),
        driver,
        endpoint: endpoint.trim(),
        region: region.trim(),
        bucket_name: bucket.trim(),
        access_key: accessKey === "" ? undefined : accessKey,
        secret_key: secretKey === "" ? undefined : secretKey,
        enabled,
      })
      onSaved(`Backend ${backend.code} updated`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save backend")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit backend <span className="font-mono">{backend.code}</span>
          </DialogTitle>
          <DialogDescription>
            Credentials are encrypted at rest and never returned — leave both key fields
            blank to keep the stored pair.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="backend-name">Name</Label>
            <Input id="backend-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backend-driver">Driver</Label>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger id="backend-driver">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRIVERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backend-endpoint">Endpoint</Label>
            <Input
              id="backend-endpoint"
              value={endpoint}
              placeholder="https://s3… (blank = AWS)"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backend-region">Region</Label>
            <Input
              id="backend-region"
              value={region}
              placeholder="ap-southeast-1"
              onChange={(event) => setRegion(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="backend-bucket">Bucket name</Label>
            <Input
              id="backend-bucket"
              value={bucket}
              onChange={(event) => setBucket(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backend-access-key">Access key</Label>
            <Input
              id="backend-access-key"
              type="password"
              autoComplete="new-password"
              value={accessKey}
              placeholder={backend.has_credentials ? "keep current" : "required"}
              onChange={(event) => setAccessKey(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backend-secret-key">Secret key</Label>
            <Input
              id="backend-secret-key"
              type="password"
              autoComplete="new-password"
              value={secretKey}
              placeholder={backend.has_credentials ? "keep current" : "required"}
              onChange={(event) => setSecretKey(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
            Enabled
          </label>
          {validationError ? (
            <p className="text-sm text-destructive sm:col-span-2">{validationError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save backend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
