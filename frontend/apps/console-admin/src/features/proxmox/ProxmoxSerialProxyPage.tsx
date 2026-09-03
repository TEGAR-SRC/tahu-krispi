import { useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type SerialProxy = {
  port?: number | string
  ticket?: string
  upid?: string
  user?: string
  [k: string]: unknown
}

export default function ProxmoxSerialProxyPage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const path = providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/serial-proxy` : null
  const state = useInfraGet<SerialProxy>(path, undefined, { intervalMs: 5000 })
  const rows = state.data && typeof state.data === "object" ? [state.data as SerialProxy] : []

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId} title="Serial proxy" description="Node host-shell termproxy ticket — live from POST /nodes/:node/termproxy (polled every 5s).">
        <p className="text-sm text-destructive">Missing providerId or node in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`Serial proxy — ${node}`}
      description={`Host-shell termproxy on ${node}. GET /admin/proxmox/:id/nodes/:node/serial-proxy (infra-readable, proxmox murni). Wraps PVE POST /nodes/:node/termproxy (xterm.js host shell) + vncwebsocket upgrade.`}
      actions={<Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>}
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket</CardTitle>
          <CardDescription>
            <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/serial-proxy</span> — polled every 5s · proxmoxAdapterFor guard
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SimpleDataTable<SerialProxy>
            columns={[
              { key: "port", header: "Port", render: (r) => <span className="font-mono text-sm">{String(r.port ?? "—")}</span> },
              { key: "ticket", header: "Ticket", render: (r) => <span className="max-w-64 truncate font-mono text-xs">{r.ticket ? `${String(r.ticket).slice(0, 24)}…` : "—"}</span> },
              { key: "user", header: "User", render: (r) => String(r.user ?? "—") },
              { key: "upid", header: "UPID", render: (r) => <span className="max-w-64 truncate font-mono text-xs">{r.upid ? String(r.upid) : "—"}</span> },
            ]}
            rows={rows}
            loading={state.loading}
            error={undefined}
            emptyMessage="No serial-proxy ticket yet — PVE may have rejected the node termproxy request."
            getRowKey={(_, i) => String(i)}
            skeletonRows={1}
          />
          {state.data ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{JSON.stringify(state.data, null, 2)}</pre>
          ) : null}
          <p className="text-xs text-muted-foreground">
            vncwebsocket: <span className="font-mono">/nodes/{node}/vncwebsocket?port=…&amp;vncticket=…</span> — upgrade with the ticket above (xterm.js). Endpoint mirrors VM{"{LXC,QEMU}"} termproxy.
          </p>
        </CardContent>
      </Card>
    </ProviderShell>
  )
}
