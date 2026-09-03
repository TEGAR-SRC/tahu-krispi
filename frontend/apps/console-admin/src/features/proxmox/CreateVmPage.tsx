// Dedicated Proxmox QEMU create form — POST /instances service_kind=vm.
// Provider routing is DB-driven via region_id (regions.provider_id), so the
// chosen node maps to a region whose code equals the PVE node name.
import { useEffect, useMemo, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"

interface RegionRow {
  id: string
  provider_id: string
  code: string
  name: string
  enabled: boolean
}

interface ClusterPayload {
  provider_id: string
  code: string
  nodes?: Array<{ node?: string; name?: string }>
}

interface ClusterStorage {
  storage?: string
  type?: string
  content?: string
}

interface IsoView {
  id?: string
  name?: string
  external_iso_id?: string
  status?: string
  filename?: string
  [key: string]: unknown
}

interface OrgRow {
  id: string
  public_id: string
  slug: string
  name: string
  status: string
}

export default function CreateVmPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const navigate = useNavigate()

  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [orgId, setOrgId] = useState("")
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [nodes, setNodes] = useState<string[]>([])
  const [storages, setStorages] = useState<ClusterStorage[]>([])
  const [isos, setIsos] = useState<IsoView[]>([])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)

  const [name, setName] = useState("")
  const [node, setNode] = useState("")
  const [vmid, setVmid] = useState("")
  const [iso, setIso] = useState("")
  const [cpu, setCpu] = useState("2")
  const [ram, setRam] = useState("2048")
  const [disk, setDisk] = useState("20")
  const [storage, setStorage] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiGet<OrgRow[]>("/admin/organizations", { query: { per_page: 100 } }).then((r) => r.data).catch(() => [] as OrgRow[]),
      apiGet<RegionRow[]>("/admin/regions", { query: { per_page: 100 } }).then((r) => r.data).catch(() => [] as RegionRow[]),
      apiGet<ClusterPayload>(`/admin/proxmox/${providerId}/cluster`).then((r) => r.data).catch(() => apiGet<ClusterPayload>(`/admin/providers/${providerId}/cluster`).then((r) => r.data).catch(() => null)),
      apiGet<ClusterStorage[]>(`/admin/proxmox/${providerId}/cluster-storages`).then((r) => r.data).catch(() => apiGet<ClusterStorage[]>(`/admin/providers/${providerId}/cluster-storages`).then((r) => r.data).catch(() => [] as ClusterStorage[])),
    ])
      .then(([orgRows, regionRows, cluster, storageRows]) => {
        if (cancelled) return
        const filteredOrgs = (orgRows ?? []).filter(Boolean)
        setOrgs(filteredOrgs)
        setOrgId((prev) => prev || (filteredOrgs[0]?.id ?? ""))
        setRegions(regionRows ?? [])
        const nodeNames = (cluster?.nodes ?? []).map((n) => String(n.node ?? n.name ?? "")).filter(Boolean)
        setNodes(nodeNames)
        if (nodeNames.length > 0) setNode((prev) => prev || nodeNames[0])
        setStorages(storageRows ?? [])
        const firstStorage = (storageRows ?? [])[0]?.storage
        if (firstStorage) setStorage((prev) => prev || String(firstStorage))
        setLoadError(null)
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId])

  useEffect(() => {
    if (!orgId) {
      setIsos([])
      return
    }
    let cancelled = false
    apiGet<IsoView[]>("/isos", { headers: { "X-Organization-ID": orgId } })
      .then(({ data }) => {
        if (!cancelled) setIsos(data ?? [])
      })
      .catch(() => {
        if (!cancelled) setIsos([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const proxmoxRegions = useMemo(
    () => regions.filter((r) => r.provider_id === providerId && r.enabled),
    [regions, providerId],
  )

  const resolvedRegionId = useMemo(() => {
    if (proxmoxRegions.length === 0) return ""
    const byNode = node ? proxmoxRegions.find((r) => r.code === node) : undefined
    return byNode?.id ?? proxmoxRegions[0].id
  }, [proxmoxRegions, node])

  const canSubmit = useMemo(() => {
    return (
      Boolean(providerId) &&
      Boolean(orgId) &&
      Boolean(name.trim()) &&
      Boolean(resolvedRegionId) &&
      Number(cpu) > 0 &&
      Number(ram) > 0 &&
      Number(disk) > 0
    )
  }, [providerId, orgId, name, resolvedRegionId, cpu, ram, disk])

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        region_id: resolvedRegionId,
        cpu: Number(cpu),
        ram: Number(ram),
        disk: Number(disk),
        service_kind: "vm",
      }
      if (vmid.trim()) payload["vmid"] = Number(vmid.trim())
      if (iso.trim()) payload["iso"] = iso.trim()
      if (storage.trim()) payload["storage"] = storage.trim()
      if (node.trim()) payload["node"] = node.trim()

      await apiPost("/instances", payload, {
        headers: { "X-Organization-ID": orgId },
      })
      toast.success(`VM "${name.trim()}" provisioning started`)
      navigate("/admin/instances")
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create VM")
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
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Create Proxmox VM"
        description={`QEMU guest on provider ${providerId.slice(0, 8)}… — routed via region_id. service_kind=vm.`}
        actions={
          <Button asChild variant="outline">
            <Link to={`/admin/proxmox/${providerId}`}>Back to provider</Link>
          </Button>
        }
      />

      {loadError ? <ErrorBanner error={loadError} /> : null}
      {submitError ? <ErrorBanner error={submitError} /> : null}

      {proxmoxRegions.length === 0 && !loading ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No enabled regions for this Proxmox provider. Create a region in{" "}
            <Link to="/admin/regions-pools" className="underline">
              Regions &amp; Pools
            </Link>{" "}
            with code equal to the PVE node name (e.g. <span className="font-mono">pve01</span>) so provisioning can route via region_id.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proxmox QEMU — create VM</CardTitle>
          <CardDescription>
            Calls <span className="font-mono">POST /v1/instances</span> with{" "}
            <span className="font-mono">service_kind=vm</span> and{" "}
            <span className="font-mono">X-Organization-ID</span>. Provider is resolved from the chosen region&apos;s provider_id. Node/VMID/ISO/storage are provider hints; vCPU/RAM/disk are the billable spec.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid w-full max-w-full min-w-0 gap-4">
          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vm-org">Organization *</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger id="vm-org">
                  <SelectValue placeholder={loading ? "Loading…" : "Select organization"} />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || o.slug} ({o.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Sent as X-Organization-ID. Staff may target any org.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-name">Name *</Label>
              <Input
                id="vm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. app-prod-01"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-node">Node *</Label>
              {nodes.length > 0 ? (
                <Select value={node} onValueChange={setNode}>
                  <SelectTrigger id="vm-node">
                    <SelectValue placeholder="Select node" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="vm-node"
                  value={node}
                  onChange={(e) => setNode(e.target.value)}
                  placeholder="pve01"
                />
              )}
              <p className="text-xs text-muted-foreground">
                PVE node name. Must match a region code for this provider to resolve region_id ({resolvedRegionId ? `→ ${resolvedRegionId.slice(0, 8)}…` : "no region yet"}).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-vmid">VMID</Label>
              <Input
                id="vm-vmid"
                value={vmid}
                onChange={(e) => setVmid(e.target.value)}
                placeholder="auto (NextVMID) if empty"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">Optional PVE VMID; leave empty to auto-allocate.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-iso">ISO</Label>
              {isos.length > 0 ? (
                <Select value={iso || "__none__"} onValueChange={(v) => setIso(v === "__none__" ? "" : v)}>
                  <SelectTrigger id="vm-iso">
                    <SelectValue placeholder="No ISO (disk boot)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No ISO (disk boot)</SelectItem>
                    {isos.map((it) => {
                      const key = String(it.external_iso_id ?? it.id ?? it.name ?? "")
                      const label = String(it.name ?? it.filename ?? key)
                      return (
                        <SelectItem key={key || label} value={key}>
                          {label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="vm-iso"
                  value={iso}
                  onChange={(e) => setIso(e.target.value)}
                  placeholder="e.g. local:iso/ubuntu-22.04.iso or leave empty"
                />
              )}
              <p className="text-xs text-muted-foreground">PVE volid for the installer ISO (storage:iso/file). Empty = disk boot.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-storage">Storage</Label>
              {storages.length > 0 ? (
                <Select value={storage} onValueChange={setStorage}>
                  <SelectTrigger id="vm-storage">
                    <SelectValue placeholder="Select storage" />
                  </SelectTrigger>
                  <SelectContent>
                    {storages.map((s) => {
                      const key = String(s.storage ?? "")
                      return (
                        <SelectItem key={key} value={key}>
                          {key} {s.type ? `(${s.type})` : ""}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="vm-storage"
                  value={storage}
                  onChange={(e) => setStorage(e.target.value)}
                  placeholder="local-lvm"
                />
              )}
              <p className="text-xs text-muted-foreground">VM disk target storage (default local-lvm on this cluster).</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-cpu">vCPU *</Label>
              <Input
                id="vm-cpu"
                type="number"
                min={1}
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vm-ram">RAM (MB) *</Label>
              <Input
                id="vm-ram"
                type="number"
                min={128}
                step={128}
                value={ram}
                onChange={(e) => setRam(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="vm-disk">Disk (GB) *</Label>
              <Input
                id="vm-disk"
                type="number"
                min={5}
                value={disk}
                onChange={(e) => setDisk(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={!canSubmit || submitting || loading} onClick={() => void onSubmit()}>
              {submitting ? "Creating…" : "Create VM"}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
              Cancel
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Payload: <span className="font-mono">{"{ name, region_id, cpu, ram, disk, service_kind: 'vm', vmid?, iso?, storage?, node? }"}</span> →{" "}
            <span className="font-mono">POST /v1/instances</span> with <span className="font-mono">X-Organization-ID</span>
            {resolvedRegionId ? ` (region ${resolvedRegionId.slice(0, 8)}…)` : ""}.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
