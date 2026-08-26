// vSphere inventory for kind=vmware providers: hosts, datastores, clusters
// and resource pools. The endpoint answers 501 for non-vmware providers and
// 503 while credentials are missing — both get explicit explanations.
import { useParams } from "react-router-dom"
import { ApiError } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatBytes, useInfraGet } from "./infra"
import { ProviderShell } from "./shared"

interface InventoryPayload {
  provider_id: string
  code: string
  hosts: Array<{ name?: string; cpu_threads?: number; memory_bytes?: number; power_state?: string }>
  datastores: Array<{ name?: string; type?: string; capacity_bytes?: number; free_bytes?: number }>
  clusters: string[]
  resource_pools: string[]
}

export default function VmwareInventoryPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const inventory = useInfraGet<InventoryPayload>(
    providerId ? `/admin/providers/${providerId}/inventory` : null,
  )

  // 501 = the provider is not vmware; explain instead of showing a raw error.
  if (inventory.error instanceof ApiError && inventory.error.status === 501) {
    return (
      <ProviderShell
        providerId={providerId}
        title="vSphere inventory"
        description="Raw vCenter infrastructure view."
      >
        <EmptyState
          message="Inventory is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501). Use the Nodes / Ceph / Storages consoles for Proxmox clusters, or the Dokploy mirror for PaaS rows."
        />
      </ProviderShell>
    )
  }

  const hosts = inventory.data?.hosts ?? []
  const datastores = inventory.data?.datastores ?? []
  const clusters = inventory.data?.clusters ?? []
  const resourcePools = inventory.data?.resource_pools ?? []

  return (
    <ProviderShell
      providerId={providerId}
      title="vSphere inventory"
      description={`${hosts.length} host(s) · ${datastores.length} datastore(s) · ${clusters.length} cluster(s)`}
    >
      <ErrorBanner error={inventory.error} />

      {!inventory.loading && !inventory.error && hosts.length === 0 && datastores.length === 0 ? (
        <EmptyState message="The inventory came back empty." description="Verify vCenter credentials and datacenter scope on the provider." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hosts</CardTitle>
              <CardDescription>ESXi hosts with thread count, memory and power state.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<NonNullable<InventoryPayload["hosts"]>[number]>
                columns={[
                  { key: "name", header: "Host", render: (row) => row.name || "—" },
                  { key: "cpu_threads", header: "Threads", render: (row) => row.cpu_threads ?? "—" },
                  {
                    key: "memory_bytes",
                    header: "Memory",
                    render: (row) => formatBytes(row.memory_bytes),
                  },
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
                getRowKey={(row, index) => String(row.name ?? index)}
                emptyMessage="No hosts discovered."
                skeletonRows={4}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datastores</CardTitle>
              <CardDescription>Capacity versus free space in bytes.</CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<NonNullable<InventoryPayload["datastores"]>[number]>
                columns={[
                  { key: "name", header: "Datastore", render: (row) => row.name || "—" },
                  { key: "type", header: "Type" },
                  {
                    key: "capacity_bytes",
                    header: "Capacity",
                    render: (row) => formatBytes(row.capacity_bytes),
                  },
                  {
                    key: "free_bytes",
                    header: "Free",
                    render: (row) => {
                      const share =
                        typeof row.free_bytes === "number" &&
                        typeof row.capacity_bytes === "number" &&
                        row.capacity_bytes > 0
                          ? (row.free_bytes / row.capacity_bytes) * 100
                          : null
                      return `${formatBytes(row.free_bytes)}${share !== null ? ` (${share.toFixed(0)}%)` : ""}`
                    },
                  },
                ]}
                rows={datastores}
                loading={inventory.loading}
                error={null}
                getRowKey={(row, index) => String(row.name ?? index)}
                emptyMessage="No datastores discovered."
                skeletonRows={4}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clusters</CardTitle>
            </CardHeader>
            <CardContent>
              {clusters.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clusters discovered.</p>
              ) : (
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {clusters.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resource pools</CardTitle>
            </CardHeader>
            <CardContent>
              {resourcePools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resource pools discovered.</p>
              ) : (
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {resourcePools.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ProviderShell>
  )
}
