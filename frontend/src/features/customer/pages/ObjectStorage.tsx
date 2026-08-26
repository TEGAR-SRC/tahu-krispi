// Object storage: S3-compatible services with a create wizard (name + region
// from the live regions payload), a master-detail service panel showing
// buckets and per-bucket access keys, and deletion guarded by typing the
// service name.
import { useCallback, useEffect, useState, Fragment, type ReactNode } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatBytes, formatDateTime, formatMoney } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface Region {
  id: string
  code: string
  name: string
  enabled: boolean
}

// List payload: capacity/used_capacity are KiB (the backend divides raw byte
// counters by 1024 before answering).
interface StorageService {
  id: string
  public_id: string
  name: string
  endpoint: string
  status: string
  capacity: number
  used_capacity: number
  created_at: string
}

// Detail payload: service.capacity / used_capacity here carry raw bytes.
interface StorageServiceDetailData {
  service: {
    id?: string
    public_id?: string
    name: string
    endpoint: string
    status: string
    capacity: number
    used_capacity: number
    currency?: string
    billing_period?: string
    external_service_id?: string
    created_at?: string
  }
  recurring_amount: number
  upload_usage: number
  download_usage: number
}

interface Bucket {
  id: string
  bucket_name: string
  versioning_enabled: boolean
  object_lock_enabled: boolean
  created_at: string
}

interface AccessKey {
  access_key: string
  secret_key?: string
}

export default function ObjectStoragePage() {
  const { orgId } = useOrg()
  const [services, setServices] = useState<StorageService[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Selected service + its detail/buckets.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StorageServiceDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [bucketsError, setBucketsError] = useState<unknown>(null)

  // Create wizard (two steps in one dialog).
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [regionChoice, setRegionChoice] = useState("auto")
  const [creating, setCreating] = useState(false)

  // New bucket dialog.
  const [bucketOpen, setBucketOpen] = useState(false)
  const [bucketName, setBucketName] = useState("")
  const [versioning, setVersioning] = useState(false)
  const [objectLock, setObjectLock] = useState(false)
  const [creatingBucket, setCreatingBucket] = useState(false)

  // Access keys panel state (per bucket).
  const [keysFor, setKeysFor] = useState<string | null>(null)
  const [keys, setKeys] = useState<AccessKey[] | null>(null)
  const [keysLoading, setKeysLoading] = useState(false)

  // Delete flow with typing-name guard.
  const [deleteTarget, setDeleteTarget] = useState<StorageServiceDetailData | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const loadServices = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<StorageService[]>("/object-storage", {
        headers: orgHeaders(orgId),
      })
      setServices(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void loadServices()
    apiGet<Region[]>("/regions")
      .then(({ data }) => setRegions((data ?? []).filter((r) => r.enabled)))
      .catch(() => {
        // The create wizard degrades to "auto region" when regions fail.
      })
  }, [loadServices])

  const loadSelected = useCallback(
    async (serviceId: string) => {
      if (!orgId) return
      setDetailLoading(true)
      setBucketsError(null)
      try {
        const [detailRes, bucketsRes] = await Promise.all([
          apiGet<StorageServiceDetailData>(`/object-storage/${serviceId}`, {
            headers: orgHeaders(orgId),
          }),
          apiGet<Bucket[]>(`/object-storage/${serviceId}/buckets`, {
            headers: orgHeaders(orgId),
          }),
        ])
        setDetail(detailRes.data)
        setBuckets(bucketsRes.data ?? [])
      } catch (cause) {
        setBucketsError(cause)
        setDetail(null)
        setBuckets([])
      } finally {
        setDetailLoading(false)
      }
    },
    [orgId],
  )

  const selectService = (id: string) => {
    setKeysFor(null)
    setKeys(null)
    setSelectedId(id)
    void loadSelected(id)
  }

  const createService = async () => {
    if (!newName.trim()) {
      toast.error("Service name is required")
      return
    }
    setCreating(true)
    try {
      const body: Record<string, string> = { name: newName.trim() }
      if (regionChoice !== "auto") body.region_id = regionChoice
      const { data } = await apiPost<StorageService>("/object-storage", body, {
        headers: orgHeaders(orgId),
      })
      toast.success(`Object storage “${data.name}” created`)
      setCreateOpen(false)
      setNewName("")
      setRegionChoice("auto")
      await loadServices()
      if (data.id) selectService(data.id)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create object storage")
    } finally {
      setCreating(false)
    }
  }

  const createBucket = async () => {
    if (!selectedId) return
    if (!bucketName.trim()) {
      toast.error("Bucket name is required")
      return
    }
    setCreatingBucket(true)
    try {
      await apiPost(
        `/object-storage/${selectedId}/buckets`,
        { bucket_name: bucketName.trim(), versioning, object_lock: objectLock },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`Bucket “${bucketName.trim()}” created`)
      setBucketOpen(false)
      setBucketName("")
      setVersioning(false)
      setObjectLock(false)
      await loadSelected(selectedId)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create bucket")
    } finally {
      setCreatingBucket(false)
    }
  }

  const toggleKeys = async (bucketName: string) => {
    if (!selectedId) return
    if (keysFor === bucketName) {
      setKeysFor(null)
      setKeys(null)
      return
    }
    setKeysFor(bucketName)
    setKeysLoading(true)
    try {
      const { data } = await apiGet<{ keys: AccessKey[] }>(
        `/object-storage/${selectedId}/buckets/${encodeURIComponent(bucketName)}/access_keys`,
        { headers: orgHeaders(orgId) },
      )
      setKeys(data.keys ?? [])
    } catch (cause) {
      setKeys(null)
      toast.error(cause instanceof ApiError ? cause.message : "Failed to load access keys")
    } finally {
      setKeysLoading(false)
    }
  }

  const deleteService = async () => {
    if (!deleteTarget || !selectedId) return
    setDeleting(true)
    try {
      await apiDelete(`/object-storage/${selectedId}`, { headers: orgHeaders(orgId) })
      toast.success(`Object storage “${deleteTarget.service.name}” deleted`)
      setDeleteTarget(null)
      setDeleteConfirmText("")
      setSelectedId(null)
      setDetail(null)
      setBuckets([])
      await loadServices()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete object storage")
    } finally {
      setDeleting(false)
    }
  }

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${what} copied to clipboard`)
    } catch {
      toast.error("Clipboard unavailable")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Object storage"
        description="S3-compatible storage services. The service is the billable unit; buckets are free."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New service
          </Button>
        }
      />

      <ErrorBanner error={error} />

      {/* Service list */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? null : services.length === 0 ? (
        <EmptyState
          message="No object storage services yet."
          description="Create one to get S3 credentials and start storing objects."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {services.map((svc) => (
            <Card
              key={svc.id}
              className={`cursor-pointer transition-colors hover:border-primary/50 ${
                selectedId === svc.id ? "border-primary" : ""
              }`}
              onClick={() => selectService(svc.id)}
            >
              <CardContent className="space-y-2 px-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{svc.name}</p>
                  <StatusBadge status={svc.status} />
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">{svc.endpoint || "—"}</p>
                <p className="text-xs text-muted-foreground">Created {formatDateTime(svc.created_at)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedId ? (
        <Card>
          <CardContent className="space-y-4 px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Service details</h2>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void loadSelected(selectedId)}>
                  <RefreshCwIcon /> Refresh
                </Button>
                {detail ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setDeleteConfirmText("")
                      setDeleteTarget(detail)
                    }}
                  >
                    <Trash2Icon /> Delete service
                  </Button>
                ) : null}
              </div>
            </div>

            {detailLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : bucketsError ? (
              <ErrorBanner error={bucketsError} />
            ) : detail ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailCell label="Endpoint" mono>
                    <span className="block max-w-56 truncate">{detail.service.endpoint || "—"}</span>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => void copy(detail.service.endpoint, "Endpoint")}
                      disabled={!detail.service.endpoint}
                    >
                      <CopyIcon className="size-3" /> Copy
                    </button>
                  </DetailCell>
                  <DetailCell label="Monthly price">
                    {formatMoney(detail.recurring_amount, detail.service.currency)}
                    <span className="ml-1 text-xs capitalize text-muted-foreground">
                      {detail.service.billing_period ?? ""}
                    </span>
                  </DetailCell>
                  <DetailCell label="Upload usage">{formatBytes(detail.upload_usage)}</DetailCell>
                  <DetailCell label="Download usage">{formatBytes(detail.download_usage)}</DetailCell>
                </div>

                {detail.service.capacity > 0 ? (
                  <div className="space-y-1">
                    <Progress value={Math.min(100, (detail.service.used_capacity / detail.service.capacity) * 100)} />
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatBytes(detail.service.used_capacity)} of {formatBytes(detail.service.capacity)} used
                    </p>
                  </div>
                ) : null}

                {/* Buckets */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Buckets</h3>
                    <Button size="sm" variant="outline" onClick={() => setBucketOpen(true)}>
                      <PlusIcon /> New bucket
                    </Button>
                  </div>

                  {buckets.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No buckets yet.
                    </p>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10" />
                            <TableHead>Bucket</TableHead>
                            <TableHead>Versioning</TableHead>
                            <TableHead>Object lock</TableHead>
                            <TableHead>Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {buckets.map((bucket) => (
                            <Fragment key={bucket.id}>
                              <TableRow>
                                <TableCell>
                                  <button
                                    type="button"
                                    onClick={() => void toggleKeys(bucket.bucket_name)}
                                    className="text-muted-foreground hover:text-foreground"
                                    title="Access keys"
                                  >
                                    {keysFor === bucket.bucket_name ? (
                                      <ChevronDownIcon className="size-4" />
                                    ) : (
                                      <ChevronRightIcon className="size-4" />
                                    )}
                                  </button>
                                </TableCell>
                                <TableCell className="font-mono text-xs break-all">
                                  {bucket.bucket_name}
                                </TableCell>
                                <TableCell>{bucket.versioning_enabled ? "On" : "Off"}</TableCell>
                                <TableCell>{bucket.object_lock_enabled ? "On" : "Off"}</TableCell>
                                <TableCell>{formatDateTime(bucket.created_at)}</TableCell>
                              </TableRow>
                              {keysFor === bucket.bucket_name ? (
                                <TableRow>
                                  <TableCell colSpan={5} className="bg-muted/40">
                                    {keysLoading ? (
                                      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                                        <Loader2Icon className="size-4 animate-spin" /> Loading access keys…
                                      </div>
                                    ) : keys && keys.length > 0 ? (
                                      <div className="space-y-2 py-2">
                                        {keys.map((key) => (
                                          <div key={key.access_key} className="flex items-center justify-between gap-3 text-sm">
                                            <div className="min-w-0">
                                              <p className="flex items-center gap-1.5 font-mono text-xs break-all">
                                                <KeyRoundIcon className="size-3 shrink-0" />
                                                {key.access_key}
                                              </p>
                                              {key.secret_key ? (
                                                <p className="font-mono text-xs break-all text-muted-foreground">
                                                  secret: {key.secret_key}
                                                </p>
                                              ) : null}
                                            </div>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              title="Copy access key"
                                              onClick={() => void copy(key.access_key, "Access key")}
                                            >
                                              <CopyIcon />
                                            </Button>
                                          </div>
                                        ))}
                                        {!keys.some((k) => k.secret_key) ? (
                                          <p className="text-xs text-muted-foreground">
                                            Secrets are not exposed by the API — store them where they were first shown.
                                          </p>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <p className="py-2 text-sm text-muted-foreground">No access keys for this bucket.</p>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Create wizard */}
      <Dialog open={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New object storage service</DialogTitle>
            <DialogDescription>
              A monthly-billed S3-compatible service is provisioned; buckets are free within it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="oss-name">Name *</Label>
              <Input
                id="oss-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. backups-eu"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Select value={regionChoice} onValueChange={setRegionChoice}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic</SelectItem>
                  {regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {regions.length > 0
                  ? "Regions come straight from the platform catalog."
                  : "Region list is unavailable — the service will be placed automatically."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void createService()} disabled={creating}>
              {creating ? <Loader2Icon className="animate-spin" /> : null} Create service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New bucket */}
      <Dialog open={bucketOpen} onOpenChange={(open) => !creatingBucket && setBucketOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New bucket</DialogTitle>
            <DialogDescription>Names are global per endpoint and lowercase.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bucket-name">Bucket name *</Label>
              <Input
                id="bucket-name"
                value={bucketName}
                onChange={(event) => setBucketName(event.target.value)}
                placeholder="my-app-assets"
              />
            </div>
            <label className="flex items-center justify-between rounded-md border p-3">
              <span>
                <span className="text-sm font-medium">Versioning</span>
                <span className="block text-xs text-muted-foreground">Keep every object version.</span>
              </span>
              <Switch checked={versioning} onCheckedChange={setVersioning} />
            </label>
            <label className="flex items-center justify-between rounded-md border p-3">
              <span>
                <span className="text-sm font-medium">Object lock</span>
                <span className="block text-xs text-muted-foreground">Write-once, retention protected.</span>
              </span>
              <Switch checked={objectLock} onCheckedChange={setObjectLock} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBucketOpen(false)} disabled={creatingBucket}>
              Cancel
            </Button>
            <Button onClick={() => void createBucket()} disabled={creatingBucket}>
              {creatingBucket ? <Loader2Icon className="animate-spin" /> : null} Create bucket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm — typing the exact service name */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.service.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              All buckets and their objects become inaccessible and the billing subscription is
              cancelled. This cannot be undone. Type the service name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(event) => setDeleteConfirmText(event.target.value)}
            placeholder={deleteTarget?.service.name}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={
                deleting ||
                deleteConfirmText.trim() !== (deleteTarget?.service.name ?? "")
              }
              onClick={(event) => {
                event.preventDefault()
                void deleteService()
              }}
            >
              {deleting ? <Loader2Icon className="animate-spin" /> : null} Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DetailCell({
  label,
  children,
  mono = false,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={`mt-1 text-sm font-medium ${mono ? "font-mono" : "tabular-nums"}`}>{children}</div>
    </div>
  )
}
