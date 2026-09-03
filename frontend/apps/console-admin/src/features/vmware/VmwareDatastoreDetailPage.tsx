// VMware datastore detail — single datastore from vCenter inventory.
// Endpoint: GET /admin/vmware/:id/datastores/:ds (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Route: /admin/vmware/:providerId/datastores/:ds
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface DatastoreDetail {
  name: string
  type?: string
  capacity_bytes?: number
  capacity?: number
  free_bytes?: number
  freeBytes?: number
  free_space?: number
}

interface DatastoreDetailPayload {
  provider_id: string
  code: string
  datastore: DatastoreDetail
}

function getCapacity(row: DatastoreDetail): number | undefined {
  if (typeof row.capacity_bytes === "number") return row.capacity_bytes
  if (typeof row.capacity === "number") return row.capacity
  return undefined
}

function getFree(row: DatastoreDetail): number | undefined {
  if (typeof row.free_bytes === "number") return row.free_bytes
  if (typeof row.freeBytes === "number") return row.freeBytes
  if (typeof (row as unknown as Record<string, unknown>).free_space === "number") return (row as unknown as Record<string, unknown>).free_space as number
  return undefined
}

export default function VmwareDatastoreDetailPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const ds = (params.ds ?? (params as Record<string, string>).datastore ?? "") as string
  const decodedDs = useMemo(() => {
    try {
      return decodeURIComponent(ds)
    } catch {
      return ds
    }
  }, [ds])

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const detail = useInfraGet<DatastoreDetailPayload>(
    providerId && ds && isVmware ? `/admin/vmware/${providerId}/datastores/${encodeURIComponent(decodedDs)}` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (!providerId || !ds) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastore detail" description="Single datastore from vCenter inventory.">
        <ErrorBanner error={new Error("Missing providerId or ds in route params")} />
      </ProviderShell>
    )
  }

  if (detail.error instanceof ApiError && detail.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastore detail" description="Single datastore from vCenter inventory.">
        <EmptyState
          message="Datastore detail is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET /v1/admin/vmware/:id/datastores/:ds."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — datastore detail at{" "}
              <span className="font-mono">/admin/vmware/:id/datastores/:ds</span> requires{" "}
              <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const row = detail.data?.datastore ?? null
  const cap = row ? getCapacity(row) : undefined
  const free = row ? getFree(row) : undefined
  const usedPct = typeof cap === "number" && typeof free === "number" && cap > 0 ? ((cap - free) / cap) * 100 : 0
  const freePct = typeof cap === "number" && typeof free === "number" && cap > 0 ? (free / cap) * 100 : null

  return (
    <ProviderShell
      providerId={providerId}
      title={`VMware datastore — ${decodedDs}`}
      description={`Detail for datastore ${decodedDs} via GET /v1/admin/vmware/:id/datastores/:ds — polling every 5s.`}
    >
      {providers.error ? <ErrorBanner error={providers.error} /> : null}

      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={isVmware ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant="outline">{match.health_status || "unknown"}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)} · endpoint{" "}
              <span className="font-mono">GET /v1/admin/vmware/:id/datastores/:ds</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — datastore detail at /admin/vmware/:id/datastores/:ds answers 501 for non-vmware kinds.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — datastore detail answers HTTP 503 until an API key is configured via the provider editor.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => detail.reload()} disabled={detail.loading}>
              {detail.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/datastores`}>Datastores</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/datastores/:ds</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>.
            </span>
          </div>

          <ErrorBanner error={detail.error} />

          {detail.loading ? (
            <p className="text-sm text-muted-foreground">Loading datastore…</p>
          ) : detail.error ? null : row ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Datastore — {row.name || decodedDs}</CardTitle>
                  <CardDescription>Raw datastore record from InventoryReport.Datastores via /datastores/:ds projection.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                      <dd className="font-mono text-xs">{row.name || "—"}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Type</dt>
                      <dd className="font-mono text-xs">{row.type || "—"}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Capacity</dt>
                      <dd className="font-mono text-xs">{formatBytes(cap)}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Free</dt>
                      <dd className="font-mono text-xs">
                        {formatBytes(free)}
                        {freePct !== null ? ` (${freePct.toFixed(0)}%)` : ""}
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Usage</span>
                      <span className="font-mono">{usedPct.toFixed(1)}% used</span>
                    </div>
                    <Progress value={usedPct} className="h-2" />
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatBytes(cap !== undefined && free !== undefined ? cap - free : undefined)} used · {formatBytes(free)} free ·{" "}
                      {formatBytes(cap)} total
                    </p>
                  </div>

                  <SimpleDataTable<Record<string, string>>
                    columns={[
                      { key: "k", header: "Field" },
                      { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs">{r.v}</span> },
                    ]}
                    rows={[
                      { k: "name", v: row.name || "—" },
                      { k: "type", v: row.type || "—" },
                      { k: "capacity_bytes", v: cap !== undefined ? `${cap} (${formatBytes(cap)})` : "—" },
                      { k: "free_bytes", v: free !== undefined ? `${free} (${formatBytes(free)})` : "—" },
                      { k: "used_bytes", v: cap !== undefined && free !== undefined ? `${cap - free} (${formatBytes(cap - free)})` : "—" },
                      { k: "usage", v: usedPct ? `${usedPct.toFixed(1)}%` : "—" },
                    ]}
                    getRowKey={(r) => r.k}
                    emptyMessage="No fields."
                    skeletonRows={4}
                  />
                  <JsonBlock value={row} />
                </CardContent>
              </Card>
              <JsonBlock value={detail.data} />
            </>
          ) : (
            <EmptyState message="Datastore not found." description={`No datastore named ${decodedDs} in inventory for this provider.`} />
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
