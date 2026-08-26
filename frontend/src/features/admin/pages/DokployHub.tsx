// Admin Dokploy PaaS hub: mirror-entity cards with per-entity sync buttons,
// a targeted-sync form for entities without a global upstream list op, and an
// API explorer that talks to the universal Dokploy proxy. The proxy relays
// upstream payloads verbatim — success AND error bodies, without the platform
// envelope — so the explorer reads the raw response instead of the api.ts
// helpers (ApiError would discard exactly the body this tool exists to show).
import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  ArrowUpRightIcon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { ApiError, API_BASE, getToken } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  DOKPLOY_MIRROR_ENTITIES,
  describeSyncResult,
  findDokployEntity,
  syncDokployEntity,
} from "./dokploy/entities"

const EXPLORER_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type ExplorerMethod = (typeof EXPLORER_METHODS)[number]

const BODY_METHODS: readonly ExplorerMethod[] = ["POST", "PUT", "PATCH"]

const EXPLORER_EXAMPLES = [
  "project.all",
  "project.one?projectId=…",
  "application.search",
  "deployment.list",
]

interface ExplorerResponse {
  status: number
  ok: boolean
  durationMs: number
  text: string
}

export default function DokployHubPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dokploy PaaS"
        description="Mirror of the Dokploy server plus a passthrough explorer for its whole API."
      />

      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Live integration</AlertTitle>
        <AlertDescription>
          Syncs pull real data into the local mirror database. The API explorer
          sends requests straight to the Dokploy server — POST/PUT/PATCH/DELETE
          change live resources and cannot be undone here.
        </AlertDescription>
      </Alert>

      <UpstreamManagerGrid />
      <EntityGrid />
      <TargetedSyncCard />
      <ExplorerCard />
    </div>
  )
}

// ---- Upstream manager consoles ------------------------------------------------

const UPSTREAM_CONSOLES = [
  { slug: "project", title: "Projects", description: "Create, rename and delete upstream projects." },
  { slug: "application", title: "Applications", description: "Apps plus deploy/start/stop lifecycle actions." },
  { slug: "database", title: "Databases", description: "Postgres, MySQL, MariaDB, Mongo and Redis." },
  { slug: "domain", title: "Domains", description: "Per-application domains with HTTPS settings." },
  { slug: "deployment", title: "Deployments", description: "Deployment history, logs and kill switch." },
  { slug: "certificate", title: "Certificates", description: "Custom TLS certificates (PEM)." },
  { slug: "registry", title: "Registries", description: "Connected container registries." },
  { slug: "server", title: "Servers", description: "Build/deploy hosts over SSH." },
  { slug: "sshkey", title: "SSH keys", description: "SSH private keys used by the server." },
] as const

function UpstreamManagerGrid() {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Upstream manager</h2>
        <p className="text-sm text-muted-foreground">
          Full CRUD straight against the Dokploy server — every action runs live.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {UPSTREAM_CONSOLES.map((console) => (
          <Card key={console.slug} className="gap-3">
            <CardHeader>
              <CardTitle>{console.title}</CardTitle>
              <CardDescription>{console.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/admin/dokploy/manager/${console.slug}`}>
                  Open console
                  <ArrowUpRightIcon />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

// ---- Mirror entity cards -----------------------------------------------------

function EntityGrid() {
  const [busyEntity, setBusyEntity] = useState<string | null>(null)

  const runSync = async (entityName: string) => {
    setBusyEntity(entityName)
    try {
      const result = await syncDokployEntity(entityName)
      toast.success(`Sync ${entityName}: ${describeSyncResult(result)}`)
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : `Failed to sync ${entityName}.`,
      )
    } finally {
      setBusyEntity(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Mirror entities</h2>
        <p className="text-sm text-muted-foreground">
          Sync pulls the upstream list and reconciles the local mirror.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DOKPLOY_MIRROR_ENTITIES.map((entity) => (
          <Card key={entity.name} className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 font-mono text-base">
                {entity.name}
                {entity.syncable ? null : (
                  <Badge variant="outline" className="font-sans text-xs">
                    targeted sync only
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>{entity.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/admin/dokploy/${entity.name}`}>
                  Browse rows
                  <ArrowUpRightIcon />
                </Link>
              </Button>
              {entity.syncable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyEntity !== null}
                  onClick={() => void runSync(entity.name)}
                >
                  {busyEntity === entity.name ? (
                    <>
                      <RefreshCwIcon className="animate-spin" />
                      Syncing…
                    </>
                  ) : (
                    <>
                      <RefreshCwIcon />
                      Sync
                    </>
                  )}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Needs op_path + query below.
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

// ---- Targeted sync -----------------------------------------------------------

function TargetedSyncCard() {
  const [entity, setEntity] = useState("deployments")
  const [opPath, setOpPath] = useState("deployment.all")
  const [queryText, setQueryText] = useState('{\n  "applicationId": "…"\n}')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    let query: Record<string, string> | undefined
    const trimmedQuery = queryText.trim()
    if (trimmedQuery !== "") {
      try {
        const parsed: unknown = JSON.parse(trimmedQuery)
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((value) => typeof value !== "string")
        ) {
          toast.error("Query must be a JSON object of string values.")
          return
        }
        query = parsed as Record<string, string>
      } catch {
        toast.error("Query is not valid JSON.")
        return
      }
    }
    if (!findDokployEntity(entity)) {
      toast.error("Unknown mirror entity.")
      return
    }
    setBusy(true)
    try {
      const result = await syncDokployEntity(entity, {
        opPath: opPath.trim(),
        query,
      })
      toast.success(`Sync ${entity}: ${describeSyncResult(result)}`)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Targeted sync failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Targeted mirror sync</CardTitle>
        <CardDescription>
          For entities without a global list op (e.g. deployments need{" "}
          <code className="font-mono text-xs">deployment.all</code> +{" "}
          <code className="font-mono text-xs">applicationId</code>). Upserts only
          — it never deletes existing mirror rows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dokploy-targeted-entity">Entity</Label>
            <Input
              id="dokploy-targeted-entity"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
              placeholder="deployments"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dokploy-targeted-op">op_path</Label>
            <Input
              id="dokploy-targeted-op"
              value={opPath}
              onChange={(event) => setOpPath(event.target.value)}
              placeholder="deployment.all"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dokploy-targeted-query">Query params (JSON)</Label>
          <Textarea
            id="dokploy-targeted-query"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            className="min-h-20 font-mono text-xs"
          />
        </div>
        <Button disabled={busy || opPath.trim() === ""} onClick={() => void submit()}>
          {busy ? "Syncing…" : "Run targeted sync"}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- API explorer ------------------------------------------------------------

function ExplorerCard() {
  const [method, setMethod] = useState<ExplorerMethod>("GET")
  const [path, setPath] = useState("project.all")
  const [bodyText, setBodyText] = useState("")
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<ExplorerResponse | null>(null)

  const send = async () => {
    const trimmed = path.trim().replace(/^\/+/, "")
    if (trimmed === "") return
    // Optional "?key=value" suffix on the path becomes query params, matching
    // how the proxy forwards query strings for GET/DELETE.
    const [opPath, rawQueryString] = trimmed.split("?")
    let url = `${API_BASE}/dokploy/${opPath}`
    if (rawQueryString) url += `?${rawQueryString}`

    const wantsBody = BODY_METHODS.includes(method)
    let body: string | undefined
    if (wantsBody && bodyText.trim() !== "") {
      try {
        JSON.parse(bodyText)
      } catch {
        toast.error("Body is not valid JSON.")
        return
      }
      body = bodyText
    }

    setSending(true)
    setResponse(null)
    const startedAt = performance.now()
    try {
      const token = getToken()
      const res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body,
      })
      const text = await res.text()
      setResponse({
        status: res.status,
        ok: res.ok,
        durationMs: Math.round(performance.now() - startedAt),
        text,
      })
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Request failed before reaching the backend.",
      )
    } finally {
      setSending(false)
    }
  }

  const pretty =
    response !== null
      ? (() => {
          try {
            return JSON.stringify(JSON.parse(response.text), null, 2)
          } catch {
            return response.text
          }
        })()
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>API explorer</CardTitle>
        <CardDescription>
          Calls <code className="font-mono text-xs">/v1/dokploy/&#123;tag.method&#125;</code>{" "}
          — every one of Dokploy's operations, relayed verbatim. Requests run
          against the real server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={method}
            onValueChange={(value) => setMethod(value as ExplorerMethod)}
          >
            <SelectTrigger aria-label="HTTP method" className="sm:w-32">
              {method}
            </SelectTrigger>
            <SelectContent>
              {EXPLORER_METHODS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Dokploy operation path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !sending) void send()
            }}
            placeholder="project.all"
            className="font-mono"
          />
          <Button disabled={sending || path.trim() === ""} onClick={() => void send()}>
            {sending ? (
              <>
                <RefreshCwIcon className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <SendIcon />
                Send
              </>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {EXPLORER_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPath(example)}
              className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>

        {BODY_METHODS.includes(method) ? (
          <div className="grid gap-2">
            <Label htmlFor="dokploy-explorer-body">JSON body</Label>
            <Textarea
              id="dokploy-explorer-body"
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              placeholder='{ "name": "my-app" }'
              className="min-h-28 font-mono text-xs"
            />
          </div>
        ) : null}

        {response ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  response.ok
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-destructive/15 text-destructive",
                )}
              >
                HTTP {response.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {response.text.length.toLocaleString()} bytes · {response.durationMs} ms
              </span>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {pretty ?? "(empty response body)"}
            </pre>
          </div>
        ) : sending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick an operation and send it — the raw upstream response shows up
            here.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
