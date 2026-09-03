// VMware vSphere inventory — dedicated per-provider page for kind=vmware.
// Endpoint: GET /admin/vmware/:id/inventory (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Also handles legacy 501/503.
// Shows hosts/datastores/clusters/resource pools with row-level drill-down.
import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type HostRow = {
  name?: string
  cpu_threads?: number
  memory_bytes?: number
  power_state?: string
}

type DatastoreRow = {
  name?: string
  type?: string
  capacity_bytes?: number
  capacity?: number
  free_bytes?: number
  freeBytes?: number
}

interface InventoryPayload {
  provider_id: string
  code: string
  hosts: HostRow[]
  datastores: DatastoreRow[]
  clusters: string[]
  resource_pools: string[]
}

function getCapacity(row: DatastoreRow): number | undefined {
  if (typeof row.capacity_bytes === "number") return row.capacity_bytes
  if (typeof row.capacity === "number") return row.capacity
  return undefined
}

function getFree(row: DatastoreRow): number | undefined {
  if (typeof row.free_bytes === "number") return row.free_bytes
  if (typeof row.freeBytes === "number") return row.freeBytes
  return undefined
}

export default function VmwareInventoryPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(
    () => providers.data?.find((row) => row.id === providerId) ?? null,
    [providers.data, providerId],
  )
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const inventory = useInfraGet<InventoryPayload>(
    providerId && isVmware ? `/admin/vmware/${providerId}/inventory` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const [selectedHost, setSelectedHost] = useState<HostRow | null>(null)
  const [selectedDs, setSelectedDs] = useState<DatastoreRow | null>(null)
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
  const [selectedPool, setSelectedPool] = useState<string | null>(null)

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="vSphere inventory" description="Raw vCenter infrastructure view.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (inventory.error instanceof ApiError && inventory.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="vSphere inventory" description="Raw vCenter infrastructure view.">
        <EmptyState
          message="Inventory is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Use the Nodes / Ceph / Storages consoles for Proxmox, or the Onidel catalog for Onidel. Switch to a vmware provider and retry GET /v1/admin/vmware/:id/inventory."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — inventory at{" "}
              <span className="font-mono">/admin/vmware/:id/inventory</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const hosts = inventory.data?.hosts ?? []
  const datastores = inventory.data?.datastores ?? []
  const clusters = inventory.data?.clusters ?? []
  const pools = inventory.data?.resource_pools ?? []

  const description =
    inventory.loading || inventory.error
      ? "Hosts, datastores, clusters and resource pools from vCenter."
      : `${hosts.length} host(s) · ${datastores.length} datastore(s) · ${clusters.length} cluster(s) · ${pools.length} pool(s)`

  return (
    <ProviderShell providerId={providerId} title="vSphere inventory" description={description}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/inventory</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — inventory at /admin/vmware/:id/inventory answers 501 for non-vmware kinds (guard kind==vmware). Use the Proxmox tree at /admin/proxmox/:id/* for this provider.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live inventory answers HTTP 503 until an API key is configured via the provider editor. The table below will stay empty until credentials are set.
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
            <Button variant="outline" size="sm" onClick={() => inventory.reload()} disabled={inventory.loading}>
              {inventory.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/create`}>Create VM</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Drill-down: click a row to inspect its raw payload below. Tables use{" "}
              <span className="font-mono">SimpleDataTable</span> + <span className="font-mono">ProviderShell</span>.
            </span>
          </div>

          <ErrorBanner error={inventory.error} />

          {!inventory.loading && !inventory.error && hosts.length === 0 && datastores.length === 0 && clusters.length === 0 && pools.length === 0 ? (
            <EmptyState
              message="The inventory came back empty."
              description="Verify vCenter credentials, datacenter scope and that the provider kind is vmware. The per-provider endpoint is GET /v1/admin/vmware/:id/inventory (vmwareAdapterFor)."
            />
          ) : null}

          <Tabs defaultValue="hosts" className="gap-4">
            <TabsList className="flex-wrap">
              <TabsTrigger value="hosts">Hosts ({hosts.length})</TabsTrigger>
              <TabsTrigger value="datastores">Datastores ({datastores.length})</TabsTrigger>
              <TabsTrigger value="clusters">Clusters ({clusters.length})</TabsTrigger>
              <TabsTrigger value="pools">Pools ({pools.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="hosts" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Hosts</CardTitle>
                  <CardDescription>
                    ESXi hosts with thread count, memory and power state. Click a row to drill into its raw record.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SimpleDataTable<HostRow>
                    columns={[
                      { key: "name", header: "Host", render: (row) => <span className="font-mono text-xs">{row.name || "—"}</span> },
                      { key: "cpu_threads", header: "Threads", render: (row) => (row.cpu_threads ?? "—") as unknown as string },
                      { key: "memory_bytes", header: "Memory", render: (row) => formatBytes(row.memory_bytes) },
                      {
                        key: "power_state",
                        header: "Power",
                        render: (row) => (
                          <Badge variant={row.power_state === "poweredOn" ? "secondary" : "outline"}>
                            {row.power_state || "—"}
                          </Badge>
                        ),
                      },
                    ]}
                    rows={hosts}
                    loading={inventory.loading}
                    error={null}
                    getRowKey={(row, index) => String(row.name ?? `host-${index}`)}
                    emptyMessage="No hosts discovered."
                    skeletonRows={4}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Tip: click any row to load its drill-down card below (selected host is highlighted via click handler on wrapper).
                  </p>
                  <div className="mt-3 grid gap-2">
                    {hosts.map((row, index) => (
                      <button
                        key={String(row.name ?? `host-${index}`)}
                        type="button"
                        onClick={() => setSelectedHost(row)}
                        className={`rounded-md border px-3 py-2 text-left text-xs hover:bg-muted ${selectedHost === row ? "border-primary bg-muted" : ""}`}
                      >
                        <span className="font-mono font-medium">{row.name || `host-${index}`}</span>
                        <span className="ml-2 text-muted-foreground">
                          {row.cpu_threads ?? "—"} threads · {formatBytes(row.memory_bytes)} · {row.power_state || "—"}
                        </span>
                        <span className="ml-2 text-primary">→ inspect</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {selectedHost ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Host drill-down — {selectedHost.name || "—"}</CardTitle>
                    <CardDescription>Raw host record from InventoryReport.Hosts plus derived memory.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                        <dd className="font-mono text-xs">{selectedHost.name || "—"}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">CPU threads</dt>
                        <dd className="font-mono text-xs">{selectedHost.cpu_threads ?? "—"}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Memory</dt>
                        <dd className="font-mono text-xs">{formatBytes(selectedHost.memory_bytes)}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Power</dt>
                        <dd>
                          <Badge variant={selectedHost.power_state === "poweredOn" ? "secondary" : "outline"}>
                            {selectedHost.power_state || "—"}
                          </Badge>
                        </dd>
                      </div>
                    </dl>
                    <JsonBlock value={selectedHost} />
                    <Button variant="outline" size="sm" onClick={() => setSelectedHost(null)}>
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground">Select a host row above to see its drill-down.</p>
              )}
            </TabsContent>

            <TabsContent value="datastores" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Datastores</CardTitle>
                  <CardDescription>Capacity versus free space with usage bar. Click a row to drill into its raw record.</CardDescription>
                </CardHeader>
                <CardContent>
                  <SimpleDataTable<DatastoreRow>
                    columns={[
                      { key: "name", header: "Datastore", render: (row) => <span className="font-mono text-xs">{row.name || "—"}</span> },
                      { key: "type", header: "Type" },
                      { key: "capacity_bytes", header: "Capacity", render: (row) => formatBytes(getCapacity(row)) },
                      {
                        key: "free_bytes",
                        header: "Free",
                        render: (row) => {
                          const cap = getCapacity(row)
                          const free = getFree(row)
                          const share = typeof free === "number" && typeof cap === "number" && cap > 0 ? (free / cap) * 100 : null
                          return `${formatBytes(free)}${share !== null ? ` (${share.toFixed(0)}%)` : ""}`
                        },
                      },
                      {
                        key: "usage",
                        header: "Usage",
                        render: (row) => {
                          const cap = getCapacity(row)
                          const free = getFree(row)
                          const usedPct =
                            typeof cap === "number" && typeof free === "number" && cap > 0 ? ((cap - free) / cap) * 100 : 0
                          return (
                            <div className="w-28">
                              <Progress value={usedPct} className="h-1.5" />
                            </div>
                          )
                        },
                      },
                    ]}
                    rows={datastores}
                    loading={inventory.loading}
                    error={null}
                    getRowKey={(row, index) => String(row.name ?? `ds-${index}`)}
                    emptyMessage="No datastores discovered."
                    skeletonRows={4}
                  />
                  <div className="mt-3 grid gap-2">
                    {datastores.map((row, index) => {
                      const cap = getCapacity(row)
                      const free = getFree(row)
                      return (
                        <button
                          key={String(row.name ?? `ds-${index}`)}
                          type="button"
                          onClick={() => setSelectedDs(row)}
                          className={`rounded-md border px-3 py-2 text-left text-xs hover:bg-muted ${selectedDs === row ? "border-primary bg-muted" : ""}`}
                        >
                          <span className="font-mono font-medium">{row.name || `ds-${index}`}</span>
                          <span className="ml-2 text-muted-foreground">
                            {row.type || "—"} · {formatBytes(cap)} cap · {formatBytes(free)} free
                          </span>
                          <span className="ml-2 text-primary">→ inspect</span>
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {selectedDs ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Datastore drill-down — {selectedDs.name || "—"}</CardTitle>
                    <CardDescription>Raw datastore record from InventoryReport.Datastores.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Name</dt>
                        <dd className="font-mono text-xs">{selectedDs.name || "—"}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Type</dt>
                        <dd className="font-mono text-xs">{selectedDs.type || "—"}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Capacity</dt>
                        <dd className="font-mono text-xs">{formatBytes(getCapacity(selectedDs))}</dd>
                      </div>
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium text-muted-foreground">Free</dt>
                        <dd className="font-mono text-xs">{formatBytes(getFree(selectedDs))}</dd>
                      </div>
                    </dl>
                    <JsonBlock value={selectedDs} />
                    <Button variant="outline" size="sm" onClick={() => setSelectedDs(null)}>
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-xs text-muted-foreground">Select a datastore row above to see its drill-down.</p>
              )}
            </TabsContent>

            <TabsContent value="clusters" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Clusters</CardTitle>
                  <CardDescription>Compute clusters (ClusterComputeResource) in this vCenter.</CardDescription>
                </CardHeader>
                <CardContent>
                  {clusters.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No clusters discovered.</p>
                  ) : (
                    <div className="grid gap-2">
                      {clusters.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setSelectedCluster(name)}
                          className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${selectedCluster === name ? "border-primary bg-muted" : ""}`}
                        >
                          <span className="font-mono text-xs">{name}</span>
                          <span className="ml-2 text-xs text-primary">→ inspect</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <SimpleDataTable<{ name: string }>
                    columns={[{ key: "name", header: "Cluster", render: (row) => <span className="font-mono text-xs">{row.name}</span> }]}
                    rows={clusters.map((name) => ({ name }))}
                    loading={inventory.loading}
                    error={null}
                    getRowKey={(row) => row.name}
                    emptyMessage="No clusters discovered."
                    skeletonRows={2}
                  />
                </CardContent>
              </Card>
              {selectedCluster ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Cluster drill-down — {selectedCluster}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Cluster <span className="font-mono">{selectedCluster}</span> is a vSphere compute cluster. Hosts above that belong to this cluster share its resource
                      pools and datastores.
                    </p>
                    <JsonBlock value={{ cluster: selectedCluster, provider_id: providerId, code: inventory.data?.code }} />
                    <Button variant="outline" size="sm" onClick={() => setSelectedCluster(null)}>
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            <TabsContent value="pools" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resource pools</CardTitle>
                  <CardDescription>Pools own CPU/memory reservations for grouped VMs.</CardDescription>
                </CardHeader>
                <CardContent>
                  {pools.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No resource pools discovered.</p>
                  ) : (
                    <div className="grid gap-2">
                      {pools.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setSelectedPool(name)}
                          className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${selectedPool === name ? "border-primary bg-muted" : ""}`}
                        >
                          <span className="font-mono text-xs">{name}</span>
                          <span className="ml-2 text-xs text-primary">→ inspect</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <SimpleDataTable<{ name: string }>
                    columns={[{ key: "name", header: "Pool", render: (row) => <span className="font-mono text-xs">{row.name}</span> }]}
                    rows={pools.map((name) => ({ name }))}
                    loading={inventory.loading}
                    error={null}
                    getRowKey={(row) => row.name}
                    emptyMessage="No resource pools discovered."
                    skeletonRows={2}
                  />
                </CardContent>
              </Card>
              {selectedPool ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Pool drill-down — {selectedPool}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Pool <span className="font-mono">{selectedPool}</span> groups VMs for resource allocation. The API returns pool names only — member VMs are listed under the provider&apos;s VM inventory.
                    </p>
                    <JsonBlock value={{ resource_pool: selectedPool, provider_id: providerId, code: inventory.data?.code }} />
                    <Button variant="outline" size="sm" onClick={() => setSelectedPool(null)}>
                      Clear selection
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </ProviderShell>
  )
}
