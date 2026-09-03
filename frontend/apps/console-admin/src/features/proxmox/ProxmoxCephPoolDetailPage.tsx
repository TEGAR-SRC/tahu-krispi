import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type CephPoolStatus = {
  name?: string
  id?: number
  size?: number
  min_size?: number
  pg_num?: number
  pgp_num?: number
  pg_num_min?: number
  pg_autoscale_mode?: string
  crush_rule?: string
  application?: string
  application_list?: string[]
  hashpspool?: boolean
  use_gmt_hitset?: boolean
  fast_read?: boolean
  nodeep_scrub?: boolean
  nodelete?: boolean
  nopgchange?: boolean
  noscrub?: boolean
  nosizechange?: boolean
  target_size?: string
  target_size_ratio?: number
  statistics?: Record<string, unknown>
  autoscale_status?: Record<string, unknown>
  [k: string]: unknown
}

type CephPoolDetailEnvelope = {
  node: string
  pool: string
  status: CephPoolStatus
}

type KvRow = { key: string; value: unknown }

function toRows(obj: Record<string, unknown> | null | undefined, exclude: Set<string>): KvRow[] {
  if (!obj || typeof obj !== "object") return []
  return Object.entries(obj)
    .filter(([k]) => !exclude.has(k))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v === "" ? "—" : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const EXCLUDE_FROM_CONFIG = new Set(["statistics", "autoscale_status"])
const EXCLUDE_FROM_STATS = new Set<string>([])

export default function ProxmoxCephPoolDetailPage() {
  const { providerId = "", pool = "" } = useParams<{ providerId: string; pool: string }>()
  const [nodeOverride, setNodeOverride] = useState("")
  const [verbose, setVerbose] = useState(true)

  const trimmedPool = pool.trim()
  const trimmedNode = nodeOverride.trim()

  const query = useMemo(() => {
    const q: Record<string, string> = {}
    if (trimmedNode) q.node = trimmedNode
    q.verbose = verbose ? "1" : "0"
    return q
  }, [trimmedNode, verbose])

  const path = providerId && trimmedPool ? `/admin/proxmox/${providerId}/ceph/pools/${encodeURIComponent(trimmedPool)}` : null
  const state = useInfraGet<CephPoolDetailEnvelope>(path, query, { intervalMs: 5000 })

  const envelope = state.data ?? null
  const status: CephPoolStatus | null = (envelope?.status as CephPoolStatus | undefined) ?? (state.data as unknown as CephPoolStatus | null) ?? null
  // Backend returns {node, pool, status}; unwrap defensively if status is top-level already
  const resolvedStatus: CephPoolStatus | null = (() => {
    if (!envelope && !state.data) return null
    if (envelope && envelope.status && typeof envelope.status === "object") return envelope.status as CephPoolStatus
    if (status && typeof status === "object" && (status as Record<string, unknown>).name !== undefined) return status
    return null
  })()

  const configRows = useMemo(() => toRows(resolvedStatus as unknown as Record<string, unknown>, EXCLUDE_FROM_CONFIG), [resolvedStatus])
  const stats = (resolvedStatus?.statistics ?? null) as Record<string, unknown> | null
  const statsRows = useMemo(() => toRows(stats, EXCLUDE_FROM_STATS), [stats])
  const autoscale = (resolvedStatus?.autoscale_status ?? null) as Record<string, unknown> | null
  const autoscaleRows = useMemo(() => toRows(autoscale, new Set()), [autoscale])

  if (!providerId || !trimmedPool) {
    return (
      <ProviderShell providerId={providerId || ""} title="Ceph pool detail" description="Per-pool Ceph status for this Proxmox cluster.">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Missing route params</CardTitle>
            <CardDescription>providerId and pool are required — expected /admin/proxmox/:id/ceph/pools/:pool.</CardDescription>
          </CardHeader>
        </Card>
      </ProviderShell>
    )
  }

  const effectiveNode = (envelope?.node as string | undefined) ?? trimmedNode ?? "—"

  return (
    <ProviderShell
      providerId={providerId}
      title={`Ceph pool — ${trimmedPool}`}
      description={`GET /admin/proxmox/:id/ceph/pools/:pool (proxmox-only via proxmoxAdapterFor, infra-readable). Node ${effectiveNode} · pool ${trimmedPool} — polled every 5s via useInfraGet.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
          Refresh
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lookup</CardTitle>
          <CardDescription>
            PVE address is node-scoped (<span className="font-mono">/nodes/{"{node}"}/ceph/pool/{"{pool}"}/status</span>). Leave node empty to use the
            first online node (like <span className="font-mono">GET /admin/proxmox/:id/cpu-models</span>). Verbose includes{" "}
            <span className="font-mono">statistics</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="ceph-pool-node">Node (optional)</Label>
            <Input id="ceph-pool-node" value={nodeOverride} onChange={(e) => setNodeOverride(e.target.value)} placeholder="pve-01 (empty = first online)" className="font-mono" />
            <p className="text-xs text-muted-foreground">Query param <span className="font-mono">?node=</span> — omit to auto-pick.</p>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="ceph-pool-verbose" checked={verbose} onCheckedChange={setVerbose} />
            <Label htmlFor="ceph-pool-verbose" className="cursor-pointer">Verbose</Label>
            <span className="text-xs text-muted-foreground">?verbose=1</span>
          </div>
          <div className="pb-2 text-xs text-muted-foreground">
            Effective: <span className="font-mono">/admin/proxmox/{providerId.slice(0, 8)}/ceph/pools/{trimmedPool}</span>
            {trimmedNode ? `?node=${trimmedNode}` : ""} {verbose ? (trimmedNode ? "&verbose=1" : "?verbose=1") : ""}
          </div>
        </CardContent>
      </Card>

      {state.error ? <ErrorBanner error={state.error} /> : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>
          Node: <span className="font-mono text-foreground">{effectiveNode}</span>
        </span>
        <span>·</span>
        <span>
          Pool: <span className="font-mono text-foreground">{trimmedPool}</span>
        </span>
        <span>·</span>
        <span>
          Polled 5s via <span className="font-mono">useInfraGet</span>
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pool config</CardTitle>
          <CardDescription>
            GET <span className="font-mono">/admin/proxmox/:id/ceph/pools/:pool</span> → <span className="font-mono">status</span> (id, size, pg_num, crush_rule,
            application …). Infra-readable (NOC + platform_admin), proxmox murni (non-proxmox → 501 expect proxmox).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <SimpleDataTable<KvRow>
            columns={[
              { key: "key", header: "Key", render: (r) => <span className="font-mono text-xs font-medium">{r.key}</span> },
              {
                key: "value",
                header: "Value",
                render: (r) => <span className="whitespace-pre-wrap break-words font-mono text-xs">{stringify(r.value)}</span>,
              },
            ]}
            rows={configRows}
            loading={state.loading}
            error={null}
            getRowKey={(r) => r.key}
            emptyMessage={state.loading ? "Loading pool status…" : "No config returned — pool may not exist or Ceph is not enabled on this node."}
            skeletonRows={8}
          />
        </CardContent>
      </Card>

      <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statistics {verbose ? "(verbose=1)" : "(verbose=0 — toggle on)"}</CardTitle>
            <CardDescription>
              <span className="font-mono">status.statistics</span> — bytes_used, percent_used, pg_num history. Only present when verbose=1.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-6">
            <SimpleDataTable<KvRow>
              columns={[
                { key: "key", header: "Metric", render: (r) => <span className="font-mono text-xs">{r.key}</span> },
                { key: "value", header: "Value", render: (r) => <span className="whitespace-pre-wrap break-words font-mono text-xs">{stringify(r.value)}</span> },
              ]}
              rows={statsRows}
              loading={state.loading}
              error={null}
              getRowKey={(r) => r.key}
              emptyMessage={verbose ? "No statistics — Ceph may not report usage for this pool." : "Enable verbose to fetch statistics."}
              skeletonRows={4}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Autoscale status</CardTitle>
            <CardDescription>
              <span className="font-mono">status.autoscale_status</span> — pg_num target vs current, would-be pg_num.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-6">
            <SimpleDataTable<KvRow>
              columns={[
                { key: "key", header: "Field", render: (r) => <span className="font-mono text-xs">{r.key}</span> },
                { key: "value", header: "Value", render: (r) => <span className="whitespace-pre-wrap break-words font-mono text-xs">{stringify(r.value)}</span> },
              ]}
              rows={autoscaleRows}
              loading={state.loading}
              error={null}
              getRowKey={(r) => r.key}
              emptyMessage="No autoscale_status — pgs may be manually fixed or Ceph is not autoscaling this pool."
              skeletonRows={3}
            />
          </CardContent>
        </Card>
      </div>

      {resolvedStatus ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Raw payload</summary>
          <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(envelope ?? state.data, null, 2)}
          </pre>
        </details>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/ceph/pools/:pool?node=&amp;verbose=</span> · requireStaff infra (NOC + platform_admin) · proxmox murni
        (proxmoxAdapterFor → 501 expect proxmox) · 5s poll via <span className="font-mono">useInfraGet(..., {"{ intervalMs: 5000 }"})</span>
      </p>
    </ProviderShell>
  )
}
