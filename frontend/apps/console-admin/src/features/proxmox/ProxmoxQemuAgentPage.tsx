import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type AgentCommandRow = { name?: string; [k: string]: unknown }
type AgentInfoPayload = {
  version?: string
  supported_commands?: Array<{ name?: string; enabled?: boolean; "success-response"?: boolean } | string>
  result?: unknown
  [k: string]: unknown
}
type AgentGenericPayload = Record<string, unknown>

function asString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

function pickAgentData(payload: unknown): unknown {
  if (payload == null) return null
  if (typeof payload !== "object") return payload
  const rec = payload as Record<string, unknown>
  // PVE wraps: {data: {result: ...}} — useInfraGet unwraps outer data, leaving {result: ...} or already unwrapped.
  if ("result" in rec) return rec.result
  if ("data" in rec && typeof rec.data === "object" && rec.data != null) {
    const inner = rec.data as Record<string, unknown>
    if ("result" in inner) return inner.result
    return inner
  }
  return rec
}

export default function ProxmoxQemuAgentPage() {
  const { providerId = "", node = "", vmid = "" } = useParams<{ providerId: string; node: string; vmid: string }>()
  const trimmedNode = (node ?? "").trim()
  const trimmedVmid = (vmid ?? "").trim()
  const validVmid = /^\d+$/.test(trimmedVmid)
  const validNode = trimmedNode.length > 0

  const agentBase =
    providerId && validNode && validVmid
      ? `/admin/proxmox/${providerId}/nodes/${encodeURIComponent(trimmedNode)}/qemu/${encodeURIComponent(trimmedVmid)}/agent`
      : null

  const infoPath = agentBase ? `${agentBase}/info` : null
  const timePath = agentBase ? `${agentBase}/get-time` : null
  const tzPath = agentBase ? `${agentBase}/get-timezone` : null
  const usersPath = agentBase ? `${agentBase}/get-users` : null
  const vcpusPath = agentBase ? `${agentBase}/get-vcpus` : null
  const fsinfoPath = agentBase ? `${agentBase}/get-fsinfo` : null

  const indexState = useInfraGet<AgentCommandRow[] | AgentGenericPayload>(agentBase, undefined, { intervalMs: 5000 })
  const infoState = useInfraGet<AgentInfoPayload | AgentGenericPayload>(infoPath, undefined, { intervalMs: 5000 })
  const timeState = useInfraGet<AgentGenericPayload>(timePath, undefined, { intervalMs: 5000 })
  const tzState = useInfraGet<AgentGenericPayload>(tzPath, undefined, { intervalMs: 5000 })
  const usersState = useInfraGet<AgentGenericPayload>(usersPath, undefined, { intervalMs: 5000 })
  const vcpusState = useInfraGet<AgentGenericPayload>(vcpusPath, undefined, { intervalMs: 5000 })
  const fsinfoState = useInfraGet<AgentGenericPayload>(fsinfoPath, undefined, { intervalMs: 5000 })

  const indexRows = useMemo(() => {
    const data = pickAgentData(indexState.data)
    if (Array.isArray(data)) return data as AgentCommandRow[]
    if (Array.isArray(indexState.data)) return indexState.data as AgentCommandRow[]
    return [] as AgentCommandRow[]
  }, [indexState.data])

  const infoData = useMemo(() => pickAgentData(infoState.data) as Record<string, unknown> | null, [infoState.data])
  const timeData: unknown = pickAgentData(timeState.data)
  const tzData: unknown = pickAgentData(tzState.data)
  const usersData: unknown = pickAgentData(usersState.data)
  const vcpusData: unknown = pickAgentData(vcpusState.data)
  const fsData: unknown = pickAgentData(fsinfoState.data)

  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdName, setCmdName] = useState("")
  const [fileReadOpen, setFileReadOpen] = useState(false)
  const [filePath, setFilePath] = useState("")
  const [fileResult, setFileResult] = useState<string>("")
  const [execOpen, setExecOpen] = useState(false)
  const [execCmd, setExecCmd] = useState("")
  const [execResult, setExecResult] = useState<string>("")
  const [busy, setBusy] = useState(false)

  const runPost = async (sub: string, body: unknown, success: string, onData?: (data: unknown) => void) => {
    if (!agentBase) return
    setBusy(true)
    try {
      const path = sub ? `${agentBase}/${sub.replace(/^\//, "")}` : agentBase
      const res = await apiPost(path, (body ?? {}) as Record<string, unknown>)
      const data = (res as unknown as { data?: unknown })?.data ?? (res as unknown)
      toast.success(success)
      onData?.(data)
      indexState.reload(); infoState.reload(); timeState.reload(); tzState.reload(); usersState.reload(); vcpusState.reload(); fsinfoState.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Agent request failed")
    } finally { setBusy(false) }
  }

  const doPing = () => void runPost("ping", {}, "Agent ping succeeded")

  const doGenericCmd = () => {
    const c = cmdName.trim()
    if (!c) { toast.error("Command is required"); return }
    void runPost("", { command: c }, `Agent command ${c} sent`, (d) => setFileResult(typeof d === "string" ? d : JSON.stringify(d, null, 2)))
  }

  const doFileRead = async () => {
    const f = filePath.trim()
    if (!f) { toast.error("File path is required"); return }
    if (!agentBase) return
    setBusy(true)
    try {
      const q = new URLSearchParams({ file: f }).toString()
      const res = await apiGet<AgentGenericPayload>(`${agentBase}/file-read?${q}`)
      const data = pickAgentData(res.data) as unknown
      const text = typeof data === "string" ? data : JSON.stringify(data, null, 2)
      setFileResult(text)
      toast.success("File read returned")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "File read failed")
    } finally { setBusy(false) }
  }

  const doExec = async () => {
    const raw = execCmd.trim()
    if (!raw) { toast.error("Command is required"); return }
    // Accept either JSON array '["bash","-c","echo hi"]' or shell-like single string.
    let argv: string[] | null = null
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) argv = parsed as string[]
    } catch { /* treat as single */ }
    if (!argv) argv = raw.split(/\s+/).filter(Boolean)
    if (argv.length === 0) { toast.error("Command is empty"); return }
    void runPost("exec", { command: argv }, `Exec pid issued for ${argv[0]}`, (d) => setExecResult(typeof d === "string" ? d : JSON.stringify(d, null, 2)))
  }

  if (!providerId || !trimmedNode || !trimmedVmid) {
    return (
      <ProviderShell providerId={providerId || ""} title="QEMU agent" description="Per-VM QEMU guest-agent — live from PVE /nodes/{node}/qemu/{vmid}/agent/* (polled every 5s, infra-readable).">
        <p className="text-sm text-destructive">Missing providerId, node or vmid in route — expected /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/* .</p>
      </ProviderShell>
    )
  }
  if (!validVmid) {
    return (
      <ProviderShell providerId={providerId} title={`QEMU agent — ${trimmedNode}/${trimmedVmid}`} description={`QEMU guest-agent for VM ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/* (infra-readable, 5s poll).`}>
        <p className="text-sm text-destructive">VMID must be a positive integer.</p>
      </ProviderShell>
    )
  }

  const cmdRows = indexRows
  const supportedCommands: Array<Record<string, unknown>> = (() => {
    if (!infoData || typeof infoData !== "object") return []
    const sc = (infoData as Record<string, unknown>).supported_commands
    if (!Array.isArray(sc)) return []
    return sc.map((x) => typeof x === "string" ? ({ name: x } as Record<string, unknown>) : (x as Record<string, unknown>))
  })()

  const versionLabel = infoData && typeof infoData === "object" ? asString((infoData as Record<string, unknown>).version) : ""

  const formatCell = (v: unknown) => {
    if (v == null) return <span className="text-muted-foreground">—</span>
    if (typeof v === "object") return <span className="max-w-64 truncate font-mono text-xs break-all">{JSON.stringify(v)}</span>
    return <span className="max-w-64 truncate font-mono text-xs">{String(v)}</span>
  }

  const anyError = indexState.error || infoState.error || timeState.error || tzState.error || usersState.error || vcpusState.error || fsinfoState.error
  const anyLoading = indexState.loading || infoState.loading

  return (
    <ProviderShell
      providerId={providerId}
      title={`QEMU agent — ${trimmedNode}/${trimmedVmid}`}
      description={`QEMU guest-agent for VM ${trimmedVmid} on node ${trimmedNode}. GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/* (polled every 5s, infra-readable). POST requires platform_admin. Proxmox murni (proxmoxAdapterFor).`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={anyLoading} onClick={() => { indexState.reload(); infoState.reload(); timeState.reload(); tzState.reload(); usersState.reload(); vcpusState.reload(); fsinfoState.reload() }}>Refresh</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={doPing}>{busy ? "…" : "Ping"}</Button>
          <Button size="sm" onClick={() => setCmdOpen(true)}>Run command</Button>
          <Button size="sm" variant="outline" onClick={() => setFileReadOpen(true)}>File read</Button>
          <Button size="sm" variant="outline" onClick={() => setExecOpen(true)}>Exec</Button>
        </div>
      }
    >
      {anyError ? <ErrorBanner error={anyError} /> : null}

      <p className="text-xs text-muted-foreground">
        Endpoints: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent</span> (index) · <span className="font-mono">GET /agent/info</span> · <span className="font-mono">GET /agent/get-time</span> · <span className="font-mono">GET /agent/get-timezone</span> · <span className="font-mono">GET /agent/get-users</span> · <span className="font-mono">GET /agent/get-vcpus</span> · <span className="font-mono">GET /agent/get-fsinfo</span> · <span className="font-mono">POST /agent/ping</span> · <span className="font-mono">POST /agent ({"{command}"})</span> · <span className="font-mono">GET /agent/file-read?file=</span> · <span className="font-mono">POST /agent/file-write / exec / fstrim / …</span> — all via <span className="font-mono">GET/POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/*</span> (wildcard passthrough, proxmox murni).
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent index</CardTitle>
            <CardDescription>GET /agent — PVE command routing table for this VM. Polled every 5s.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleDataTable<AgentCommandRow>
              columns={[
                { key: "name", header: "Command", render: (r) => <span className="font-mono text-xs">{asString(r.name) || "—"}</span> },
                { key: "raw", header: "Raw", render: (r) => formatCell(r) },
              ]}
              rows={cmdRows}
              loading={indexState.loading}
              error={null}
              getRowKey={(r, i) => String((r.name as string) ?? i)}
              emptyMessage={indexState.loading ? "Loading agent index…" : "No agent commands — VM may be off or guest-agent not running."}
              skeletonRows={6}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent info {versionLabel ? <Badge variant="secondary" className="ml-2 align-middle font-mono text-xs">{versionLabel}</Badge> : null}</CardTitle>
            <CardDescription>GET /agent/info — guest-agent version + advertised QGA commands. Polled every 5s.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {infoState.loading && supportedCommands.length === 0 ? <p className="text-sm text-muted-foreground">Loading agent info…</p> : supportedCommands.length === 0 ? <p className="text-sm text-muted-foreground">No info — guest-agent may not be running.</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {supportedCommands.map((c, i) => (
                <Badge key={String((c.name as string) ?? i)} variant={c.enabled === false ? "outline" : "secondary"} className="font-mono text-xs">
                  {asString(c.name) || `cmd-${i}`} {c.enabled === false ? "(disabled)" : ""}
                </Badge>
              ))}
            </div>
            {infoData ? (
              <details className="rounded border p-2">
                <summary className="cursor-pointer text-xs font-medium">Raw info JSON</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{JSON.stringify(infoData, null, 2)}</pre>
              </details>
            ) : null}
            <p className="text-xs text-muted-foreground">Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/info</span></p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Time</CardTitle><CardDescription>GET /agent/get-time</CardDescription></CardHeader>
          <CardContent>
            {timeState.error ? <p className="text-xs text-destructive">{String((timeState.error as ApiError).message ?? timeState.error)}</p> : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{timeData != null ? (typeof timeData === "object" ? JSON.stringify(timeData, null, 2) : String(timeData)) : timeState.loading ? "Loading…" : "—"}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Timezone</CardTitle><CardDescription>GET /agent/get-timezone</CardDescription></CardHeader>
          <CardContent>
            {tzState.error ? <p className="text-xs text-destructive">{String((tzState.error as ApiError).message ?? tzState.error)}</p> : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{tzData != null ? (typeof tzData === "object" ? JSON.stringify(tzData, null, 2) : String(tzData)) : tzState.loading ? "Loading…" : "—"}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Users / vCPUs</CardTitle><CardDescription>GET /agent/get-users · GET /agent/get-vcpus</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium">get-users</p>
              {usersState.error ? <p className="text-xs text-destructive">{String((usersState.error as ApiError).message ?? usersState.error)}</p> : null}
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{usersData != null ? (typeof usersData === "object" ? JSON.stringify(usersData, null, 2) : String(usersData)) : usersState.loading ? "Loading…" : "—"}</pre>
            </div>
            <div>
              <p className="text-xs font-medium">get-vcpus</p>
              {vcpusState.error ? <p className="text-xs text-destructive">{String((vcpusState.error as ApiError).message ?? vcpusState.error)}</p> : null}
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{vcpusData != null ? (typeof vcpusData === "object" ? JSON.stringify(vcpusData, null, 2) : String(vcpusData)) : vcpusState.loading ? "Loading…" : "—"}</pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filesystems</CardTitle><CardDescription>GET /agent/get-fsinfo — mounted filesystems + disk usage + block device topology. Polled every 5s.</CardDescription></CardHeader>
        <CardContent>
          {fsinfoState.error ? <ErrorBanner error={fsinfoState.error} /> : null}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{fsData != null ? (typeof fsData === "object" ? JSON.stringify(fsData, null, 2) : String(fsData)) : fsinfoState.loading ? "Loading…" : "No fs info — agent may not be running."}</pre>
          <p className="mt-2 text-xs text-muted-foreground">Endpoint: <span className="font-mono">GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/get-fsinfo</span></p>
        </CardContent>
      </Card>

      {(fileResult || execResult) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {fileResult ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Last command / file result</CardTitle><CardDescription>Response from POST /agent or GET /agent/file-read</CardDescription></CardHeader>
              <CardContent><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{fileResult}</pre></CardContent>
            </Card>
          ) : null}
          {execResult ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Exec result</CardTitle><CardDescription>POST /agent/exec — PVE returns pid; poll /exec-status</CardDescription></CardHeader>
              <CardContent><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{execResult}</pre></CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Endpoint family: <span className="font-mono">GET/POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/*</span> · GET requireStaff infra (NOC + platform_admin) · POST/PUT platform_admin only · proxmox murni (proxmoxAdapterFor) · 5s poll via useInfraGet. Wildcard after /agent/ passes through to PVE (<span className="font-mono">/nodes/{"{node}"}/qemu/{"{vmid}"}/agent/{"{suffix}"}</span>).
      </p>

      <Dialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run agent command</DialogTitle>
            <DialogDescription>POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent — {"{command}"} — forwarded to PVE POST /agent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="agent-cmd">QGA command *</Label>
            <Input id="agent-cmd" value={cmdName} onChange={(e) => setCmdName(e.target.value)} placeholder="get-time" className="font-mono" />
            <p className="text-xs text-muted-foreground">Examples: ping, get-time, get-timezone, get-users, get-vcpus, get-fsinfo, fstrim, fsfreeze-freeze, file-read, info</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCmdOpen(false)}>Cancel</Button>
            <Button disabled={busy || !cmdName.trim()} onClick={() => { doGenericCmd(); setCmdOpen(false) }}>{busy ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fileReadOpen} onOpenChange={setFileReadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>File read</DialogTitle>
            <DialogDescription>GET /agent/file-read?file= — cap 16 MiB, truncated flag. Also: POST /agent/file-write via F5.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="agent-file">Guest file path *</Label>
            <Input id="agent-file" value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="/etc/hosts" className="font-mono" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileReadOpen(false)}>Cancel</Button>
            <Button disabled={busy || !filePath.trim()} onClick={() => void doFileRead()}>{busy ? "Reading…" : "Read"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={execOpen} onOpenChange={setExecOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Exec</DialogTitle>
            <DialogDescription>POST /agent/exec — {"{command: string[], input-data?}"} — enter JSON array or space-separated command.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="agent-exec">Command *</Label>
            <Textarea id="agent-exec" value={execCmd} onChange={(e) => setExecCmd(e.target.value)} placeholder='["bash","-c","echo hi"]  or  cat /etc/hosts' rows={4} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">JSON array preferred; plain string is split on whitespace. Check result via POST /agent/exec-status?pid=</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecOpen(false)}>Cancel</Button>
            <Button disabled={busy || !execCmd.trim()} onClick={() => void doExec()}>{busy ? "Sending…" : "Exec"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProviderShell>
  )
}
