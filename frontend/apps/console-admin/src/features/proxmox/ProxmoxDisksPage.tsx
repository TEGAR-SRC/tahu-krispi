import { useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PveDisk {
  devpath?: string
  type?: string
  model?: string
  serial?: string
  size?: number
  used?: string
  health?: string
  wearout?: string
  vendor?: string
  wwn?: string
  osdid?: number
  mounted?: string
  gpt?: boolean | number
  rpm?: number
  [key: string]: unknown
}

export default function ProxmoxDisksPage() {
  const { providerId = "", node = "" } = useParams<{
    providerId: string
    node: string
  }>()

  const path =
    providerId && node
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/disks`
      : null

  const disks = useInfraGet<PveDisk[]>(path, undefined, { intervalMs: 5000 })
  const rows = Array.isArray(disks.data) ? disks.data : []

  if (!providerId || !node) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Disks"
        description="Physical disks on this Proxmox node."
      >
        <p className="text-sm text-destructive">Missing providerId or node in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`Disks — ${node}`}
      description={`Physical disk inventory on node ${node}. GET /admin/proxmox/:id/nodes/:node/disks (infra-readable, proxmox murni via proxmoxAdapterFor, polled every 5s).`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => disks.reload()}
          disabled={disks.loading}
        >
          Refresh
        </Button>
      }
    >
      {disks.error ? <ErrorBanner error={disks.error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disks</CardTitle>
          <CardDescription>
            <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/disks</span> ·{" "}
            {rows.length} disk(s) · polled 5s via useInfraGet
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <SimpleDataTable<PveDisk>
            columns={[
              {
                key: "devpath",
                header: "Device",
                render: (d) => (
                  <span className="font-mono text-xs">{d.devpath || "—"}</span>
                ),
              },
              { key: "type", header: "Type", render: (d) => d.type || "—" },
              {
                key: "size",
                header: "Size",
                render: (d) => formatBytes(d.size),
              },
              { key: "used", header: "Used", render: (d) => d.used || "—" },
              {
                key: "health",
                header: "Health",
                render: (d) =>
                  d.health ? <Badge variant="outline">{d.health}</Badge> : "—",
              },
              { key: "wearout", header: "Wearout", render: (d) => d.wearout || "—" },
              {
                key: "model",
                header: "Model",
                className: "hidden md:table-cell",
                render: (d) => d.model || "—",
              },
              {
                key: "serial",
                header: "Serial",
                className: "hidden lg:table-cell font-mono text-xs",
                render: (d) => d.serial || "—",
              },
              {
                key: "mounted",
                header: "Mounted",
                className: "hidden xl:table-cell",
                render: (d) => d.mounted || "—",
              },
            ]}
            rows={rows}
            loading={disks.loading}
            error={undefined}
            getRowKey={(d, index) => String(d.devpath ?? d.wwn ?? index)}
            emptyMessage={`No disks reported on node ${node}.`}
            skeletonRows={4}
          />
        </CardContent>
      </Card>

      {rows.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Raw payload</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(rows, null, 2)}
          </pre>
        </details>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/disks</span> ·
        requireStaff infra · proxmoxAdapterFor guard (501 expect proxmox) · 5s poll
      </p>
    </ProviderShell>
  )
}
