// VMware host detail — single ESXi host from vCenter inventory.
// Endpoint: GET /admin/vmware/:id/hosts/:host (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Route: /admin/vmware/:providerId/hosts/:host
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
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface HostDetail {
  name: string
  cpu_threads: number
  memory_bytes: number
  power_state: string
}

interface HostDetailPayload {
  provider_id: string
  code: string
  host: HostDetail
}

export default function VmwareHostDetailPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const host = (params.host ?? "") as string
  const decodedHost = useMemo(() => {
    try { return decodeURIComponent(host) } catch { return host }
  }, [host])

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const detail = useInfraGet<HostDetailPayload>(
    providerId && host && isVmware ? `/admin/vmware/${providerId}/hosts/${encodeURIComponent(decodedHost)}` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (!providerId || !host) {
    return (
      <ProviderShell providerId={providerId} title="VMware host detail" description="Single ESXi host from vCenter inventory.">
        <ErrorBanner error={new Error("Missing providerId or host in route params")} />
      </ProviderShell>
    )
  }

  if (detail.error instanceof ApiError && detail.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware host detail" description="Single ESXi host from vCenter inventory.">
        <EmptyState
          message="Host detail is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET /v1/admin/vmware/:id/hosts/:host."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — host detail at{" "}
              <span className="font-mono">/admin/vmware/:id/hosts/:host</span> requires{" "}
              <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const row = detail.data?.host ?? null

  return (
    <ProviderShell providerId={providerId} title={`VMware host — ${decodedHost}`} description={`Detail for ESXi host ${decodedHost} via GET /v1/admin/vmware/:id/hosts/:host — polling every 5s.`}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/hosts/:host</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — host detail at /admin/vmware/:id/hosts/:host answers 501 for non-vmware kinds.`} />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — host detail answers HTTP 503 until an API key is configured via the provider editor.
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
              <Link to={`/admin/vmware/${providerId}/datastores`}>Datastores</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/hosts/:host</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>.
            </span>
          </div>

          <ErrorBanner error={detail.error} />

          {detail.loading ? (
            <p className="text-sm text-muted-foreground">Loading host…</p>
          ) : detail.error ? null : row ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Host — {row.name || decodedHost}</CardTitle>
                  <CardDescription>Raw ESXi host record from InventoryReport.Hosts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                      <dd className="font-mono text-xs">{row.name || "—"}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">CPU threads</dt>
                      <dd className="font-mono text-xs">{row.cpu_threads ?? "—"}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Memory</dt>
                      <dd className="font-mono text-xs">{formatBytes(row.memory_bytes)}</dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium text-muted-foreground">Power</dt>
                      <dd>
                        <Badge variant={row.power_state === "poweredOn" ? "secondary" : "outline"}>{row.power_state || "—"}</Badge>
                      </dd>
                    </div>
                  </dl>
                  <SimpleDataTable<Record<string, string>>
                    columns={[
                      { key: "k", header: "Field" },
                      { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs">{r.v}</span> },
                    ]}
                    rows={[
                      { k: "name", v: row.name || "—" },
                      { k: "cpu_threads", v: String(row.cpu_threads ?? "—") },
                      { k: "memory_bytes", v: String(row.memory_bytes ?? "—") + (row.memory_bytes ? ` (${formatBytes(row.memory_bytes)})` : "") },
                      { k: "power_state", v: row.power_state || "—" },
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
            <EmptyState message="Host not found." description={`No host named ${decodedHost} in inventory for this provider.`} />
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
