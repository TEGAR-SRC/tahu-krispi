import { useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/features/admin/pages/shared"

interface HealthDetailPayload {
  provider_id: string
  code: string
  enabled: boolean
  health_status: string
  last_check: string | null
  last_health_check_at: string | null
  api_base_url: string
  live: string
  latency_ms?: number
  error?: string
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(String(value).trim().replace(" ", "T"))
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

export default function OnidelHealthDetailPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const detail = useInfraGet<HealthDetailPayload>(
    providerId ? `/admin/onidel/${providerId}/health/detail` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const data = detail.data
  const healthStatus = data?.health_status ?? "—"
  const lastCheck = data?.last_check ?? data?.last_health_check_at ?? null
  const live = data?.live ?? "—"

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel health detail"
      description="GET /admin/onidel/:id/health/detail — health_status + last_check (DB) + live probe via provider.Lookup, polling 5s (infra readable, NOC + platform_admin)."
    >
      {detail.error ? <ErrorBanner error={detail.error} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Health status</CardTitle>
            <CardDescription>DB field health_status + last_check (last_health_check_at).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {detail.loading && !data ? (
              <Skeleton className="h-16 w-full" />
            ) : data ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">health_status</span>
                  <StatusBadge status={healthStatus} />
                  <span className="text-xs text-muted-foreground">enabled</span>
                  <Badge variant={data.enabled ? "secondary" : "outline"}>{data.enabled ? "yes" : "no"}</Badge>
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">last_check: </span>
                  <span className="font-mono text-xs">{formatDateTime(lastCheck)}</span>
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">{data.api_base_url || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  provider: <span className="font-mono">{data.code || "—"}</span> · {data.provider_id?.slice(0, 8) ?? ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data — check provider id or credentials.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live probe</CardTitle>
            <CardDescription>Live check via Onidel adapter ListInstanceTypes (latency + error).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detail.loading && !data ? (
              <Skeleton className="h-16 w-full" />
            ) : data ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">live</span>
                  <Badge variant={live === "ok" ? "secondary" : live === "disabled" ? "outline" : "destructive"}>{live}</Badge>
                  {typeof data.latency_ms === "number" ? (
                    <span className="text-xs">
                      {data.latency_ms}ms
                    </span>
                  ) : null}
                </div>
                {data.error ? <p className="break-all text-xs text-destructive">{data.error}</p> : null}
                {!data.error && live === "ok" ? <p className="text-xs text-emerald-600">Provider reachable — Onidel API answered.</p> : null}
                <p className="font-mono text-xs text-muted-foreground">GET /admin/onidel/:id/health/detail · interval 5000ms</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Health not available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
