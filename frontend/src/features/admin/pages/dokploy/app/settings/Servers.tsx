// Dokploy parity #24 — settings/servers.tsx +
// components/dashboard/settings/servers/{show-servers,handle-servers,
// actions/*}. Remote servers CRUD + setup wizard-lite, security audit,
// default command, monitoring setup, GPU support, docker-cleanup actions and
// diagnostics, backed by server.* / admin.setupMonitoring / settings.clean*.
import { useState } from "react"
import { toast } from "sonner"
import {
  CopyIcon,
  CpuIcon,
  GaugeIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { FieldErrorText, JsonBlock, runMutation } from "./helpers"

type Row = Record<string, unknown>

interface ServerDraft {
  serverId: string
  name: string
  description: string
  ipAddress: string
  port: string
  username: string
  sshKeyId: string
  serverType: "deploy" | "build"
  enableDockerCleanup: boolean
}

const emptyDraft: ServerDraft = {
  serverId: "",
  name: "",
  description: "",
  ipAddress: "",
  port: "22",
  username: "root",
  sshKeyId: "",
  serverType: "deploy",
  enableDockerCleanup: false,
}

const CLEANUPS = [
  { op: "settings.cleanAll", label: "Clean everything", description: "Runs every cleanup routine below against the selected scope." },
  { op: "settings.cleanDockerBuilder", label: "Clean Docker builder", description: "Removes Docker buildx builder cache." },
  { op: "settings.cleanDockerPrune", label: "Docker system prune", description: "Prunes dangling Docker data." },
  { op: "settings.cleanStoppedContainers", label: "Remove stopped containers", description: "Deletes containers that are not running." },
  { op: "settings.cleanUnusedImages", label: "Remove unused images", description: "Deletes images not referenced by any container." },
  { op: "settings.cleanUnusedVolumes", label: "Remove unused volumes", description: "Deletes volumes not attached to a container. Data loss risk!" },
  { op: "settings.cleanAllDeploymentQueue", label: "Clear deployment queue", description: "Empties all pending deployment jobs." },
] as const

export default function DokploySettingsServersPage() {
  const servers = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.all"), [])
  const withSSHKey = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.withSSHKey"), [])
  const buildServersList = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.buildServers"), [])
  const sshKeys = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "sshKey.all"), [])
  const webSettings = useUpstream<Row>(() => dokploy<Row>("GET", "settings.getWebServerSettings"), [])

  const [draft, setDraft] = useState<ServerDraft | null>(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [validateResult, setValidateResult] = useState<{ row: Row; payload: unknown; error?: unknown } | null>(null)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [securityResult, setSecurityResult] = useState<unknown>(null)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [securityLoading, setSecurityLoading] = useState(false)
  const [removeRow, setRemoveRow] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)
  const [cleanupOp, setCleanupOp] = useState<string | null>(null)
  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [monitoringTarget, setMonitoringTarget] = useState("")
  const [monitoringBusy, setMonitoringBusy] = useState<string | null>(null)
  const [gpuStatus, setGpuStatus] = useState<unknown>(null)
  const [gpuLoading, setGpuLoading] = useState(false)
  const [gpuSetupConfirm, setGpuSetupConfirm] = useState(false)

  const openCreate = () => setDraft({ ...emptyDraft })
  const openEdit = (row: Row) =>
    setDraft({
      serverId: String(row.serverId ?? ""),
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      ipAddress: String(row.ipAddress ?? ""),
      port: String(row.port ?? "22"),
      username: String(row.username ?? "root"),
      sshKeyId: row.sshKeyId ? String(row.sshKeyId) : "",
      serverType: row.serverType === "build" ? "build" : "deploy",
      enableDockerCleanup: Boolean(row.enableDockerCleanup),
    })

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.name.trim()) return
    if (!draft.ipAddress.trim()) return
    setDraftSaving(true)
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      ipAddress: draft.ipAddress.trim(),
      port: Number(draft.port) || 22,
      username: draft.username.trim() || "root",
      sshKeyId: draft.sshKeyId || null,
      serverType: draft.serverType,
      ...(draft.serverType === "deploy" ? { enableDockerCleanup: draft.enableDockerCleanup } : {}),
    }
    if (draft.serverId) body.serverId = draft.serverId
    const result = await runMutation(
      () => dokploy("POST", draft.serverId ? "server.update" : "server.create", body),
      {
        success: draft.serverId ? "Server updated" : "Server created",
        onDone: () => servers.reload(),
      },
    )
    if (!result.ok) {
      setDraftSaving(false)
      return
    }
    if (!draft.serverId) {
      // Wizard-lite: probe the freshly registered machine right away by
      // locating its row in server.all and running server.validate on it.
      setDraft(null)
      try {
        const rows = await dokploy<Row[]>("GET", "server.all")
        const fresh = rows.find((row) => String(row.name ?? "") === draft.name.trim())
        if (fresh) await runValidate(fresh)
      } catch {
        // List refresh failed — the table will surface it after reload().
      }
    }
    setDraftSaving(false)
  }

  // Validate runs server.validate for a row and shows the raw outcome.
  const runValidate = async (row: Row) => {
    const serverId = String(row.serverId ?? "")
    setValidatingId(serverId)
    try {
      const payload = await dokploy<unknown>("GET", "server.validate", undefined, { serverId })
      setValidateResult({ row, payload })
      toast.success("Validation finished")
    } catch (cause) {
      setValidateResult({ row, payload: null, error: cause })
    } finally {
      setValidatingId(null)
    }
  }

  const showSecurity = async (row: Row) => {
    setSecurityOpen(true)
    setSecurityLoading(true)
    setSecurityResult(null)
    try {
      setSecurityResult(
        await dokploy<unknown>("GET", "server.security", undefined, {
          serverId: String(row.serverId ?? ""),
        }),
      )
    } catch (cause) {
      setSecurityResult({ error: toErrorMessage(cause) })
    } finally {
      setSecurityLoading(false)
    }
  }

  const copyDefaultCommand = async (row: Row) => {
    try {
      const command = await dokploy<string>(
        "GET",
        "server.getDefaultCommand",
        undefined,
        { serverId: String(row.serverId ?? "") },
      )
      await navigator.clipboard.writeText(typeof command === "string" ? command : JSON.stringify(command))
      toast.success("Default command copied")
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    }
  }

  const removeServer = async () => {
    if (!removeRow) return
    setRemoving(true)
    await runMutation(
      () => dokploy("POST", "server.remove", { serverId: String(removeRow.serverId ?? "") }),
      {
        success: "Server removed",
        onDone: () => {
          setRemoveRow(null)
          servers.reload()
        },
      },
    )
    setRemoving(false)
  }

  const runCleanup = async (op: string) => {
    setCleanupRunning(true)
    await runMutation(() => dokploy("POST", op, {}), {
      success: `${op.split(".")[1]} finished`,
    })
    setCleanupRunning(false)
    setCleanupOp(null)
  }

  const setupMonitoring = async (scope: "admin" | "server") => {
    const metricsConfig = {
      server: { port: 4500, type: "Dokploy", token: "", refreshRate: 60 },
      containers: { refreshRate: 60 },
    }
    setMonitoringBusy(scope)
    await runMutation(
      () =>
        scope === "admin"
          ? dokploy("POST", "admin.setupMonitoring", { metricsConfig })
          : dokploy("POST", "server.setupMonitoring", {
              serverId: monitoringTarget,
              metricsConfig,
            }),
      {
        success: scope === "admin" ? "Web-server monitoring configured" : "Server monitoring configured",
      },
    )
    setMonitoringBusy(null)
  }

  const checkGpu = async () => {
    setGpuLoading(true)
    try {
      setGpuStatus(await dokploy("GET", "settings.checkGPUStatus", undefined, {}))
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setGpuLoading(false)
    }
  }

  const setupGpu = async () => {
    setGpuSetupConfirm(false)
    await runMutation(() => dokploy("POST", "settings.setupGPU", {}), {
      success: "GPU setup started",
    })
  }

  const publicIp = useUpstream<unknown>(() => dokploy<unknown>("GET", "server.publicIp"), [])
  const serverTime = useUpstream<unknown>(() => dokploy<unknown>("GET", "server.getServerTime"), [])

  const columns: Array<SimpleColumn<Row>> = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{String(row.name ?? "?")}</span>
          <span className="text-muted-foreground text-xs">{String(row.description ?? "")}</span>
        </div>
      ),
    },
    {
      key: "ipAddress",
      header: "Address",
      render: (row) => (
        <code className="text-xs">
          {String(row.username ?? "root")}@{String(row.ipAddress ?? "?")}:{String(row.port ?? "22")}
        </code>
      ),
    },
    {
      key: "serverType",
      header: "Type",
      render: (row) => (
        <Badge variant={row.serverType === "build" ? "secondary" : "outline"}>
          {String(row.serverType ?? "deploy")}
        </Badge>
      ),
    },
    { key: "appName", header: "App name" },
    {
      key: "actions",
      header: "",
      className: "w-64",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Validate SSH connection"
            disabled={validatingId !== null}
            onClick={() => void runValidate(row)}
          >
            {validatingId === String(row.serverId ?? "") ? (
              <Spinner className="size-4" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon" title="Security audit" onClick={() => void showSecurity(row)}>
            <ShieldCheckIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Copy default install command"
            onClick={() => void copyDefaultCommand(row)}
          >
            <CopyIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(row)}>
            <PencilIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            title="Remove"
            onClick={() => setRemoveRow(row)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Remote Servers"
        description="Additional machines Dokploy deploys to. Register via SSH, validate connectivity, then let the panel provision them."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            Add server
          </Button>
        }
      />

      {/* Diagnostics strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Public IP (server.publicIp)</CardDescription>
            <CardTitle className="text-base">
              {publicIp.loading ? "…" : typeof publicIp.data === "string" ? publicIp.data : JSON.stringify(publicIp.data)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Server time (server.getServerTime)</CardDescription>
            <CardTitle className="text-base">{serverTime.loading ? "…" : safeText(serverTime.data)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Global build concurrency</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <GaugeIcon className="size-4 text-muted-foreground" />
              {webSettings.loading ? "…" : String(webSettings.data?.buildsConcurrency ?? "?")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Servers table */}
      {servers.error ? <ErrorBanner error={servers.error} /> : null}
      <SimpleDataTable
        columns={columns}
        rows={servers.data ?? []}
        loading={servers.loading}
        getRowKey={(row) => String(row.serverId ?? row.name)}
        emptyMessage="No remote servers registered — everything currently deploys to the web server itself."
      />

      {/* Validation result */}
      <Dialog open={validateResult !== null} onOpenChange={(open) => (open ? null : setValidateResult(null))}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              server.validate — {String(validateResult?.row?.name ?? "")}
            </DialogTitle>
            <DialogDescription>
              Raw upstream response. Failures usually mean the SSH key is missing or the host is
              unreachable.
            </DialogDescription>
          </DialogHeader>
          {validateResult?.error ? (
            <ErrorBanner error={validateResult.error} />
          ) : (
            <JsonBlock value={validateResult?.payload} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setValidateResult(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Security view */}
      <Dialog open={securityOpen} onOpenChange={(open) => (open ? null : setSecurityOpen(false))}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Security audit</DialogTitle>
            <DialogDescription>Raw output of server.security for the selected machine.</DialogDescription>
          </DialogHeader>
          {securityLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Auditing…
            </p>
          ) : (
            <JsonBlock value={securityResult} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSecurityOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit dialog */}
      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.serverId ? "Edit server" : "Add server"}</DialogTitle>
            <DialogDescription>
              Registers an SSH target. After creating you can run server.validate to confirm
              reachability.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="srv-name">Name *</Label>
                <Input
                  id="srv-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  required
                />
                {!draft.name.trim() ? <FieldErrorText>Name is required</FieldErrorText> : null}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="srv-ip">IP address *</Label>
                  <Input
                    id="srv-ip"
                    value={draft.ipAddress}
                    onChange={(event) => setDraft({ ...draft, ipAddress: event.target.value })}
                    placeholder="203.0.113.10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="srv-port">Port *</Label>
                  <Input
                    id="srv-port"
                    type="number"
                    value={draft.port}
                    onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                  />
                </div>
              </div>
              {!draft.ipAddress.trim() ? <FieldErrorText>IP address is required</FieldErrorText> : null}
              <div className="space-y-2">
                <Label htmlFor="srv-user">SSH username *</Label>
                <Input
                  id="srv-user"
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="srv-desc">Description</Label>
                <Input
                  id="srv-desc"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="srv-type">Server type</Label>
                  <select
                    id="srv-type"
                    className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                    value={draft.serverType}
                    onChange={(event) =>
                      setDraft({ ...draft, serverType: event.target.value as ServerDraft["serverType"] })
                    }
                  >
                    <option value="deploy">deploy</option>
                    <option value="build">build</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="srv-key">SSH key</Label>
                  <select
                    id="srv-key"
                    className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                    value={draft.sshKeyId}
                    onChange={(event) => setDraft({ ...draft, sshKeyId: event.target.value })}
                  >
                    <option value="">— none —</option>
                    {(sshKeys.data ?? []).map((key) => (
                      <option key={String(key.sshKeyId ?? "")} value={String(key.sshKeyId ?? "")}>
                        {String(key.name ?? "key")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {draft.serverType === "deploy" ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor="srv-cleanup" className="text-sm">
                    Nightly Docker cleanup
                  </Label>
                  <Switch
                    id="srv-cleanup"
                    checked={draft.enableDockerCleanup}
                    onCheckedChange={(checked) => setDraft({ ...draft, enableDockerCleanup: checked })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={draftSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveDraft()}
              disabled={draftSaving || !draft?.name.trim() || !draft?.ipAddress.trim()}
            >
              {draftSaving ? <Spinner className="size-4" /> : null}
              {draft?.serverId ? "Save changes" : "Create & validate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={removeRow !== null} onOpenChange={(open) => (open ? null : setRemoveRow(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove server?</AlertDialogTitle>
            <AlertDialogDescription>
              “{String(removeRow?.name ?? "")}” will be unregistered. Services deployed there keep
              running but can no longer be managed from this panel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                void removeServer()
              }}
            >
              {removing ? <Spinner className="size-4" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Monitoring + GPU */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GaugeIcon className="size-4 text-muted-foreground" />
              Monitoring setup
            </CardTitle>
            <CardDescription>
              admin.setupMonitoring configures the web server itself; server.setupMonitoring targets a
              registered remote server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              size="sm"
              disabled={monitoringBusy !== null}
              onClick={() => void setupMonitoring("admin")}
            >
              {monitoringBusy === "admin" ? <Spinner className="size-4" /> : null}
              Set up web-server monitoring
            </Button>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="mon-target">Remote server</Label>
                <select
                  id="mon-target"
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                  value={monitoringTarget}
                  onChange={(event) => setMonitoringTarget(event.target.value)}
                >
                  <option value="">— pick a server —</option>
                  {(servers.data ?? []).map((row) => (
                    <option key={String(row.serverId ?? "")} value={String(row.serverId ?? "")}>
                      {String(row.name ?? "")}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={monitoringBusy !== null || !monitoringTarget}
                onClick={() => void setupMonitoring("server")}
              >
                {monitoringBusy === "server" ? <Spinner className="size-4" /> : null}
                Set up
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CpuIcon className="size-4 text-muted-foreground" />
              GPU support
            </CardTitle>
            <CardDescription>settings.checkGPUStatus / settings.setupGPU</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" onClick={() => void checkGpu()} disabled={gpuLoading}>
              {gpuLoading ? <Spinner className="size-4" /> : null}
              Check GPU status
            </Button>
            {gpuStatus !== null ? <JsonBlock value={gpuStatus} /> : null}
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm" onClick={() => setGpuSetupConfirm(true)}>
              Run GPU setup…
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Docker cleanup actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2Icon className="size-4 text-muted-foreground" />
            Docker cleanup actions
          </CardTitle>
          <CardDescription>
            Destructive maintenance ops applied to the whole connected instance. Each one asks for
            confirmation first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[...CLEANUPS, { op: "settings.cleanMonitoring", label: "Clean monitoring data", description: "Trims stored monitoring samples." }].map(
            (cleanup) => (
              <Button key={cleanup.op} variant="destructive" size="sm" onClick={() => setCleanupOp(cleanup.op)}>
                {cleanup.label}
              </Button>
            ),
          )}
        </CardContent>
      </Card>

      {/* Cleanup confirmation */}
      <AlertDialog open={cleanupOp !== null} onOpenChange={(open) => (open ? null : setCleanupOp(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Run {cleanupOp?.split(".")[1] ?? "cleanup"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {CLEANUPS.find((c) => c.op === cleanupOp)?.description ??
                "This deletes collected monitoring history."}{" "}
              Calls <code>{cleanupOp}</code> upstream.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cleanupRunning}
              onClick={(event) => {
                event.preventDefault()
                if (cleanupOp) void runCleanup(cleanupOp)
              }}
            >
              {cleanupRunning ? <Spinner className="size-4" /> : null}
              Run now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* GPU setup confirmation */}
      <AlertDialog open={gpuSetupConfirm} onOpenChange={(open) => (open ? null : setGpuSetupConfirm(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run settings.setupGPU?</AlertDialogTitle>
            <AlertDialogDescription>
              Installs NVIDIA container-toolkit wiring on the connected instance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void setupGpu()
              }}
            >
              Start setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Build servers + SSH-key servers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Build servers</CardTitle>
            <CardDescription>server.buildServers — machines flagged as build targets.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(buildServersList.data ?? []).length === 0 ? (
                <li className="text-muted-foreground">No dedicated build servers.</li>
              ) : (
                (buildServersList.data ?? []).map((row, index) => (
                  <li key={String(row.serverId ?? index)} className="flex items-center justify-between">
                    <span>{String(row.name ?? row.serverId)}</span>
                    <Badge variant="secondary">build</Badge>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Servers with SSH keys attached</CardTitle>
            <CardDescription>server.withSSHKey — filtered listing.</CardDescription>
          </CardHeader>
          <CardContent>
            {(withSSHKey.data ?? []).length === 0 ? (
              <EmptyState message="No servers carry a dedicated SSH private key." />
            ) : (
              <ul className="space-y-1 text-sm">
                {(withSSHKey.data ?? []).map((row, index) => (
                  <li key={String(row.serverId ?? index)}>
                    {String(row.name ?? "?")}
                    {typeof row.sshPrivateKey === "object" && row.sshPrivateKey !== null
                      ? ` · ${String((row.sshPrivateKey as Row).name ?? "")}`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create / edit dialog footer hint about terminal access */}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <TerminalIcon className="size-3" />
        Setup provisioning (server.setup) intentionally requires manual confirmation per server and is
        available from each application's build settings after validation succeeds.
      </p>
    </div>
  )
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return "—"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
