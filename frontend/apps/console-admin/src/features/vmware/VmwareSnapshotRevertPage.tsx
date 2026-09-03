// VMware snapshot revert — dedicated per-VM action page for kind=vmware.
// Endpoints: GET /admin/vmware/:id/snapshots (infra, polled 5s) + POST /admin/vmware/:id/snapshots/:snap/revert (platform_admin).
// Guard kind==vmware via vmwareAdapterFor — non-vmware answers 501 expect vmware.
// Polling contract: useInfraGet intervalMs 5000 like proxmox snapshots (frontend/apps/console-admin/src/features/proxmox/ProxmoxSnapshotsPage.tsx).
import { useCallback, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

function vmFromSnapshot(snapshotId: string): string {
  const idx = snapshotId.indexOf("/")
  if (idx > 0) return snapshotId.slice(0, idx).trim()
  return ""
}

export default function VmwareSnapshotRevertPage() {
  const params = useParams()
  const providerId = (params.providerId ?? (params as Record<string, string>).id ?? "") as string
  const rawSnap = (params.snap ?? (params as Record<string, string>).snap_id ?? (params as Record<string, string>).snapId ?? "") as string
  const decodedSnap = useMemo(() => {
    if (!rawSnap) return ""
    try {
      return decodeURIComponent(rawSnap)
    } catch {
      return rawSnap
    }
  }, [rawSnap])

  const baseList = `/admin/vmware/${providerId}/snapshots`
  const baseRevert = (snapId: string) => `/admin/vmware/${providerId}/snapshots/${encodeURIComponent(snapId)}/revert`

  const providers = useInfraGet<ProviderRow[]>("/admin/providers")
  const match = useMemo(() => providers.data?.find((row) => row.id === providerId) ?? null, [providers.data, providerId])
  const isVmware = !match || match.kind === "vmware"
  const kindMismatch = Boolean(match && match.kind !== "vmware")

  const snapshotsState = useInfraGet<SnapshotsPayload>(providerId && isVmware ? baseList : null, undefined, { intervalMs: 5000 })
  const rows: SnapshotRow[] = Array.isArray((snapshotsState.data as SnapshotsPayload | null)?.snapshots)
    ? ((snapshotsState.data as SnapshotsPayload).snapshots as SnapshotRow[])
    : Array.isArray(snapshotsState.data as unknown as SnapshotRow[])
      ? (snapshotsState.data as unknown as SnapshotRow[])
      : []

  const [filterVm, setFilterVm] = useState("")
  const [selectedSnap, setSelectedSnap] = useState<string>(decodedSnap)
  const [revertTarget, setRevertTarget] = useState<SnapshotRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)

  const filteredRows = useMemo(() => {
    const f = filterVm.trim()
    const target = decodedSnap.trim()
    let list = rows
    if (f) {
      const needle = f.toLowerCase()
      list = list.filter((r) => snapExtId(r).toLowerCase().includes(needle) || snapName(r).toLowerCase().includes(needle))
    }
    if (target) {
      const exact = list.find((r) => snapExtId(r) === target)
      if (exact) return [exact, ...list.filter((r) => snapExtId(r) !== target)]
    }
    return list
  }, [rows, filterVm, decodedSnap])

  const onPickRow = useCallback((row: SnapshotRow) => {
    const id = snapExtId(row)
    if (id) setSelectedSnap(id)
  }, [])

  const effectiveSnap = selectedSnap.trim() || decodedSnap.trim()

  const canRevert = Boolean(providerId) && Boolean(effectiveSnap) && !busy && !kindMismatch

  const doRevert = async (row: SnapshotRow) => {
    const snapId = snapExtId(row).trim()
    if (!snapId) {
      toast.error("Snapshot id is required")
      return
    }
    const vmExt = vmFromSnapshot(snapId)
    if (!vmExt) {
      toast.error("Invalid snapshot id — must be <vm-ext-id>/<snapname>")
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      await apiPost(baseRevert(snapId), vmExt ? { snapshot_id: snapId, vm: vmExt } : { snapshot_id: snapId })
      toast.success(`Snapshot reverted — ${snapId} (VM ${vmExt})`)
      snapshotsState.reload()
      setRevertTarget(null)
    } catch (cause) {
      setSubmitError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Revert failed")
    } finally {
      setBusy(false)
    }
  }

  const onConfirmRevert = () => {
    if (!revertTarget) return
    const t = revertTarget
    setRevertTarget(null)
    void doRevert(t)
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Snapshot revert" description="VMware per-VM snapshot revert.">
        <ErrorBanner error={new Error("Missing providerId in route params")} />
      </ProviderShell>
    )
  }

  if (snapshotsState.error instanceof ApiError && snapshotsState.error.status === 501) {
    return (
      <ProviderShell providerId={providerId} title="Snapshot revert" description="VMware per-VM snapshot revert.">
        <EmptyState
          message="Snapshot revert is only available for vmware providers."
          description="This provider runs another platform (the API answered HTTP 501 via vmwareAdapterFor kind guard). Switch to a vmware provider and retry POST /v1/admin/vmware/:id/snapshots/:snap/revert."
        />
        {match ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Current provider <span className="font-mono">{match.code}</span> is kind <Badge variant="destructive">{match.kind}</Badge> — snapshot revert at{" "}
              <span className="font-mono">/admin/vmware/:id/snapshots/:snap/revert</span> requires <span className="font-mono">kind=vmware</span>.
            </CardContent>
          </Card>
        ) : null}
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Snapshot revert"
      description="POST /admin/vmware/:id/snapshots/:snap/revert — revert a VM to its vSphere snapshot. GET /admin/vmware/:id/snapshots polls every 5s (infra, NOC readable); POST is platform_admin only. Snapshot id is <vm-ext-id>/<snapname> e.g. VirtualMachine:vm-42/pre-upgrade."
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
              <span className="font-mono">GET /v1/admin/vmware/:id/snapshots</span> ·{" "}
              <span className="font-mono">POST /v1/admin/vmware/:id/snapshots/:snap/revert</span> — RBAC{" "}
              <span className="font-mono">GET infra</span> · <span className="font-mono">POST ""</span> (platform_admin only)
            </CardDescription>
          </CardHeader>
          {kindMismatch ? (
            <CardContent>
              <EmptyState message="This provider is not vmware." description={`Kind is ${match.kind} — snapshot revert at /admin/vmware/:id/snapshots/:snap/revert answers 501. Switch to a vmware provider.`} />
            </CardContent>
          ) : !match.has_credentials ? (
            <CardContent>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No stored credentials — snapshot revert answers HTTP 503 until credentials are configured via the provider editor.
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
              <CardTitle className="text-base">Revert target</CardTitle>
              <CardDescription>
                Snapshot id is the provider snapshot extID — <span className="font-mono">{"<vm-ext-id>/<snapname>"}</span> e.g.{" "}
                <span className="font-mono">VirtualMachine:vm-42/pre-upgrade</span> or <span className="font-mono">vm-42/pre-upgrade</span>. Pick from the table below or paste directly. The handler derives{" "}
                <span className="font-mono">vm</span> from the prefix before <span className="font-mono">/</span> when omitted. Calls{" "}
                <span className="font-mono">POST /admin/vmware/:id/snapshots/:snap/revert</span> where <span className="font-mono">:snap</span> is url-escaped snapshot id.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="vmware-snap-filter">Filter snapshots</Label>
                  <Input
                    id="vmware-snap-filter"
                    value={filterVm}
                    onChange={(e) => setFilterVm(e.target.value)}
                    placeholder="Filter by vm or snap name"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Client-side filter over the 5s-polled snapshot list.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vmware-snap-id">Snapshot id *</Label>
                  <Input
                    id="vmware-snap-id"
                    value={selectedSnap}
                    onChange={(e) => setSelectedSnap(e.target.value)}
                    placeholder="VirtualMachine:vm-42/pre-upgrade"
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Full extID — VM part is <span className="font-mono">{effectiveSnap ? vmFromSnapshot(effectiveSnap) || "—" : "—"}</span>. Encoded as{" "}
                    <span className="font-mono">{effectiveSnap ? encodeURIComponent(effectiveSnap) : "—"}</span> in the POST path.
                  </p>
                </div>
              </div>

              {decodedSnap ? (
                <p className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                  Route snap param: <span className="font-medium">{decodedSnap}</span> — pre-selected from URL <span className="font-mono">:snap</span>. Change the input above to revert a different snapshot.
                </p>
              ) : null}

              {submitError ? <ErrorBanner error={submitError} /> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  disabled={!canRevert}
                  onClick={() => {
                    const row = rows.find((r) => snapExtId(r) === effectiveSnap) ?? ({ ExternalID: effectiveSnap } as SnapshotRow)
                    if (!effectiveSnap) {
                      toast.error("Snapshot id is required")
                      return
                    }
                    setRevertTarget(row)
                  }}
                >
                  {busy ? "Reverting…" : "Revert to snapshot"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSelectedSnap(decodedSnap)
                    setSubmitError(null)
                  }}
                >
                  Reset to route
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => { setSelectedSnap(""); setSubmitError(null) }}>
                  Clear
                </Button>
                <span className="text-xs text-muted-foreground">
                  Calls <span className="font-mono">POST {effectiveSnap ? baseRevert(effectiveSnap) : `/admin/vmware/${providerId}/snapshots/:snap/revert`}</span> — 200 on success, 501 if provider kind is not vmware.
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
                  const isSelected = id === effectiveSnap
                  return (
                    <div className="flex justify-end gap-2">
                      <Button variant={isSelected ? "secondary" : "outline"} size="sm" disabled={!id} onClick={() => onPickRow(row)}>
                        {isSelected ? "Selected" : "Use"}
                      </Button>
                      <Button variant="outline" size="sm" disabled={!id} onClick={() => setRevertTarget(row)}>
                        Revert
                      </Button>
                    </div>
                  )
                },
              },
            ]}
            rows={filteredRows}
            loading={snapshotsState.loading}
            error={snapshotsState.error}
            getRowKey={(row, idx) => String(snapExtId(row) || `snap-${idx}`)}
            emptyMessage="No snapshots — create one via POST /admin/vmware/:id/snapshots {vm, name} then revert here. Table polls every 5s via useInfraGet intervalMs: 5000."
            skeletonRows={4}
          />

          <p className="text-xs text-muted-foreground">
            vSphere notes: snapshot revert uses <span className="font-mono">VirtualMachine.RevertToSnapshot</span> with{" "}
            <span className="font-mono">suppressPowerOn=false</span> so the VM returns to the power state captured at snapshot time. The handler re-validates the VM prefix server-side. Polling uses{" "}
            <span className="font-mono">useInfraGet(..., {"{ intervalMs: 5000 }"})</span>.
          </p>
        </div>
      ) : null}

      <RevertDialog
        open={revertTarget !== null}
        busy={busy}
        row={revertTarget}
        onOpenChange={(open) => !open && setRevertTarget(null)}
        onConfirm={onConfirmRevert}
      />

      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title=""
        body=""
        confirmLabel=""
        onConfirm={() => {}}
      />
    </ProviderShell>
  )
}

interface RevertDialogProps {
  open: boolean
  busy: boolean
  row: SnapshotRow | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function RevertDialog({ open, busy, row, onOpenChange, onConfirm }: RevertDialogProps) {
  if (!row) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revert to snapshot</DialogTitle>
            <DialogDescription>Select a snapshot above.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  const id = snapExtId(row)
  const name = snapName(row)
  const vm = vmFromSnapshot(id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revert {vm || "VM"} to &ldquo;{name || id}&rdquo;?</DialogTitle>
          <DialogDescription>
            vSphere will revert VM <span className="font-mono">{vm || "—"}</span> to snapshot <span className="font-mono">{id || name || "—"}</span>. Any changes after the snapshot are lost. POST{" "}
            <span className="font-mono">/admin/vmware/:id/snapshots/:snap/revert</span> where <span className="font-mono">:snap</span> is <span className="font-mono">{id ? encodeURIComponent(id) : "—"}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs">
          <div>snapshot_id: {id || "—"}</div>
          <div>vm: {vm || "—"}</div>
          <div>name: {name || "—"}</div>
          {snapDesc(row) ? <div>desc: {snapDesc(row)}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy || !id}>
            {busy ? "Reverting…" : "Revert snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
