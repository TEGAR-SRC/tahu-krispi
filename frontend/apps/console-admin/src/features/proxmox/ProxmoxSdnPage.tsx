import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { StatusBadge } from "@/features/admin/pages/shared"
import type { SdnVnet, SdnZone } from "@/features/admin/pages/providers/types"

const ZONE_TYPES = ["simple", "vlan", "qinq", "vxlan", "evpn"] as const

export default function ProxmoxSdnPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [zones, setZones] = useState<SdnZone[]>([])
  const [vnets, setVnets] = useState<SdnVnet[]>([])
  const [zonesLoading, setZonesLoading] = useState(true)
  const [vnetsLoading, setVnetsLoading] = useState(true)
  const [zonesError, setZonesError] = useState<unknown>(null)
  const [vnetsError, setVnetsError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)

  const [createZoneOpen, setCreateZoneOpen] = useState(false)
  const [editZoneTarget, setEditZoneTarget] = useState<SdnZone | null>(null)
  const [deleteZoneTarget, setDeleteZoneTarget] = useState<SdnZone | null>(null)

  const [createVnetOpen, setCreateVnetOpen] = useState(false)
  const [editVnetTarget, setEditVnetTarget] = useState<SdnVnet | null>(null)
  const [deleteVnetTarget, setDeleteVnetTarget] = useState<SdnVnet | null>(null)

  const reload = useCallback(() => setTick((v) => v + 1), [])

  useEffect(() => {
    if (!providerId) {
      setZonesLoading(false)
      setVnetsLoading(false)
      return
    }
    let cancelled = false
    setZonesLoading(true)
    setVnetsLoading(true)
    setZonesError(null)
    setVnetsError(null)
    apiGet<SdnZone[]>(`${base}/sdn/zones`)
      .then((env) => {
        if (cancelled) return
        setZones(Array.isArray(env.data) ? env.data : [])
        setZonesError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setZonesError(cause)
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    apiGet<SdnVnet[]>(`${base}/sdn/vnets`)
      .then((env) => {
        if (cancelled) return
        setVnets(Array.isArray(env.data) ? env.data : [])
        setVnetsError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setVnetsError(cause)
      })
      .finally(() => {
        if (!cancelled) setVnetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, base, tick])

  const runMutation = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reload()
      done?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  const handleApply = () => {
    void runMutation(() => apiPost(`${base}/sdn/apply`, {}), "SDN configuration applied")
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="SDN" description="Software-defined networking for this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="SDN"
      description="Software-defined networking: zones and virtual networks as configured on the cluster. Zones are L3 domains; VNets are L2 segments bound to a zone. GET is infra-readable (NOC), mutations require platform_admin. POST/PUT/DELETE apply pending config — use Apply to push."
      actions={
        <Button variant="outline" size="sm" disabled={busy} onClick={handleApply}>
          Apply SDN
        </Button>
      }
    >
      <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Zones</CardTitle>
                <CardDescription>Layer-3 domains backing the virtual networks.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setCreateZoneOpen(true)}>
                Create zone
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<SdnZone>
              columns={[
                {
                  key: "zone",
                  header: "Zone",
                  render: (row) => <span className="font-mono text-sm font-medium">{row.zone || "—"}</span>,
                },
                { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type || "—"}</Badge> },
                {
                  key: "state",
                  header: "State",
                  render: (row) => <StatusBadge status={row.state ?? null} />,
                },
                {
                  key: "mtu",
                  header: "MTU",
                  className: "hidden md:table-cell",
                  render: (row) => (row.mtu != null ? String(row.mtu) : "—"),
                },
                {
                  key: "ipam",
                  header: "IPAM / DHCP",
                  className: "hidden lg:table-cell",
                  render: (row) => [row.ipam, row.dhcp].filter(Boolean).join(" · ") || "—",
                },
                {
                  key: "nodes",
                  header: "Nodes",
                  className: "hidden xl:table-cell max-w-40 truncate",
                  render: (row) => (row.nodes as string) || "all",
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-32 text-right",
                  render: (row) => (
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" disabled={!row.zone} onClick={() => setEditZoneTarget(row)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" disabled={!row.zone} onClick={() => setDeleteZoneTarget(row)}>
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={zones}
              loading={zonesLoading}
              error={zonesError}
              getRowKey={(row) => String(row.zone ?? "?")}
              emptyMessage="No SDN zones configured."
              skeletonRows={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">VNets</CardTitle>
                <CardDescription>Virtual networks attached to a zone with optional VLAN/VXLAN tags.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setCreateVnetOpen(true)}>
                Create VNet
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<SdnVnet>
              columns={[
                {
                  key: "vnet",
                  header: "VNet",
                  render: (row) => <span className="font-mono text-sm font-medium">{row.vnet || "—"}</span>,
                },
                { key: "zone", header: "Zone", render: (row) => (row.zone as string) || "—" },
                {
                  key: "tag",
                  header: "Tag",
                  render: (row) => (row.tag != null ? String(row.tag) : "—"),
                },
                {
                  key: "alias",
                  header: "Alias",
                  className: "hidden md:table-cell",
                  render: (row) => (row.alias as string) || "—",
                },
                {
                  key: "vlanaware",
                  header: "VLAN aware",
                  className: "hidden lg:table-cell",
                  render: (row) => (row.vlanaware === 1 || row.vlanaware === undefined ? "yes" : "no"),
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-32 text-right",
                  render: (row) => (
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" disabled={!row.vnet} onClick={() => setEditVnetTarget(row)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" disabled={!row.vnet} onClick={() => setDeleteVnetTarget(row)}>
                        Delete
                      </Button>
                    </div>
                  ),
                },
              ]}
              rows={vnets}
              loading={vnetsLoading}
              error={vnetsError}
              getRowKey={(row) => String(row.vnet ?? "?")}
              emptyMessage="No VNets configured."
              skeletonRows={3}
            />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Endpoints:{" "}
        <span className="font-mono">GET /admin/proxmox/:id/sdn/zones</span> ·{" "}
        <span className="font-mono">GET /admin/proxmox/:id/sdn/vnets</span> ·{" "}
        <span className="font-mono">POST /admin/proxmox/:id/sdn/zones</span> ·{" "}
        <span className="font-mono">PUT /admin/proxmox/:id/sdn/zones/:zone</span> ·{" "}
        <span className="font-mono">DELETE /admin/proxmox/:id/sdn/zones/:zone</span> ·{" "}
        <span className="font-mono">POST /admin/proxmox/:id/sdn/vnets</span> ·{" "}
        <span className="font-mono">PUT /admin/proxmox/:id/sdn/vnets/:vnet</span> ·{" "}
        <span className="font-mono">DELETE /admin/proxmox/:id/sdn/vnets/:vnet</span> ·{" "}
        <span className="font-mono">POST /admin/proxmox/:id/sdn/apply</span>
      </p>

      <CreateZoneDialog
        open={createZoneOpen}
        busy={busy}
        onOpenChange={setCreateZoneOpen}
        onSubmit={(body, done) =>
          void runMutation(() => apiPost(`${base}/sdn/zones`, body), `Zone ${String(body.zone)} created`, done)
        }
      />

      {editZoneTarget?.zone ? (
        <EditZoneDialog
          open
          target={editZoneTarget}
          busy={busy}
          onOpenChange={(open) => !open && setEditZoneTarget(null)}
          onSubmit={(body, done) =>
            void runMutation(
              () => apiPut(`${base}/sdn/zones/${encodeURIComponent(String(editZoneTarget.zone))}`, body),
              `Zone ${editZoneTarget.zone} updated`,
              done,
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteZoneTarget !== null}
        onOpenChange={(open) => !open && setDeleteZoneTarget(null)}
        title={`Delete zone "${deleteZoneTarget?.zone}"?`}
        body="Removes the SDN zone from the cluster configuration. VNets still referencing this zone will need to be migrated or removed before apply succeeds."
        confirmLabel="Delete zone"
        busy={busy}
        onConfirm={() => {
          const target = deleteZoneTarget
          setDeleteZoneTarget(null)
          if (!target?.zone) return
          void runMutation(
            () => apiDelete(`${base}/sdn/zones/${encodeURIComponent(String(target.zone))}`),
            `Zone ${target.zone} deleted`,
          )
        }}
      />

      <CreateVnetDialog
        open={createVnetOpen}
        busy={busy}
        zones={zones}
        onOpenChange={setCreateVnetOpen}
        onSubmit={(body, done) =>
          void runMutation(() => apiPost(`${base}/sdn/vnets`, body), `VNet ${String(body.vnet)} created`, done)
        }
      />

      {editVnetTarget?.vnet ? (
        <EditVnetDialog
          open
          target={editVnetTarget}
          busy={busy}
          zones={zones}
          onOpenChange={(open) => !open && setEditVnetTarget(null)}
          onSubmit={(body, done) =>
            void runMutation(
              () => apiPut(`${base}/sdn/vnets/${encodeURIComponent(String(editVnetTarget.vnet))}`, body),
              `VNet ${editVnetTarget.vnet} updated`,
              done,
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteVnetTarget !== null}
        onOpenChange={(open) => !open && setDeleteVnetTarget(null)}
        title={`Delete VNet "${deleteVnetTarget?.vnet}"?`}
        body="Removes the virtual network from the SDN configuration. Guests attached to this VNet will lose network on next apply."
        confirmLabel="Delete VNet"
        busy={busy}
        onConfirm={() => {
          const target = deleteVnetTarget
          setDeleteVnetTarget(null)
          if (!target?.vnet) return
          void runMutation(
            () => apiDelete(`${base}/sdn/vnets/${encodeURIComponent(String(target.vnet))}`),
            `VNet ${target.vnet} deleted`,
          )
        }}
      />
    </ProviderShell>
  )
}

interface ZoneDialogProps {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

function CreateZoneDialog({ open, busy, onOpenChange, onSubmit }: ZoneDialogProps) {
  const [zone, setZone] = useState("")
  const [type, setType] = useState<string>("vxlan")
  const [ipam, setIpam] = useState("pve")
  const [dhcp, setDhcp] = useState("")
  const [mtu, setMtu] = useState("")
  const [nodes, setNodes] = useState("")

  const submit = () => {
    if (!zone.trim()) {
      toast.error("Zone name is required.")
      return
    }
    if (!type.trim()) {
      toast.error("Type is required.")
      return
    }
    const body: Record<string, unknown> = { zone: zone.trim(), type: type.trim() }
    if (ipam.trim()) body.ipam = ipam.trim()
    if (dhcp.trim()) body.dhcp = dhcp.trim()
    if (mtu.trim()) {
      const n = Number(mtu.trim())
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("MTU must be a positive number.")
        return
      }
      body.mtu = n
    }
    if (nodes.trim()) body.nodes = nodes.trim()
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create SDN zone</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/sdn/zones — zone + type are mandatory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sdn-zone-name">Zone *</Label>
            <Input id="sdn-zone-name" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-zone-type">Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="sdn-zone-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-ipam">IPAM</Label>
              <Input id="sdn-zone-ipam" value={ipam} onChange={(e) => setIpam(e.target.value)} placeholder="pve" />
              <p className="text-xs text-muted-foreground">pve or an external IPAM id.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-dhcp">DHCP</Label>
              <Input id="sdn-zone-dhcp" value={dhcp} onChange={(e) => setDhcp(e.target.value)} placeholder="dnsmasq or empty" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-mtu">MTU</Label>
              <Input id="sdn-zone-mtu" inputMode="numeric" value={mtu} onChange={(e) => setMtu(e.target.value)} placeholder="1450" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-nodes">Nodes</Label>
              <Input id="sdn-zone-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="pve01,pve02 or empty = all" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || zone.trim() === ""} onClick={submit}>
            {busy ? "Creating…" : "Create zone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditZoneDialog({
  open,
  busy,
  target,
  onOpenChange,
  onSubmit,
}: ZoneDialogProps & { target: SdnZone }) {
  const [type, setType] = useState((target.type as string) || "vxlan")
  const [ipam, setIpam] = useState((target.ipam as string) || "")
  const [dhcp, setDhcp] = useState((target.dhcp as string) || "")
  const [mtu, setMtu] = useState(target.mtu != null ? String(target.mtu) : "")
  const [nodes, setNodes] = useState((target.nodes as string) || "")

  const submit = () => {
    const body: Record<string, unknown> = { zone: target.zone, type: type.trim() }
    if (ipam.trim()) body.ipam = ipam.trim()
    if (dhcp.trim()) body.dhcp = dhcp.trim()
    else body.dhcp = ""
    if (mtu.trim()) {
      const n = Number(mtu.trim())
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("MTU must be a positive number.")
        return
      }
      body.mtu = n
    } else {
      body.mtu = 0
    }
    if (nodes.trim()) body.nodes = nodes.trim()
    else body.nodes = ""
    body.zone = target.zone
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit zone {target.zone}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/sdn/zones/:zone — zone name is immutable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Zone</Label>
            <Input value={String(target.zone)} disabled className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-zone-edit-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="sdn-zone-edit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-edit-ipam">IPAM</Label>
              <Input id="sdn-zone-edit-ipam" value={ipam} onChange={(e) => setIpam(e.target.value)} placeholder="pve" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-edit-dhcp">DHCP</Label>
              <Input id="sdn-zone-edit-dhcp" value={dhcp} onChange={(e) => setDhcp(e.target.value)} placeholder="dnsmasq or empty" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-edit-mtu">MTU</Label>
              <Input id="sdn-zone-edit-mtu" inputMode="numeric" value={mtu} onChange={(e) => setMtu(e.target.value)} placeholder="1450" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-zone-edit-nodes">Nodes</Label>
              <Input id="sdn-zone-edit-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="pve01,pve02 or empty = all" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface VnetDialogProps {
  open: boolean
  busy: boolean
  zones: SdnZone[]
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}

function CreateVnetDialog({ open, busy, zones, onOpenChange, onSubmit }: VnetDialogProps) {
  const [vnet, setVnet] = useState("")
  const [zone, setZone] = useState("")
  const [alias, setAlias] = useState("")
  const [tag, setTag] = useState("")
  const [vlanaware, setVlanaware] = useState("1")

  const submit = () => {
    if (!vnet.trim()) {
      toast.error("VNet name is required.")
      return
    }
    if (!zone.trim()) {
      toast.error("Zone is required.")
      return
    }
    const body: Record<string, unknown> = { vnet: vnet.trim(), zone: zone.trim() }
    if (alias.trim()) body.alias = alias.trim()
    if (tag.trim()) {
      const n = Number(tag.trim())
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Tag must be a non-negative number.")
        return
      }
      body.tag = n
    }
    body.vlanaware = vlanaware === "1" ? 1 : 0
    body.type = "vnet"
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create VNet</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/sdn/vnets — vnet + zone are mandatory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sdn-vnet-name">VNet *</Label>
            <Input id="sdn-vnet-name" value={vnet} onChange={(e) => setVnet(e.target.value)} placeholder="vnet10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-vnet-zone">Zone *</Label>
            {zones.length > 0 ? (
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger id="sdn-vnet-zone">
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={String(z.zone)} value={String(z.zone)}>
                      {String(z.zone)} ({String(z.type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="sdn-vnet-zone" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone1" />
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-vnet-alias">Alias</Label>
              <Input id="sdn-vnet-alias" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Departemen A" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-vnet-tag">Tag</Label>
              <Input id="sdn-vnet-tag" inputMode="numeric" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="10 for VLAN / 10000 for VXLAN" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-vnet-vlanaware">VLAN aware</Label>
            <Select value={vlanaware} onValueChange={setVlanaware}>
              <SelectTrigger id="sdn-vnet-vlanaware">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">yes (1)</SelectItem>
                <SelectItem value="0">no (0)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || vnet.trim() === "" || zone.trim() === ""} onClick={submit}>
            {busy ? "Creating…" : "Create VNet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditVnetDialog({
  open,
  busy,
  target,
  zones,
  onOpenChange,
  onSubmit,
}: VnetDialogProps & { target: SdnVnet }) {
  const [zone, setZone] = useState((target.zone as string) || "")
  const [alias, setAlias] = useState((target.alias as string) || "")
  const [tag, setTag] = useState(target.tag != null ? String(target.tag) : "")
  const [vlanaware, setVlanaware] = useState(String(target.vlanaware ?? 1))

  const submit = () => {
    if (!zone.trim()) {
      toast.error("Zone is required.")
      return
    }
    const body: Record<string, unknown> = { vnet: target.vnet, zone: zone.trim() }
    if (alias.trim()) body.alias = alias.trim()
    else body.alias = ""
    if (tag.trim()) {
      const n = Number(tag.trim())
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Tag must be a non-negative number.")
        return
      }
      body.tag = n
    } else {
      body.tag = 0
    }
    body.vlanaware = vlanaware === "1" ? 1 : 0
    body.type = "vnet"
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit VNet {target.vnet}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/sdn/vnets/:vnet — VNet name is immutable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>VNet</Label>
            <Input value={String(target.vnet)} disabled className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-vnet-edit-zone">Zone</Label>
            {zones.length > 0 ? (
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger id="sdn-vnet-edit-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={String(z.zone)} value={String(z.zone)}>
                      {String(z.zone)} ({String(z.type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="sdn-vnet-edit-zone" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="zone1" />
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sdn-vnet-edit-alias">Alias</Label>
              <Input id="sdn-vnet-edit-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sdn-vnet-edit-tag">Tag</Label>
              <Input id="sdn-vnet-edit-tag" inputMode="numeric" value={tag} onChange={(e) => setTag(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sdn-vnet-edit-vlanaware">VLAN aware</Label>
            <Select value={vlanaware} onValueChange={setVlanaware}>
              <SelectTrigger id="sdn-vnet-edit-vlanaware">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">yes (1)</SelectItem>
                <SelectItem value="0">no (0)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
