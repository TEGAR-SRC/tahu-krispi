import { useParams } from "react-router-dom"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type AclEntry = {
  path?: string
  roleid?: string
  type?: string
  ugid?: string
  propagate?: number | boolean
  [k: string]: unknown
}

function propagateLabel(v: unknown): string {
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return v ? "yes" : "no"
  return "—"
}

export default function ProxmoxAclPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const path = providerId ? `/admin/proxmox/${providerId}/access/acl` : null
  const state = useInfraGet<AclEntry[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as AclEntry[]

  if (!providerId) {
    return (
      <ProviderShell
        providerId={providerId}
        title="Access ACL"
        description="PVE access control list (GET /admin/proxmox/:id/access/acl). GET is infra-readable (NOC), proxmox murni via proxmoxAdapterFor."
      >
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Access ACL"
      description="Proxmox ACL entries — path / role / ugid bindings from PVE /access/acl. GET is infra-readable (NOC + platform_admin), proxmox murni via proxmoxAdapterFor, polled every 5s."
      actions={
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
          Refresh
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        GET /admin/proxmox/:id/access/acl — polled every 5s via useInfraGet (infra).
      </p>
      {state.error ? <ErrorBanner error={state.error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ACL</CardTitle>
          <CardDescription>
            <span className="font-mono">GET /admin/proxmox/:id/access/acl</span> · {rows.length} entr{rows.length === 1 ? "y" : "ies"} · polled 5s
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <SimpleDataTable<AclEntry>
            columns={[
              { key: "path", header: "Path", render: (r) => <span className="font-mono text-xs">{r.path || "—"}</span> },
              { key: "type", header: "Type", render: (r) => r.type ? <Badge variant="outline">{String(r.type)}</Badge> : "—" },
              { key: "ugid", header: "UGID", render: (r) => <span className="font-mono text-xs">{r.ugid || "—"}</span> },
              { key: "roleid", header: "Role", render: (r) => r.roleid ? <span className="font-mono text-sm font-medium">{String(r.roleid)}</span> : "—" },
              { key: "propagate", header: "Propagate", render: (r) => propagateLabel(r.propagate) },
            ]}
            rows={rows}
            loading={state.loading}
            error={undefined}
            getRowKey={(r, i) => `${String(r.path ?? "")}::${String(r.ugid ?? "")}::${String(r.roleid ?? "")}::${i}`}
            emptyMessage="No ACL entries on this cluster."
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
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/access/acl</span> · requireStaff infra · proxmoxAdapterFor guard (501 expect proxmox) · 5s poll
      </p>
    </ProviderShell>
  )
}
