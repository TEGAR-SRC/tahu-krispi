// Proxmox clone — per-provider VM (qemu) + LXC clone.
// Endpoint: POST /admin/proxmox/:id/clone {source, name} — proxmoxAdapterFor guard kind==proxmox,
// RBAC: GET /clone requireStaff infra (NOC readable, finance 403), POST /clone requireStaff "" (platform_admin only, NOC 403).
// Realtime: GET /clone polled every 5s via useInfraGet intervalMs 5000 (websocket not available for this surface; polling is the contract).
// Adapter: backend/internal/provider/proxmox/provider.go CloneVM now branches on "ct" prefix — qemu via QEMUClone, lxc via ContainerClone (Full:true).
// Worker: cmd/worker cloneInstance no longer rejects service_kind=container — ct* external ids flow through CloneVM's container branch.
import { useCallback, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface CloneStatusPayload {
  nodes?: Array<{ node?: string; name?: string; status?: string }>
  guests?: Array<{ id?: string; type?: string; vmid?: number; name?: string; node?: string; status?: string; tags?: string; pool?: string }>
  total?: number
  hint?: string
  example?: Record<string, string>
}

type GuestRow = NonNullable<CloneStatusPayload["guests"]>[number]

export default function ProxmoxClonePage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}/clone`

  const status = useInfraGet<CloneStatusPayload>(providerId ? `/admin/proxmox/${providerId}/clone` : null, undefined, {
    intervalMs: 5000,
  })

  const [source, setSource] = useState("")
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const guests: GuestRow[] = Array.isArray(status.data?.guests) ? status.data!.guests! : []

  const onPickGuest = useCallback((row: GuestRow) => {
    const vmid = row.vmid ? String(row.vmid) : ""
    const derived = row.type === "lxc" ? `ct${vmid}` : vmid
    setSource(derived)
  }, [])

  const canSubmit = Boolean(providerId) && Boolean(source.trim()) && Boolean(name.trim()) && !submitting

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const src = source.trim()
      const nm = name.trim()
      await apiPost(base, { source: src, name: nm })
      const kind = src.startsWith("ct") ? "LXC" : "VM"
      toast.success(`${kind} clone "${nm}" from ${src} queued (201)`)
      setSource("")
      status.reload()
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Clone failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Clone" description="Proxmox per-provider clone — VM (qemu) + LXC.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  const isLxcSource = source.trim().startsWith("ct")

  return (
    <ProviderShell
      providerId={providerId}
      title="Clone (VM + LXC)"
      description="POST /admin/proxmox/:id/clone — full copy clone for both qemu guests (numeric VMID, e.g. 101) and LXC containers (ct101). GET /clone polls every 5s (infra, NOC readable); POST is platform_admin only."
      actions={
        <Button variant="outline" size="sm" onClick={() => status.reload()} disabled={status.loading}>
          {status.loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clone a guest</CardTitle>
          <CardDescription>
            Source is the <span className="font-mono">VMID</span> for VMs (<span className="font-mono">101</span>) or{" "}
            <span className="font-mono">ct101</span> for LXC. The backend&apos;s{" "}
            <span className="font-mono">CloneVM</span> branches on the <span className="font-mono">ct</span> prefix —{" "}
            <span className="font-mono">QEMUClone</span> for qemu, <span className="font-mono">ContainerClone</span> (Full:true) for
            lxc. RBAC: <span className="font-mono">GET /clone infra</span> · <span className="font-mono">POST /clone &quot;&quot;</span>{" "}
            (platform_admin only).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid w-full max-w-full min-w-0 gap-4">
          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clone-source">Source *</Label>
              <Input
                id="clone-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={isLxcSource ? "ct101" : "101"}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Numeric VMID for VMs or <span className="font-mono">ct&lt;vmid&gt;</span> for LXC (e.g.{" "}
                <span className="font-mono">ct101</span>). Pick from the table below.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clone-name">New name *</Label>
              <Input
                id="clone-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="web-01-clone"
                autoComplete="off"
                maxLength={64}
              />
              <p className="text-xs text-muted-foreground">Target hostname — max 64 chars. Maps to PVE newid hostname.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isLxcSource ? "secondary" : "outline"}>{isLxcSource ? "LXC clone" : "VM clone (qemu)"}</Badge>
            <span className="text-xs text-muted-foreground">
              Full copy (<span className="font-mono">Full:true</span>) — linked clones not used; storage override forces full.
            </span>
          </div>

          {submitError ? <ErrorBanner error={submitError} /> : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
              {submitting ? "Cloning…" : isLxcSource ? "Clone LXC" : "Clone VM"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSource("")
                setName("")
                setSubmitError(null)
              }}
              disabled={submitting}
            >
              Clear
            </Button>
            <span className="text-xs text-muted-foreground">
              Calls <span className="font-mono">POST {base}</span> <span className="font-mono">{`{source, name}`}</span> — 201 on success, 501 if provider kind is not proxmox.
            </span>
          </div>
        </CardContent>
      </Card>

      <ErrorBanner error={status.error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Guests on this cluster (polls every 5s)</CardTitle>
          <CardDescription>
            Live guest inventory from <span className="font-mono">GET {base}</span> —{" "}
            <span className="font-mono">useInfraGet</span> with{" "}
            <span className="font-mono">intervalMs: 5000</span>. Click a row to fill the source field.
            {status.data?.total !== undefined ? ` · ${status.data.total} guest(s)` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<GuestRow>
            columns={[
              {
                key: "type",
                header: "Kind",
                render: (row) => (
                  <Badge variant={row.type === "lxc" ? "secondary" : "outline"}>{row.type || "—"}</Badge>
                ),
              },
              {
                key: "vmid",
                header: "VMID",
                render: (row) => <span className="font-mono text-xs">{row.vmid ?? "—"}</span>,
              },
              {
                key: "source",
                header: "Clone source",
                render: (row) => {
                  const vmid = row.vmid ? String(row.vmid) : ""
                  const src = row.type === "lxc" ? `ct${vmid}` : vmid
                  return <span className="font-mono text-xs">{src || "—"}</span>
                },
              },
              { key: "name", header: "Name", render: (row) => row.name || "—" },
              { key: "node", header: "Node", render: (row) => row.node || "—" },
              { key: "status", header: "Status", render: (row) => row.status || "—" },
              {
                key: "action",
                header: "",
                className: "w-28 text-right",
                render: (row) => (
                  <Button variant="outline" size="sm" onClick={() => onPickGuest(row)}>
                    Use
                  </Button>
                ),
              },
            ]}
            rows={guests}
            loading={status.loading}
            error={null}
            getRowKey={(row, idx) => String(row.id ?? `${row.type}-${row.vmid}-${idx}`)}
            emptyMessage="No qemu/lxc guests reported — verify PVE credentials and that the provider kind is proxmox."
            skeletonRows={5}
          />
          {!status.loading && !status.error && guests.length === 0 ? (
            <EmptyState
              message="No guests found"
              description="The clone status endpoint returned no guests — check the provider id, kind is proxmox, and PVE is reachable. Both VMs (qemu) and LXC (ct*) appear here when present."
            />
          ) : null}
          {status.data?.hint ? <p className="mt-2 text-xs text-muted-foreground">{status.data.hint}</p> : null}
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
