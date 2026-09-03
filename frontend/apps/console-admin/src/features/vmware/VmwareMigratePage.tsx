// VMware vMotion wizard — dedicated per-provider page for kind=vmware.
// Endpoints: GET /admin/vmware/:id/migrate (infra, polled 5s) + POST /admin/vmware/:id/migrate (platform_admin).
// Guard kind==vmware via vmwareAdapterFor — non-vmware answers 501 expect vmware.
// Polling contract: useInfraGet intervalMs 5000 like proxmox clone (frontend/apps/console-admin/src/features/proxmox/ProxmoxClonePage.tsx).
import { useCallback, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type HostRow = {
  name?: string
  cpu_threads?: number
  memory_bytes?: number
  power_state?: string
}

type VmRow = {
  external_id?: string
  name?: string
  status?: string
  power_status?: string
  vcpu?: number
  ram_mb?: number
}

interface MigrateStatusPayload {
  provider_id: string
  code: string
  hosts: HostRow[]
  vms: VmRow[]
  total_hosts: number
  total_vms: number
  hint?: string
  example?: Record<string, string>
}

export default function VmwareMigratePage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const base = `/admin/vmware/${providerId}/migrate`

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const status = useInfraGet<MigrateStatusPayload>(providerId && isVmware ? base : null, undefined, { intervalMs: 5000 })

  const [source, setSource] = useState("")
  const [targetHost, setTargetHost] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const hosts: HostRow[] = Array.isArray(status.data?.hosts) ? status.data!.hosts! : []
  const vms: VmRow[] = Array.isArray(status.data?.vms) ? status.data!.vms! : []

  const onPickVm = useCallback((row: VmRow) => {
    if (row.external_id) setSource(row.external_id)
  }, [])

  const onPickHost = useCallback((row: HostRow) => {
    if (row.name) setTargetHost(row.name)
  }, [])

  const canSubmit = Boolean(providerId) && Boolean(source.trim()) && Boolean(targetHost.trim()) && !submitting && !kindMismatch

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const src = source.trim()
      const tgt = targetHost.trim()
      await apiPost(base, { source: src, target_host: tgt })
      toast.success(`vMotion "${src}" → ${tgt} queued (200)`)
      status.reload()
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Migrate failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Migrate" description="VMware per-provider vMotion wizard.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (status.error instanceof ApiError && status.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Migrate" description="VMware per-provider vMotion wizard.">
        <EmptyState
          message="Migrate is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Use Proxmox migrate for proxmox guests or switch to a vmware provider and retry POST /v1/admin/vmware/:id/migrate."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind <Badge variant="destructive">{match.kind}</Badge> — migrate at <span className="font-mono">/admin/vmware/:id/migrate</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Migrate (vMotion)"
      description="POST /admin/vmware/:id/migrate — live vMotion a VM to another ESXi host within the same vCenter. GET /migrate polls every 5s (infra, NOC readable); POST is platform_admin only."
      actions={
        <Button variant="outline" size="sm" onClick={() => status.reload()} disabled={status.loading}>
          {status.loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {providers.error ? <ErrorBanner error={providers.error} /> : null}
      {match ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Provider lookup
              <Badge variant="outline">{match.code}</Badge>
              <Badge variant={isVmware ? "secondary" : "destructive"}>{match.kind}</Badge>
              {match.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="outline">disabled</Badge>}
              <span className="font-mono text-xs text-muted-foreground">{match.id.slice(0, 8)}…</span>
              <Badge variant="outline">{match.health_status || "unknown"}</Badge>
            </CardTitle>
            <CardDescription className="font-mono text-xs">
              api_base_url {match.api_base_url || "—"} · has_credentials {String(match.has_credentials)} · endpoint{" "}
              <span className="font-mono">GET/POST /v1/admin/vmware/:id/migrate</span> — RBAC{" "}
              <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span> (platform_admin only)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — migrate at /admin/vmware/:id/migrate answers 501. Switch to a vmware provider or use proxmox migrate for proxmox.`} />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live inventory/migrate answers HTTP 503 until credentials are configured via the provider editor.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">vMotion wizard</CardTitle>
              <CardDescription>
                Pick a source VM (<span className="font-mono">external_id</span> like <span className="font-mono">VirtualMachine:vm-42</span> or <span className="font-mono">vm-42</span>) and a target ESXi host. The backend calls{" "}
                <span className="font-mono">Adapter.MigrateVM</span> which does{" "}
                <span className="font-mono">finder.HostSystem(target)</span> + <span className="font-mono">VirtualMachine.Relocate</span> (
                <span className="font-mono">RelocateSpec.Host</span>). RBAC:{" "}
                <span className="font-mono">GET /migrate infra</span> · <span className="font-mono">POST /migrate ""</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid w-full max-w-full min-w-0 gap-4">
              <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="migrate-source">Source VM *</Label>
                  <Input
                    id="migrate-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="VirtualMachine:vm-42 or vm-42"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Provider external id — e.g. <span className="font-mono">VirtualMachine:vm-42</span> or bare <span className="font-mono">vm-42</span> (also accepts <span className="font-mono">external_id/vm_id/vm</span> keys). Pick from the VM table below.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="migrate-target">Target host *</Label>
                  <Input
                    id="migrate-target"
                    value={targetHost}
                    onChange={(e) => setTargetHost(e.target.value)}
                    placeholder="esxi-02.example.com"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    ESXi host name as seen in inventory (also accepts <span className="font-mono">target_host/target_node/host/target</span> keys). Pick from the host table below.
                  </p>
                </div>
              </div>

              {submitError ? <ErrorBanner error={submitError} /> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
                  {submitting ? "Migrating…" : "Migrate via vMotion"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSource("")
                    setTargetHost("")
                    setSubmitError(null)
                  }}
                  disabled={submitting}
                >
                  Clear
                </Button>
                <span className="text-xs text-muted-foreground">
                  Calls <span className="font-mono">POST {base}</span> <span className="font-mono">{`{source, target_host}`}</span> — 200 on success, 501 if provider kind is not vmware, 422 if host not found.
                </span>
              </div>
              {status.data?.hint ? <p className="mt-2 text-xs text-muted-foreground">{status.data.hint} — example {JSON.stringify(status.data.example)}</p> : null}
            </CardContent>
          </Card>

          <ErrorBanner error={status.error} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">VMs on this vCenter (polls every 5s)</CardTitle>
                <CardDescription>
                  Managed VMs from <span className="font-mono">GET {base}</span> — <span className="font-mono">useInfraGet intervalMs: 5000</span>. Click Use to fill source.
                  {status.data?.total_vms !== undefined ? ` · ${status.data.total_vms} vm(s)` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleDataTable<VmRow>
                  columns={[
                    { key: "external_id", header: "External ID", render: (row) => <span className="font-mono text-xs">{row.external_id || "—"}</span> },
                    { key: "name", header: "Name", render: (row) => row.name || "—" },
                    { key: "power_status", header: "Power", render: (row) => <Badge variant={row.power_status === "poweredOn" ? "secondary" : "outline"}>{row.power_status || row.status || "—"}</Badge> },
                    {
                      key: "action",
                      header: "",
                      className: "w-20 text-right",
                      render: (row) => (
                        <Button variant="outline" size="sm" onClick={() => onPickVm(row)} disabled={!row.external_id}>
                          Use
                        </Button>
                      ),
                    },
                  ]}
                  rows={vms}
                  loading={status.loading}
                  error={null}
                  getRowKey={(row, idx) => String(row.external_id ?? `vm-${idx}`)}
                  emptyMessage="No managed VMs — verify vCenter credentials, the kilat tag/folder, and that kind is vmware."
                  skeletonRows={5}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">ESXi hosts (polls every 5s)</CardTitle>
                <CardDescription>
                  Hosts from inventory — click Use to fill target. {status.data?.total_hosts !== undefined ? `· ${status.data.total_hosts} host(s)` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleDataTable<HostRow>
                  columns={[
                    { key: "name", header: "Host", render: (row) => <span className="font-mono text-xs">{row.name || "—"}</span> },
                    { key: "cpu_threads", header: "Threads", render: (row) => (row.cpu_threads ?? "—") as unknown as string },
                    { key: "memory_bytes", header: "Memory", render: (row) => formatBytes(row.memory_bytes) },
                    { key: "power_state", header: "Power", render: (row) => <Badge variant={row.power_state === "poweredOn" ? "secondary" : "outline"}>{row.power_state || "—"}</Badge> },
                    {
                      key: "action",
                      header: "",
                      className: "w-20 text-right",
                      render: (row) => (
                        <Button variant="outline" size="sm" onClick={() => onPickHost(row)} disabled={!row.name}>
                          Use
                        </Button>
                      ),
                    },
                  ]}
                  rows={hosts}
                  loading={status.loading}
                  error={null}
                  getRowKey={(row, idx) => String(row.name ?? `host-${idx}`)}
                  emptyMessage="No hosts discovered — check vCenter inventory and provider id."
                  skeletonRows={4}
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </ProviderShell>
  )
}
