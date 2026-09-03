// SDN inventory board: zones and VNets side by side (read-only — the admin
// API only exposes GETs for both).
import { useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { StatusBadge } from "../shared"
import { ProviderShell } from "./shared"
import { useInfraGet } from "./infra"
import type { SdnVnet, SdnZone } from "./types"

export default function ProviderSdnPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = providerId ? `/admin/proxmox/${providerId}` : null

  const zones = useInfraGet<SdnZone[]>(base ? `${base}/sdn/zones` : null, undefined, { intervalMs: 5000 })
  const vnets = useInfraGet<SdnVnet[]>(base ? `${base}/sdn/vnets` : null, undefined, { intervalMs: 5000 })

  return (
    <ProviderShell
      providerId={providerId}
      title="SDN"
      description="Software-defined networking: zones and virtual networks as configured on the cluster."
    >
      <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Zones</CardTitle>
            <CardDescription>Layer-3 domains backing the virtual networks.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<SdnZone>
              columns={[
                {
                  key: "zone",
                  header: "Zone",
                  render: (row) => (
                    <span className="font-mono text-sm font-medium">{row.zone || "—"}</span>
                  ),
                },
                { key: "type", header: "Type", render: (row) => <Badge variant="outline">{row.type}</Badge> },
                {
                  key: "state",
                  header: "State",
                  render: (row) => <StatusBadge status={row.state ?? null} />,
                },
                {
                  key: "mtu",
                  header: "MTU",
                  className: "hidden md:table-cell",
                  render: (row) => row.mtu ?? "—",
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
                  render: (row) => row.nodes || "all",
                },
              ]}
              rows={zones.data ?? []}
              loading={zones.loading}
              error={zones.error}
              getRowKey={(row) => String(row.zone ?? "?")}
              emptyMessage="No SDN zones configured."
              skeletonRows={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">VNets</CardTitle>
            <CardDescription>Virtual networks attached to a zone with optional VLAN/VXLAN tags.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<SdnVnet>
              columns={[
                {
                  key: "vnet",
                  header: "VNet",
                  render: (row) => (
                    <span className="font-mono text-sm font-medium">{row.vnet || "—"}</span>
                  ),
                },
                { key: "zone", header: "Zone" },
                {
                  key: "tag",
                  header: "Tag",
                  render: (row) => row.tag ?? "—",
                },
                {
                  key: "alias",
                  header: "Alias",
                  className: "hidden md:table-cell",
                  render: (row) => row.alias || "—",
                },
                {
                  key: "vlanaware",
                  header: "VLAN aware",
                  className: "hidden lg:table-cell",
                  render: (row) =>
                    row.vlanaware === 1 || row.vlanaware === undefined ? "yes" : "no",
                },
              ]}
              rows={vnets.data ?? []}
              loading={vnets.loading}
              error={vnets.error}
              getRowKey={(row) => String(row.vnet ?? "?")}
              emptyMessage="No VNets configured."
              skeletonRows={3}
            />
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
