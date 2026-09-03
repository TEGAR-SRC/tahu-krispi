// VMware snapshots — dedicated per-provider page for kind=vmware.
// Endpoints: GET /admin/vmware/:id/snapshots (infra, polled 5s) + POST /admin/vmware/:id/snapshots (platform_admin).
// Guard kind==vmware via vmwareAdapterFor — non-vmware answers 501 expect vmware.
// Polling contract: useInfraGet intervalMs 5000 like proxmox snapshots (frontend/apps/console-admin/src/features/proxmox/ProxmoxSnapshotsPage.tsx).
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiDelete, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ProviderRow } from "@/features/admin/pages/providers/types"

type SnapshotRow = {
  ExternalID?: string
  external_id?: string
  externalId?: string
  Name?: string
  name?: string
  Desc?: string
  desc?: string
  description?: string
  CreatedAt?: string
  created_at?: string
  createdAt?: string
  Status?: string
  status?: string
  Size?: number
  size?: number
  [key: string]: unknown
}

interface SnapshotsPayload {
  provider_id: string
  code: string
  snapshots: SnapshotRow[]
}

function snapExtId(row: SnapshotRow): string {
  const v = row.ExternalID ?? row.external_id ?? row.externalId ?? (row as Record<string, unknown>).externalID
  return typeof v === "string" ? v : String(v ?? "")
}

function snapName(row: SnapshotRow): string {
  const v = row.Name ?? row.name ?? ""
  return String(v ?? "")
}

function snapDesc(row: SnapshotRow): string {
  const v = row.Desc ?? row.desc ?? row.description ?? ""
  return String(v ?? "")
}

function snapCreatedAt(row: SnapshotRow): string {
  const v = row.CreatedAt ?? row.created_at ?? row.createdAt ?? ""
  if (!v) return "—"
  const s = String(v)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  return s
}

function snapStatus(row: SnapshotRow): string {
  return String(row.Status ?? row.status ?? "available")
}

export default function VmwareSnapshotPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const base = `/admin/vmware/${providerId}/snapshots`

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const snapshotsState = useInfraGet<SnapshotsPayload>(providerId && isVmware ? base : null, undefined, { intervalMs: 5000 })
  const rows: SnapshotRow[] = Array.isArray((snapshotsState.data as SnapshotsPayload | null)?.snapshots)
    ? ((snapshotsState.data as SnapshotsPayload).snapshots as SnapshotRow[])
    : Array.isArray(snapshotsState.data as unknown as SnapshotRow[])
      ? (snapshotsState.data as unknown as SnapshotRow[])
      : []

  const [vm, setVm] = useState("")
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [deleteTarget, setDeleteTarget] = useState<SnapshotRow | null>(null)

  const trimmedVm = vm.trim()
  const trimmedName = name.trim()
  const canCreate = Boolean(providerId) && Boolean(trimmedVm) && Boolean(trimmedName) && !busy && !kindMismatch

  const doCreate = async () => {
    if (!trimmedVm) {
      toast.error("VM external id is required (e.g. VirtualMachine:vm-42)")
      return
    }
    if (!trimmedName) {
      toast.error("Snapshot name is required")
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      const body: Record<string, string> = { vm: trimmedVm, name: trimmedName }
      if (desc.trim()) body.desc = desc.trim()
      await apiPost(base, body)
      toast.success(`Snapshot "${trimmedName}" created on ${trimmedVm}`)
      setName("")
      setDesc("")
      snapshotsState.reload()
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Create snapshot failed")
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (row: SnapshotRow) => {
    const snapshotId = snapExtId(row).trim()
    if (!snapshotId) {
      toast.error("Snapshot id is required")
      return
    }
    setBusy(true)
    try {
      await apiDelete(base, { query: { snapshot_id: snapshotId } })
      toast.success(`Snapshot deleted — ${snapshotId}`)
      snapshotsState.reload()
      setDeleteTarget(null)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Snapshots" description="VMware vSphere snapshots — create and list.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (snapshotsState.error instanceof ApiError && snapshotsState.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Snapshots" description="VMware vSphere snapshots — create and list.">
        <EmptyState
          message="Snapshots are only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry GET/POST /v1/admin/vmware/:id/snapshots."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind <Badge variant="destructive">{match.kind}</Badge> — snapshots at <span className="font-mono">/admin/vmware/:id/snapshots</span> require <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Snapshots"
      description="GET /admin/vmware/:id/snapshots — list every snapshot across all Kilat-managed VMs on this vCenter (infra, NOC readable, polled every 5s). POST /admin/vmware/:id/snapshots {vm, name, desc?} — create snapshot (platform_admin only)."
      actions={
        <Button variant="outline" size="sm" onClick={() => snapshotsState.reload()} disabled={snapshotsState.loading}>
          {snapshotsState.loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
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
              <span className="font-mono">GET/POST /v1/admin/vmware/:id/snapshots</span> — RBAC{" "}
              <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span> (platform_admin only)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — snapshots at /admin/vmware/:id/snapshots answer 501. Switch to a vmware provider.`} />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — snapshots answer HTTP 503 until credentials are configured via the provider editor.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : providers.loading ? (
        <p className="text-sm text-muted-foreground">Resolving provider…</p>
      ) : null}

      {!kindMismatch ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create snapshot</CardTitle>
              <CardDescription>
                POST <span className="font-mono">/admin/vmware/:id/snapshots</span> <span className="font-mono">{"{ vm, name, desc? }"}</span> — <span className="font-mono">vm</span> is provider external id e.g.{" "}
                <span className="font-mono">VirtualMachine:vm-42</span> or <span className="font-mono">vm-42</span>, <span className="font-mono">name</span> is snapshot name. Snapshot id returned is{" "}
                <span className="font-mono">{"<vmExt>/<name>"}</span>. RBAC platform_admin.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vmware-snap-vm">VM external id *</Label>
                  <Input
                    id="vmware-snap-vm"
                    value={vm}
                    onChange={(e) => setVm(e.target.value)}
                    placeholder="VirtualMachine:vm-42 or vm-42"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Provider external_id — copy from snapshot table or inventory.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vmware-snap-name">Snapshot name *</Label>
                  <Input
                    id="vmware-snap-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="pre-upgrade"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Snapshot name — used as last segment of extID.</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vmware-snap-desc">Description</Label>
                <Textarea
                  id="vmware-snap-desc"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Optional — e.g. before kernel bump"
                  rows={2}
                  maxLength={512}
                />
              </div>

              {submitError ? <ErrorBanner error={submitError} /> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button disabled={!canCreate} onClick={() => void doCreate()}>
                  {busy ? "Creating…" : "Create snapshot"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setVm("")
                    setName("")
                    setDesc("")
                    setSubmitError(null)
                  }}
                >
                  Clear
                </Button>
                <span className="text-xs text-muted-foreground">
                  Calls <span className="font-mono">POST {base}</span> — 201 on success, 501 if provider kind is not vmware.
                </span>
              </div>
            </CardContent>
          </Card>

          <SimpleDataTable<SnapshotRow>
            columns={[
              { key: "external_id", header: "Snapshot id", render: (row) => <span className="font-mono text-xs">{snapExtId(row) || "—"}</span> },
              { key: "name", header: "Name", render: (row) => <span className="font-mono text-xs font-medium">{snapName(row) || "—"}</span> },
              { key: "desc", header: "Description", className: "hidden md:table-cell max-w-64 truncate", render: (row) => snapDesc(row) || "—" },
              { key: "created_at", header: "Created", className: "hidden lg:table-cell", render: (row) => <span className="text-xs">{snapCreatedAt(row)}</span> },
              {
                key: "status",
                header: "Status",
                className: "hidden xl:table-cell",
                render: (row) => <Badge variant={snapStatus(row) === "available" ? "secondary" : "outline"}>{snapStatus(row)}</Badge>,
              },
              {
                key: "actions",
                header: "",
                className: "w-32 text-right",
                render: (row) => {
                  const id = snapExtId(row)
                  return (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!id}
                        onClick={() => {
                          if (id) {
                            const slash = id.indexOf("/")
                            if (slash > 0) setVm(id.slice(0, slash))
                            const nm = snapName(row)
                            if (nm) setName(nm)
                          }
                        }}
                      >
                        Use
                      </Button>
                      <Button variant="outline" size="sm" disabled={!id} onClick={() => setDeleteTarget(row)}>
                        Delete
                      </Button>
                    </div>
                  )
                },
              },
            ]}
            rows={rows}
            loading={snapshotsState.loading}
            error={snapshotsState.error}
            getRowKey={(row, idx) => String(snapExtId(row) || `snap-${idx}`)}
            emptyMessage="No snapshots — create one via the form above (POST /admin/vmware/:id/snapshots {vm, name}). Table polls every 5s via useInfraGet intervalMs: 5000."
            skeletonRows={4}
          />

          <p className="text-xs text-muted-foreground">
            vSphere notes: create uses <span className="font-mono">VirtualMachine.CreateSnapshot</span> with{" "}
            <span className="font-mono">memory=false · quiesce=false</span> (crash-consistent). List walks every Kilat-managed guest. Delete uses{" "}
            <span className="font-mono">DELETE /admin/vmware/:id/snapshots?snapshot_id=&lt;extID&gt;</span>. Polling uses{" "}
            <span className="font-mono">useInfraGet(..., {"{ intervalMs: 5000 }"})</span>.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete snapshot "${deleteTarget ? snapName(deleteTarget) : ""}"?`}
        body={`Snapshot ${deleteTarget ? snapExtId(deleteTarget) : ""} will be removed via VirtualMachine.RemoveSnapshot. This cannot be undone.`}
        confirmLabel="Delete snapshot"
        busy={busy}
        onConfirm={() => {
          const t = deleteTarget
          if (!t) return
          void doDelete(t)
        }}
      />
    </ProviderShell>
  )
}
