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

type PauseStatusPayload = {
  provider_id: string
  code: string
  node: string
  vmid: number
  external_id: string
  guest?: QemuRow | null
  hint?: string
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

export default function ProxmoxQemuPausePage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validVmid = /^\d+$/.test(trimmedVmid)
  const validNode = trimmedNode.length > 0

  const pausePath =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/pause`
      : null

  const state = useInfraGet<PauseStatusPayload>(pausePath, undefined, { intervalMs: 5000 })
  const guest = (state.data?.guest as QemuRow | null | undefined) ?? null
  const target = useMemo(() => {
    if (guest && String(guest.vmid ?? "") === trimmedVmid) return guest
    if (guest) return guest
    return null
  }, [guest, trimmedVmid])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const doPause = async () => {
    if (!pausePath) return
    setBusy(true)
    try {
      const res = (await apiPost(pausePath, {})) as { data?: { task?: unknown } }
      const task = (res as unknown as { data?: { task?: string } })?.data?.task ?? (res as unknown as { task?: string })?.task
      toast.success(task ? `Pause issued for ${trimmedNode}/${trimmedVmid} — task ${String(task)}` : `Pause issued for ${trimmedNode}/${trimmedVmid}`)
      setConfirmOpen(false)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to pause VM")
    } finally {
      setBusy(false)
    }
  }

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU pause"
        description="Per-VM suspend to RAM — POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause (GET status polled every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">
          Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause.
        </p>
      </ProviderShell>
    )
  }

  if (!validVmid) {
    return (
      <ProviderShell
        providerId={providerId}
        title={`QEMU pause — ${trimmedNode}/${trimmedVmid}`}
        description={`Pause (suspend to RAM) for QEMU ${trimmedVmid} on node ${trimmedNode}. POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause (platform_admin only, proxmox murni).`}
      >
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU pause — ${trimmedNode}/${trimmedVmid}`}
      description={`Pause (PVE suspend to RAM) for VM ${trimmedVmid} on node ${trimmedNode}. POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause — platform_admin only, proxmox murni (proxmoxAdapterFor). Status polled every 5s via useInfraGet.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={state.loading} onClick={() => state.reload()}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {busy ? "Pausing…" : "Pause VM"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {state.error ? <ErrorBanner error={state.error} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Target VM</CardTitle>
            <CardDescription>
              Resolved from <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause</span> (infra-readable, 5s poll).
              Pause suspends the guest to RAM — the VM remains defined but execution is frozen until resumed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleDataTable<QemuRow>
              columns={[
                { key: "vmid", header: "VMID", render: (r) => <span className="font-mono text-sm font-medium">{stringify(r.vmid ?? trimmedVmid)}</span> },
                { key: "name", header: "Name", render: (r) => stringify(r.name) },
                { key: "status", header: "Status", render: (r) => stringify(r.status) },
                { key: "node", header: "Node", render: (r) => stringify(r.node ?? trimmedNode) },
                { key: "cpus", header: "CPUs", className: "hidden md:table-cell", render: (r) => stringify(r.cpus) },
                { key: "uptime", header: "Uptime", className: "hidden lg:table-cell", render: (r) => stringify(r.uptime) },
              ]}
              rows={target ? [target] : []}
              loading={state.loading}
              error={null}
              getRowKey={(r) => String(r.vmid ?? trimmedVmid)}
              emptyMessage={
                state.loading
                  ? "Loading pause status…"
                  : `VM ${trimmedVmid} not found on ${trimmedNode} — status is live from PVE cluster resources. The pause button still works (PVE validates VMID).`
              }
              skeletonRows={1}
            />
            {!target && !state.loading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Tip: verify node/VMID against the QEMU per-node page at{" "}
                <span className="font-mono">/admin/proxmox/{providerId}/nodes/{trimmedNode}/qemu</span>.
                {state.data?.hint ? <> · {state.data.hint}</> : null}
              </p>
            ) : state.data?.hint ? (
              <p className="mt-2 text-xs text-muted-foreground">{state.data.hint}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pause</CardTitle>
            <CardDescription>
              <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause</span> — no body. Returns 202 with{" "}
              <span className="font-mono">{"{ node, vmid, status, task }"}</span>. Requires platform_admin; proxmox murni via{" "}
              <span className="font-mono">proxmoxAdapterFor</span> (non-proxmox → 501 expect proxmox).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This issues <span className="font-mono">POST /api2/json/nodes/{trimmedNode}/qemu/{trimmedVmid}/status/suspend</span> on the
              PVE host via <span className="font-mono">Client.QEMUPause</span>. Use to suspend a running VM to RAM — the guest can be
              resumed later via <span className="font-mono">POST .../resume</span>. PVE returns a task UPID you can follow under Tasks.
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(true)}>
              {busy ? "Pausing…" : `Pause ${trimmedNode}/${trimmedVmid}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause</span> · requireStaff
              platform_admin · proxmox murni · 202 + task on success. GET side:{" "}
              <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause</span> · requireStaff infra · 5s poll.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause {trimmedNode}/{trimmedVmid}?</DialogTitle>
            <DialogDescription>
              This suspends QEMU VM {trimmedVmid} on node {trimmedNode} to RAM (PVE suspend). The guest will be frozen but remains
              defined — resume it later via the resume action. Running workloads will be paused.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void doPause()}>
              {busy ? "Pausing…" : "Confirm pause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
