import { useCallback, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface NodeRow {
  node?: string
  name?: string
  status?: string
  level?: string
  online?: number
}

interface QemuMigrateStatusPayload {
  provider_id: string
  code: string
  node: string
  vmid: number
  external_id: string
  guest?: Record<string, unknown> | null
  nodes: NodeRow[]
  total_nodes: number
  hint?: string
  example?: Record<string, string>
}

export default function ProxmoxQemuMigratePage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const node = (params.node ?? "") as string
  const vmid = (params.vmid ?? "") as string

  const base =
    providerId && node && vmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/migrate`
      : null

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isProxmox = !match || match.kind === "proxmox"
  const kindMismatch = Boolean(match && match.kind !== "proxmox")

  const status = useInfraGet<QemuMigrateStatusPayload>(providerId && isProxmox && base ? base : null, undefined, {
    intervalMs: 5000,
  })

  const [targetNode, setTargetNode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const nodes: NodeRow[] = Array.isArray(status.data?.nodes) ? status.data!.nodes! : []
  const externalId = status.data?.external_id ?? (vmid ? vmid : "")

  const onPickNode = useCallback((row: NodeRow) => {
    const name = row.node ?? row.name
    if (name) setTargetNode(name)
  }, [])

  const canSubmit = Boolean(providerId) && Boolean(node) && Boolean(vmid) && Boolean(targetNode.trim()) && !submitting && !kindMismatch

  const doMigrate = async () => {
    if (!canSubmit || !base) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const tgt = targetNode.trim()
      await apiPost(base, { target_node: tgt })
      toast.success(`QEMU ${externalId} → ${tgt} migrated`)
      setConfirmOpen(false)
      status.reload()
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Migrate failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (!providerId || !node || !vmid) {
    return (
      <ProviderShell providerId={providerId} title="QEMU migrate" description="Proxmox per-VM QEMU live migration.">
        <ErrorBanner error={new Error("Missing providerId, node or vmid in route params — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate")} />
      </ProviderShell>
    )
  }

  if (status.error instanceof ApiError && status.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="QEMU migrate" description="Proxmox per-VM QEMU live migration.">
        <EmptyState
          message="QEMU migrate is only available for proxmox providers."
          description="This provider runs another platform (the API answered HTTP 501 via proxmoxAdapterFor kind guard). Use a proxmox provider and retry POST /v1/admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — QEMU migrate at{" "}
              <span className="font-mono">/admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate</span> requires{" "}
              <span className="font-mono">kind=proxmox</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU migrate · ${vmid} on ${node}`}
      description="POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate — live-migrate a QEMU VM to another node. GET /migrate polls every 5s (infra, NOC readable); POST is platform_admin only (proxmoxAdapterFor guard)."
      actions={
        <Button variant="outline" size="sm" onClick={() => status.reload()} disabled={status.loading}>
          {status.loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {providers.error ? <ErrorBanner error={providers.error} /> : null}
      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={isProxmox ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              node <span className="font-mono">{node}</span> · vmid <span className="font-mono">{vmid}</span> · external{" "}
              <span className="font-mono">{externalId}</span> · endpoint{" "}
              <span className="font-mono">GET/POST /v1/admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate</span> — RBAC{" "}
              <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span> (platform_admin only)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not proxmox." description={`Kind is ${match.kind} — QEMU migrate at /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate answers 501. Switch to a proxmox provider.`} />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live inventory/migrate answers HTTP 503 until credentials are configured via the provider editor.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Migrate QEMU {externalId}</CardTitle>
              <CardDescription>
                Move QEMU VM <span className="font-mono">{externalId}</span> from node{" "}
                <span className="font-mono">{node}</span> to a target node. The backend calls{" "}
                <span className="font-mono">Adapter.MigrateVM</span> which does preflight +{" "}
                <span className="font-mono">POST .../qemu/{vmid}/migrate {"{target}"}</span> +{" "}
                <span className="font-mono">WaitForTask</span>. RBAC: <span className="font-mono">GET infra</span> ·{" "}
                <span className="font-mono">POST ""</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid w-full max-w-full min-w-0 gap-4">
              <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">{node}</Badge>
                    <Badge variant="secondary">{externalId}</Badge>
                    <Badge variant="outline">vmid {vmid}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Derived from route params · external <span className="font-mono">{externalId}</span>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qemu-target">Target node *</Label>
                  <Input
                    id="qemu-target"
                    value={targetNode}
                    onChange={(e) => setTargetNode(e.target.value)}
                    placeholder="pve02"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    PVE node name (also accepts <span className="font-mono">target/target_node/node/host</span> keys). Pick from the node table below.
                  </p>
                </div>
              </div>

              {submitError ? <ErrorBanner error={submitError} /> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
                  {submitting ? "Migrating…" : `Migrate ${externalId} → ${targetNode.trim() || "…"}`}
                </Button>
                <Button variant="outline" onClick={() => { setTargetNode(""); setSubmitError(null) }} disabled={submitting}>
                  Clear
                </Button>
                <span className="text-xs text-muted-foreground">
                  Calls <span className="font-mono">POST {base}</span> <span className="font-mono">{"{target_node}"}</span> — 200 on success, 501 if provider kind is not proxmox, 422 if same-node or unknown target.
                </span>
              </div>
              {status.data?.hint ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {status.data.hint} — example {JSON.stringify(status.data.example)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <ErrorBanner error={status.error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cluster nodes (polls every 5s)</CardTitle>
              <CardDescription>
                Nodes from <span className="font-mono">GET {base}</span> —{" "}
                <span className="font-mono">useInfraGet intervalMs: 5000</span>. Click Use to fill target (current node{" "}
                <span className="font-mono">{node}</span> is not a valid target — same-node migration returns 422).
                {status.data?.total_nodes !== undefined ? ` · ${status.data.total_nodes} node(s)` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<NodeRow>
                columns={[
                  { key: "node", header: "Node", render: (row) => <span className="font-mono text-xs">{row.node ?? row.name ?? "—"}</span> },
                  { key: "status", header: "Status", render: (row) => <Badge variant={row.status === "online" ? "secondary" : "outline"}>{row.status || "—"}</Badge> },
                  { key: "level", header: "Level", render: (row) => row.level || "—" },
                  {
                    key: "action",
                    header: "",
                    className: "w-20 text-right",
                    render: (row) => {
                      const name = row.node ?? row.name ?? ""
                      const isCurrent = name === node
                      return (
                        <Button variant="outline" size="sm" onClick={() => onPickNode(row)} disabled={!name || isCurrent}>
                          {isCurrent ? "Current" : "Use"}
                        </Button>
                      )
                    },
                  },
                ]}
                rows={nodes}
                loading={status.loading}
                error={null}
                getRowKey={(row, idx) => String(row.node ?? row.name ?? `node-${idx}`)}
                emptyMessage="No nodes discovered — check PVE cluster and provider id."
                skeletonRows={4}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How it works</CardTitle>
              <CardDescription>
                <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate</span> (infra-readable, 5s poll via useInfraGet) returns caller node + guest + node list.{" "}
                <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate</span> (platform_admin only) calls{" "}
                <span className="font-mono">proxmoxAdapterFor</span> guard — non-proxmox answers 501 expect proxmox.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Endpoint: <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/migrate</span> · requireStaff platform_admin · proxmox murni · 200 + status on success.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Migrate {externalId} to {targetNode.trim() || "…"}?
            </DialogTitle>
            <DialogDescription>
              This will live-migrate QEMU VM {vmid} from {node} to {targetNode.trim() || "…"}. The VM will be moved to the target node — ensure the target has sufficient resources and shared storage. This calls{" "}
              <span className="font-mono">POST /nodes/{node}/qemu/{vmid}/migrate</span> on PVE.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} onClick={() => void doMigrate()}>
              {submitting ? "Migrating…" : `Confirm migrate to ${targetNode.trim() || "…"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
