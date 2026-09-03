// Platform-admin provider management: provider CRUD via the upsert endpoint,
// catalog sync trigger, and navigation into the per-provider infrastructure
// console (cluster/node resources, vCenter inventory, Dokploy mirror live on
// the dedicated provider detail pages under /admin/providers/:id/...).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import type { PagedMeta } from "@/lib/types"
import { PaginationBar, StatusBadge } from "./shared"

interface ProviderRow {
  id: string
  code: string
  name: string
  kind: string
  api_base_url: string
  enabled: boolean
  health_status: string
  has_credentials: boolean
  created_at: string
}

const PROVIDER_KINDS = ["onidel", "proxmox", "vmware", "dokploy"]
const PER_PAGE = 20

export default function AdminProvidersPage() {
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderRow | null>(null)

  const bulk = useBulkSelection<ProviderRow>((row) => row.id)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false)

  const runBulk = useCallback(
    async (action: (row: ProviderRow) => Promise<unknown>, successLabel: string) => {
      const targets = bulk.resolve(rows)
      if (targets.length === 0) return
      setBulkBusy(true)
      try {
        await Promise.all(targets.map(action))
        toast.success(`${successLabel} ${targets.length} provider${targets.length === 1 ? "" : "s"}`)
        setReloadTick((tick) => tick + 1)
        bulk.clear()
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      } finally {
        setBulkBusy(false)
      }
    },
    [bulk, rows],
  )

  const load = useCallback(() => {
    setLoading(true)
    apiGet<ProviderRow[]>("/admin/providers", { query: { page, per_page: PER_PAGE } })
      .then((envelope) => {
        setRows(Array.isArray(envelope.data) ? envelope.data : [])
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    const t = setTimeout(() => load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  const runProviderAction = async (
    provider: ProviderRow,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setBusyId(provider.id)
    try {
      await action()
      toast.success(successMessage)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusyId(null)
    }
  }

  const visibleRows = kindFilter === "all" ? rows : rows.filter((row) => row.kind === kindFilter)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Upstream compute providers and their infrastructure."
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            Add provider
          </Button>
        }
      />

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkBusy}
        actions={[
          {
            key: "sync",
            label: "Sync selected",
            onClick: () =>
              void runBulk((row) => apiPost(`/admin/providers/${row.id}/sync`), "Sync queued for"),
          },
          {
            key: "delete",
            label: "Delete selected",
            destructive: true,
            onClick: () => setBulkConfirmDelete(true),
          },
        ]}
      />

      <Tabs value={kindFilter} onValueChange={setKindFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {PROVIDER_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind} className="capitalize">
              {kind}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <SimpleDataTable<ProviderRow>
        columns={[
          {
            key: "code",
            header: "Provider",
            render: (row) => (
              <div className="min-w-0">
                <p className="min-w-0 truncate font-medium">{row.name}</p>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.code}</p>
              </div>
            ),
          },
          {
            key: "kind",
            header: "Kind",
            render: (row) => <Badge variant="outline">{row.kind}</Badge>,
          },
          {
            key: "api_base_url",
            header: "API URL",
            className: "hidden md:table-cell max-w-56 truncate",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {row.api_base_url || "—"}
              </span>
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
            key: "health_status",
            header: "Health",
            render: (row) => <StatusBadge status={row.health_status} />,
          },
          {
            key: "has_credentials",
            header: "Credentials",
            className: "hidden lg:table-cell",
            render: (row) =>
              row.has_credentials ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">configured</span>
              ) : (
                <span className="text-xs text-muted-foreground">none</span>
              ),
          },
          {
            key: "actions",
            header: "",
            className: "w-full sm:w-[330px] text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() =>
                    void runProviderAction(
                      row,
                      () => apiPost(`/admin/providers/${row.id}/test`),
                      `Test ok for ${row.code}`,
                    )
                  }
                >
                  Test
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() =>
                    void runProviderAction(
                      row,
                      () => apiPost(`/admin/providers/${row.id}/sync`),
                      `Sync queued for ${row.code}`,
                    )
                  }
                >
                  Sync
                </Button>
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
                <Button asChild variant="outline" size="sm">
                  <Link to={`/admin/providers/${row.id}`}>Resources</Link>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => setDeleteTarget(row)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={visibleRows}
        loading={loading}
        error={error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No providers configured yet."
        skeletonRows={4}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      {/* Create / edit — the API has a single POST upsert keyed by code. */}
      <ProviderEditorDialog
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
          setReloadTick((tick) => tick + 1)
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete provider "{deleteTarget?.code}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the provider. It fails with 409 while instances,
              regions or provider accounts still reference it — disable it instead by
              saving with Enabled off in that case.
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
                void runProviderAction(
                  target,
                  () => apiDelete(`/admin/providers/${target.id}`),
                  `Provider ${target.code} deleted`,
                )
              }}
            >
              Delete provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkConfirmDelete}
        onOpenChange={setBulkConfirmDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulk.selectedKeys.size} selected providers?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes them. Deletion fails with 409 while instances,
              regions or provider accounts still reference a provider — disable it instead
              by saving with Enabled off in that case.
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
                void runBulk((row) => apiDelete(`/admin/providers/${row.id}`), "Provider(s) deleted")
              }}
            >
              Delete selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ProviderEditorDialogProps {
  open: boolean
  editing: ProviderRow | null
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}

function ProviderEditorDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: ProviderEditorDialogProps) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [kind, setKind] = useState("onidel")
  const [apiBaseUrl, setApiBaseUrl] = useState("")
  const [tokenUser, setTokenUser] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reset the form whenever the dialog opens for a different provider.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setCode(editing?.code ?? "")
      setName(editing?.name ?? "")
      setKind(editing?.kind ?? "onidel")
      setApiBaseUrl(editing?.api_base_url ?? "")
      setTokenUser("")
      setApiKey("")
      setEnabled(editing ? editing.enabled : true)
      setValidationError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, editing])

  const needsTokenUser = kind === "proxmox" || kind === "vmware"

  const submit = async () => {
    if (code.trim() === "" || name.trim() === "") {
      setValidationError("Code and name are required.")
      return
    }
    if (needsTokenUser && !editing && apiKey !== "" && tokenUser.trim() === "") {
      setValidationError(`${kind} requires a token user together with an API key.`)
      return
    }
    if (!editing && kind === "dokploy" && apiKey === "") {
      setValidationError("New dokploy providers require an API key.")
      return
    }
    setSaving(true)
    try {
      await apiPost("/admin/providers", {
        code: code.trim(),
        name: name.trim(),
        kind,
        api_base_url: apiBaseUrl.trim(),
        token_user: tokenUser.trim(),
        api_key: apiKey,
        enabled,
      })
      onSaved(editing ? `Provider ${code.trim()} updated` : `Provider ${code.trim()} created`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save provider")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.code}` : "Add provider"}</DialogTitle>
          <DialogDescription>
            Providers are upserted by code — creating one with an existing code updates
            it. Credentials are stored encrypted and never returned; leave the API key
            blank to keep the current ones.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="provider-code">Code</Label>
            <Input
              id="provider-code"
              value={code}
              disabled={editing !== null}
              placeholder="e.g. proxmox-jkt"
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              placeholder="e.g. Kilat Proxmox Jakarta"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-kind">Kind</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="provider-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-url">API base URL</Label>
            <Input
              id="provider-url"
              value={apiBaseUrl}
              placeholder="https://… (dokploy: no /api suffix)"
              onChange={(event) => setApiBaseUrl(event.target.value)}
            />
          </div>
          {needsTokenUser ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="provider-token-user">Token user</Label>
              <Input
                id="provider-token-user"
                value={tokenUser}
                placeholder={kind === "vmware" ? "administrator@vsphere.local" : "root@pam"}
                onChange={(event) => setTokenUser(event.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="provider-api-key">API key / secret</Label>
            <Input
              id="provider-api-key"
              type="password"
              value={apiKey}
              autoComplete="new-password"
              placeholder={editing ? "leave blank to keep existing" : "secret"}
              onChange={(event) => setApiKey(event.target.value)}
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
            {saving ? "Saving…" : "Save provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
