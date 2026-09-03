import { useParams } from "react-router-dom"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

interface NodeReportPayload {
  node?: string
  report?: string
  [key: string]: unknown
}

export default function ProxmoxNodeReportPage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const state = useInfraGet<NodeReportPayload>(
    providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/report` : null,
    undefined,
    { intervalMs: 5000 },
  )

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId} title="Node report" description="Full node report from the Proxmox cluster.">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Missing route params</CardTitle>
            <CardDescription>providerId and node are required.</CardDescription>
          </CardHeader>
        </Card>
      </ProviderShell>
    )
  }

  const report = typeof state.data?.report === "string" ? state.data.report : state.data ? JSON.stringify(state.data, null, 2) : ""

  return (
    <ProviderShell
      providerId={providerId}
      title={`Node report — ${node}`}
      description={`GET /admin/proxmox/:id/nodes/:node/report — wraps client.NodeReport. Polled every 5s via useInfraGet.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
          Refresh
        </Button>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report</CardTitle>
          <CardDescription>Text bundle comparable to pveversion -v on the node. Infra-readable (NOC + platform_admin).</CardDescription>
        </CardHeader>
        <CardContent>
          {state.loading && !state.data ? (
            <p className="text-sm text-muted-foreground">Loading node report…</p>
          ) : report ? (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
              {report}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No report data.</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/report</span> · requireStaff infra
      </p>
    </ProviderShell>
  )
}
