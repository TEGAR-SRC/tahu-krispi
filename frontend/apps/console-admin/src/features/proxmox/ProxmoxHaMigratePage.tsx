// Proxmox HA MigrateRelocate — per-resource HA managed guest migration.
// Endpoints: GET  /admin/proxmox/:id/ha-resources/:sid/migrate (infra, polled 5s)
//            POST /admin/proxmox/:id/ha-resources/:sid/migrate (platform_admin)
// Guard kind==proxmox via proxmoxAdapterFor — non-proxmox answers 501 expect proxmox.
// Adapter: Client().HAResourceMigrateRelocate(ctx, sid, node, relocate) -> POST /cluster/ha/resources/{sid}/migrate or /relocate.
import { useCallback, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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

interface HaMigrateStatusPayload {
  provider_id: string
  code: string
  sid: string
  resource?: Record<string, unknown> | null
  nodes: NodeRow[]
  total_nodes: number
  ha_status?: unknown[]
  hint?: string
  example?: Record<string, unknown>
}

export default function ProxmoxHaMigratePage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const sid = (params.sid ?? "") as string

  const base =
    providerId && sid
      ? `/admin/proxmox/${providerId}/ha-resources/${encodeURIComponent(sid)}/migrate`
      : null

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isProxmox = !match || match.kind === "proxmox"
  const kindMismatch = Boolean(match && match.kind !== "proxmox")

  const status = useInfraGet<HaMigrateStatusPayload>(providerId && isProxmox && base ? base : null, undefined, { intervalMs: 5000 })

  const [targetNode, setTargetNode] = useState("")
  const [relocate, setRelocate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const nodes: NodeRow[] = Array.isArray(status.data?.nodes) ? status.data!.nodes! : []

  const onPickNode = useCallback((row: NodeRow) => {
    const name = row.node ?? row.name
    if (name) setTargetNode(name)
  }, [])

  const canSubmit = Boolean(providerId) && Boolean(sid) && Boolean(targetNode.trim()) && !submitting && !kindMismatch

  const onSubmit = async () => {
    if (!canSubmit || !base) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const tgt = targetNode.trim()
      await apiPost(base, { target_node: tgt, relocate })
      const verb = relocate ? "relocated" : "migrated"
      toast.success(`HA ${sid} → ${tgt} ${verb} (200)`)
      status.reload()
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "HA migrate failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (!providerId || !sid) {
    return (
      <ProviderShell providerId={providerId} title="HA migrate" description="Proxmox HA resource migrate/relocate.">
        <ErrorBanner error={new Error("Missing providerId or sid in route params — expected /admin/proxmox/:id/ha-resources/:sid/migrate")} />
      </ProviderShell>
    )
  }

  if (status.error instanceof ApiError && status.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="HA migrate" description="Proxmox HA resource migrate/relocate.">
        <EmptyState
          message="HA migrate is only available for proxmox providers."
          description="This provider runs another platform (the API answered HTTP 501 via proxmoxAdapterFor kind guard). Use a proxmox provider and retry POST /v1/admin/proxmox/:id/ha-resources/:sid/migrate."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind <Badge variant="destructive">{match.kind}</Badge> — HA migrate at <span className="font-mono">/admin/proxmox/:id/ha-resources/:sid/migrate</span> requires <span className="font-mono">kind=proxmox</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const resource = status.data?.resource as Record<string, unknown> | null | undefined
  const resourceLabel = resource ? String((resource as Record<string, unknown>).sid ?? sid) : sid

  return (
    <ProviderShell
      providerId={providerId}
      title={`HA migrate · ${sid}`}
      description="POST /admin/proxmox/:id/ha-resources/:sid/migrate — migrate/relocate an HA-managed guest to another node. GET /migrate polls every 5s (infra, NOC readable); POST is platform_admin only (proxmoxAdapterFor guard). Relocate=true restarts on target (harder), migrate does online request."
      actions={<Button variant="outline" size="sm" onClick={() => status.reload()} disabled={status.loading}>{status.loading ? "Refreshing…" : "Refresh"}</Button>}
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
              sid <span className="font-mono">{sid}</span> · resource <span className="font-mono">{resourceLabel}</span> · endpoint <span className="font-mono">GET/POST /v1/admin/proxmox/:id/ha-resources/:sid/migrate</span> — RBAC <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span> (platform_admin only)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not proxmox." description={`Kind is ${match.kind} — HA migrate at /admin/proxmox/:id/ha-resources/:sid/migrate answers 501. Switch to a proxmox provider.`} />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">No stored credentials — live inventory/migrate answers HTTP 503 until credentials are configured via the provider editor.</p>
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
              <CardTitle className="text-base">Migrate HA resource {resourceLabel}</CardTitle>
              <CardDescription>
                Move HA resource <span className="font-mono">{sid}</span> to a target node. Backend calls <span className="font-mono">HAResourceMigrateRelocate</span> → <span className="font-mono">POST /cluster/ha/resources/{"{sid}"}/migrate</span> or <span className="font-mono">/relocate</span> on PVE. RBAC: <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid w-full max-w-full min-w-0 gap-4">
              <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">{sid}</Badge>
                    {resource ? <Badge variant="outline">{String((resource as Record<string, unknown>).state ?? "—")}</Badge> : null}
                    {resource ? <Badge variant="outline">group {String((resource as Record<string, unknown>).group ?? "—")}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    SID format <span className="font-mono">vm:{"{vmid}"}</span> or <span className="font-mono">ct:{"{ctid}"}</span> · resource {resource ? "found" : "unknown (check HA resources list)"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ha-target">Target node *</Label>
                  <Input id="ha-target" value={targetNode} onChange={(e) => setTargetNode(e.target.value)} placeholder="pve02" autoComplete="off" className="font-mono text-xs" />
                  <p className="text-xs text-muted-foreground">PVE node name (also accepts <span className="font-mono">target/target_node/node/host</span> keys). Pick from the node table below.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={relocate} onCheckedChange={(v) => setRelocate(v === true)} />
                Relocate (hard restart on target — POST <span className="font-mono">/relocate</span> instead of <span className="font-mono">/migrate</span>)
              </label>
              <p className="text-xs text-muted-foreground">When off (default), the backend POSTs <span className="font-mono">/migrate</span> (online migration). When on, it POSTs <span className="font-mono">/relocate</span> (stop+start on target).</p>

              {submitError ? <ErrorBanner error={submitError} /> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={!canSubmit} onClick={() => void onSubmit()}>{submitting ? (relocate ? "Relocating…" : "Migrating…") : relocate ? `Relocate ${sid} → ${targetNode.trim() || "…"}` : `Migrate ${sid} → ${targetNode.trim() || "…"}`}</Button>
                <Button variant="outline" onClick={() => { setTargetNode(""); setRelocate(false); setSubmitError(null) }} disabled={submitting}>Clear</Button>
                <span className="text-xs text-muted-foreground">Calls <span className="font-mono">POST {base}</span> <span className="font-mono">{"{target_node, relocate}"}</span> — 200 on success, 501 if provider kind is not proxmox.</span>
              </div>
              {status.data?.hint ? <p className="mt-2 text-xs text-muted-foreground">{status.data.hint} — example {JSON.stringify(status.data.example)}</p> : null}
            </CardContent>
          </Card>

          <ErrorBanner error={status.error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cluster nodes (polls every 5s)</CardTitle>
              <CardDescription>
                Nodes from <span className="font-mono">GET {base}</span> — <span className="font-mono">useInfraGet intervalMs: 5000</span>. Click Use to fill target.
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
                      return <Button variant="outline" size="sm" onClick={() => onPickNode(row)} disabled={!name}>Use</Button>
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
                <span className="font-mono">GET /admin/proxmox/:id/ha-resources/:sid/migrate</span> (infra-readable, 5s poll via useInfraGet) returns resource + node list.{" "}
                <span className="font-mono">POST /admin/proxmox/:id/ha-resources/:sid/migrate</span> (platform_admin only) calls <span className="font-mono">proxmoxAdapterFor</span> guard — non-proxmox answers 501 expect proxmox.
              </CardDescription>
            </CardHeader>
            <CardContent><p className="text-xs text-muted-foreground">Endpoint: <span className="font-mono">POST /admin/proxmox/:id/ha-resources/:sid/migrate</span> · requireStaff platform_admin · proxmox murni · 200 + status on success.</p></CardContent>
          </Card>
        </>
      ) : null}
    </ProviderShell>
  )
}
