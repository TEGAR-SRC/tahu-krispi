// Dokploy logs realtime — GET /admin/dokploy/logs tail polling 3s
// Provider: dokploy single instance (no :id). RBAC: GET infra (NOC readable), tail realtime via polling.
// Upstream: dokploy readLogs ops proxied through backend GET /admin/dokploy/logs?applicationId=…&tail=100
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { PageHeader } from "@/components/shared/PageHeader"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type LogKind =
  | "application"
  | "deployment"
  | "compose"
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongo"
  | "redis"
  | "libsql"

interface LogsPayload {
  logs: string
  tail: number
  op: string
}

const KINDS: Array<{ value: LogKind; label: string; idParam: string; op: string }> = [
  { value: "application", label: "Application", idParam: "applicationId", op: "application.readLogs" },
  { value: "deployment", label: "Deployment", idParam: "deploymentId", op: "deployment.readLogs" },
  { value: "compose", label: "Compose", idParam: "composeId", op: "compose.readLogs" },
  { value: "postgres", label: "Postgres", idParam: "postgresId", op: "postgres.readLogs" },
  { value: "mysql", label: "MySQL", idParam: "mysqlId", op: "mysql.readLogs" },
  { value: "mariadb", label: "MariaDB", idParam: "mariadbId", op: "mariadb.readLogs" },
  { value: "mongo", label: "Mongo", idParam: "mongoId", op: "mongo.readLogs" },
  { value: "redis", label: "Redis", idParam: "redisId", op: "redis.readLogs" },
  { value: "libsql", label: "LibSQL", idParam: "libsqlId", op: "libsql.readLogs" },
]

export default function DokployLogsPage() {
  const [kind, setKind] = useState<LogKind>("application")
  const [resourceId, setResourceId] = useState("")
  const [containerId, setContainerId] = useState("")
  const [tail, setTail] = useState("100")
  const [since, setSince] = useState("all")
  const [search, setSearch] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const preRef = useRef<HTMLPreElement>(null)

  const activeKind = useMemo(() => KINDS.find((k) => k.value === kind)!, [kind])
  const query = useMemo(() => {
    const id = resourceId.trim()
    if (!id) return null
    if (kind === "compose" && !containerId.trim()) return null
    const t = parseInt(tail, 10)
    const q: Record<string, string | number> = { tail: Number.isFinite(t) && t > 0 ? Math.min(t, 10000) : 100 }
    q[activeKind.idParam] = id
    if (kind === "compose") q["containerId"] = containerId.trim()
    if (since.trim() && since.trim() !== "all") q["since"] = since.trim()
    if (search.trim()) q["search"] = search.trim()
    return q
  }, [resourceId, containerId, tail, since, search, kind, activeKind.idParam])

  const path = query ? "/admin/dokploy/logs" : null
  const logsState = useInfraGet<LogsPayload>(path, query ?? undefined, {
    intervalMs: autoRefresh && query ? 3000 : undefined,
  })

  const logsText = logsState.data?.logs ?? ""
  const lineCount = logsText ? logsText.split("\n").length : 0

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Dokploy logs (realtime)"
        description="GET /admin/dokploy/logs — tail polling every 3s via useInfraGet (infra, NOC readable). Proxies Dokploy readLogs (application/deployment/compose/databases) through the backend x-api-key so the console never sees the key."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target</CardTitle>
          <CardDescription>
            Pick a Dokploy resource kind and paste its Dokploy id. For compose, containerId is required (
            <span className="font-mono">compose.readLogs</span> needs <span className="font-mono">composeId + containerId</span>).
            Tail is lines from the end (<span className="font-mono">tail</span> 1–10000). Polling uses{" "}
            <span className="font-mono">useInfraGet</span> with <span className="font-mono">intervalMs: 3000</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid w-full max-w-full min-w-0 gap-4">
          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as LogKind)}>
                <SelectTrigger aria-label="Log kind">{KINDS.find((k) => k.value === kind)?.label ?? kind}</SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label} — {k.op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Op routed: <span className="font-mono">{activeKind.op}</span> via{" "}
                <span className="font-mono">GET /admin/dokploy/logs</span> (infra).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dokploy-logs-id">{activeKind.idParam} *</Label>
              <Input
                id="dokploy-logs-id"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                placeholder={
                  kind === "application"
                    ? "applicationId e.g. app_abc123"
                    : kind === "deployment"
                      ? "deploymentId e.g. dep_xyz"
                      : kind === "compose"
                        ? "composeId e.g. comp_123"
                        : `${activeKind.idParam} e.g. pg_abc`
                }
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Dokploy resource id — from mirror DB or upstream explorer.</p>
            </div>
          </div>

          {kind === "compose" ? (
            <div className="space-y-1.5">
              <Label htmlFor="dokploy-logs-container">containerId *</Label>
              <Input
                id="dokploy-logs-container"
                value={containerId}
                onChange={(e) => setContainerId(e.target.value)}
                placeholder="container name e.g. web-1"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Required for compose — the service name inside the compose stack.
              </p>
            </div>
          ) : null}

          <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="dokploy-logs-tail">tail *</Label>
              <Input id="dokploy-logs-tail" value={tail} onChange={(e) => setTail(e.target.value)} placeholder="100" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Lines from end (1–10000, default 100).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dokploy-logs-since">since</Label>
              <Input id="dokploy-logs-since" value={since} onChange={(e) => setSince(e.target.value)} placeholder="all or 10m/1h/2d" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Dokploy since filter — all or Nd/Nh/Nm/Ns.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dokploy-logs-search">search</Label>
              <Input id="dokploy-logs-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="optional grep" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Optional server-side grep (alphanumeric + . _ -).</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={autoRefresh ? "default" : "outline"}>{autoRefresh ? "Polling 3s" : "Paused"}</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
              disabled={!query}
            >
              {autoRefresh ? "Pause" : "Resume"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => logsState.reload()} disabled={!query || logsState.loading}>
              {logsState.loading ? "Refreshing…" : "Refresh now"}
            </Button>
            {logsState.data ? <span className="text-xs text-muted-foreground">{logsState.data.tail} lines · {logsState.data.op} · {lineCount} lines rendered</span> : null}
          </div>

          <ErrorBanner error={logsState.error} />
          {!query ? (
            <p className="text-sm text-muted-foreground">
              Enter {activeKind.idParam}
              {kind === "compose" ? " and containerId" : ""} to start tailing. GET stays <span className="font-mono">infra</span> so NOC can read; no POST here.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tail output</CardTitle>
          <CardDescription>
            Realtime tail from <span className="font-mono">GET /admin/dokploy/logs?{activeKind.idParam}=…&tail=…</span> — polled every 3s when a target is set. Copy from the pre block; auto-scroll stays at top so new lines don&apos;t jump.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsState.loading && !logsState.data ? (
            <p className="text-sm text-muted-foreground">Loading logs…</p>
          ) : logsText ? (
            <pre
              ref={preRef}
              className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
            >
              {logsText}
            </pre>
          ) : logsState.error ? null : (
            <p className="text-sm text-muted-foreground">(empty log output — resource may have no logs yet)</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
