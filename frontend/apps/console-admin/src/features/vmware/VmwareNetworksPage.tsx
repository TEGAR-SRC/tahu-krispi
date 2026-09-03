// VMware networks — dedicated per-provider page for kind=vmware.
// Endpoint: GET /admin/vmware/:id/networks (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Route: /admin/vmware/:providerId/networks
import { useMemo, useState } from "react"
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
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type NetworkRow = {
  name?: string
  type?: string
  accessible?: boolean
  host_count?: number
  vm_count?: number
  inventory_path?: string
  opaque_network_id?: string
  opaque_network_type?: string
}

interface NetworksPayload {
  provider_id: string
  code: string
  networks: NetworkRow[]
}

export default function VmwareNetworksPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(
    () => providers.data?.find((row) => row.id === providerId) ?? null,
    [providers.data, providerId],
  )
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const networksState = useInfraGet<NetworksPayload>(
    providerId && isVmware ? `/admin/vmware/${providerId}/networks` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkRow | null>(null)

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="VMware networks" description="Networks / portgroups from vCenter inventory.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (networksState.error instanceof ApiError && networksState.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware networks" description="Networks / portgroups from vCenter inventory.">
        <EmptyState
          message="Networks are only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Use the SDN consoles for Proxmox, or the Onidel catalog for Onidel. Switch to a vmware provider and retry GET /v1/admin/vmware/:id/networks."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — networks at{" "}
              <span className="font-mono">/admin/vmware/:id/networks</span> requires{" "}
              <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const networks = networksState.data?.networks ?? []

  const description =
    networksState.loading || networksState.error
      ? "Networks and portgroups from vCenter inventory — polls every 5s."
      : `${networks.length} network(s) · ${networksState.data?.code ?? ""}`

  return (
    <ProviderShell providerId={providerId} title="VMware networks" description={description}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/networks</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — networks at /admin/vmware/:id/networks answers 501 for non-vmware kinds (guard kind==vmware). Use the Proxmox SDN at /admin/proxmox/:id/sdn for this provider.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live networks answer HTTP 503 until an API key is configured via the provider editor. The table below will stay empty until credentials are set.
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
            <Button variant="outline" size="sm" onClick={() => networksState.reload()} disabled={networksState.loading}>
              {networksState.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/hosts`}>Hosts</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/datastores`}>Datastores</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/networks</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>. Click a row to inspect its raw payload below.
            </span>
          </div>

          <ErrorBanner error={networksState.error} />

          {!networksState.loading && !networksState.error && networks.length === 0 ? (
            <EmptyState
              message="No networks discovered."
              description="Verify vCenter credentials, datacenter scope and that the provider kind is vmware. The per-provider endpoint is GET /v1/admin/vmware/:id/networks (vmwareAdapterFor)."
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Networks</CardTitle>
              <CardDescription>Portgroups and virtual networks with attachment counts. Click a row to drill into its raw record.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<NetworkRow>
                columns={[
                  { key: "name", header: "Network" },
                  { key: "type", header: "Type" },
                  {
                    key: "accessible",
                    header: "Accessible",
                    render: (row) => (
                      <Badge variant={row.accessible ? "secondary" : "outline"}>{row.accessible ? "yes" : "no"}</Badge>
                    ),
                  },
                  { key: "host_count", header: "Hosts", render: (row) => String(row.host_count ?? "—") },
                  { key: "vm_count", header: "VMs", render: (row) => String(row.vm_count ?? "—") },
                ]}
                rows={networks}
                loading={networksState.loading}
                error={null}
                getRowKey={(row, index) => String(row.name ?? `net-${index}`)}
                emptyMessage="No networks discovered."
                skeletonRows={4}
              />
              <div className="mt-3 grid gap-2">
                {networks.map((row, index) => (
                  <div
                    key={String(row.name ?? `net-${index}`)}
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${selectedNetwork === row ? "border-primary bg-muted" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedNetwork(row)}
                      className="text-left hover:underline"
                    >
                      <span className="font-mono font-medium">{row.name || `net-${index}`}</span>
                      <span className="ml-2 text-muted-foreground">
                        {row.type || "—"} · {String(row.host_count ?? "—")} hosts · {String(row.vm_count ?? "—")} VMs
                        {row.inventory_path ? ` · ${row.inventory_path}` : ""}
                      </span>
                      <span className="ml-2 text-primary">→ inspect</span>
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedNetwork ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Network drill-down — {selectedNetwork.name || "—"}</CardTitle>
                <CardDescription>Raw network record from Adapter.Networks via /admin/vmware/:id/networks projection.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                    <dd className="font-mono text-xs">{selectedNetwork.name || "—"}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Type</dt>
                    <dd className="font-mono text-xs">{selectedNetwork.type || "—"}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Accessible</dt>
                    <dd className="font-mono text-xs">{selectedNetwork.accessible ? "yes" : "no"}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Hosts / VMs</dt>
                    <dd className="font-mono text-xs">
                      {String(selectedNetwork.host_count ?? "—")} / {String(selectedNetwork.vm_count ?? "—")}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Inventory path</dt>
                    <dd className="font-mono text-xs break-all">{selectedNetwork.inventory_path || "—"}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Opaque ID</dt>
                    <dd className="font-mono text-xs">{selectedNetwork.opaque_network_id || "—"}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">Opaque type</dt>
                    <dd className="font-mono text-xs">{selectedNetwork.opaque_network_type || "—"}</dd>
                  </div>
                </dl>
                <JsonBlock value={selectedNetwork} />
                <Button variant="outline" size="sm" onClick={() => setSelectedNetwork(null)}>
                  Clear selection
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-xs text-muted-foreground">Select a network row above to see its drill-down.</p>
          )}
        </>
      ) : null}
    </ProviderShell>
  )
}
