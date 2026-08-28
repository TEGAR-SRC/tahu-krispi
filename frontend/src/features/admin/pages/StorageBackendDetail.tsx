// Storage backend detail. The API has no GET-by-code route, so the row is
// resolved from the list endpoint; editing rides PUT :code (upsert) and
// "disable" rides DELETE :code which only flips enabled=false.
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPut, ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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

export default function StorageBackendDetailPage() {
  const params = useParams()
  const code = params.code ?? ""

  const [rows, setRows] = useState<StorageBackendRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editOpen, setEditOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return
    let cancelled = false
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
  }, [code, reloadTick])

  if (!code) {
    return <EmptyState message="Backend code missing." />
  }

  const backend = rows?.find((row) => row.code === code) ?? null

  return (
    <div className="flex flex-col gap-6">
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
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {backend?.name ?? code}
            {backend ? (
              backend.enabled ? (
                <StatusBadge status="active" />
              ) : (
                <StatusBadge status="disabled" />
              )
            ) : null}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{code}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!backend || busy} onClick={() => setEditOpen(true)}>
            Edit…
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!backend?.enabled || busy}
            onClick={() => setDisableOpen(true)}
          >
            Disable…
          </Button>
        </div>
      </div>

      {loading && !rows ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <ErrorBanner error={error} />
      ) : !backend ? (
        <EmptyState
          message="Backend not found."
          description="Codes are limited to avatar, document, iso, ticket and invoice."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              Object storage used for this category of uploads. Credentials are write-only and
              never returned.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
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
              <Field label="Credentials">
                {backend.has_credentials ? "configured" : "not set"}
              </Field>
              <Field label="State">
                {backend.enabled ? (
                  <StatusBadge status="active" />
                ) : (
                  <StatusBadge status="disabled" />
                )}
              </Field>
            </dl>
          </CardContent>
        </Card>
      )}

      {backend ? (
        <EditDialog
          open={editOpen}
          backend={backend}
          busy={busy}
          onOpenChange={setEditOpen}
          onSaved={(message) => {
            setEditOpen(false)
            toast.success(message)
            setReloadTick((tick) => tick + 1)
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
              setReloadTick((tick) => tick + 1)
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
      <dd className="truncate text-sm">{children ?? "—"}</dd>
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
          <DialogDescription>
            Credentials are encrypted at rest and never returned — leave both key fields blank to
            keep the stored pair.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
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
            <Input
              id="sb-endpoint"
              value={endpoint}
              placeholder="https://s3… (blank = AWS)"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-region">Region</Label>
            <Input
              id="sb-region"
              value={region}
              placeholder="ap-southeast-1"
              onChange={(event) => setRegion(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sb-bucket">Bucket name *</Label>
            <Input id="sb-bucket" value={bucket} onChange={(event) => setBucket(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-access-key">Access key</Label>
            <Input
              id="sb-access-key"
              type="password"
              autoComplete="new-password"
              value={accessKey}
              placeholder={backend.has_credentials ? "keep current" : "required"}
              onChange={(event) => setAccessKey(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sb-secret-key">Secret key</Label>
            <Input
              id="sb-secret-key"
              type="password"
              autoComplete="new-password"
              value={secretKey}
              placeholder={backend.has_credentials ? "keep current" : "required"}
              onChange={(event) => setSecretKey(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || saving}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Save backend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
