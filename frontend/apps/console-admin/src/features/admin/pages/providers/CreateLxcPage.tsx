import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProviderShell } from "./shared"

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

export default function CreateLxcPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const navigate = useNavigate()
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [name, setName] = useState("")
  const [regionId, setRegionId] = useState("")
  const [orgId, setOrgId] = useState("")
  const [vcpu, setVcpu] = useState(1)
  const [ram, setRam] = useState(1024)
  const [disk, setDisk] = useState(20)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiGet<RegionRow[]>("/admin/regions", { query: { per_page: 100 } })
      .then(({ data }) => {
        const filtered = (data ?? []).filter((r) => !providerId || r.provider_id === providerId)
        setRegions(filtered)
        if (filtered.length === 1) setRegionId(filtered[0].id)
      })
      .catch(() => setRegions([]))
    apiGet<OrgRow[]>("/admin/organizations", { query: { per_page: 100 } })
      .then(({ data }) => setOrgs(Array.isArray(data) ? data : []))
      .catch(() => setOrgs([]))
  }, [providerId])

  const submit = async () => {
    if (!name.trim() || !regionId) {
      toast.error("Name and region are required")
      return
    }
    setSubmitting(true)
    try {
      const { data } = await apiPost<{ id?: string }>(
        "/instances",
        {
          name: name.trim(),
          region_id: regionId,
          service_kind: "container",
          cpu: vcpu,
          ram,
          disk,
        },
        { headers: orgId ? { "X-Organization-ID": orgId } : undefined },
      )
      toast.success(`Container "${name.trim()}" provisioning started`)
      if (data?.id) navigate(`/admin/instances/${data.id}`)
      else navigate(`/admin/proxmox/${providerId}/containers`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create container")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Create LXC container"
      description="Provisions a container via POST /instances with region routing and service_kind=container."
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-name">Name *</Label>
            <Input id="lxc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="lxc-01" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Region *</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Organization</Label>
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
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="lxc-vcpu">vCPU</Label>
              <Input id="lxc-vcpu" type="number" min={1} value={vcpu} onChange={(e) => setVcpu(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lxc-ram">RAM (MB)</Label>
              <Input id="lxc-ram" type="number" min={128} step={128} value={ram} onChange={(e) => setRam(Math.max(128, Number(e.target.value) || 128))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lxc-disk">Disk (GB)</Label>
              <Input id="lxc-disk" type="number" min={5} value={disk} onChange={(e) => setDisk(Math.max(5, Number(e.target.value) || 5))} />
            </div>
          </div>
          <Button disabled={submitting || !name.trim() || !regionId} onClick={() => void submit()}>
            {submitting ? "Creating…" : "Create container"}
          </Button>
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
