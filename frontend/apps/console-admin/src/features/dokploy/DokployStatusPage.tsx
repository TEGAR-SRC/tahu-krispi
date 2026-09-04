// Dokploy status — GET infra polling 5s + POST platform_admin test
// Route: /admin/dokploy/:providerId/status (per-provider, murni dokploy, single instance via ProviderShell)
// Backend: POST /admin/providers/:id/test untuk code=dokploy pakai dokploy.NewClientFromDB → GET project.all (bukan provider.Lookup)
// Frontend contract: ProviderShell + useInfraGet intervalMs 5000 (surgical minimal, tsc lolos) like proxmox/onidel/vmware.
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

interface TestPayload {
  code: string
  kind: string
  status: string
  latency_ms: number
}

export default function DokployStatusPage() {
  const params = useParams()
  const routeProviderId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string

  const providersState = useInfraGet<ProviderRow[]>("/admin/providers", undefined, { intervalMs: 5000 })
  const providers = providersState.data ?? []

  const resolvedProviderId = useMemo(() => {
    if (routeProviderId) return routeProviderId
    const dokploy = providers.find((p) => p.code === "dokploy" || p.kind === "dokploy")
    return dokploy?.id ?? ""
  }, [routeProviderId, providers])

  const providerId = routeProviderId || resolvedProviderId
  const match = useMemo(
    () => providers.find((row) => row.id === providerId) ?? null,
    [providers, providerId],
  )
  const isDokploy = !match || match.kind === "dokploy" || match.code === "dokploy"
  const kindMismatch = Boolean(match && match.kind !== "dokploy" && match.code !== "dokploy")

  const [testResult, setTestResult] = useState<TestPayload | null>(null)
  const [testError, setTestError] = useState<unknown>(null)
  const [testing, setTesting] = useState(false)

  const onTest = async () => {
    if (!providerId) {
      toast.error("Provider id missing")
      return
    }
    setTesting(true)
    setTestError(null)
    try {
      const res = await apiPost<TestPayload>(`/admin/providers/${providerId}/test`)
      const payload = (res as unknown as { data: TestPayload }).data ?? (res as unknown as TestPayload)
      const normalized = (payload as TestPayload)?.status ? (payload as TestPayload) : null
      setTestResult(normalized ?? (payload as TestPayload))
      toast.success(`Test ok — ${normalized?.code ?? match?.code ?? "dokploy"} · ${normalized?.latency_ms ?? "?"}ms`)
    } catch (cause) {
      setTestError(cause)
      setTestResult(null)
      toast.error(cause instanceof ApiError ? cause.message : "Test failed")
    } finally {
      setTesting(false)
    }
  }

  if (!providerId && providersState.loading) {
    return (
      <ProviderShell providerId={providerId || "—"} title="Dokploy status" description="GET /admin/providers polled every 5s via useInfraGet (infra, NOC readable).">
        <p className="text-sm text-muted-foreground">Resolving dokploy provider…</p>
      </ProviderShell>
    )
  }

  if (!providerId) {
    return (
      <ProviderShell providerId="—" title="Dokploy status" description="GET /admin/providers polled every 5s via useInfraGet (infra).">
        <EmptyState
          message="Dokploy provider not found."
          description="No providers row with code or kind dokploy. Create one via POST /v1/admin/providers {code:dokploy, kind:dokploy, api_base_url, api_key} then test here. Polling is useInfraGet intervalMs 5000."
        />
        {providersState.error ? <ErrorBanner error={providersState.error} /> : null}
      </ProviderShell>
    )
  }

  if (providersState.error instanceof ApiError && (providersState.error as ApiError).status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Dokploy status" description="Dokploy per-provider status — GET infra polling 5s.">
        <EmptyState
          message="Dokploy status only available for dokploy providers."
          description="This provider runs another platform (the API answered HTTP 501 via kind guard). Use the matching console for proxmox/vmware/onidel. Switch to a dokploy provider and retry POST /v1/admin/providers/:id/test."
        />
      </ProviderShell>
    )
  }

  const description = providersState.loading || providersState.error
    ? "Dokploy PaaS — single-instance, murni dokploy. Polling every 5s via useInfraGet."
    : `${match?.code ?? "dokploy"} · ${match?.kind ?? "dokploy"} · ${providers.length} provider(s)`

  return (
    <ProviderShell providerId={providerId} title="Dokploy status" description={description}>
      {providersState.error ? <ErrorBanner error={providersState.error} /> : null}
      {testError ? <ErrorBanner error={testError} /> : null}

      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={isDokploy ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant="outline">{match.health_status || "unknown"}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)} · endpoint{" "}
              <span className="font-mono">POST /v1/admin/providers/:id/test</span> — RBAC{" "}
              <span className="font-mono">requireStaff auto</span> (platform_admin for POST, infra for GET) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span> · dokploy branch:{" "}
              <span className="font-mono">dokploy.NewClientFromDB → GET project.all</span> (bukan provider.Lookup)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not dokploy."
                description={`Kind is ${match.kind} (code ${match.code}) — POST /admin/providers/:id/test routes to provider.Lookup for non-dokploy kinds, but for code=dokploy it must use dokploy.NewClientFromDB → GET project.all. Use a dokploy provider for this console.`}
              />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — POST /admin/providers/:id/test will answer HTTP 503 until api_key is configured via the provider editor. Set api_base_url + api_key for code dokploy, then Test.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providersState.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void onTest()} disabled={testing || !providerId}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => providersState.reload()} disabled={providersState.loading}>
              {providersState.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/providers</span> every 5s via{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span> · Test via{" "}
              <span className="font-mono">POST /admin/providers/:id/test</span> (dokploy →{" "}
              <span className="font-mono">GET project.all</span>).
            </span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test result — POST /admin/providers/:id/test</CardTitle>
              <CardDescription>
                For <span className="font-mono">code=dokploy</span> the handler uses{" "}
                <span className="font-mono">dokploy.NewClientFromDB(ctx, db, encKey)</span> then{" "}
                <span className="font-mono">GET project.all</span> (latency_ms) — not{" "}
                <span className="font-mono">provider.Lookup → SyncCatalog</span>. Non-dokploy kinds keep the
                registry path.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!testResult && !testError ? (
                <p className="text-sm text-muted-foreground">
                  Click Test to POST /admin/providers/{providerId.slice(0, 8)}…/test. Success returns{" "}
                  <span className="font-mono">{"{code, kind, status: ok, latency_ms}"}</span>.
                </p>
              ) : null}
              {testResult ? (
                <SimpleDataTable<{ k: string; v: string }>
                  columns={[
                    { key: "k", header: "Field" },
                    { key: "v", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{r.v}</span> },
                  ]}
                  rows={[
                    { k: "code", v: testResult.code ?? "—" },
                    { k: "kind", v: testResult.kind ?? "—" },
                    { k: "status", v: testResult.status ?? "—" },
                    { k: "latency_ms", v: String(testResult.latency_ms ?? "—") },
                  ]}
                  getRowKey={(r) => r.k}
                  emptyMessage="No result."
                  skeletonRows={4}
                />
              ) : null}
              <p className="text-xs text-muted-foreground">
                Endpoint: <span className="font-mono">POST /admin/providers/:id/test</span> · Guard{" "}
                <span className="font-mono">code==dokploy || kind==dokploy</span> →{" "}
                <span className="font-mono">NewClientFromDB</span> +{" "}
                <span className="font-mono">GET project.all</span> · Poll contract{" "}
                <span className="font-mono">useInfraGet intervalMs 5000</span> on GET /admin/providers · Shell{" "}
                <span className="font-mono">ProviderShell</span>.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </ProviderShell>
  )
}
