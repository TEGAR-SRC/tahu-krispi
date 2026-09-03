import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { EmptyState } from "@/components/shared/EmptyState"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import type { ClusterPayload, ClusterStorage } from "@/features/admin/pages/providers/types"

interface PruneBackupItem {
  volid?: string
  volid_display?: string
  mark?: string
  type?: string
  vmid?: number
  ctime?: number | string
  [key: string]: unknown
}

const TYPE_OPTIONS = ["all", "qemu", "lxc"] as const

function prunePath(providerId: string, node: string): string {
  return `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/prune`
}

function markTone(mark?: string): "default" | "destructive" | "secondary" | "outline" {
  switch (mark) {
    case "remove":
      return "destructive"
    case "keep":
      return "secondary"
    case "protected":
      return "outline"
    case "renamed":
      return "outline"
    default:
      return "outline"
  }
}

export default function ProxmoxPrunePage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const base = useMemo(
    () => (providerId && node ? prunePath(providerId, node) : null),
    [providerId, node],
  )

  const cluster = useInfraGet<ClusterPayload>(
    providerId ? `/admin/proxmox/${providerId}/cluster` : null,
    undefined,
    { intervalMs: 5000 },
  )
  const clusterStorages = useInfraGet<ClusterStorage[]>(
    providerId ? `/admin/proxmox/${providerId}/cluster-storages` : null,
    undefined,
    { intervalMs: 5000 },
  )
  const storagesOnNode = useInfraGet<ClusterStorage[] | { data?: ClusterStorage[] }>(
    providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/storages` : null,
    undefined,
    { intervalMs: 5000 },
  ) as unknown as ReturnType<typeof useInfraGet<ClusterStorage[]>>

  const storageOptions = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    const push = (name?: string) => {
      const v = (name ?? "").trim()
      if (!v || seen.has(v)) return
      seen.add(v)
      out.push(v)
    }
    const cs = clusterStorages.data
    if (Array.isArray(cs)) cs.forEach((r) => push(r?.storage))
    else if (cs && typeof cs === "object" && Array.isArray((cs as { data?: ClusterStorage[] }).data)) {
      ;(cs as { data: ClusterStorage[] }).data.forEach((r) => push(r?.storage))
    }
    const ns = storagesOnNode.data
    if (Array.isArray(ns)) ns.forEach((r) => push((r as ClusterStorage)?.storage))
    return out
  }, [clusterStorages.data, storagesOnNode.data])

  const [storage, setStorage] = useState("")
  const [pruneBackups, setPruneBackups] = useState("")
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>("all")
  const [vmid, setVmid] = useState("")
  const [preview, setPreview] = useState<PruneBackupItem[]>([])
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const nodeNames = useMemo(
    () => (Array.isArray(cluster.data?.nodes) ? cluster.data!.nodes! : []),
    [cluster.data],
  )

  useEffect(() => {
    if (storageOptions.length > 0 && !storage) setStorage(storageOptions[0]!)
  }, [storageOptions, storage])

  const canPreview = Boolean(base && storage.trim())
  const canPrune = canPreview && !pruning

  const buildQuery = useCallback(() => {
    const q: Record<string, string> = { storage: storage.trim() }
    if (pruneBackups.trim()) q["prune-backups"] = pruneBackups.trim()
    if (type !== "all") q.type = type
    if (vmid.trim()) q.vmid = vmid.trim()
    return q
  }, [storage, pruneBackups, type, vmid])

  const doPreview = useCallback(async () => {
    if (!base || !storage.trim()) {
      toast.error("Pick a storage first.")
      return
    }
    const vmidNum = vmid.trim()
    if (vmidNum && !/^\d+$/.test(vmidNum)) {
      toast.error("VMID must be a positive integer.")
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const res = await apiGet<PruneBackupItem[]>(base, { query: buildQuery() })
      setPreview(Array.isArray(res.data) ? res.data : [])
      const removes = (res.data as PruneBackupItem[] | undefined)?.filter((r) => r.mark === "remove").length ?? 0
      toast.success(removes > 0 ? `Preview: ${removes} backup(s) would be removed.` : "Preview: nothing would be removed.")
    } catch (cause) {
      setPreview([])
      setPreviewError(cause)
      toast.error(cause instanceof ApiError ? cause.message : "Preview failed")
    } finally {
      setPreviewLoading(false)
    }
  }, [base, storage, vmid, buildQuery])

  const doPrune = async () => {
    if (!base || !storage.trim()) return
    const vmidNum = vmid.trim()
    if (vmidNum && !/^\d+$/.test(vmidNum)) {
      toast.error("VMID must be a positive integer.")
      return
    }
    setPruning(true)
    try {
      const body: Record<string, unknown> = { storage: storage.trim() }
      if (pruneBackups.trim()) body.prune_backups = pruneBackups.trim()
      if (type !== "all") body.type = type
      if (vmidNum) body.vmid = Number(vmidNum)
      const res = await apiPost<{ node?: string; storage?: string; task?: unknown }>(base, body)
      const task = (res.data as { task?: string })?.task
      toast.success(task ? `Prune queued — ${String(task)}` : "Prune queued (202)")
      setConfirmOpen(false)
      void doPreview()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Prune failed")
    } finally {
      setPruning(false)
    }
  }

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId || ""} title="Prune backups" description="Per-node backup retention prune (vzdump/PBS).">
        <ErrorBanner error={new Error("Missing providerId or node in route params — expected /admin/proxmox/:id/nodes/:node/prune")} />
      </ProviderShell>
    )
  }

  const removes = preview.filter((r) => r.mark === "remove").length
  const keeps = preview.filter((r) => r.mark !== "remove").length

  return (
    <ProviderShell
      providerId={providerId}
      title={`Prune — ${node}`}
      description={`POST /admin/proxmox/:id/nodes/:node/prune — wraps client.PruneBackups (PVE DELETE /nodes/:node/storage/:storage/prunebackups). GET /nodes/:node/prune is the dry-run preview (infra, NOC readable); POST is platform_admin only. Polled every 5s where applicable.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void doPreview()} disabled={!canPreview || previewLoading}>
            {previewLoading ? "Previewing…" : "Preview"}
          </Button>
          <Button size="sm" disabled={!canPrune} onClick={() => setConfirmOpen(true)}>
            {pruning ? "Pruning…" : "Prune backups"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retention filter</CardTitle>
            <CardDescription>
              <span className="font-mono">storage</span> is required. Leave{" "}
              <span className="font-mono">prune-backups</span> empty to use the storage&apos;s configured retention.{" "}
              <span className="font-mono">type</span> and <span className="font-mono">vmid</span> narrow the prune to a subset. Preview is
              exactly what PVE would delete (mark <span className="font-mono">remove</span>).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prune-storage">Storage *</Label>
                {storageOptions.length > 0 ? (
                  <Select value={storage} onValueChange={setStorage}>
                    <SelectTrigger id="prune-storage">
                      <SelectValue placeholder="Pick a storage" />
                    </SelectTrigger>
                    <SelectContent>
                      {storageOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="prune-storage"
                    value={storage}
                    onChange={(e) => setStorage(e.target.value)}
                    placeholder="e.g. local, pbs-backup"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  From <span className="font-mono">/cluster-storages</span> + <span className="font-mono">/nodes/:node/storages</span> (polled 5s).
                  {clusterStorages.error || storagesOnNode.error ? " Manual entry when cluster is unreachable." : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prune-type">Guest type</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger id="prune-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v === "all" ? "all (qemu + lxc)" : v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prune-vmid">VMID (optional)</Label>
                <Input
                  id="prune-vmid"
                  value={vmid}
                  onChange={(e) => setVmid(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 100"
                  inputMode="numeric"
                />
                <p className="text-xs text-muted-foreground">Limit prune to one guest. Empty means all guests.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prune-retention">prune-backups (retention spec)</Label>
                <Input
                  id="prune-retention"
                  value={pruneBackups}
                  onChange={(e) => setPruneBackups(e.target.value)}
                  placeholder="keep-last=3,keep-monthly=4"
                />
                <p className="text-xs text-muted-foreground">Example: keep-last=3, keep-daily=7, keep-weekly=4, keep-monthly=6.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => void doPreview()} disabled={!canPreview || previewLoading}>
                {previewLoading ? "Previewing…" : "Preview (dry-run)"}
              </Button>
              <Button size="sm" disabled={!canPrune} onClick={() => setConfirmOpen(true)}>
                Prune for real (202)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPruneBackups("")
                  setType("all")
                  setVmid("")
                  setPreview([])
                  setPreviewError(null)
                }}
              >
                Reset
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Endpoints: <span className="font-mono">GET</span> <span className="font-mono">{prunePath(":id", ":node")} ?storage=&prune-backups=&type=&vmid=</span>{" "}
              (infra) · <span className="font-mono">POST</span> <span className="font-mono">{prunePath(":id", ":node")}</span> (platform_admin)
              {nodeNames.length ? ` · node ${node} seen in cluster` : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What this does</CardTitle>
            <CardDescription>Maps to PVE storage/content prunebackups (keep-last/keep-daily/… policy).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>
                <span className="font-mono">GET /nodes/:node/prune</span> calls{" "}
                <span className="font-mono">client.PruneBackupsPreview</span> — dry-run, returns{" "}
                <span className="font-mono">PruneBackupItem[]</span> with{" "}
                <span className="font-mono">mark</span> <span className="font-mono">keep</span> /{" "}
                <span className="font-mono">remove</span> / <span className="font-mono">protected</span> /{" "}
                <span className="font-mono">renamed</span>.
              </li>
              <li>
                <span className="font-mono">POST /nodes/:node/prune</span> calls{" "}
                <span className="font-mono">client.PruneBackups</span> — deletes the <span className="font-mono">remove</span> volumes
                and returns a <span className="font-mono">Task</span> (202). Backups added between preview and prune may shift
                which volumes are removed.
              </li>
              <li>
                Guarded by <span className="font-mono">proxmoxAdapterFor</span> — non-proxmox kinds answer{" "}
                <span className="font-mono">501 expect proxmox</span>.
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Tip: run <span className="font-mono">Preview</span> first. Storage selection blends the global definition list and
              the node-visible view, both refreshed every 5s.
            </p>
          </CardContent>
        </Card>
      </div>

      {previewError ? <ErrorBanner error={previewError} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Preview {preview.length ? `— ${preview.length} item(s) · ${removes} remove · ${keeps} keep/protected/renamed` : ""}
          </CardTitle>
          <CardDescription>
            Dry-run from <span className="font-mono">GET {prunePath(":id", ":node")}</span>. Click{" "}
            <span className="font-mono">Preview</span> to fill; <span className="font-mono">Prune backups</span> deletes the{" "}
            <span className="font-mono">remove</span> rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable<PruneBackupItem>
            columns={[
              {
                key: "volid",
                header: "Volume",
                render: (row) => (
                  <span className="font-mono text-xs break-all">{String(row.volid ?? row.volid_display ?? "—")}</span>
                ),
              },
              {
                key: "mark",
                header: "Mark",
                className: "w-28",
                render: (row) => <Badge variant={markTone(row.mark)}>{row.mark ?? "—"}</Badge>,
              },
              { key: "type", header: "Type", className: "w-20", render: (row) => row.type ?? "—" },
              { key: "vmid", header: "VMID", className: "w-20", render: (row) => (row.vmid != null ? String(row.vmid) : "—") },
              {
                key: "ctime",
                header: "Created",
                className: "hidden md:table-cell",
                render: (row) => {
                  const v = row.ctime
                  if (v == null || v === "") return "—"
                  const n = typeof v === "number" ? v : Number(v)
                  if (!Number.isFinite(n)) return String(v)
                  return new Date(n * 1000).toLocaleString()
                },
              },
            ]}
            rows={preview}
            loading={previewLoading}
            error={previewError}
            getRowKey={(row, idx) => String(row.volid ?? `${row.type}-${row.vmid}-${idx}`)}
            emptyMessage='No preview yet — pick a storage and click "Preview (dry-run)".'
            skeletonRows={4}
          />
          {!previewLoading && !previewError && preview.length === 0 ? (
            <EmptyState
              message="No backups matched"
              description="The preview returned no rows for this filter — check the storage name, type/vmid scope, and that the storage actually holds vzdump/PBS backups. Empty prune-backups means use the storage's configured retention."
            />
          ) : null}
          {preview.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Last preview at {new Date().toLocaleTimeString()} · {removes} would be deleted on prune.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Prune backups on ${node} / ${storage || "storage"}?`}
        body={
          removes > 0
            ? `${removes} backup(s) are marked "remove" and will be deleted from storage "${storage}" on node "${node}". This cannot be undone. Backups added or removed between preview and prune may shift which volumes are deleted.`
            : `Run the keep-policy prune on storage "${storage}" (node "${node}"). Volumes whose preview mark is "remove" will be deleted. This cannot be undone. Preview first if you are unsure.`
        }
        confirmLabel={pruning ? "Pruning…" : "Prune backups"}
        busy={pruning}
        onConfirm={() => void doPrune()}
      />
    </ProviderShell>
  )
}
