import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiPut, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type TimePayload = Record<string, unknown> & { timezone?: string; localtime?: number; time?: number }

export default function ProxmoxNodeTimePage() {
  const { providerId = "", node = "" } = useParams<{ providerId: string; node: string }>()
  const base = providerId && node ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(node)}/time` : null
  const time = useInfraGet<TimePayload>(base, undefined, { intervalMs: 5000 })
  const [timezone, setTimezone] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (time.data?.timezone) setTimezone(String(time.data.timezone))
  }, [time.data?.timezone])

  const save = async () => {
    if (!base) return
    const tz = timezone.trim()
    if (!tz) { toast.error("Timezone is required."); return }
    setSaving(true)
    try {
      await apiPut(base, { timezone: tz })
      toast.success("Timezone updated")
      time.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update timezone")
    } finally { setSaving(false) }
  }

  if (!providerId || !node) {
    return (
      <ProviderShell providerId={providerId || ""} title="Node time" description="Per-node clock & timezone.">
        <p className="text-sm text-destructive">Missing providerId or node in route.</p>
      </ProviderShell>
    )
  }

  const epoch = Number((time.data as TimePayload | null)?.time ?? 0)
  const localtime = Number((time.data as TimePayload | null)?.localtime ?? 0)

  return (
    <ProviderShell providerId={providerId} title={`Node ${node} — Time`} description="Clock & timezone for this Proxmox node. GET is infra-readable (NOC), PUT requires platform_admin. PUT /admin/proxmox/:id/nodes/:node/time — {timezone}. Polling every 5s.">
      {time.error ? <ErrorBanner error={time.error} /> : null}
      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clock</CardTitle>
            <CardDescription>Live from GET /nodes/:node/time (polled every 5s).</CardDescription>
          </CardHeader>
          <CardContent>
            {time.loading ? <p className="text-sm text-muted-foreground">Loading clock…</p> : time.data ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Timezone</dt><dd className="font-mono">{String(time.data.timezone ?? "—")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">UTC time</dt><dd>{epoch > 0 ? new Date(epoch * 1000).toLocaleString() : "—"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Local time</dt><dd>{localtime > 0 ? new Date(localtime * 1000).toLocaleString() : "—"}</dd></div>
              </dl>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit timezone</CardTitle>
            <CardDescription>PUT /admin/proxmox/:id/nodes/:node/time — {"{ timezone }"}. Must be a valid IANA zone (e.g. Asia/Jakarta, UTC, America/New_York).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="node-timezone">Timezone *</Label>
              <Input id="node-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Jakarta" />
            </div>
            <Button disabled={saving || timezone.trim() === ""} onClick={() => void save()}>{saving ? "Saving…" : "Save timezone"}</Button>
            <p className="text-xs text-muted-foreground">Endpoint: <span className="font-mono">PUT /admin/proxmox/:id/nodes/:node/time</span></p>
          </CardContent>
        </Card>
      </div>
    </ProviderShell>
  )
}
