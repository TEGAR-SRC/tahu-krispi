import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, Link } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { ErrorBanner } from "@/components/shared/ErrorBanner"

interface RegionRow {
  id: string
  provider_id: string
  code: string
  name: string
  enabled: boolean
}

interface OrgRow {
  id: string
  slug: string
  name: string
}

interface ProviderRow {
  id: string
  code: string
  kind: string
  name: string
}

export default function VmwareCreatePage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const navigate = useNavigate()
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [providerKind, setProviderKind] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [regionId, setRegionId] = useState("")
  const [orgId, setOrgId] = useState("")
  const [vcpu, setVcpu] = useState(2)
  const [ram, setRam] = useState(2048)
  const [disk, setDisk] = useState(40)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    Promise.all([
      apiGet<ProviderRow[]>("/admin/providers").then((r) => r.data).catch(() => [] as ProviderRow[]),
      apiGet<RegionRow[]>("/admin/regions", { query: { per_page: 100 } }).then((r) => r.data).catch(() => [] as RegionRow[]),
      apiGet<OrgRow[]>("/admin/organizations", { query: { per_page: 100 } }).then((r) => r.data).catch(() => [] as OrgRow[]),
    ])
      .then(([providers, regionRows, orgRows]) => {
        if (cancelled) return
        const prov = (providers ?? []).find((p) => p.id === providerId)
        if (prov) setProviderKind(prov.kind)
        else setProviderKind(null)
        const rows = (regionRows ?? []) as RegionRow[]
        setRegions(rows)
        const vmwareRows = rows.filter((r) => r.provider_id === providerId && r.enabled)
        if (vmwareRows.length === 1) setRegionId(vmwareRows[0].id)
        setOrgs(Array.isArray(orgRows) ? (orgRows as OrgRow[]) : [])
        setLoadError(null)
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  const vmwareRegions = useMemo(
    () => regions.filter((r) => r.provider_id === providerId && r.enabled),
    [regions, providerId],
  )

  const canSubmit = useMemo(() => {
    if (!name.trim() || !regionId || !orgId) return false
    const selected = vmwareRegions.find((r) => r.id === regionId)
    if (!selected) return false
    return vcpu >= 1 && ram >= 128 && disk >= 5
  }, [name, regionId, orgId, vmwareRegions, vcpu, ram, disk])

  const isWrongKind = providerKind !== null && providerKind !== "vmware"

  const submit = async () => {
    if (!name.trim() || !regionId) {
      toast.error("Name and region are required")
      return
    }
    if (!orgId) {
      toast.error("Organization is required")
      return
    }
    const selected = vmwareRegions.find((r) => r.id === regionId)
    if (!selected) {
      toast.error("Selected region does not belong to this VMware provider")
      return
    }
    setSubmitting(true)
    try {
      const { data } = await apiPost<{ id?: string }>(
        "/instances",
        {
          name: name.trim(),
          region_id: regionId,
          service_kind: "vm",
          cpu: vcpu,
          ram,
          disk,
        },
        { headers: { "X-Organization-ID": orgId } },
      )
      toast.success(`VMware VM "${name.trim()}" provisioning started`)
      if (data?.id) navigate(`/admin/instances/${data.id}`)
      else navigate(`/admin/vmware/${providerId}/inventory`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create VMware VM")
    } finally {
      setSubmitting(false)
    }
  }

  if (!providerId) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6 p-6">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </div>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Create VMware VM"
      description="Provisions a VMware VM via POST /instances with region routing and service_kind=vm. Region is resolved strictly from this VMware provider's enabled regions."
    >
      {loadError ? <ErrorBanner error={loadError} /> : null}

      {isWrongKind ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Provider <span className="font-mono">{providerId.slice(0, 8)}</span> is kind <span className="font-mono">{providerKind}</span>, not vmware. Region selection is scoped to vmware providers only — this page will not show Proxmox/Onidel regions.
            <Link to={`/admin/providers/${providerId}`} className="ml-2 underline">Back to provider</Link>
          </CardContent>
        </Card>
      ) : null}

      {vmwareRegions.length === 0 ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="text-base">No VMware regions</CardTitle>
            <CardDescription>
              No enabled regions for this VMware provider. Create a region in{" "}
              <Link to="/admin/regions-pools" className="underline">Regions &amp; Pools</Link> with provider set to this VMware provider. Unlike Proxmox, VMware region codes are not PVE node names — they map to vSphere datacenter/cluster scope.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">VMware — create VM</CardTitle>
          <CardDescription>
            Calls <span className="font-mono">POST /v1/instances</span> with <span className="font-mono">service_kind=vm</span> and <span className="font-mono">X-Organization-ID</span>. Provider is resolved from the chosen region&apos;s provider_id. Only regions where <span className="font-mono">provider_id == this VMware provider</span> and <span className="font-mono">enabled</span> are listed — Proxmox node regions are excluded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="vmware-name">Name *</Label>
            <Input id="vmware-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="vmware-vm-01" autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Region *</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger>
                  <SelectValue placeholder={vmwareRegions.length === 0 ? "No VMware regions" : "Select VMware region"} />
                </SelectTrigger>
                <SelectContent>
                  {vmwareRegions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only enabled regions for this VMware provider. Proxmox regions are filtered out.
                {regionId ? ` → ${regionId.slice(0, 8)}…` : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Organization *</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization (sends X-Organization-ID)" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.slug || o.name || o.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sent as X-Organization-ID. Required for provisioning.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="vmware-vcpu">vCPU *</Label>
              <Input id="vmware-vcpu" type="number" min={1} value={vcpu} onChange={(e) => setVcpu(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vmware-ram">RAM (MB) *</Label>
              <Input id="vmware-ram" type="number" min={128} step={128} value={ram} onChange={(e) => setRam(Math.max(128, Number(e.target.value) || 128))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vmware-disk">Disk (GB) *</Label>
              <Input id="vmware-disk" type="number" min={5} value={disk} onChange={(e) => setDisk(Math.max(5, Number(e.target.value) || 5))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={submitting || !canSubmit || isWrongKind} onClick={() => void submit()}>
              {submitting ? "Creating…" : "Create VMware VM"}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Back to inventory</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Payload: <span className="font-mono">{"{ name, region_id, cpu, ram, disk, service_kind: 'vm' }"}</span> → <span className="font-mono">POST /v1/instances</span> with <span className="font-mono">X-Organization-ID</span>
            {regionId ? ` (region ${regionId.slice(0, 8)}…)` : ""}.
          </p>
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
