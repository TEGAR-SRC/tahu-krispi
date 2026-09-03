import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "../shared"
import { useInfraGet } from "./infra"
import { ProviderShell } from "./shared"
import type { ProviderRow } from "./types"

interface CatalogLocation {
  code: string
  name: string
  enabled?: boolean
  region?: string
}

interface CatalogInstanceType {
  code: string
  name: string
  max_vcpu: number
  max_ram_mb: number
  max_disk_gb: number
  cpu?: number
  ram_mb?: number
  disk_gb?: number
}

interface CatalogOSTemplate {
  name: string
  family: string
  code?: string
}

interface OnidelCatalogPayload {
  provider_id: string
  code: string
  regions: CatalogLocation[]
  instance_types: CatalogInstanceType[]
  os_templates: CatalogOSTemplate[]
}

interface OnidelHealthPayload {
  provider_id: string
  code: string
  enabled: boolean
  health_status: string
  api_base_url: string
  live: string
  latency_ms?: number
  error?: string
}

export default function OnidelCatalog() {
  const providerId = useParams().providerId ?? ""
  const catalog = useInfraGet<OnidelCatalogPayload>(providerId ? `/admin/onidel/${providerId}/catalog` : null)
  const health = useInfraGet<OnidelHealthPayload>(providerId ? `/admin/onidel/${providerId}/health` : null)
  const provider = useInfraGet<ProviderRow[]>(`/admin/providers`)
  const match = provider.data?.find((r) => r.id === providerId) ?? null
  const [busy, setBusy] = useState<string | null>(null)

  if (catalog.error instanceof ApiError && catalog.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Onidel catalog" description="Per-provider live catalog — regions, instance types & OS templates.">
        <EmptyState
          message="Catalog is only available for onidel providers."
          description="This provider runs another platform (API answered HTTP 501). Use the Proxmox / VMware / Dokploy consoles for that kind."
        />
      </ProviderShell>
    )
  }

  const runAction = async (key: string, path: string, success: string) => {
    setBusy(key)
    try {
      await apiPost(path)
      toast.success(success)
      catalog.reload()
      health.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(null)
    }
  }

  const regions = catalog.data?.regions ?? []
  const types = catalog.data?.instance_types ?? []
  const templates = catalog.data?.os_templates ?? []
  const isInfraError = catalog.error instanceof ApiError && (catalog.error.status === 403 || catalog.error.status === 503)
  const healthLive = health.data?.live ?? "—"

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel catalog"
      description="Per-provider live catalog from api.cloud.onidel.com via GET /admin/onidel/:id/catalog · health via GET /admin/onidel/:id/health · NOC read-only (infra), mutations platform_admin only."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !providerId}
            onClick={() => void runAction("test", `/admin/providers/${providerId}/test`, "Connection test OK")}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !providerId}
            onClick={() => void runAction("sync", `/admin/providers/${providerId}/sync`, "Sync queued")}
          >
            {busy === "sync" ? "Queueing…" : "Sync catalog"}
          </Button>
        </div>
      }
    >
      {provider.error ? <ErrorBanner error={provider.error} /> : null}
      {catalog.error && !isInfraError ? <ErrorBanner error={catalog.error} /> : null}
      {health.error ? <ErrorBanner error={health.error} /> : null}

      {isInfraError ? (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <CardContent className="pt-4 text-sm text-amber-900 dark:text-amber-100">
            {catalog.error instanceof ApiError && catalog.error.status === 403
              ? "You do not have access to this provider (finance/billing roles cannot read infra). Switch to a platform_admin or NOC account."
              : "Provider has no stored credentials or is disabled — live catalog answers HTTP 503 until an API key is configured on the Providers page."}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Provider</CardTitle>
            <CardDescription>{match ? `${match.code} · ${match.kind}` : providerId.slice(0, 8)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {provider.loading ? (
              <Skeleton className="h-16 w-full" />
            ) : match ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{match.kind}</Badge>
                  {match.enabled ? <StatusBadge status="active" /> : <StatusBadge status="disabled" />}
                  <StatusBadge status={match.health_status} />
                  {health.data ? <Badge variant={healthLive === "ok" ? "secondary" : healthLive === "disabled" ? "outline" : "destructive"}>{healthLive}</Badge> : null}
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">{match.api_base_url || "—"}</p>
                <p className="text-xs text-muted-foreground">{match.has_credentials ? "credentials configured" : "no credentials stored"}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Provider not found in registry.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Health probe</CardTitle>
            <CardDescription>GET /admin/onidel/:id/health — live via Onidel adapter (infra = NOC readable).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {health.loading ? (
              <Skeleton className="h-16 w-full" />
            ) : health.data ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">enabled</span>
                  <Badge variant={health.data.enabled ? "secondary" : "outline"}>{health.data.enabled ? "yes" : "no"}</Badge>
                  <span className="text-xs text-muted-foreground">health_status</span>
                  <StatusBadge status={health.data.health_status} />
                </div>
                <p className="text-xs">
                  live: <span className="font-medium">{healthLive}</span>
                  {typeof health.data.latency_ms === "number" ? ` · ${health.data.latency_ms}ms` : ""}
                </p>
                {health.data.error ? <p className="break-all text-xs text-destructive">{health.data.error}</p> : null}
                <p className="break-all font-mono text-xs text-muted-foreground">{health.data.api_base_url || "—"}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Health not available.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Access</CardTitle>
            <CardDescription>RBAC · hide/show via provider enabled flag.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="font-medium">platform_admin</span> — GET + POST/Sync/Test, PUT hide/show (enabled), DELETE, attach to org.
            </p>
            <p>
              <span className="font-medium">NOC (infra)</span> — GET catalog & health only.
            </p>
            <p>
              <span className="font-medium">finance (billing)</span> — no infra access; manage products/plans via /admin/billing.
            </p>
            <p className="text-xs text-muted-foreground">Attach to org: PUT /admin/organizations/:org_id/provider-account (infra → platform_admin only via staffAreaFor mutation guard). Hide/show: POST /admin/providers upsert enabled=false.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regions (available datacenters)</CardTitle>
          <CardDescription>
            {catalog.loading ? "Loading…" : `${regions.length} region(s) from live Onidel catalog`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<CatalogLocation>
            columns={[
              { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code || "—"}</span> },
              { key: "name", header: "Name", render: (r) => r.name || "—" },
              { key: "enabled", header: "Enabled", render: (r) => <Badge variant={r.enabled ? "secondary" : "outline"}>{r.enabled ? "yes" : "no"}</Badge> },
            ]}
            rows={regions}
            loading={catalog.loading}
            error={null}
            getRowKey={(r, i) => String(r.code ?? i)}
            emptyMessage="No regions returned — trigger Sync catalog or check provider credentials."
            skeletonRows={4}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instance types</CardTitle>
          <CardDescription>{catalog.loading ? "Loading…" : `${types.length} type(s) · vCPU / RAM / Disk from live catalog`}</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<CatalogInstanceType>
            columns={[
              { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code || "—"}</span> },
              { key: "name", header: "Name", render: (r) => r.name || "—" },
              {
                key: "max_vcpu",
                header: "vCPU",
                render: (r) => String(r.max_vcpu ?? r.cpu ?? "—"),
              },
              {
                key: "max_ram_mb",
                header: "RAM (MB)",
                render: (r) => String(r.max_ram_mb ?? r.ram_mb ?? "—"),
              },
              {
                key: "max_disk_gb",
                header: "Disk (GB)",
                render: (r) => String(r.max_disk_gb ?? r.disk_gb ?? "—"),
              },
            ]}
            rows={types}
            loading={catalog.loading}
            error={null}
            getRowKey={(r, i) => String(r.code ?? i)}
            emptyMessage="No instance types returned."
            skeletonRows={4}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">OS templates</CardTitle>
          <CardDescription>{catalog.loading ? "Loading…" : `${templates.length} template(s) · family grouping`}</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<CatalogOSTemplate>
            columns={[
              { key: "name", header: "Template", render: (r) => r.name || r.code || "—" },
              { key: "family", header: "Family", render: (r) => <Badge variant="outline">{r.family || "—"}</Badge> },
            ]}
            rows={templates}
            loading={catalog.loading}
            error={null}
            getRowKey={(r, i) => String(r.name ?? r.code ?? i)}
            emptyMessage="No OS templates returned."
            skeletonRows={4}
          />
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
