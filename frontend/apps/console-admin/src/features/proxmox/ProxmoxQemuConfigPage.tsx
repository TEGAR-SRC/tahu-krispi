import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type QemuConfig = Record<string, unknown>

type ConfigRow = {
  key: string
  value: unknown
}

function toRows(cfg: QemuConfig | null): ConfigRow[] {
  if (!cfg || typeof cfg !== "object") return []
  return Object.entries(cfg).map(([key, value]) => ({ key, value }))
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function parseValue(raw: string): unknown {
  const t = raw.trim()
  if (t === "") return raw
  if (t === "true") return true
  if (t === "false") return false
  if (t === "null") return null
  const num = Number(t)
  if (t !== "" && Number.isFinite(num) && String(num) === t) return num
  try {
    const parsed = JSON.parse(t)
    if (typeof parsed === "object") return parsed
    return parsed
  } catch {
    return raw
  }
}

export default function ProxmoxQemuConfigPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const path =
    providerId && node && vmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/config`
      : null
  const state = useInfraGet<QemuConfig>(path, undefined, { intervalMs: 5000 })
  const rows = useMemo(() => toRows((state.data as QemuConfig | null) ?? null), [state.data])

  const [editKey, setEditKey] = useState("")
  const [editValue, setEditValue] = useState("")
  const [rawJson, setRawJson] = useState("")
  const [saving, setSaving] = useState(false)

  if (!providerId || !node || !vmid) {
    return (
      <ProviderShell
        providerId={providerId || ""}
        title="QEMU config"
        description="Per-VM QEMU config — live from PVE /nodes/{node}/qemu/{vmid}/config (polled every 5s, infra-readable)."
      >
        <p className="text-sm text-destructive">
          Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/config.
        </p>
      </ProviderShell>
    )
  }

  const saveSingle = async () => {
    const k = editKey.trim()
    if (!k) {
      toast.error("Key is required")
      return
    }
    if (!path) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { [k]: parseValue(editValue) }
      await apiPut(path, payload)
      toast.success(`Config ${k} updated`)
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update config")
    } finally {
      setSaving(false)
    }
  }

  const saveRaw = async () => {
    const t = rawJson.trim()
    if (!t) {
      toast.error("JSON payload is required")
      return
    }
    let payload: Record<string, unknown>
    try {
      const parsed = JSON.parse(t) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload must be a JSON object")
      payload = parsed as Record<string, unknown>
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Invalid JSON")
      return
    }
    if (Object.keys(payload).length === 0) {
      toast.error("JSON object is empty")
      return
    }
    if (!path) return
    setSaving(true)
    try {
      await apiPut(path, payload)
      toast.success("QEMU config updated")
      setRawJson("")
      state.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update config")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU config — ${node}/${vmid}`}
      description={`Live QEMU config for VM ${vmid} on node ${node}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/config (polled every 5s, infra-readable). PUT requires platform_admin.`}
      actions={
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>
          Refresh
        </Button>
      }
    >
      {state.error ? <ErrorBanner error={state.error} /> : null}

      <SimpleDataTable<ConfigRow>
        columns={[
          { key: "key", header: "Key", render: (r) => <span className="font-mono text-sm font-medium">{r.key}</span> },
          {
            key: "value",
            header: "Value",
            render: (r) => <span className="max-w-[28rem] truncate font-mono text-xs">{stringifyValue(r.value)}</span>,
          },
          {
            key: "type",
            header: "Type",
            className: "w-24",
            render: (r) => <span className="text-xs text-muted-foreground">{r.value === null ? "null" : typeof r.value}</span>,
          },
        ]}
        rows={rows}
        loading={state.loading}
        error={null}
        getRowKey={(r) => r.key}
        emptyMessage={state.loading ? "Loading QEMU config…" : "No config keys — VM may not exist or PVE returned an empty config."}
        skeletonRows={8}
      />
      <p className="text-xs text-muted-foreground">
        Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/config</span> · requireStaff infra (NOC + platform_admin) · proxmox murni (proxmoxAdapterFor) · 5s poll
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick edit — single key</CardTitle>
            <CardDescription>
              PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/config — {"{ [key]: value }"} — booleans &amp; numbers are auto-coerced (e.g. &quot;true&quot; → true, &quot;2048&quot; → 2048). PVE validates keys server-side.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-key">Key *</Label>
              <Input id="qc-key" value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder="cores" className="font-mono" />
              <p className="text-xs text-muted-foreground">Examples: name, description, cores, memory, onboot, agent, ostype, boot, scsi0, net0, tags, ciuser</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-value">Value *</Label>
              <Input id="qc-value" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="2  or  2048  or  my-vm-01" className="font-mono" />
            </div>
            <Button onClick={() => void saveSingle()} disabled={saving || !editKey.trim()}>
              {saving ? "Saving…" : "Save key"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Endpoint: <span className="font-mono">PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/config</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk edit — raw JSON</CardTitle>
            <CardDescription>PUT the same endpoint with a full JSON object. Useful for multi-key patches like {"{"}"cores":2,"memory":2048{"}"}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qc-json">JSON object *</Label>
              <Textarea
                id="qc-json"
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                placeholder={'{\n  "cores": 2,\n  "memory": 2048,\n  "name": "web-01"\n}'}
                rows={8}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={() => void saveRaw()} disabled={saving || !rawJson.trim()}>
              {saving ? "Saving…" : "Save JSON"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Tip: PVE rejects unknown keys — check PVE docs for valid QEMU config keys. Digest is managed by PVE; do not send digest.
            </p>
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
