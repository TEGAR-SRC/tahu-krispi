// Onidel billing sync — POST /admin/onidel/:id/catalog/sync enqueues catalog sync (worker provider_sync).
// Also keeps /regions/sync as alias (same worker job). Mirrors proxmox clone / vmware migrate:
// ProviderShell + useInfraGet polling 5000 + SimpleDataTable.
// GET sources: /admin/onidel/:id/catalog (infra, polling 5s) + /admin/onidel/:id/health (infra, polling 5s).
// POST sync: /admin/onidel/:id/catalog/sync (platform_admin only, onidelAdapterFor kind==onidel guard).
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

interface CatalogLocation {
  code?: string
  Code?: string
  name?: string
  Name?: string
}

interface CatalogInstanceType {
  code?: string
  Code?: string
  max_vcpu?: number
  MaxVCPU?: number
  max_ram_mb?: number
  MaxRAM?: number
  max_disk_gb?: number
  MaxDisk?: number
}

interface CatalogOSTemplate {
  name?: string
  Name?: string
  family?: string
  Family?: string
}

interface OnidelCatalogPayload {
  provider_id: string
  code: string
  regions: CatalogLocation[]
  instance_types: CatalogInstanceType[]
  os_templates: CatalogOSTemplate[]
}

interface HealthPayload {
  provider_id: string
  code: string
  enabled: boolean
  health_status: string
  api_base_url: string
  live: string
  latency_ms?: number
  error?: string
}

function locCode(r: CatalogLocation): string {
  return String(r.code ?? r.Code ?? "")
}

function locName(r: CatalogLocation): string {
  return String(r.name ?? r.Name ?? "")
}

export default function OnidelBillingSyncPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const base = `/admin/onidel/${providerId}`

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(
    () => providers.data?.find((row) => row.id === providerId) ?? null,
    [providers.data, providerId],
  )
  const isOnidel = !match || match.kind === "onidel"
  const kindMismatch = Boolean(match && match.kind !== "onidel")

  const catalog = useInfraGet<OnidelCatalogPayload>(
    providerId && isOnidel ? `${base}/catalog` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const health = useInfraGet<HealthPayload>(
    providerId && isOnidel ? `${base}/health` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState<unknown>(null)
  const [lastJob, setLastJob] = useState<{ job_id: string } | null>(null)

  const regions = Array.isArray(catalog.data?.regions) ? catalog.data!.regions : []
  const typesCount = Array.isArray(catalog.data?.instance_types) ? catalog.data!.instance_types.length : 0
  const templatesCount = Array.isArray(catalog.data?.os_templates) ? catalog.data!.os_templates.length : 0

  const canSync = Boolean(providerId) && !busy && !kindMismatch

  const onSync = async () => {
    if (!canSync) return
    setBusy(true)
    setSyncError(null)
    try {
      const res = await apiPost<{ job_id: string; provider_id: string; code: string; status: string }>(
        `${base}/catalog/sync`,
      )
      const jobId = String((res.data as unknown as Record<string, unknown>).job_id ?? "")
      if (jobId) setLastJob({ job_id: jobId })
      toast.success(`Catalog sync queued — job ${jobId.slice(0, 8)}…`)
      catalog.reload()
      health.reload()
    } catch (cause) {
      setSyncError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Sync failed")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Onidel billing sync" description="Per-provider catalog sync via worker — POST /admin/onidel/:id/catalog/sync.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (catalog.error instanceof ApiError && catalog.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Onidel billing sync" description="Per-provider catalog sync via worker — POST /admin/onidel/:id/catalog/sync.">
        <EmptyState
          message="Billing sync is only available for onidel providers."
          description="This provider runs another platform (the API answered HTTP 501 via onidelAdapterFor kind guard kind==onidel). Use Proxmox/VMware consoles for those kinds, or switch to an onidel provider and retry POST /v1/admin/onidel/:id/catalog/sync."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — sync at{" "}
              <span className="font-mono">/admin/onidel/:id/catalog/sync</span> requires{" "}
              <span className="font-mono">kind=onidel</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel billing sync"
      description="POST /admin/onidel/:id/catalog/sync — enqueues provider_sync (catalog sync) for this onidel provider via onidelAdapterFor guard. GET /catalog + GET /health poll every 5s (infra, NOC readable); POST is platform_admin only."
      actions={
        <Button variant="outline" size="sm" onClick={() => catalog.reload()} disabled={catalog.loading}>
          {catalog.loading ? "Refreshing…" : "Refresh catalog"}
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
              <Badge variant={isOnidel ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant="outline">{match.health_status || "unknown"}</Badge>
              {lastJob ? <Badge variant="secondary">job {lastJob.job_id.slice(0, 8)}…</Badge> : null}
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)} · endpoint{" "}
              <span className="font-mono">POST /v1/admin/onidel/:id/catalog/sync</span> (alias{" "}
              <span className="font-mono">/regions/sync</span>) — RBAC{" "}
              <span className="font-mono">requireStaff ""</span> (platform_admin only, NOC 403) · catalog{" "}
              <span className="font-mono">GET /v1/admin/onidel/:id/catalog</span> + health{" "}
              <span className="font-mono">GET /v1/admin/onidel/:id/health</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not onidel."
                description={`Kind is ${match.kind} — sync at /admin/onidel/:id/catalog/sync answers 501 for non-onidel kinds (guard kind==onidel via onidelAdapterFor). Use the Proxmox or VMware trees for this provider, or the generic POST /admin/providers/:id/sync.`}
              />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live catalog answers HTTP 503 / provider_unavailable until an API key is configured via the provider editor (or ONIDEL_API_KEY env). POST /catalog/sync is still guard-checked via onidelAdapterFor and will 503 until configured.
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
              <CardTitle className="text-base">Catalog sync (billing)</CardTitle>
              <CardDescription>
                Trigger a durable <span className="font-mono">catalog / provider_sync</span> job for this provider — the worker calls{" "}
                <span className="font-mono">Adapter.SyncCatalog</span> then upserts{" "}
                <span className="font-mono">regions</span> (<span className="font-mono">provider_id, code</span>),{" "}
                <span className="font-mono">instance_types</span> and <span className="font-mono">os_templates</span> exactly like{" "}
                <span className="font-mono">POST /admin/providers/:id/sync</span>. Sync is idempotent; the dedicated{" "}
                <span className="font-mono">POST /admin/onidel/:id/catalog/sync</span> (alias{" "}
                <span className="font-mono">/regions/sync</span>) route is the per-provider, kind-guarded billing trigger the task
                requires. RBAC: <span className="font-mono">POST ""</span> → platform_admin only.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {syncError ? <ErrorBanner error={syncError} /> : null}
              {health.error ? <ErrorBanner error={health.error} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canSync} onClick={() => void onSync()}>
                  {busy ? "Queueing…" : "Sync catalog (POST /catalog/sync)"}
                </Button>
                <Button variant="outline" onClick={() => { catalog.reload(); health.reload() }} disabled={catalog.loading || health.loading}>
                  Reload catalog + health
                </Button>
                <span className="text-xs text-muted-foreground">
                  Calls <span className="font-mono">POST {base}/catalog/sync</span> → 202{" "}
                  <span className="font-mono">{"{job_id, provider_id, code, status: queued}"}</span> · worker queue{" "}
                  <span className="font-mono">catalog / provider_sync</span> · 501 if kind != onidel, 503 if not configured, 401/403 on auth/RBAC.
                </span>
              </div>
              {lastJob ? (
                <p className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                  Last queued job <span className="font-medium">{lastJob.job_id}</span> — track in{" "}
                  <span className="font-mono">/admin/jobs?queue=catalog</span> or{" "}
                  <span className="font-mono">/admin/onidel/{providerId}/jobs</span>.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">
                  Live catalog: {regions.length} region(s) · {typesCount} instance type(s) · {templatesCount} OS template(s).
                </span>
                {health.data ? (
                  <span className="flex items-center gap-1">
                    Health <Badge variant={health.data.live === "ok" ? "secondary" : health.data.live === "disabled" ? "outline" : "destructive"}>{health.data.live}</Badge>
                    {typeof health.data.latency_ms === "number" ? <span className="font-mono">{health.data.latency_ms}ms</span> : null}
                    <Badge variant="outline">{health.data.health_status || "unknown"}</Badge>
                  </span>
                ) : health.loading ? (
                  <span className="text-muted-foreground">Health polling…</span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Worker dedupes on <span className="font-mono">(provider_id, code)</span> for regions and{" "}
                <span className="font-mono">(provider_id, external_id)</span> for types/templates, stamping{" "}
                <span className="font-mono">last_synced_at</span>. Health polls{" "}
                <span className="font-mono">GET {base}/health</span> every 5000ms via{" "}
                <span className="font-mono">useInfraGet intervalMs: 5000</span>.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Health — live probe (polls every 5s)</CardTitle>
              <CardDescription>
                <span className="font-mono">GET {base}/health</span> — <span className="font-mono">useInfraGet intervalMs: 5000</span> (infra, NOC readable). Mirrors OnidelHealthDetailPage health polling.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {health.loading && !health.data ? (
                <p className="text-muted-foreground">Loading health…</p>
              ) : health.data ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">live</span>
                    <Badge variant={health.data.live === "ok" ? "secondary" : health.data.live === "disabled" ? "outline" : "destructive"}>{health.data.live}</Badge>
                    {typeof health.data.latency_ms === "number" ? <span className="font-mono">{health.data.latency_ms}ms</span> : null}
                    <span className="text-muted-foreground">health_status</span>
                    <Badge variant="outline">{health.data.health_status || "unknown"}</Badge>
                    <span className="text-muted-foreground">enabled</span>
                    <Badge variant={health.data.enabled ? "secondary" : "outline"}>{health.data.enabled ? "yes" : "no"}</Badge>
                  </div>
                  {health.data.error ? <p className="break-all text-destructive">{health.data.error}</p> : null}
                  {!health.data.error && health.data.live === "ok" ? <p className="text-emerald-600">Provider reachable — Onidel API answered.</p> : null}
                  <p className="font-mono text-muted-foreground break-all">{health.data.api_base_url || "—"}</p>
                </>
              ) : health.error ? (
                <ErrorBanner error={health.error} />
              ) : (
                <p className="text-muted-foreground">No health data — check provider id or credentials.</p>
              )}
            </CardContent>
          </Card>

          <ErrorBanner error={catalog.error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regions — live catalog (polls every 5s)</CardTitle>
              <CardDescription>
                Regions derived from <span className="font-mono">GET {base}/catalog</span> —{" "}
                <span className="font-mono">useInfraGet intervalMs: 5000</span> (like proxmox qemu / vmware migrate). Uses{" "}
                <span className="font-mono">ProviderShell</span> + <span className="font-mono">SimpleDataTable</span>.
                Trigger Sync above, then watch this table and <span className="font-mono">/admin/regions</span> converge once the worker finishes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<CatalogLocation>
                columns={[
                  { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{locCode(r) || "—"}</span> },
                  { key: "name", header: "Name", render: (r) => locName(r) || "—" },
                ]}
                rows={regions}
                loading={catalog.loading}
                error={null}
                getRowKey={(r, i) => locCode(r) || String(i)}
                emptyMessage="No regions returned — trigger Sync catalog or check provider credentials (HTTP 503 until API key is configured)."
                skeletonRows={4}
              />
              {!catalog.loading && !catalog.error && regions.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Empty catalog — verify the provider kind is onidel, credentials are set, and api.cloud.onidel.com is reachable. Both
                  POST /admin/onidel/:id/catalog/sync and POST /admin/onidel/:id/regions/sync enqueue the same provider_sync job.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What the sync does (for reviewers)</CardTitle>
              <CardDescription>Backend — adminOnidelCatalogSync via onidelAdapterFor + worker providerSync.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                <span className="font-mono font-medium">POST /v1/admin/onidel/:id/catalog/sync</span> (alias{" "}
                <span className="font-mono">/regions/sync</span>) — handler{" "}
                <span className="font-mono">adminOnidelCatalogSync</span> /{" "}
                <span className="font-mono">adminOnidelRegionsSync</span> in{" "}
                <span className="font-mono">backend/internal/api/handlers_onidel.go</span>, registered as{" "}
                <span className="font-mono">onidelAdmin.Post("/catalog/sync", requireStaff(""), …)</span> +{" "}
                <span className="font-mono">onidelAdmin.Post("/regions/sync", …)</span> in{" "}
                <span className="font-mono">backend/internal/api/server.go</span>. Validates{" "}
                <span className="font-mono">kind==onidel</span> via <span className="font-mono">onidelAdapterFor</span> (decrypts
                provider api_key, falls back to ONIDEL env, 501/503 otherwise), then{" "}
                <span className="font-mono">admEnqueueJob(catalog, provider_sync, provider, id, {"{provider_id}"})</span> → 202.
              </p>
              <p>
                Worker <span className="font-mono">cmd/worker providerSync</span> —{" "}
                <span className="font-mono">SyncCatalog</span> → upserts{" "}
                <span className="font-mono">regions(provider_id, code)</span> with{" "}
                <span className="font-mono">last_synced_at</span> plus{" "}
                <span className="font-mono">instance_types</span> and{" "}
                <span className="font-mono">os_templates</span>. Billing reads regions through{" "}
                <span className="font-mono">GET /admin/regions</span> / <span className="font-mono">GET /admin/providers</span> /{" "}
                <span className="font-mono">/billing/regions-pools</span>. Generic{" "}
                <span className="font-mono">POST /admin/providers/:id/sync</span> still works — this per-provider route is the onidel billing alias.
                Health polls <span className="font-mono">GET /admin/onidel/:id/health</span> every 5s via{" "}
                <span className="font-mono">useInfraGet intervalMs: 5000</span> on this page.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </ProviderShell>
  )
}
