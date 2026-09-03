import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

interface Region {
  id: string
  code: string
  name: string
  enabled: boolean
}

interface InstanceType {
  id: string
  external_id: string
  name: string
  max_vcpu: number
  max_ram_mb: number
  max_disk_gb: number
}

interface OsTemplate {
  id: string
  external_id: string
  name: string
  family: string
  version: string
}

interface AdminOrgRow {
  id: string
  public_id: string
  slug: string
  name: string
}

export default function CreateOnidelVmPage() {
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [regionId, setRegionId] = useState("")
  const [instanceTypeId, setInstanceTypeId] = useState("")
  const [osTemplateId, setOsTemplateId] = useState("")
  const [orgId, setOrgId] = useState("")

  const [regions, setRegions] = useState<Region[]>([])
  const [instanceTypes, setInstanceTypes] = useState<InstanceType[]>([])
  const [osTemplates, setOsTemplates] = useState<OsTemplate[]>([])
  const [orgs, setOrgs] = useState<AdminOrgRow[]>([])

  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  const selectedType = useMemo(
    () => instanceTypes.find((t) => t.id === instanceTypeId) ?? null,
    [instanceTypes, instanceTypeId],
  )

  useEffect(() => {
    let cancelled = false
    setCatalogLoading(true)
    Promise.all([
      apiGet<Region[]>("/regions"),
      apiGet<InstanceType[]>("/instance-types"),
      apiGet<OsTemplate[]>("/os-templates"),
      apiGet<AdminOrgRow[]>("/admin/organizations", { query: { page: 1, per_page: 100 } }),
    ])
      .then(([regionsRes, typesRes, templatesRes, orgsRes]) => {
        if (cancelled) return
        setRegions((regionsRes.data ?? []).filter((r) => r.enabled))
        setInstanceTypes(templatesRes ? (typesRes.data ?? []) : [])
        setOsTemplates(templatesRes.data ?? [])
        const orgRows = Array.isArray(orgsRes.data) ? orgsRes.data : []
        setOrgs(orgRows)
        if (orgRows.length === 1) setOrgId(orgRows[0].id)
        try {
          const stored = localStorage.getItem("kilat_org_id")
          if (stored && orgRows.some((o) => o.id === stored)) setOrgId(stored)
        } catch {
          // ignore storage errors
        }
        setCatalogError(null)
      })
      .catch((cause) => {
        if (!cancelled) setCatalogError(cause)
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const canSubmit =
    name.trim().length > 0 && regionId !== "" && instanceTypeId !== "" && osTemplateId !== ""

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return
    if (!orgId) {
      toast.error("Select an organization (X-Organization-ID required)")
      return
    }
    setSubmitting(true)
    try {
      const cpu = selectedType?.max_vcpu && selectedType.max_vcpu > 0 ? selectedType.max_vcpu : 2
      const ram = selectedType?.max_ram_mb && selectedType.max_ram_mb > 0 ? selectedType.max_ram_mb : 2048
      const disk = selectedType?.max_disk_gb && selectedType.max_disk_gb > 0 ? selectedType.max_disk_gb : 50

      const { data } = await apiPost<{ id?: string }>(
        "/instances",
        {
          name: name.trim(),
          region_id: regionId,
          instance_type_id: instanceTypeId,
          os_template_id: osTemplateId,
          cpu,
          ram,
          disk,
          service_kind: "vm",
        },
        { headers: { "X-Organization-ID": orgId } },
      )
      toast.success(`Instance "${name.trim()}" provisioning started`)
      if (data?.id) navigate(`/admin/instances/${data.id}`)
      else navigate("/admin/instances")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create instance")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Create Onidel VM"
        description="Provision a new Onidel VM. Provider is routed via the selected region."
      />

      <ErrorBanner error={catalogError} />

      {catalogLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onidel VM details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="onidel-vm-name">Name *</Label>
              <Input
                id="onidel-vm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="onidel-vm-01"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onidel-vm-org">Organization *</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger id="onidel-vm-org">
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No organizations
                    </SelectItem>
                  ) : (
                    orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name || o.slug} ({o.slug})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sent as X-Organization-ID header.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onidel-vm-region">Region *</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger id="onidel-vm-region">
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No regions
                    </SelectItem>
                  ) : (
                    regions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onidel-vm-type">Instance type *</Label>
              <Select value={instanceTypeId} onValueChange={setInstanceTypeId}>
                <SelectTrigger id="onidel-vm-type">
                  <SelectValue placeholder="Select instance type" />
                </SelectTrigger>
                <SelectContent>
                  {instanceTypes.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No instance types
                    </SelectItem>
                  ) : (
                    instanceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {t.max_vcpu} vCPU · {t.max_ram_mb} MB · {t.max_disk_gb} GB
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedType ? (
                <p className="text-xs text-muted-foreground">
                  {selectedType.max_vcpu} vCPU · {selectedType.max_ram_mb} MB · {selectedType.max_disk_gb} GB
                  will be sent as cpu/ram/disk.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onidel-vm-os">OS template *</Label>
              <Select value={osTemplateId} onValueChange={setOsTemplateId}>
                <SelectTrigger id="onidel-vm-os">
                  <SelectValue placeholder="Select OS template" />
                </SelectTrigger>
                <SelectContent>
                  {osTemplates.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No OS templates
                    </SelectItem>
                  ) : (
                    osTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.family ? ` · ${t.family}` : ""}
                        {t.version ? ` ${t.version}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
              {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {submitting ? "Creating…" : "Create VM"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/admin/instances")} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
