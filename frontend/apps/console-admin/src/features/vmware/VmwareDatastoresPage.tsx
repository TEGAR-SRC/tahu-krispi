// VMware datastores — dedicated per-provider page for kind=vmware.
// Endpoint: GET /admin/vmware/:id/datastores (vmwareAdapterFor guard kind==vmware,
// requireStaff infra → NOC readable, finance 403). Polling 5s via useInfraGet.
// Shows capacity / free / type / usage bar with row-level drill-down.
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
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { JsonBlock } from "@/features/admin/pages/shared"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { formatBytes, useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type DatastoreRow = {
  name?: string
  type?: string
  capacity_bytes?: number
  capacity?: number
  free_bytes?: number
  freeBytes?: number
}

interface DatastoresPayload {
  provider_id: string
  code: string
  datastores: DatastoreRow[]
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

export default function VmwareDatastoresPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(
    () => providers.data?.find((row) => row.id === providerId) ?? null,
    [providers.data, providerId],
  )
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const datastoresState = useInfraGet<DatastoresPayload>(
    providerId && isVmware ? `/admin/vmware/${providerId}/datastores` : null,
    undefined,
    { intervalMs: 5000 },
  )

  const [selectedDs, setSelectedDs] = useState<DatastoreRow | null>(null)

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastores" description="Capacity versus free space for this vCenter.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (datastoresState.error instanceof ApiError && datastoresState.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="VMware datastores" description="Capacity versus free space for this vCenter.">
        <EmptyState
          message="Datastores are only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Use the Storages console for Proxmox, or the Onidel catalog for Onidel. Switch to a vmware provider and retry GET /v1/admin/vmware/:id/datastores."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind{" "}
              <Badge variant="destructive">{match.kind}</Badge> — datastores at{" "}
              <span className="font-mono">/admin/vmware/:id/datastores</span> requires{" "}
              <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  const datastores = datastoresState.data?.datastores ?? []

  const description =
    datastoresState.loading || datastoresState.error
      ? "Capacity versus free space from vCenter inventory — polls every 5s."
      : `${datastores.length} datastore(s) · ${datastoresState.data?.code ?? ""}`

  return (
    <ProviderShell providerId={providerId} title="VMware datastores" description={description}>
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
              <span className="font-mono">GET /v1/admin/vmware/:id/datastores</span> — RBAC{" "}
              <span className="font-mono">requireStaff infra</span> (NOC read, finance 403) · poll{" "}
              <span className="font-mono">useInfraGet intervalMs 5000</span>
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState
                message="This provider is not vmware."
                description={`Kind is ${match.kind} — datastores at /admin/vmware/:id/datastores answers 501 for non-vmware kinds (guard kind==vmware). Use the Proxmox storages at /admin/proxmox/:id/storages for this provider.`}
              />
            </CardContent>
          ) : null}
          {!match.has_credentials && match.kind === "vmware" ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — live datastores answer HTTP 503 until an API key is configured via the provider editor. The table below will stay empty until credentials are set.
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
            <Button variant="outline" size="sm" onClick={() => datastoresState.reload()} disabled={datastoresState.loading}>
              {datastoresState.loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/vmware/${providerId}/inventory`}>Inventory</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Polling <span className="font-mono">GET /admin/vmware/:id/datastores</span> every 5s via{" "}
              <span className="font-mono">useInfraGet</span>. Click a row to inspect its raw payload below.
            </span>
          </div>

          <ErrorBanner error={datastoresState.error} />

          {!datastoresState.loading && !datastoresState.error && datastores.length === 0 ? (
            <EmptyState
              message="No datastores discovered."
              description="Verify vCenter credentials, datacenter scope and that the provider kind is vmware. The per-provider endpoint is GET /v1/admin/vmware/:id/datastores (vmwareAdapterFor)."
            />
          ) : null}

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
                loading={datastoresState.loading}
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
                <CardDescription>Raw datastore record from InventoryReport.Datastores via /datastores projection.</CardDescription>
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
        </>
      ) : null}
    </ProviderShell>
  )
}
