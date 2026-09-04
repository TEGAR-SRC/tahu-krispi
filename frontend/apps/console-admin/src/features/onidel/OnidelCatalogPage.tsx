import { useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface CatalogLocation {
  Code?: string
  code?: string
  Name?: string
  name?: string
}

interface CatalogInstanceType {
  Code?: string
  code?: string
  Name?: string
  name?: string
  ExternalID?: string
  external_id?: string
  Category?: string
  category?: string
  MaxVCPU?: number
  max_vcpu?: number
  MaxRAM?: number
  max_ram_mb?: number
  MaxDisk?: number
  max_disk_gb?: number
  NetworkRate?: number
  network_rate?: number
  Locations?: string[]
  locations?: string[]
}

interface CatalogOSTemplate {
  Name?: string
  name?: string
  Family?: string
  family?: string
  ExternalID?: string
  external_id?: string
}

interface OnidelCatalogPayload {
  provider_id: string
  code: string
  regions: CatalogLocation[]
  instance_types: CatalogInstanceType[]
  os_templates: CatalogOSTemplate[]
}

function locCode(r: CatalogLocation): string {
  return String(r.Code ?? r.code ?? "")
}

function locName(r: CatalogLocation): string {
  return String(r.Name ?? r.name ?? "")
}

function typeCode(r: CatalogInstanceType): string {
  return String(r.Code ?? r.code ?? r.ExternalID ?? r.external_id ?? "")
}

function typeName(r: CatalogInstanceType): string {
  return String(r.Name ?? r.name ?? typeCode(r))
}

function typeCategory(r: CatalogInstanceType): string {
  return String(r.Category ?? r.category ?? "—")
}

function typeVCPU(r: CatalogInstanceType): string {
  const v = r.MaxVCPU ?? r.max_vcpu
  return v !== undefined && v !== null ? String(v) : "—"
}

function typeRAM(r: CatalogInstanceType): string {
  const v = r.MaxRAM ?? r.max_ram_mb
  return v !== undefined && v !== null ? String(v) : "—"
}

function typeDisk(r: CatalogInstanceType): string {
  const v = r.MaxDisk ?? r.max_disk_gb
  return v !== undefined && v !== null ? String(v) : "—"
}

function typeRate(r: CatalogInstanceType): string {
  const v = r.NetworkRate ?? r.network_rate
  return v !== undefined && v !== null ? String(v) : "—"
}

function typeLocations(r: CatalogInstanceType): string {
  const v = r.Locations ?? r.locations
  if (!Array.isArray(v) || v.length === 0) return "—"
  return v.join(", ")
}

function osName(r: CatalogOSTemplate): string {
  return String(r.Name ?? r.name ?? "")
}

function osFamily(r: CatalogOSTemplate): string {
  return String(r.Family ?? r.family ?? "—")
}

function osExternal(r: CatalogOSTemplate): string {
  return String(r.ExternalID ?? r.external_id ?? "—")
}

export default function OnidelCatalogPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const raw = useInfraGet<OnidelCatalogPayload>(providerId ? `/admin/onidel/${providerId}/catalog` : null, undefined, { intervalMs: 5000 })
  const data: OnidelCatalogPayload | null = raw.data
    ? {
        provider_id: String((raw.data as unknown as Record<string, unknown>).provider_id ?? providerId),
        code: String((raw.data as unknown as Record<string, unknown>).code ?? ""),
        regions: Array.isArray(raw.data.regions) ? raw.data.regions : [],
        instance_types: Array.isArray((raw.data as unknown as Record<string, unknown>).instance_types as unknown[])
          ? (raw.data.instance_types as unknown as CatalogInstanceType[])
          : [],
        os_templates: Array.isArray((raw.data as unknown as Record<string, unknown>).os_templates as unknown[])
          ? (raw.data.os_templates as unknown as CatalogOSTemplate[])
          : [],
      }
    : null
  const loading = raw.loading
  const error = raw.error
  const regions = data?.regions ?? []
  const instanceTypes = data?.instance_types ?? []
  const osTemplates = data?.os_templates ?? []

  return (
    <ProviderShell
      providerId={providerId}
      title="Onidel catalog"
      description={
        data?.code
          ? `Provider ${data.code} · regions, instance types & OS templates (live via Onidel adapter, provider-filtered).`
          : "Regions, instance types & OS templates for this Onidel provider (GET /admin/onidel/:id/catalog, provider-filtered; NOC read via infra, admin full access)."
      }
    >
      <ErrorBanner error={error} />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regions</CardTitle>
            <CardDescription>
              {loading ? "Loading…" : `${regions.length} region(s) for this provider`}
              {data?.code ? <Badge variant="outline" className="ml-2">{data.code}</Badge> : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<CatalogLocation>
              columns={[
                { key: "code", header: "Code", render: (r) => <span className="font-mono text-sm">{locCode(r) || "—"}</span> },
                { key: "name", header: "Name", render: (r) => locName(r) || "—" },
              ]}
              rows={regions}
              loading={loading}
              error={null}
              getRowKey={(r, i) => locCode(r) || String(i)}
              emptyMessage="No regions synced for this provider — trigger sync on Providers page or check Onidel credentials."
              skeletonRows={4}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instance types</CardTitle>
            <CardDescription>{loading ? "Loading…" : `${instanceTypes.length} type(s) for this provider`}</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<CatalogInstanceType>
              columns={[
                { key: "code", header: "Code", render: (r) => <span className="font-mono text-sm">{typeCode(r) || "—"}</span> },
                { key: "name", header: "Name", render: (r) => typeName(r) },
                { key: "category", header: "Category", render: (r) => typeCategory(r) },
                { key: "vcpu", header: "vCPU", render: (r) => typeVCPU(r) },
                { key: "ram", header: "RAM MB", render: (r) => typeRAM(r) },
                { key: "disk", header: "Disk GB", render: (r) => typeDisk(r) },
                { key: "rate", header: "Net Mbps", render: (r) => typeRate(r) },
                { key: "locations", header: "Locations", render: (r) => <span className="max-w-32 truncate text-xs text-muted-foreground">{typeLocations(r)}</span> },
              ]}
              rows={instanceTypes}
              loading={loading}
              error={null}
              getRowKey={(r, i) => typeCode(r) || String(i)}
              emptyMessage="No instance types for this provider."
              skeletonRows={5}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">OS templates</CardTitle>
            <CardDescription>{loading ? "Loading…" : `${osTemplates.length} template(s) for this provider`}</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<CatalogOSTemplate>
              columns={[
                { key: "name", header: "Name", render: (r) => osName(r) || "—" },
                { key: "family", header: "Family", render: (r) => osFamily(r) },
                { key: "external_id", header: "External ID", className: "hidden md:table-cell font-mono text-xs", render: (r) => osExternal(r) },
              ]}
              rows={osTemplates}
              loading={loading}
              error={null}
              getRowKey={(r, i) => osName(r) || osExternal(r) || String(i)}
              emptyMessage="No OS templates for this provider."
              skeletonRows={4}
            />
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
