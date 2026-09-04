// GET /admin/proxmox/:id/ha/manager-status — proxmox murni (proxmoxAdapterFor guard kind==proxmox, 501 expect proxmox otherwise).
// RBAC GET infra (NOC + platform_admin readable, finance 403). Polling every 5s via useInfraGet intervalMs 5000.
import { useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type HAManagerStatus = {
  manager_status?: Record<string, unknown>
  node_status?: Record<string, string>
  service_status?: Record<string, Record<string, unknown>>
  quorum?: Record<string, unknown>
  [k: string]: unknown
}

type KvRow = { key: string; value: unknown }
type NodeRow = { node: string; status: string }
type ServiceRow = { service: string; node: string; status: string; state: string; raw: string }

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v === "" ? "—" : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function toKvRows(obj: Record<string, unknown> | null | undefined): KvRow[] {
  if (!obj || typeof obj !== "object") return []
  return Object.entries(obj)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function toNodeRows(obj: Record<string, string> | null | undefined): NodeRow[] {
  if (!obj || typeof obj !== "object") return []
  return Object.entries(obj)
    .map(([node, status]) => ({ node, status }))
    .sort((a, b) => a.node.localeCompare(b.node))
}

function toServiceRows(obj: Record<string, Record<string, unknown>> | null | undefined): ServiceRow[] {
  if (!obj || typeof obj !== "object") return []
  return Object.entries(obj).map(([service, detail]) => ({
    service,
    node: typeof detail?.node === "string" ? (detail.node as string) : typeof detail?.node === "number" ? String(detail.node) : "—",
    status: typeof detail?.status === "string" ? (detail.status as string) : "—",
    state: typeof detail?.state === "string" ? (detail.state as string) : (typeof detail?.crm_state === "string" ? (detail.crm_state as string) : "—"),
    raw: (() => { try { return JSON.stringify(detail) } catch { return String(detail) } })(),
  }))
}

export default function ProxmoxHaManagerStatusPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`
  const path = providerId ? `${base}/ha/manager-status` : null
  const state = useInfraGet<HAManagerStatus>(path, undefined, { intervalMs: 5000 })
  const data = (state.data ?? {}) as HAManagerStatus
  const kvManager = toKvRows(data.manager_status as Record<string, unknown>)
  const nodeRows = toNodeRows(data.node_status)
  const serviceRows = toServiceRows(data.service_status)
  const kvQuorum = toKvRows(data.quorum as Record<string, unknown>)

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="HA manager status" description="HA manager status for this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="HA manager status"
      description="HA manager status (GET /admin/proxmox/:id/ha/manager-status) — master CRM/LRM state, node liveliness and quorum. Polled every 5s via useInfraGet intervalMs 5000. Proxmox-only via proxmoxAdapterFor (non-proxmox → 501 expect proxmox), GET is infra-readable (NOC + platform_admin)."
      actions={<Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>}
    >
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node status</CardTitle>
            <CardDescription>LRM node_status — one row per cluster node (online/offline).</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<NodeRow>
              columns={[
                { key: "node", header: "Node", render: (r) => <span className="font-mono text-xs font-medium">{r.node}</span> },
                { key: "status", header: "Status", render: (r) => <Badge variant={r.status === "online" ? "outline" : "destructive"}>{r.status}</Badge> },
              ]}
              rows={nodeRows}
              loading={state.loading}
              error={state.error}
              getRowKey={(r) => r.node}
              emptyMessage="No node_status entries — HA manager has not reported node liveliness yet."
              skeletonRows={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service status</CardTitle>
            <CardDescription>Per-service CRM state keyed by SID (e.g. vm:100).</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<ServiceRow>
              columns={[
                { key: "service", header: "Service", render: (r) => <span className="font-mono text-xs">{r.service}</span> },
                { key: "node", header: "Node", render: (r) => r.node || "—" },
                { key: "status", header: "Status", render: (r) => <Badge variant="outline">{r.status}</Badge> },
                { key: "state", header: "State", className: "hidden md:table-cell", render: (r) => r.state || "—" },
                { key: "raw", header: "Raw", className: "hidden xl:table-cell max-w-64 truncate font-mono text-xs", render: (r) => <span title={r.raw} className="truncate">{r.raw.slice(0, 120)}</span> },
              ]}
              rows={serviceRows}
              loading={state.loading}
              error={state.error}
              getRowKey={(r) => r.service}
              emptyMessage="No service_status entries — no HA-managed guests reported."
              skeletonRows={3}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manager status</CardTitle>
              <CardDescription>manager_status blob (master, mode, timestamps).</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<KvRow>
                columns={[
                  { key: "key", header: "Key", render: (r) => <span className="font-mono text-xs">{r.key}</span> },
                  { key: "value", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{stringify(r.value)}</span> },
                ]}
                rows={kvManager}
                loading={state.loading}
                error={state.error}
                getRowKey={(r) => r.key}
                emptyMessage="No manager_status fields returned."
                skeletonRows={4}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quorum</CardTitle>
              <CardDescription>quorate / quorum blob from the HA manager.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<KvRow>
                columns={[
                  { key: "key", header: "Key", render: (r) => <span className="font-mono text-xs">{r.key}</span> },
                  { key: "value", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{stringify(r.value)}</span> },
                ]}
                rows={kvQuorum}
                loading={state.loading}
                error={state.error}
                getRowKey={(r) => r.key}
                emptyMessage="No quorum fields returned."
                skeletonRows={3}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/ha/manager-status</span> · infra-readable, 5s poll via{" "}
        <span className="font-mono">useInfraGet(..., {`{intervalMs: 5000}`})</span> · proxmox-only guard{" "}
        <span className="font-mono">proxmoxAdapterFor</span> (non-proxmox → <span className="font-mono">501 expect proxmox</span>) · SDK{" "}
        <span className="font-mono">GET /cluster/ha/status/manager_status</span> via <span className="font-mono">(*Cluster).HAManagerStatus</span>
      </p>
    </ProviderShell>
  )
}
