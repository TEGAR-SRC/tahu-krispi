// VMware hosts — dedicated per-provider page for kind=vmware.
// Endpoint: GET /admin/vmware/:id/hosts (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Route: /admin/vmware/:providerId/hosts → row links to /hosts/:host
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

interface HostsPayload {
  provider_id: string
  code: string
  hosts: HostRow[]
}

export default function VmwareHostsPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(
    () => providers.data?.find((row) => row.id === providerId) ?? null,
    [providers.data, providerId],
  )
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const hostsState = useInfraGet<HostsPayload>(
    providerId && isVmware ? `/admin/vmware/${providerId}/hosts` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="VMware hosts" description="ESXi hosts from vCenter inventory.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (hostsState.error instanceof ApiError && hostsState.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware hosts" description="ESXi hosts from vCenter inventory.">
        <EmptyState
          message="Hosts are only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Use the Nodes console for Proxmox, or the Onidel catalog for Onidel. Switch to a vmware provider and retry GET /v1/admin/vmware/:id/hosts."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — hosts at{" "}
              <span className="font-mono">/admin/vmware/:id/hosts</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const hosts = hostsState.data?.hosts ?? []

  const description =
    hostsState.loading || hostsState.error
      ? "ESXi hosts with thread count, memory and power state — polls every 5s."
      : `${hosts.length} host(s) · ${hostsState.data?.code ?? ""}`

  return (
    <ProviderShell providerId={providerId} title="VMware hosts" description={description}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/hosts</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — hosts at /admin/vmware/:id/hosts answers 501 for non-vmware kinds (guard kind==vmware). Use the Proxmox nodes at /admin/proxmox/:id/nodes for this provider.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live hosts answer HTTP 503 until an API key is configured via the provider editor. The table below will stay empty until credentials are set.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => hostsState.reload()} disabled={hostsState.loading}>
              {hostsState.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/datastores`}>Datastores</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/hosts</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>.
            </span>
          </div>

          <ErrorBanner error={hostsState.error} />

          {!hostsState.loading && !hostsState.error && hosts.length === 0 ? (
            <EmptyState
              message="No hosts discovered."
              description="Verify vCenter credentials, datacenter scope and that the provider kind is vmware. The per-provider endpoint is GET /v1/admin/vmware/:id/hosts (vmwareAdapterFor)."
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hosts</CardTitle>
              <CardDescription>ESXi hosts with thread count, memory and power state. Click a host name to open its detail page.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<HostRow>
                columns={[
                  {
                    key: "name",
                    header: "Host",
                    render: (row) =>
                      row.name ? (
                        <Link
                          to={`/admin/vmware/${providerId}/hosts/${encodeURIComponent(row.name)}`}
                          className="font-mono text-xs font-medium text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">—</span>
                      ),
                  },
                  { key: "cpu_threads", header: "Threads", render: (row) => (row.cpu_threads ?? "—") as unknown as string },
                  { key: "memory_bytes", header: "Memory", render: (row) => formatBytes(row.memory_bytes) },
                  {
                    key: "power_state",
                    header: "Power",
                    render: (row) => (
                      <Badge variant={row.power_state === "poweredOn" ? "secondary" : "outline"}>{row.power_state || "—"}</Badge>
                    ),
                  },
                ]}
                rows={hosts}
                loading={hostsState.loading}
                error={null}
                getRowKey={(row, index) => String(row.name ?? `host-${index}`)}
                emptyMessage="No hosts discovered."
                skeletonRows={4}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </ProviderShell>
  )
}
