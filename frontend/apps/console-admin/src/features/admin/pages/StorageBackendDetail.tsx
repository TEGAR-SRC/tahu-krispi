// Storage backend detail — per-code S3/R2/MinIO bucket config plus live
// object inventory polled every 5s. GET /admin/storage-backends/:code and
// GET /admin/storage-backends/:code/buckets via useInfraGet (infra-readable).
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPut, ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "./shared"
import { ConfirmDialog } from "./providers/shared"
import { formatBytes, useInfraGet } from "./providers/infra"

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

interface BackendDetailRes {
  backend: StorageBackendRow
  created_at: string
  updated_at: string
}

interface BucketObjectRow {
  id: string
  object_key: string
  purpose: string
  mime_type: string
  size_bytes: number
  created_at: string
}

const DRIVERS = ["s3", "r2", "minio"]

export default function StorageBackendDetailPage() {
  const params = useParams()
  const code = params.code ?? ""

  const backendPath = code ? `/admin/storage-backends/${encodeURIComponent(code)}` : null
  const bucketsPath = code ? `/admin/storage-backends/${encodeURIComponent(code)}/buckets` : null

  const backendState = useInfraGet<BackendDetailRes>(backendPath, undefined, { intervalMs: 5000 })
  const bucketsState = useInfraGet<BucketObjectRow[]>(bucketsPath, { limit: 50 }, { intervalMs: 5000 })

  const backend = backendState.data?.backend ?? null

  const [editOpen, setEditOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!code) {
    return <EmptyState message="Backend code missing." />
  }

  const bucketRows = Array.isArray(bucketsState.data) ? bucketsState.data : []
  const bucketTotal = (bucketsState.meta?.total as number | undefined) ?? bucketRows.length

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/storage-backends">Storage backends</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{code}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {backend?.name ?? code}
            {backend ? backend.enabled ? <StatusBadge status="active" /> : <StatusBadge status="disabled" /> : null}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{code}</p>
          {backendState.data ? (
            <p className="text-xs text-muted-foreground">
              Updated {backendState.data.updated_at.slice(0, 19).replace("T", " ")} · Created {backendState.data.created_at.slice(0, 19).replace("T", " ")} · polled 5s via useInfraGet
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => backendState.reload()} disabled={backendState.loading}>
            Refresh
          </Button>
          <Button size="sm" disabled={!backend || busy} onClick={() => setEditOpen(true)}>
            Edit…
          </Button>
          <Button variant="destructive" size="sm" disabled={!backend?.enabled || busy} onClick={() => setDisableOpen(true)}>
            Disable…
          </Button>
        </div>
      </div>

      {backendState.loading && !backendState.data ? (
        <Skeleton className="h-48 w-full" />
      ) : backendState.error ? (
        <ErrorBanner error={backendState.error} />
      ) : !backend ? (
        <EmptyState message="Backend not found." description="Codes are limited to avatar, document, iso, ticket and invoice." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              <span className="font-mono">GET /admin/storage-backends/:code</span> · Object storage used for this category of uploads. Credentials are write-only and never returned. Polled every 5s.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Driver">
                <Badge variant="outline">{backend.driver}</Badge>
              </Field>
              <Field label="Bucket">
                <span className="font-mono text-xs">{backend.bucket_name}</span>
              </Field>
              <Field label="Endpoint">
                <span className="font-mono text-xs">{backend.endpoint || "AWS default"}</span>
              </Field>
              <Field label="Region">{backend.region || "—"}</Field>
              <Field label="Credentials">{backend.has_credentials ? "configured" : "not set"}</Field>
              <Field label="State">{backend.enabled ? <StatusBadge status="active" /> : <StatusBadge status="disabled" />}</Field>
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Objects</CardTitle>
              <CardDescription>
                <span className="font-mono">GET /admin/storage-backends/:code/buckets</span> · stored_objects on this backend · {bucketTotal} total · polled 5s via useInfraGet
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => bucketsState.reload()} disabled={bucketsState.loading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {bucketsState.error ? <div className="px-6 pb-4"><ErrorBanner error={bucketsState.error} /></div> : null}
          <SimpleDataTable<BucketObjectRow>
            columns={[
              { key: "object_key", header: "Object key", render: (r) => <span className="font-mono text-xs break-all">{r.object_key}</span> },
              { key: "purpose", header: "Purpose", render: (r) => r.purpose || "—" },
              { key: "mime_type", header: "MIME", className: "hidden md:table-cell", render: (r) => r.mime_type || "—" },
              { key: "size_bytes", header: "Size", render: (r) => formatBytes(r.size_bytes) },
              { key: "created_at", header: "Created", className: "hidden lg:table-cell font-mono text-xs", render: (r) => r.created_at.slice(0, 19).replace("T", " ") },
            ]}
            rows={bucketRows}
            loading={bucketsState.loading}
            error={undefined}
            getRowKey={(r) => r.id}
            emptyMessage={backend ? `No objects stored on backend ${code} yet.` : "Backend not found — cannot list objects."}
            skeletonRows={5}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Endpoints: <span className="font-mono">GET /admin/storage-backends/:code</span> · <span className="font-mono">GET /admin/storage-backends/:code/buckets</span> · requireStaff infra · 5s poll via useInfraGet · SimpleDataTable
      </p>

      {backend ? (
        <EditDialog
          open={editOpen}
          backend={backend}
          busy={busy}
          onOpenChange={setEditOpen}
          onSaved={(message) => {
            setEditOpen(false)
            toast.success(message)
            backendState.reload()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        title={`Disable "${code}"?`}
        body="Uploads that depend on this category (e.g. ticket attachments, invoice PDFs) fail while it is disabled. The DELETE endpoint only disables — it never deletes the row."
        confirmLabel="Disable backend"
        busy={busy}
        onConfirm={() => {
          setDisableOpen(false)
          void (async () => {
            setBusy(true)
            try {
              await apiDelete(`/admin/storage-backends/${encodeURIComponent(code)}`)
              toast.success(`Backend ${code} disabled`)
              backendState.reload()
            } catch (cause) {
              toast.error(cause instanceof ApiError ? cause.message : "Failed to disable")
            } finally {
              setBusy(false)
            }
          })()
        }}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children ?? "—"}</dd>
    </div>
  )
}

function EditDialog({
  open,
  backend,
  busy,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  backend: StorageBackendRow
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(backend.name)
  const [driver, setDriver] = useState(backend.driver || "s3")
  const [endpoint, setEndpoint] = useState(backend.endpoint ?? "")
  const [region, setRegion] = useState(backend.region ?? "")
  const [bucket, setBucket] = useState(backend.bucket_name)
  const [accessKey, setAccessKey] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [enabled, setEnabled] = useState(backend.enabled)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (bucket.trim() === "") {
      toast.error("Bucket name is required.")
      return
    }
    if ((accessKey === "") !== (secretKey === "")) {
      toast.error("Access key and secret key must be provided together.")
      return
    }
    setSaving(true)
    try {
      await apiPut(`/admin/storage-backends/${encodeURIComponent(backend.code)}`, {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit backend <span className="font-mono">{backend.code}</span>
          </DialogTitle>
          <DialogDescription>Credentials are encrypted at rest and never returned — leave both key fields blank to keep the stored pair.</DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sb-name">Name</Label>
            <Input id="sb-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-driver">Driver</Label>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger id="sb-driver">
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
            <Label htmlFor="sb-endpoint">Endpoint</Label>
            <Input id="sb-endpoint" value={endpoint} placeholder="https://s3… (blank = AWS)" onChange={(event) => setEndpoint(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-region">Region</Label>
            <Input id="sb-region" value={region} placeholder="ap-southeast-1" onChange={(event) => setRegion(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sb-bucket">Bucket name *</Label>
            <Input id="sb-bucket" value={bucket} onChange={(event) => setBucket(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-access-key">Access key</Label>
            <Input id="sb-access-key" type="password" autoComplete="new-password" value={accessKey} placeholder={backend.has_credentials ? "keep current" : "required"} onChange={(event) => setAccessKey(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-secret-key">Secret key</Label>
            <Input id="sb-secret-key" type="password" autoComplete="new-password" value={secretKey} placeholder={backend.has_credentials ? "keep current" : "required"} onChange={(event) => setSecretKey(event.target.value)} />
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Enabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save backend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
