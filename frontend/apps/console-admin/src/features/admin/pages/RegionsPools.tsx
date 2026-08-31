// Platform-admin regions and PVE resource pools.
// - Regions: POST /admin/regions upserts by (provider, code); the API exposes
//   no delete endpoint, so disabling a region is done via the Enabled toggle.
// - Pools: PVE resource pools under /admin/providers/:id/pools with full CRUD
//   (create / comment update / delete).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "./shared"

interface RegionRow {
  id: string
  provider_id: string
  external_id: string
  code: string
  name: string
  country_code: string
  city: string
  enabled: boolean
}

interface ProviderLite {
  id: string
  code: string
  kind: string
}

interface PoolRow {
  poolid: string
  comment?: string
  members?: unknown
  [key: string]: unknown
}

const PER_PAGE = 20

export default function AdminRegionsPoolsPage() {
  const [providers, setProviders] = useState<ProviderLite[]>([])

  const [rows, setRows] = useState<RegionRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<RegionRow | null>(null)

  const regionBulk = useBulkSelection<RegionRow>((row) => row.id)

  useEffect(() => {
    let cancelled = false
    apiGet<RegionRow[]>("/admin/regions", { query: { page, per_page: PER_PAGE } })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
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
  }, [page])

  useEffect(() => {
    apiGet<ProviderLite[]>("/admin/providers", { query: { per_page: 100 } })
      .then(({ data }) => setProviders(data))
      .catch(() => setProviders([]))
  }, [])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Regions & Pools"
        description="Region catalog and hypervisor resource pools."
      />

      <Tabs defaultValue="regions">
        <TabsList>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="pools">Provider pools</TabsTrigger>
        </TabsList>

        <TabsContent value="regions" className="flex w-full max-w-full min-w-0 flex-col gap-4 pt-2">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
              Add region
            </Button>
          </div>

          <BulkActionBar selectedCount={regionBulk.selectedKeys.size} actions={[]} />

          <SimpleDataTable<RegionRow>
            columns={[
              {
                key: "code",
                header: "Code",
                render: (row) => <span className="font-mono text-sm">{row.code}</span>,
              },
              { key: "name", header: "Name" },
              {
                key: "country_code",
                header: "Country",
                className: "hidden md:table-cell",
                render: (row) => row.country_code || "—",
              },
              {
                key: "city",
                header: "City",
                className: "hidden md:table-cell",
                render: (row) => row.city || "—",
              },
              {
                key: "external_id",
                header: "External ID",
                className:
                  "hidden lg:table-cell max-w-40 truncate font-mono text-xs text-muted-foreground",
                render: (row) => row.external_id || "—",
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
                className: "w-20 text-right",
                render: (row) => (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(row)
                      setEditorOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                ),
              },
            ]}
            rows={rows}
            loading={loading}
            error={error}
            getRowKey={regionBulk.getRowKey}
            selectable
            selectedKeys={regionBulk.selectedKeys}
            onSelectionChange={regionBulk.onSelectionChange}
            emptyMessage="No regions configured yet."
            skeletonRows={6}
          />

          <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
        </TabsContent>

        <TabsContent value="pools" className="pt-2">
          <PoolsPanel providers={providers} />
        </TabsContent>
      </Tabs>

      <RegionEditorDialog
        open={editorOpen}
        editing={editing}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
        onSaved={(message) => {
          setEditorOpen(false)
          setEditing(null)
          toast.success(message)
          setPage(1)
        }}
      />
    </div>
  )
}

interface RegionEditorDialogProps {
  open: boolean
  editing: RegionRow | null
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}

function RegionEditorDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: RegionEditorDialogProps) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [city, setCity] = useState("")
  const [externalId, setExternalId] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setCode(editing?.code ?? "")
      setName(editing?.name ?? "")
      setCountryCode(editing?.country_code ?? "")
      setCity(editing?.city ?? "")
      setExternalId(editing?.external_id ?? "")
      setEnabled(editing?.enabled ?? true)
      setValidationError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, editing])

  const submit = async () => {
    if (code.trim() === "" || name.trim() === "") {
      setValidationError("Code and name are required.")
      return
    }
    setSaving(true)
    try {
      await apiPost("/admin/regions", {
        code: code.trim(),
        name: name.trim(),
        country_code: countryCode.trim(),
        city: city.trim(),
        external_id: externalId.trim(),
        enabled,
      })
      onSaved(editing ? `Region ${code.trim()} updated` : `Region ${code.trim()} created`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save region")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.code}` : "Add region"}</DialogTitle>
          <DialogDescription>
            Regions upsert by code against the default provider (onidel preferred, else
            the first configured). The API has no region delete — disable instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="region-code">Code</Label>
            <Input
              id="region-code"
              value={code}
              placeholder="e.g. jakarta"
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region-name">Name</Label>
            <Input
              id="region-name"
              value={name}
              placeholder="e.g. Jakarta"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region-country">Country code</Label>
            <Input
              id="region-country"
              value={countryCode}
              placeholder="ID"
              maxLength={2}
              onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region-city">City</Label>
            <Input
              id="region-city"
              value={city}
              placeholder="Jakarta"
              onChange={(event) => setCity(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="region-external">External ID</Label>
            <Input
              id="region-external"
              value={externalId}
              placeholder="upstream location id (optional)"
              onChange={(event) => setExternalId(event.target.value)}
            />
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
            Enabled
          </label>
          {validationError ? (
            <p className="text-sm text-destructive sm:col-span-2">{validationError}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save region"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PoolsPanel({ providers }: { providers: ProviderLite[] }) {
  // PVE resource pools exist only on proxmox providers (onidel answers 501).
  const pveProviders = providers.filter((provider) => provider.kind === "proxmox")
  const [providerId, setProviderId] = useState<string>("")
  const activeProvider = providerId || pveProviders[0]?.id || ""

  const [pools, setPools] = useState<PoolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PoolRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PoolRow | null>(null)

  const poolBulk = useBulkSelection<PoolRow>((pool) => pool.poolid)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false)

  const runBulkDelete = async () => {
    const targets = poolBulk.resolve(pools)
    if (targets.length === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(
        targets.map((pool) => apiDelete(`/admin/providers/${activeProvider}/pools/${pool.poolid}`)),
      )
      toast.success(`Deleted ${targets.length} pool${targets.length === 1 ? "" : "s"}`)
      setReloadTick((tick) => tick + 1)
      poolBulk.clear()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete failed")
    } finally {
      setBulkBusy(false)
    }
  }

  useEffect(() => {
    if (!activeProvider) return
    let cancelled = false
    apiGet<PoolRow[]>(`/admin/providers/${activeProvider}/pools`)
      .then((envelope) => {
        if (!cancelled) {
          setPools(envelope.data)
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
  }, [activeProvider, reloadTick])

  if (pveProviders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a proxmox provider first — resource pools are a Proxmox VE concept exposed
        through its admin API.
      </p>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeProvider} onValueChange={setProviderId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {pveProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.code} ({provider.kind})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          New pool
        </Button>
      </div>

      <BulkActionBar
        selectedCount={poolBulk.selectedKeys.size}
        busy={bulkBusy}
        actions={[
          {
            key: "delete",
            label: "Delete selected",
            destructive: true,
            onClick: () => setBulkConfirmDelete(true),
          },
        ]}
      />

      <SimpleDataTable<PoolRow>
        columns={[
          {
            key: "poolid",
            header: "Pool ID",
            render: (pool) => <span className="font-mono text-sm">{pool.poolid}</span>,
          },
          {
            key: "comment",
            header: "Comment",
            render: (pool) => pool.comment || "—",
          },
          {
            key: "members",
            header: "Members",
            render: (pool) =>
              Array.isArray(pool.members) ? `${pool.members.length} member(s)` : "—",
          },
          {
            key: "actions",
            header: "",
            className: "w-36 text-right",
            render: (pool) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(pool)
                    setEditorOpen(true)
                  }}
                >
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(pool)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={pools}
        loading={loading}
        error={error}
        getRowKey={poolBulk.getRowKey}
        selectable
        selectedKeys={poolBulk.selectedKeys}
        onSelectionChange={poolBulk.onSelectionChange}
        emptyMessage="No resource pools on this cluster yet."
        skeletonRows={4}
      />

      <PoolEditorDialog
        open={editorOpen}
        editing={editing}
        providerId={activeProvider}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
        onSaved={(message) => {
          setEditorOpen(false)
          setEditing(null)
          toast.success(message)
          setReloadTick((tick) => tick + 1)
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pool "{deleteTarget?.poolid}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The pool is removed from the cluster. Members keep their VMs and storages;
              only the grouping disappears.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (!target) return
                apiDelete(`/admin/providers/${activeProvider}/pools/${target.poolid}`)
                  .then(() => {
                    toast.success(`Pool ${target.poolid} deleted`)
                    setReloadTick((tick) => tick + 1)
                  })
                  .catch((cause) =>
                    toast.error(
                      cause instanceof ApiError ? cause.message : "Delete failed",
                    ),
                  )
              }}
            >
              Delete pool
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkConfirmDelete} onOpenChange={setBulkConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {poolBulk.selectedKeys.size} selected pool{poolBulk.selectedKeys.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be removed from the cluster. Members keep their VMs and storages;
              only the grouping disappears.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={bulkBusy}
              onClick={(event) => {
                event.preventDefault()
                setBulkConfirmDelete(false)
                void runBulkDelete()
              }}
            >
              {bulkBusy ? "Deleting…" : "Delete selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface PoolEditorDialogProps {
  open: boolean
  editing: PoolRow | null
  providerId: string
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}

function PoolEditorDialog({
  open,
  editing,
  providerId,
  onOpenChange,
  onSaved,
}: PoolEditorDialogProps) {
  const [poolId, setPoolId] = useState("")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setPoolId(editing?.poolid ?? "")
      setComment(editing?.comment ?? "")
      setValidationError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, editing])

  const submit = async () => {
    if (editing === null && poolId.trim() === "") {
      setValidationError("Pool ID is required.")
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await apiPut(`/admin/providers/${providerId}/pools/${editing.poolid}`, {
          comment,
        })
        onSaved(`Pool ${editing.poolid} updated`)
      } else {
        await apiPost(`/admin/providers/${providerId}/pools`, {
          poolid: poolId.trim(),
          comment,
        })
        onSaved(`Pool ${poolId.trim()} created`)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save pool")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.poolid}` : "New resource pool"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Only the comment can be changed after creation."
              : "Group VMs and storages at the hypervisor level."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pool-id">Pool ID</Label>
            <Input
              id="pool-id"
              value={poolId}
              disabled={editing !== null}
              placeholder="e.g. kilat-jkt-cust01"
              onChange={(event) => setPoolId(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pool-comment">Comment</Label>
            <Input
              id="pool-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
