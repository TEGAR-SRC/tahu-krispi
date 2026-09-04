// VMware cluster detail — single cluster from vCenter inventory.
// Endpoint: GET /admin/vmware/:id/clusters/:cluster (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Route: /admin/vmware/:providerId/clusters/:cluster
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface ClusterDetailPayload {
  provider_id: string
  code: string
  cluster: string
  name: string
}

export default function VmwareClusterDetailPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const cluster = (params.cluster ?? "") as string
  const decodedCluster = useMemo(() => {
    try { return decodeURIComponent(cluster) } catch { return cluster }
  }, [cluster])

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const detail = useInfraGet<ClusterDetailPayload>(
    providerId && cluster && isVmware ? `/admin/vmware/${providerId}/clusters/${encodeURIComponent(decodedCluster)}` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (!providerId || !cluster) {
    return (
      <ProviderShell providerId={providerId} title="VMware cluster detail" description="Single vSphere cluster from inventory.">
        <ErrorBanner error={new Error("Missing providerId or cluster in route params")} />
      </ProviderShell>
    )
  }

  if (detail.error instanceof ApiError && detail.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware cluster detail" description="Single vSphere cluster from inventory.">
        <EmptyState
          message="Cluster detail is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET /v1/admin/vmware/:id/clusters/:cluster."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — cluster detail at{" "}
              <span className="font-mono">/admin/vmware/:id/clusters/:cluster</span> requires{" "}
              <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const row = detail.data ?? null

  return (
    <ProviderShell providerId={providerId} title={`VMware cluster — ${decodedCluster}`} description={`Detail for cluster ${decodedCluster} via GET /v1/admin/vmware/:id/clusters/:cluster — polling every 5s.`}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/clusters/:cluster</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — cluster detail at /admin/vmware/:id/clusters/:cluster answers 501 for non-vmware kinds.`} />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — cluster detail answers HTTP 503 until an API key is configured via the provider editor.
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
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/hosts`}>Hosts</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/clusters/:cluster</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>.
            </span>
          </div>

          <ErrorBanner error={detail.error} />

          {detail.loading ? (
            <p className="text-sm text-muted-foreground">Loading cluster…</p>
          ) : detail.error ? null : row ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cluster — {row.cluster || row.name || decodedCluster}</CardTitle>
                  <CardDescription>Raw cluster name from InventoryReport.Clusters.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SimpleDataTable<Record<string, string>>
                    columns={[
                      { key: "k", header: "Field" },
                      { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs">{r.v}</span> },
                    ]}
                    rows={[
                      { k: "name", v: row.cluster || row.name || decodedCluster || "—" },
                      { k: "provider_id", v: row.provider_id || "—" },
                      { k: "code", v: row.code || "—" },
                    ]}
                    getRowKey={(r) => r.k}
                    emptyMessage="No fields."
                    skeletonRows={3}
                  />
                  <JsonBlock value={row} />
                </CardContent>
              </Card>
              <JsonBlock value={detail.data} />
            </>
          ) : (
            <EmptyState message="Cluster not found." description={`No cluster named ${decodedCluster} in inventory for this provider.`} />
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
