// Console access: short-lived noVNC and serial-console sessions. The backend
// returns the (encrypted-at-rest) URL plus a unix-seconds expiry; both are
// displayed with copy support and a live countdown. VNC is VM-only — on
// container instances it answers 501, which is explained inline.
import { useCallback, useState } from "react"
import { useParams } from "react-router-dom"
import { ExternalLinkIcon, Loader2Icon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { orgHeaders, useOrg } from "../../useOrg"
import {
  CopyButton,
  ExpiryCountdown,
  InstanceBreadcrumb,
  useInstance,
} from "./shared"

interface ConsoleSession {
  /** URL-ish string fields keyed by their API name ("vnc_url", "serial_url"). */
  urls: Array<{ label: string; url: string }>
  /** Any extra scalar fields the backend includes. */
  extras: Array<{ key: string; value: string }>
  /** Unix seconds when the session expires, when provided. */
  expireAt: number | null
}

/** Normalizes whatever object the console endpoint returned. */
function toSession(payload: unknown): ConsoleSession | null {
  if (typeof payload !== "object" || payload === null) return null
  const record = payload as Record<string, unknown>
  const urls: ConsoleSession["urls"] = []
  const extras: ConsoleSession["extras"] = []
  let expireAt: number | null = null

  for (const [key, value] of Object.entries(record)) {
    if (/expire|expir|ttl/i.test(key) && typeof value === "number" && value > 0) {
      // PVE hands out unix seconds; guard against millisecond timestamps.
      expireAt = value > 10_000_000_000 ? Math.floor(value / 1000) : value
      continue
    }
    if (typeof value === "string" && /url|uri|host|ws/i.test(key) && value.length > 0) {
      urls.push({ label: key, url: value })
      continue
    }
    if (value !== null && typeof value !== "object") {
      extras.push({ key, value: String(value) })
    }
  }
  return { urls, extras, expireAt }
}

export default function InstanceConsolePage() {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const { instance } = useInstance(instanceId)

  const [vncSession, setVncSession] = useState<ConsoleSession | null>(null)
  const [serialSession, setSerialSession] = useState<ConsoleSession | null>(null)
  const [vncBusy, setVncBusy] = useState(false)
  const [serialBusy, setSerialBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const openSession = useCallback(
    async (kind: "vnc" | "serial-console") => {
      if (!instanceId || !orgId) return
      const busySetter = kind === "vnc" ? setVncBusy : setSerialBusy
      const sessionSetter = kind === "vnc" ? setVncSession : setSerialSession
      busySetter(true)
      setLastError(null)
      try {
        const { data } = await apiPost<unknown>(
          `/instances/${instanceId}/${kind}`,
          {},
          { headers: orgHeaders(orgId) },
        )
        sessionSetter(toSession(data))
        toast.success(kind === "vnc" ? "VNC session opened" : "Serial console session opened")
      } catch (cause) {
        const message =
          cause instanceof ApiError ? cause.message : "Failed to open console session"
        setLastError(message)
        toast.error(message)
        sessionSetter(null)
      } finally {
        busySetter(false)
      }
    },
    [instanceId, orgId],
  )

  const isContainer = instance?.service_kind === "container"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance?.name} section="Console" />
      <PageHeader
        title="Console"
        description="Open short-lived encrypted sessions to this instance's display or serial port."
      />

      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-2">
        {/* VNC — VM only */}
        <Card>
          <CardHeader>
            <CardTitle>VNC console</CardTitle>
            <CardDescription>
              Graphical display via noVNC in your browser.{" "}
              {isContainer
                ? "Virtual machines only — container instances have no VNC device."
                : "Each session expires shortly after it is issued."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => void openSession("vnc")} disabled={vncBusy}>
              {vncBusy ? (
                <Loader2Icon className="animate-spin" />
              ) : vncSession ? (
                <RefreshCwIcon />
              ) : (
                <ExternalLinkIcon />
              )}
              {vncSession ? "New VNC session" : "Open VNC session"}
            </Button>
            {vncSession ? (
              <SessionDetails session={vncSession} />
            ) : null}
            {isContainer ? (
              <p className="text-xs text-muted-foreground">
                Expect a “not implemented” answer here: containers expose a serial console
                instead (see below).
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Serial console */}
        <Card>
          <CardHeader>
            <CardTitle>Serial console</CardTitle>
            <CardDescription>
              Terminal session over the serial port (works for VMs and containers). Point an
              xterm.js client at the returned URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={() => void openSession("serial-console")} disabled={serialBusy}>
              {serialBusy ? (
                <Loader2Icon className="animate-spin" />
              ) : serialSession ? (
                <RefreshCwIcon />
              ) : (
                <ExternalLinkIcon />
              )}
              {serialSession ? "New serial session" : "Open serial session"}
            </Button>
            {serialSession ? <SessionDetails session={serialSession} /> : null}
          </CardContent>
        </Card>
      </div>

      {lastError ? (
        <p className="text-sm text-muted-foreground">
          Last attempt failed: {lastError}. Sessions need a running instance with a provider
          mapping; VM-only features stay unavailable on containers.
        </p>
      ) : null}
    </div>
  )
}

function SessionDetails({ session }: { session: ConsoleSession }) {
  if (session.urls.length === 0 && session.extras.length === 0) {
    return <p className="text-sm text-muted-foreground">Empty session response.</p>
  }
  return (
    <div className="space-y-2">
      {session.urls.map(({ label, url }) => (
        <div
          key={label}
          className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/30 px-3 py-2"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 block truncate font-mono text-sm underline-offset-4 hover:underline"
            >
              {url}
            </a>
          </div>
          <CopyButton value={url} label={`Copy ${label}`} />
        </div>
      ))}
      {session.expireAt ? (
        <p className="text-sm text-muted-foreground">
          <ExpiryCountdown expireAt={session.expireAt} /> — request a new session afterwards.
        </p>
      ) : null}
      {session.extras.map(({ key, value }) => (
        <p key={key} className="text-sm text-muted-foreground">
          {key}: <span className="font-mono text-foreground">{value}</span>
        </p>
      ))}
    </div>
  )
}
