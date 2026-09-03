import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import type { ClusterPayload } from "@/features/admin/pages/providers/types"

interface RegionRow {
  id: string
  code: string
  external_id?: string
  name?: string
  provider_id?: string
  enabled?: boolean
}

function getStoredOrgId(): string {
  try {
    return localStorage.getItem("kilat_org_id") ?? ""
  } catch {
    return ""
  }
}

export default function CreateLxcPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const navigate = useNavigate()

  const [name, setName] = useState("")
  const [node, setNode] = useState("")
  const [vmid, setVmid] = useState("")
  const [template, setTemplate] = useState("local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst")
  const [cpu, setCpu] = useState("1")
  const [ram, setRam] = useState("1024")
  const [disk, setDisk] = useState("10")
  const [password, setPassword] = useState("")
  const [orgId, setOrgId] = useState(getStoredOrgId)

  const [nodes, setNodes] = useState<string[]>([])
  const [regions, setRegions] = useState<RegionRow[]>([])
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    setLoadingMeta(true)
    const clusterPromise = apiGet<ClusterPayload>(`/admin/proxmox/${providerId}/cluster`)
      .then((envelope) => {
        if (cancelled) return
        const list = (envelope.data?.nodes ?? [])
          .map((n) => n.node ?? n.name ?? "")
          .filter(Boolean) as string[]
        setNodes(list)
        if (list.length === 1) setNode((prev) => prev || list[0])
      })
      .catch(() => {
        if (!cancelled) setNodes([])
      })

    const regionsPromise = apiGet<RegionRow[]>("/regions")
      .then((envelope) => {
        if (cancelled) return
        const rows = Array.isArray(envelope.data) ? envelope.data : []
        setRegions(rows)
      })
      .catch(() => {
        if (!cancelled) setRegions([])
      })

    Promise.allSettled([clusterPromise, regionsPromise]).finally(() => {
      if (!cancelled) setLoadingMeta(false)
    })

    return () => {
      cancelled = true
    }
  }, [providerId])

  const regionIdForNode = useMemo(() => {
    if (!node) return null
    const match =
      regions.find((r) => r.code === node) ??
      regions.find((r) => r.external_id === node) ??
      null
    return match?.id ?? null
  }, [node, regions])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitError(null)

    const trimmedName = name.trim()
    const trimmedTemplate = template.trim()
    const cpuNum = Number(cpu)
    const ramNum = Number(ram)
    const diskNum = Number(disk)
    const vmidNum = vmid.trim() === "" ? undefined : Number(vmid.trim())
    const org = orgId.trim()

    if (!trimmedName) {
      setSubmitError("Name is required.")
      return
    }
    if (!node) {
      setSubmitError("Node is required.")
      return
    }
    if (!trimmedTemplate) {
      setSubmitError("Template is required (e.g. local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst).")
      return
    }
    if (!Number.isFinite(cpuNum) || cpuNum < 1) {
      setSubmitError("CPU must be at least 1.")
      return
    }
    if (!Number.isFinite(ramNum) || ramNum < 128) {
      setSubmitError("RAM must be at least 128 MB.")
      return
    }
    if (!Number.isFinite(diskNum) || diskNum < 4) {
      setSubmitError("Disk must be at least 4 GB.")
      return
    }
    if (vmidNum !== undefined && (!Number.isInteger(vmidNum) || vmidNum < 100)) {
      setSubmitError("VMID must be an integer >= 100 or left blank for auto allocation.")
      return
    }

    setSubmitting(true)
    try {
      const headers = org ? { "X-Organization-ID": org } : undefined

      // Preferred path: queue via POST /instances with service_kind=container.
      // Provider routing is driven by region_id (proxmox regions encode the
      // target node in regions.code / external_id). Extra LXC-native fields
      // (node, vmid, template, password) are forwarded so a future worker can
      // consume them without a frontend change. The direct admin path
      // POST /admin/proxmox/:id/lxc (payload: { node, vmid, hostname, template,
      // cores, memory, rootfs, password }) is the alternative when a synchronous
      // PVE create endpoint is exposed; keep that route as a fallback branch
      // if /instances is unavailable for this provider.
      const instanceBody: Record<string, unknown> = {
        name: trimmedName,
        service_kind: "container",
        cpu: cpuNum,
        ram: ramNum,
        disk: diskNum,
        node,
        template: trimmedTemplate,
        password: password || undefined,
      }
      if (vmidNum !== undefined) instanceBody.vmid = vmidNum
      if (regionIdForNode) instanceBody.region_id = regionIdForNode

      try {
        await apiPost("/instances", instanceBody, headers ? { headers } : undefined)
      } catch (err) {
        // Fallback: try the synchronous per-provider LXC endpoint when the
        // instance queue rejects the request (e.g. missing region routing).
        // Backend today exposes no POST /admin/proxmox/:id/lxc, so this branch
        // is best-effort and surfaces the original error when the admin route
        // is also unavailable.
        const shouldTryDirect =
          err instanceof ApiError &&
          (err.status === 404 || err.status === 422 || err.code === "region_unavailable")
        if (!shouldTryDirect) throw err

        const directBody: Record<string, unknown> = {
          node,
          hostname: trimmedName,
          template: trimmedTemplate,
          cores: cpuNum,
          memory: ramNum,
          rootfs: diskNum,
          password: password || undefined,
        }
        if (vmidNum !== undefined) directBody.vmid = vmidNum

        try {
          await apiPost(`/admin/proxmox/${providerId}/lxc`, directBody)
        } catch (directErr) {
          if (directErr instanceof ApiError && directErr.status === 404) {
            throw err
          }
          throw directErr
        }
      }

      toast.success(`LXC "${trimmedName}" creation queued`)
      navigate(`/admin/proxmox/${providerId}/containers`)
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Request failed"
      setSubmitError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Create LXC container"
      description="Provision a new LXC container on this Proxmox cluster. Reviews as POST /instances with service_kind=container (provider routed via region) or POST /admin/proxmox/:id/lxc when that endpoint is available."
    >
      <Card>
        <CardHeader>
          <CardTitle>LXC details</CardTitle>
          <CardDescription>
            Fields mirror PVE create-LXC: hostname, target node, VMID, template
            (local:vztmpl/...), CPU, RAM MB, disk GB and root password. Region
            routing is resolved automatically from the selected node when a
            matching enabled region exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lxc-name">Name *</Label>
                <Input
                  id="lxc-name"
                  value={name}
                  placeholder="ct-web-01"
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Hostname inside PVE (lowercase, no spaces).</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-node">Node *</Label>
                {nodes.length > 0 ? (
                  <Select value={node} onValueChange={setNode}>
                    <SelectTrigger id="lxc-node">
                      <SelectValue placeholder={loadingMeta ? "Loading nodes…" : "Select node"} />
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
                    id="lxc-node"
                    value={node}
                    placeholder={loadingMeta ? "Loading…" : "pve01"}
                    onChange={(e) => setNode(e.target.value)}
                    required
                  />
                )}
                {regionIdForNode ? (
                  <p className="text-xs text-muted-foreground">Routes via region {regionIdForNode.slice(0, 8)}…</p>
                ) : node ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No enabled region matches this node — request will queue without region_id and may fall back to
                    POST /admin/proxmox/{providerId}/lxc.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-vmid">VMID</Label>
                <Input
                  id="lxc-vmid"
                  type="number"
                  inputMode="numeric"
                  min={100}
                  value={vmid}
                  placeholder="auto (next free)"
                  onChange={(e) => setVmid(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave blank to auto-allocate via NextVMID.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-template">Template *</Label>
                <Input
                  id="lxc-template"
                  value={template}
                  placeholder="local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
                  onChange={(e) => setTemplate(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Must be a vztmpl volume visible on the selected node.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-cpu">CPU (cores) *</Label>
                <Input
                  id="lxc-cpu"
                  type="number"
                  min={1}
                  value={cpu}
                  onChange={(e) => setCpu(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-ram">RAM (MB) *</Label>
                <Input
                  id="lxc-ram"
                  type="number"
                  min={128}
                  step={128}
                  value={ram}
                  onChange={(e) => setRam(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-disk">Disk (GB) *</Label>
                <Input
                  id="lxc-disk"
                  type="number"
                  min={4}
                  value={disk}
                  onChange={(e) => setDisk(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Rootfs on local-lvm (size=...G).</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lxc-password">Root password</Label>
                <Input
                  id="lxc-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  placeholder="auto-generate if blank (no SSH keys)"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Used when no SSH keys are attached; otherwise ignored.</p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="lxc-org">Organization ID (X-Organization-ID)</Label>
                <Input
                  id="lxc-org"
                  value={orgId}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  onChange={(e) => setOrgId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Required for POST /instances (withOrg guard). Prefilled from kilat_org_id when available.
                </p>
              </div>
            </div>

            {submitError ? (
              <Alert variant="destructive">
                <AlertTitle>Failed to create LXC</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitting || !providerId}>
                {submitting ? "Creating…" : "Create container"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/admin/proxmox/${providerId}/containers`}>Back to containers</Link>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Primary: POST /instances {"{ name, region_id, service_kind: 'container', cpu, ram, disk, node, vmid, template, password }"} with{" "}
              X-Organization-ID header. Fallback: POST /admin/proxmox/:id/lxc when the queue route is unavailable.
            </p>
          </form>
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
