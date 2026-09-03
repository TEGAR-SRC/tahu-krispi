import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type QemuRow = {
  vmid?: number
  name?: string
  status?: string
  node?: string
  cpus?: number
  maxmem?: number
  mem?: number
  uptime?: number
  [key: string]: unknown
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v || "—"
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export default function ProxmoxQemuResetPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validVmid = /^\d+$/.test(trimmedVmid)
  const validNode = trimmedNode.length > 0

  const qemuPath =
    providerId && validNode
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu`
      : null
  const resetPath =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/reset`
      : null

  const qemuState = useInfraGet<QemuRow[]>(qemuPath, undefined, { intervalMs: 5000 })
  const rows = useMemo(() => (qemuState.data ?? []) as QemuRow[], [qemuState.data])
  const target = useMemo(
    () => rows.find((r) => String(r.vmid ?? "") === trimmedVmid) ?? null,
    [rows, trimmedVmid],
  )

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const doReset = async () => {
    if (!resetPath) return
    setBusy(true)
    try {
      const res = (await apiPost(resetPath, {})) as { data?: { task?: unknown } }
      const task = (res as unknown as { data?: { task?: string } })?.data?.task ?? (res as unknown as { task?: string })?.task
      toast.success(task ? `Reset issued for ${trimmedNode}/${trimmedVmid} — task ${String(task)}` : `Reset issued for ${trimmedNode}/${trimmedVmid}`)
      setConfirmOpen(false)
      qemuState.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to reset VM")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU reset"
        description="Per-VM hard reset — POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset (polled list via GET /nodes/:node/qemu every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">
          Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset.
        </p>
      </ProviderShell>
    )
  }

  if (!validVmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title={`QEMU reset — ${trimmedNode}/${trimmedVmid}`}
        description={`Hard reset for QEMU ${trimmedVmid} on node ${trimmedNode}. POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset (platform_admin only, proxmox murni).`}
      >
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU reset — ${trimmedNode}/${trimmedVmid}`}
      description={`Hard reset (PVE reset) for VM ${trimmedVmid} on node ${trimmedNode}. POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset — platform_admin only, proxmox murni (proxmoxAdapterFor). List polled every 5s via useInfraGet.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={qemuState.loading} onClick={() => qemuState.reload()}>
            Refresh
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {busy ? "Resetting…" : "Hard reset VM"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {qemuState.error ? <ErrorBanner error={qemuState.error} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Target VM</CardTitle>
            <CardDescription>
              Resolved from <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu</span> (infra-readable, 5s poll). Reset
              is a hard power reset — equivalent to pressing the reset button. Unsaved guest state is lost.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<QemuRow>
              columns={[
                { key: "vmid", header: "VMID", render: (r) => <span className="font-mono text-sm font-medium">{stringify(r.vmid)}</span> },
                { key: "name", header: "Name", render: (r) => stringify(r.name) },
                { key: "status", header: "Status", render: (r) => stringify(r.status) },
                { key: "node", header: "Node", render: (r) => stringify(r.node ?? trimmedNode) },
                { key: "cpus", header: "CPUs", className: "hidden md:table-cell", render: (r) => stringify(r.cpus) },
                { key: "uptime", header: "Uptime", className: "hidden lg:table-cell", render: (r) => stringify(r.uptime) },
              ]}
              rows={target ? [target] : []}
              loading={qemuState.loading}
              error={null}
              getRowKey={(r) => String(r.vmid ?? trimmedVmid)}
              emptyMessage={
                qemuState.loading
                  ? "Loading QEMU list…"
                  : `VM ${trimmedVmid} not found on ${trimmedNode} — list is live from PVE /nodes/${trimmedNode}/qemu. The reset button still works (PVE validates VMID).`
              }
              skeletonRows={1}
            />
            {!target && !qemuState.loading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Tip: verify node/VMID against the QEMU per-node page at{" "}
                <span className="font-mono">/admin/proxmox/{providerId}/nodes/{trimmedNode}/qemu</span>.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hard reset</CardTitle>
            <CardDescription>
              <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset</span> — no body. Returns 202 with{" "}
              <span className="font-mono">{"{ node, vmid, status, task }"}</span>. Requires platform_admin; proxmox murni via{" "}
              <span className="font-mono">proxmoxAdapterFor</span> (non-proxmox → 501 expect proxmox).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This issues <span className="font-mono">POST /api2/json/nodes/{trimmedNode}/qemu/{trimmedVmid}/status/reset</span> on the
              PVE host. Use when the guest is hung and a graceful reboot is not possible. The VM is reset immediately; PVE returns a
              task UPID you can follow under Tasks.
            </p>
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
              {busy ? "Resetting…" : `Hard reset ${trimmedNode}/${trimmedVmid}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset</span> · requireStaff
              platform_admin · proxmox murni · 202 + task on success.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hard reset {trimmedNode}/{trimmedVmid}?</DialogTitle>
            <DialogDescription>
              This performs a hard reset of QEMU VM {trimmedVmid} on node {trimmedNode}. The guest is reset immediately without a
              graceful shutdown — unsaved data will be lost. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void doReset()}>
              {busy ? "Resetting…" : "Confirm hard reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
