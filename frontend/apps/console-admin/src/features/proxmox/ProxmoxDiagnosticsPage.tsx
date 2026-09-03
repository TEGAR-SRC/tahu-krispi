import { useParams } from "react-router-dom"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type VersionPayload = {
  version?: string
  release?: string
  repoid?: string
  [key: string]: unknown
}

type NextIdPayload = {
  next_id?: number
  nextId?: number
  id?: number
  [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value !== "object") return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNextId(payload: unknown): number | null {
  const rec = asRecord(payload)
  if (!rec) return typeof payload === "number" ? payload : null
  const candidates = [rec.next_id, rec.nextId, rec.id]
  for (const c of candidates) {
    const n = typeof c === "string" ? Number(c) : (c as number)
    if (typeof n === "number" && Number.isFinite(n)) return n
  }
  return null
}

export default function ProxmoxDiagnosticsPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = providerId ? `/admin/proxmox/${providerId}` : null
  const versionState = useInfraGet<VersionPayload>(base ? `${base}/version` : null, undefined, { intervalMs: 5000 })
  const nextIdState = useInfraGet<NextIdPayload | number>(base ? `${base}/next-id` : null, undefined, { intervalMs: 5000 })

  const versionRec = asRecord(versionState.data)
  const nextId = asNextId(nextIdState.data)

  const versionRows: Array<Record<string, unknown>> = []
  if (versionRec) {
    // PVE version is typically { version, release, repoid } — render generically.
    for (const [k, v] of Object.entries(versionRec)) {
      versionRows.push({ key: k, value: v == null ? "—" : String(v) })
    }
  } else if (versionState.data && typeof versionState.data === "object") {
    // Fallback: raw record already handled
  }

  const nextIdRows: Array<Record<string, unknown>> = []
  if (nextId != null) {
    nextIdRows.push({ key: "next_id", value: String(nextId) })
  } else {
    const rec = asRecord(nextIdState.data)
    if (rec) {
      for (const [k, v] of Object.entries(rec)) nextIdRows.push({ key: k, value: v == null ? "—" : String(v) })
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId="" title="Proxmox diagnostics" description="Version and next free VM/CT ID.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Proxmox diagnostics"
      description="GET /admin/proxmox/:id/version and GET /admin/proxmox/:id/next-id — infra-readable (NOC + platform_admin), polling every 5s. Version reflects PVE's /version; next-id allocates the next free VM/CT ID from the cluster (/cluster/nextid)."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => versionState.reload()} disabled={versionState.loading}>
            Refresh version
          </Button>
          <Button variant="outline" size="sm" onClick={() => nextIdState.reload()} disabled={nextIdState.loading}>
            Refresh next-id
          </Button>
        </div>
      }
    >
      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version</CardTitle>
            <CardDescription>
              <span className="font-mono">GET /admin/proxmox/:id/version</span> — PVE version as reported by the API (version, release, repoid). Infra-readable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<Record<string, unknown>>
              columns={[
                { key: "key", header: "Field", render: (r) => <span className="font-mono text-xs">{String(r.key)}</span> },
                { key: "value", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{String(r.value)}</span> },
              ]}
              rows={versionRows}
              loading={versionState.loading}
              error={versionState.error}
              getRowKey={(r) => String(r.key)}
              emptyMessage="No version data. Verify provider kind is proxmox and credentials are valid."
              skeletonRows={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next ID</CardTitle>
            <CardDescription>
              <span className="font-mono">GET /admin/proxmox/:id/next-id</span> — next free VMID allocated by the cluster. Infra-readable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nextId != null ? (
              <div className="mb-3 rounded-md border bg-muted/30 px-4 py-3">
                <div className="text-xs text-muted-foreground">Next free VM/CT ID</div>
                <div className="font-mono text-2xl font-semibold tabular-nums">{nextId}</div>
              </div>
            ) : null}
            <SimpleDataTable<Record<string, unknown>>
              columns={[
                { key: "key", header: "Field", render: (r) => <span className="font-mono text-xs">{String(r.key)}</span> },
                { key: "value", header: "Value", render: (r) => <span className="font-mono text-xs break-all">{String(r.value)}</span> },
              ]}
              rows={nextIdRows}
              loading={nextIdState.loading}
              error={nextIdState.error}
              getRowKey={(r) => String(r.key)}
              emptyMessage="No next-id data. The cluster may be unreachable."
              skeletonRows={2}
            />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Endpoints: <span className="font-mono">GET /admin/proxmox/:id/version</span> ·{" "}
        <span className="font-mono">GET /admin/proxmox/:id/next-id</span>
      </p>
    </ProviderShell>
  )
}
