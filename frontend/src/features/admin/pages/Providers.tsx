// Platform-admin provider management: provider CRUD via the upsert endpoint,
// catalog sync trigger, and per-provider drill-down into PVE cluster/node
// resources (proxmox), vCenter inventory (vmware) or the Dokploy mirror DB.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
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
import { Badge } from "@/components/ui/badge"
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
import {
  JsonBlock,
  PaginationBar,
  StatusBadge,
  formatDateTime,
} from "./shared"

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

interface PveNode {
  node?: string
  name?: string
  status?: string
  [key: string]: unknown
}

const PROVIDER_KINDS = ["onidel", "proxmox", "vmware", "dokploy"]
const PER_PAGE = 20

export default function AdminProvidersPage() {
  const { role } = useAuth()
  // Node commands (reboot/shutdown/wakeonlan) are platform-admin-only server
  // side; this console only mounts under /admin so gate on the resolved role.
  const isPlatformAdmin = role === "admin"

  const [rows, setRows] = useState<ProviderRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProviderRow | null>(null)
  const [drillDown, setDrillDown] = useState<ProviderRow | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiGet<ProviderRow[]>("/admin/providers", { query: { page, per_page: PER_PAGE } })
      .then((envelope) => {
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    load()
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

  return (
    <div className="flex flex-col gap-6">
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

      <SimpleDataTable<ProviderRow>
        columns={[
          {
            key: "code",
            header: "Provider",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{row.code}</p>
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
            className: "w-[330px] text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
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
                <Button variant="outline" size="sm" onClick={() => setDrillDown(row)}>
                  Resources
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
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
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
              className="bg-destructive text-white hover:bg-destructive/90"
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

      {drillDown ? (
        <ProviderResourcesDialog
          provider={drillDown}
          showNodeCommands={isPlatformAdmin}
          onClose={() => setDrillDown(null)}
        />
      ) : null}
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
    setCode(editing?.code ?? "")
    setName(editing?.name ?? "")
    setKind(editing?.kind ?? "onidel")
    setApiBaseUrl(editing?.api_base_url ?? "")
    setTokenUser("")
    setApiKey("")
    setEnabled(editing ? editing.enabled : true)
    setValidationError(null)
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

        <div className="grid gap-4 sm:grid-cols-2">
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
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
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

interface ProviderResourcesDialogProps {
  provider: ProviderRow
  showNodeCommands: boolean
  onClose: () => void
}

/** Drill-down dialog whose tabs adapt to the provider kind. */
function ProviderResourcesDialog({
  provider,
  showNodeCommands,
  onClose,
}: ProviderResourcesDialogProps) {
  // Cluster observability answers 501 for kind=onidel — proxmox only.
  const supportsPve = provider.kind === "proxmox"
  const supportsVmware = provider.kind === "vmware"

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {provider.name} <Badge variant="outline">{provider.kind}</Badge>
          </DialogTitle>
          <DialogDescription>Infrastructure drill-down</DialogDescription>
        </DialogHeader>

        {supportsPve ? (
          <PveResourceTabs providerId={provider.id} showNodeCommands={showNodeCommands} />
        ) : supportsVmware ? (
          <VmwareInventoryTabs providerId={provider.id} />
        ) : provider.kind === "dokploy" ? (
          <DokployMirrorTabs />
        ) : (
          <p className="text-sm text-muted-foreground">
            No infrastructure drill-down is available for this provider kind through the
            admin API.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

type FetchState<T> = {
  data: T | null
  loading: boolean
  error: unknown
}

/** Generic GET loader used by every drill-down tab. */
function useAdminFetch<T>(
  path: string | null,
  query?: Record<string, string | number | null>,
): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((previous) => ({ ...previous, loading: true }))
    apiGet<T>(path, { query })
      .then((envelope) => {
        if (!cancelled) setState({ data: envelope.data, loading: false, error: null })
      })
      .catch((cause) => {
        if (!cancelled) setState({ data: null, loading: false, error: cause })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query objects are stable literals at call sites
  }, [path, tick, JSON.stringify(query)])
  return { ...state, reload: () => setTick((value) => value + 1) }
}

function ResourceError({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? `${error.message} (${error.status})` : String(error)
  return <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{message}</p>
}

// ---- Proxmox / onidel drill-down -------------------------------------------

function PveResourceTabs({
  providerId,
  showNodeCommands,
}: {
  providerId: string
  showNodeCommands: boolean
}) {
  const cluster = useAdminFetch<{ nodes?: PveNode[] } | PveNode[]>(
    `/admin/providers/${providerId}/cluster`,
  )

  const nodes: PveNode[] = Array.isArray(cluster.data)
    ? cluster.data
    : (cluster.data?.nodes ?? [])

  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  return (
    <Tabs defaultValue="cluster">
      <TabsList>
        <TabsTrigger value="cluster">Cluster</TabsTrigger>
        <TabsTrigger value="node">Node</TabsTrigger>
      </TabsList>

      <TabsContent value="cluster" className="space-y-4 pt-2">
        {cluster.error ? <ResourceError error={cluster.error} /> : null}
        {cluster.loading ? <p className="text-sm text-muted-foreground">Loading cluster…</p> : null}
        {!cluster.loading && nodes.length === 0 && !cluster.error ? (
          <p className="text-sm text-muted-foreground">No cluster nodes reported.</p>
        ) : null}
        {nodes.length > 0 ? (
          <SimpleDataTable<PveNode>
            columns={[
              {
                key: "node",
                header: "Node",
                render: (node) => String(node.node ?? node.name ?? "—"),
              },
              {
                key: "status",
                header: "Status",
                render: (node) => <StatusBadge status={node.status ?? null} />,
              },
              {
                key: "open",
                header: "",
                className: "w-24 text-right",
                render: (node) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedNode(String(node.node ?? node.name))}
                  >
                    Inspect
                  </Button>
                ),
              },
            ]}
            rows={nodes}
            getRowKey={(node) => String(node.node ?? node.name)}
            skeletonRows={3}
          />
        ) : null}
      </TabsContent>

      <TabsContent value="node" className="pt-2">
        {selectedNode ? (
          <NodeInspector
            providerId={providerId}
            node={selectedNode}
            showCommands={showNodeCommands}
            onBack={() => setSelectedNode(null)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a node on the Cluster tab to inspect storages, tasks, disks and
            certificates.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

function NodeInspector({
  providerId,
  node,
  showCommands,
  onBack,
}: {
  providerId: string
  node: string
  showCommands: boolean
  onBack: () => void
}) {
  const basePath = `/admin/providers/${providerId}/nodes/${encodeURIComponent(node)}`
  const detail = useAdminFetch<Record<string, unknown>>(`${basePath}/detail`)
  const storages = useAdminFetch<Array<Record<string, unknown>>>(`${basePath}/storages`)
  const tasks = useAdminFetch<Array<Record<string, unknown>>>(`${basePath}/tasks`)
  const disks = useAdminFetch<Array<Record<string, unknown>>>(`${basePath}/disks`)
  const certs = useAdminFetch<unknown>(`${basePath}/certs`)

  const [commandTarget, setCommandTarget] = useState<"reboot" | "shutdown" | "wakeonlan" | null>(null)
  const [busy, setBusy] = useState(false)

  const runCommand = async () => {
    const command = commandTarget
    setCommandTarget(null)
    if (!command) return
    setBusy(true)
    try {
      await apiPost(`${basePath}/command`, { command })
      toast.success(`Node ${command} queued`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Node <span className="font-mono">{node}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← All nodes
        </Button>
      </div>

      <Tabs defaultValue="detail">
        <TabsList>
          <TabsTrigger value="detail">Detail</TabsTrigger>
          <TabsTrigger value="storages">Storages</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="disks">Disks</TabsTrigger>
          <TabsTrigger value="certs">Certs</TabsTrigger>
        </TabsList>
        <TabsContent value="detail" className="pt-2">
          {detail.error ? (
            <ResourceError error={detail.error} />
          ) : detail.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : detail.data ? (
            <JsonBlock value={detail.data} />
          ) : null}
        </TabsContent>
        <TabsContent value="storages" className="pt-2">
          <RawListTable state={storages} />
        </TabsContent>
        <TabsContent value="tasks" className="pt-2">
          <RawListTable state={tasks} />
        </TabsContent>
        <TabsContent value="disks" className="pt-2">
          <RawListTable state={disks} />
        </TabsContent>
        <TabsContent value="certs" className="pt-2">
          {certs.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : certs.error ? (
            <ResourceError error={certs.error} />
          ) : (
            <JsonBlock value={certs.data} />
          )}
        </TabsContent>
      </Tabs>

      {showCommands ? (
        <section className="space-y-2 border-t pt-4">
          <h4 className="text-sm font-semibold">
            Node power commands{" "}
            <Badge variant="destructive">platform admin only</Badge>
          </h4>
          <p className="text-xs text-muted-foreground">
            Reboot/shutdown enqueue a command at the hypervisor; wake-on-LAN targets the
            node's management NIC. These affect real hardware.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setCommandTarget("reboot")}
            >
              Reboot
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => setCommandTarget("shutdown")}
            >
              Shutdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setCommandTarget("wakeonlan")}
            >
              Wake-on-LAN
            </Button>
          </div>
        </section>
      ) : null}

      <AlertDialog
        open={commandTarget !== null}
        onOpenChange={(open) => !open && setCommandTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run "{commandTarget}" on {node}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends a power command to a production hypervisor node. Shutdown will
              stop every VM running on it until it comes back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abort</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void runCommand()}
            >
              Run command
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---- VMware inventory --------------------------------------------------------

function VmwareInventoryTabs({ providerId }: { providerId: string }) {
  const inventory = useAdminFetch<{
    hosts?: Array<Record<string, unknown>>
    datastores?: Array<Record<string, unknown>>
    clusters?: Array<Record<string, unknown>>
    resource_pools?: Array<Record<string, unknown>>
    [key: string]: unknown
  }>(`/admin/providers/${providerId}/inventory`)
  const [perfExtId, setPerfExtId] = useState("")
  const [perfTimeframe, setPerfTimeframe] = useState("hour")
  const perf = useAdminFetch<unknown>(
    perfExtId.trim()
      ? `/admin/providers/${providerId}/perf`
      : null,
    { v: perfExtId.trim(), timeframe: perfTimeframe },
  )

  const hosts = inventory.data?.hosts ?? []
  const datastores = inventory.data?.datastores ?? []

  return (
    <Tabs defaultValue="hosts">
      <TabsList>
        <TabsTrigger value="hosts">Hosts ({hosts.length})</TabsTrigger>
        <TabsTrigger value="datastores">Datastores ({datastores.length})</TabsTrigger>
        <TabsTrigger value="perf">Perf</TabsTrigger>
      </TabsList>
      <TabsContent value="hosts" className="pt-2">
        <RawListTable state={{ ...inventory, data: hosts }} />
      </TabsContent>
      <TabsContent value="datastores" className="pt-2">
        <RawListTable state={{ ...inventory, data: datastores }} />
      </TabsContent>
      <TabsContent value="perf" className="space-y-3 pt-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="perf-ext-id">Guest external ID</Label>
            <Input
              id="perf-ext-id"
              value={perfExtId}
              placeholder="vm-1234 / vmx ext id"
              onChange={(event) => setPerfExtId(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="perf-timeframe">Timeframe</Label>
            <Select value={perfTimeframe} onValueChange={setPerfTimeframe}>
              <SelectTrigger id="perf-timeframe" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">hour</SelectItem>
                <SelectItem value="day">day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {perf.loading ? (
          <p className="text-sm text-muted-foreground">Loading metrics…</p>
        ) : perf.error ? (
          <ResourceError error={perf.error} />
        ) : perf.data ? (
          <JsonBlock value={perf.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter a guest external ID to load its metrics.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )
}

// ---- Dokploy mirror ----------------------------------------------------------

interface DokployMirrorResponse {
  entity: string
  items: Array<Record<string, unknown>>
}

const DOKPLOY_ENTITIES = ["projects", "servers", "registries", "sshkeys", "certificates"]

function DokployMirrorTabs() {
  const [entity, setEntity] = useState("projects")
  // The mirror endpoint answers {entity, items:[…]} rather than a bare array.
  const list = useAdminFetch<DokployMirrorResponse>(`/admin/dokploy/db/${entity}`, {
    limit: 25,
  })
  const [busy, setBusy] = useState(false)

  const sync = async () => {
    setBusy(true)
    try {
      const { data } = await apiPost<{ synced: number; failed: number; removed: number }>(
        "/admin/dokploy/sync",
        { entity },
      )
      toast.success(
        `Dokploy sync done: ${data.synced} synced, ${data.failed} failed, ${data.removed} removed`,
      )
      list.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Sync failed")
    } finally {
      setBusy(false)
    }
  }

  const deleteRow = async (remoteId: string) => {
    try {
      await apiDelete(`/admin/dokploy/db/${entity}/${remoteId}`)
      toast.success("Mirror row removed")
      list.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete failed")
    }
  }

  const rowsData = list.data?.items ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOKPLOY_ENTITIES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={busy} onClick={() => void sync()}>
          {busy ? "Syncing…" : "Pull upstream now"}
        </Button>
        <span className="text-xs text-muted-foreground">latest 25 mirror rows</span>
      </div>
      <SimpleDataTable<Record<string, unknown>>
        columns={[
          {
            key: "remote_id",
            header: "Remote ID",
            render: (row) => (
              <span className="font-mono text-xs">{String(row.remote_id ?? "—")}</span>
            ),
          },
          {
            key: "name",
            header: "Name",
            render: (row) => String(row.name ?? row.title ?? "—"),
          },
          {
            key: "updated_at",
            header: "Updated",
            render: (row) => formatDateTime(String(row.updated_at ?? "")),
          },
          {
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void deleteRow(String(row.remote_id))}
              >
                Remove
              </Button>
            ),
          },
        ]}
        rows={rowsData}
        loading={list.loading}
        error={list.error}
        getRowKey={(row, index) => String(row.remote_id ?? index)}
        emptyMessage={`No ${entity} mirrored yet — run a sync first.`}
        skeletonRows={5}
      />
    </div>
  )
}

// ---- Shared raw table ---------------------------------------------------------

/** Renders any list-of-objects payload as a generic two-column table. */
function RawListTable({
  state,
}: {
  state: FetchState<Array<Record<string, unknown>>> & { reload: () => void }
}) {
  if (state.loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (state.error) {
    return <ResourceError error={state.error} />
  }
  const rows = state.data ?? []
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing returned.</p>
  }
  const keys = Object.keys(rows[0]).slice(0, 6)
  return (
    <SimpleDataTable<Record<string, unknown>>
      columns={keys.map((key) => ({
        key,
        header: key.replace(/_/g, " "),
        render: (row) => {
          const value = row[key]
          if (value === null || value === undefined) return "—"
          if (typeof value === "object") return JSON.stringify(value)
          return String(value)
        },
      }))}
      rows={rows}
      getRowKey={(row, index) => String(row.id ?? index)}
      skeletonRows={4}
    />
  )
}
