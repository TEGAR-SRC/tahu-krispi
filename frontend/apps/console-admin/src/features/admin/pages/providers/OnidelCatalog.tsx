import { useParams } from "react-router-dom"
import { ProviderShell } from "./shared"
import { useInfraGet } from "./infra"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Badge } from "@/components/ui/badge"

interface CatalogRegion { code: string; name: string; enabled: boolean }
interface CatalogInstanceType { code: string; name: string; max_vcpu: number; max_ram_mb: number; max_disk_gb: number }
interface CatalogOSTemplate { name: string; family: string }

export default function OnidelCatalog() {
  const providerId = useParams().providerId ?? ""
  const regions = useInfraGet<CatalogRegion[]>("/regions")
  const types = useInfraGet<CatalogInstanceType[]>("/instance-types")
  const templates = useInfraGet<CatalogOSTemplate[]>("/os-templates")

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel catalog"
      description="Regions, instance types & OS templates synced from api.cloud.onidel.com via worker provider_sync."
    >
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Regions (available datacenters)</CardTitle></CardHeader>
          <CardContent>
            {regions.loading ? <Skeleton className="h-20 w-full" /> : regions.error ? <ErrorBanner error={regions.error} /> : !regions.data?.length ? <p className="text-sm text-muted-foreground">No regions synced yet — trigger sync on Providers page.</p> : (
              <div className="flex flex-wrap gap-2">
                {regions.data!.map((r) => <Badge key={r.code} variant={r.enabled ? "default" : "outline"}>{r.name} ({r.code})</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Instance types</CardTitle></CardHeader>
          <CardContent>
            {types.loading ? <Skeleton className="h-20 w-full" /> : types.error ? <ErrorBanner error={types.error} /> : !types.data?.length ? <p className="text-sm text-muted-foreground">No instance types yet.</p> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {types.data!.slice(0, 24).map((t) => (
                  <div key={t.code} className="rounded border p-3 text-sm">
                    <p className="font-medium">{t.name} <span className="font-mono text-xs text-muted-foreground">({t.code})</span></p>
                    <p className="text-xs text-muted-foreground">{t.max_vcpu} vCPU · {t.max_ram_mb} MB · {t.max_disk_gb} GB</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">OS templates</CardTitle></CardHeader>
          <CardContent>
            {templates.loading ? <Skeleton className="h-20 w-full" /> : templates.error ? <ErrorBanner error={templates.error} /> : !templates.data?.length ? <p className="text-sm text-muted-foreground">No OS templates yet.</p> : (
              <div className="flex flex-wrap gap-2">
                {templates.data!.slice(0, 32).map((t) => <Badge key={t.name} variant="outline">{t.name} <span className="text-muted-foreground">· {t.family}</span></Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
