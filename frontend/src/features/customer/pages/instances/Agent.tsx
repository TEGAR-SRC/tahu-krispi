// Guest agent introspection: OS info, mounted filesystems and agent metadata
// rendered as definition lists, plus a ping button with round-trip latency.
// All routes answer 501 on containers and fail when qemu-guest-agent is not
// installed — each section degrades independently with an inline explanation.
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2Icon, WifiHighIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { formatBytes } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"
import {
  InstanceBreadcrumb,
  isUnsupportedFeature,
  useInstance,
  type AgentFsInfo,
  type AgentInfo,
  type AgentOsInfo,
} from "./shared"

/** Pretty-prints qga kebab-case keys ("kernel-release" → "Kernel release"). */
function prettyKey(key: string): string {
  return key
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export default function InstanceAgentPage() {
  const { instanceId } = useParams()
  return (
    <div className="flex flex-col gap-6">
      <AgentContent instanceId={instanceId} />
    </div>
  )
}

function AgentContent({ instanceId }: { instanceId: string | undefined }) {
  const { instance } = useInstance(instanceId)
  return (
    <>
      <InstanceBreadcrumb instanceName={instance?.name} section="Guest agent" />
      <PageHeader
        title="Guest agent"
        description="Introspection through the qemu-guest-agent running inside the guest. VM-only."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <OsInfoCard instanceId={instanceId} />
        <AgentInfoCard instanceId={instanceId} />
      </div>
      <FilesystemsCard instanceId={instanceId} />
      <PingCard instanceId={instanceId} />
    </>
  )
}

function SectionError({ error }: { error: unknown }) {
  if (!error) return null
  const hint = isUnsupportedFeature(error)
    ? "The provider does not serve this route for the current instance kind/state (containers and unmapped instances answer 409/501)."
    : "Check that the instance runs and qemu-guest-agent is installed inside the guest."
  return (
    <div className="space-y-1">
      <ErrorInline error={error} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function ErrorInline({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? `${error.message} (${error.code})` : String(error)
  return <p className="text-sm text-destructive">{message}</p>
}

function DefinitionList({ rows }: { rows: Array<[string, string]> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing reported.</p>
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(([key, value]) => (
        <div key={key} className="min-w-0 space-y-0.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{key}</dt>
          <dd className="truncate font-mono text-sm">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  )
}

function OsInfoCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [data, setData] = useState<AgentOsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<AgentOsInfo>(`/instances/${instanceId}/agent/osinfo`, {
      headers: orgHeaders(orgId),
    })
      .then(({ data: payload }) => !cancelled && setData(payload ?? null))
      .catch((cause) => !cancelled && setError(cause))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  const rows = data
    ? Object.entries(data)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => [
          prettyKey(key),
          value === null || value === undefined ? "" : String(value),
        ])
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operating system</CardTitle>
        <CardDescription>Reported by guest-get-osinfo.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <SectionError error={error} />
        ) : (
          <DefinitionList rows={rows as Array<[string, string]>} />
        )}
      </CardContent>
    </Card>
  )
}

function AgentInfoCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [data, setData] = useState<AgentInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<AgentInfo>(`/instances/${instanceId}/agent/info`, {
      headers: orgHeaders(orgId),
    })
      .then(({ data: payload }) => !cancelled && setData(payload ?? null))
      .catch((cause) => !cancelled && setError(cause))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  const commands = data?.supported_commands ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent</CardTitle>
        <CardDescription>guest-info: version and supported commands.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <SectionError error={error} />
        ) : (
          <>
            <DefinitionList
              rows={[
                ["Version", data?.version ?? ""],
                ["Supported commands", String(commands.length)],
              ]}
            />
            {commands.length > 0 ? (
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-md border bg-muted/30 p-2">
                {commands.map((command, index) =>
                  command?.name ? (
                    <Badge key={`${command.name}-${index}`} variant="secondary" className="font-mono text-[10px]">
                      {command.name}
                    </Badge>
                  ) : null,
                )}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function FilesystemsCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [data, setData] = useState<AgentFsInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<AgentFsInfo[]>(`/instances/${instanceId}/agent/fsinfo`, {
      headers: orgHeaders(orgId),
    })
      .then(({ data: payload }) => !cancelled && setData(Array.isArray(payload) ? payload : null))
      .catch((cause) => !cancelled && setError(cause))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filesystems</CardTitle>
        <CardDescription>Mounted filesystems from guest-get-fsinfo.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <SectionError error={error} />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No filesystems reported.</p>
        ) : (
          <dl className="space-y-3">
            {data.map((fs, index) => {
              const used = fs["used-bytes"]
              const total = fs["total-bytes"]
              return (
                <div key={`${fs.mountpoint ?? "fs"}-${index}`} className="space-y-1">
                  <Separator />
                  <DefinitionList
                    rows={[
                      ["Mountpoint", fs.mountpoint ?? "—"],
                      ["Device", fs.name ?? "—"],
                      ["Type", fs.type ?? "—"],
                      [
                        "Usage",
                        typeof total === "number" && total > 0
                          ? `${formatBytes(used)} of ${formatBytes(total)}`
                          : "—",
                      ],
                    ]}
                  />
                </div>
              )
            })}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

interface PingResult {
  ok: boolean
  latencyMs: number
  message: string
}

function PingCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<PingResult | null>(null)

  const ping = useCallback(async () => {
    if (!instanceId || !orgId) return
    setBusy(true)
    const startedAt = performance.now()
    try {
      await apiPost(
        `/instances/${instanceId}/agent/ping`,
        {},
        { headers: orgHeaders(orgId) },
      )
      setLast({
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        message: "pong",
      })
    } catch (cause) {
      setLast({
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        message:
          cause instanceof ApiError ? cause.message : "Ping request failed",
      })
      toast.error(
        cause instanceof ApiError ? cause.message : "Agent ping failed",
      )
    } finally {
      setBusy(false)
    }
  }, [instanceId, orgId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ping</CardTitle>
        <CardDescription>
          guest-ping round trip through the provider — a quick liveness check for the agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <Button onClick={() => void ping()} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <WifiHighIcon />} Ping agent
        </Button>
        {last ? (
          <p className={`text-sm ${last.ok ? "" : "text-destructive"}`}>
            {last.ok ? "Reply received" : "Failed"} ·{" "}
            <span className="tabular-nums">{last.latencyMs} ms</span>
            {!last.ok ? ` — ${last.message}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No ping sent yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
