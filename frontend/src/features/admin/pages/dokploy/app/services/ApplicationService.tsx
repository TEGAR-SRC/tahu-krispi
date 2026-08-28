import { useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { dokploy, toErrorMessage, useUpstream } from "../shared"

type Row = Record<string, unknown>
type Query = Record<string, string | number | undefined>
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

type Operation = {
  op: string
  method: HttpMethod
  title: string
  description: string
  defaultBody?: Row
  defaultQuery?: Row
  destructive?: boolean
  disabled?: string
}

type Tab = {
  value: string
  label: string
  load?: Operation
  operations: Operation[]
}

const APPLICATION_ID = "applicationId"
const SERVICE_ID = "serviceId"
const APPLICATION_TYPE = "application"

const tabs: Tab[] = [
  {
    value: "general",
    label: "General",
    load: op("application.one", "GET", "Reload application", "Fetch application.one", undefined, { applicationId: APPLICATION_ID }),
    operations: [
      op("application.update", "POST", "Update application", "Update fields such as name, description, autoDeploy, cleanCache, commands, resources, networks, ports or advanced settings.", { applicationId: APPLICATION_ID }),
      op("application.start", "POST", "Start", "Start the application.", { applicationId: APPLICATION_ID }),
      op("application.stop", "POST", "Stop", "Stop the running application.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.deploy", "POST", "Deploy", "Download source and run a full deployment.", deploymentBody()),
      op("application.reload", "POST", "Reload", "Reload without rebuilding. Add appName if the upstream server requires it.", { applicationId: APPLICATION_ID, appName: "" }),
      op("application.redeploy", "POST", "Redeploy", "Rebuild using the existing source checkout.", deploymentBody()),
      op("application.refreshToken", "POST", "Refresh token", "Rotate the application webhook token.", { applicationId: APPLICATION_ID }),
      op("application.saveEnvironment", "POST", "Save environment", "Replace application environment variables. Paste the raw .env text in env.", { applicationId: APPLICATION_ID, env: "KEY=value" }),
      op("application.saveBuildType", "POST", "Save build type", "Set buildType and optional builder fields.", { applicationId: APPLICATION_ID, buildType: "nixpacks" }),
      op("application.saveGithubProvider", "POST", "Save GitHub provider", "Connect a GitHub repo. Fill githubId, owner, repository, branch and buildPath.", { applicationId: APPLICATION_ID, githubId: "", owner: "", repository: "", branch: "main", buildPath: "/" }),
      op("application.saveGitlabProvider", "POST", "Save GitLab provider", "Connect a GitLab repo. Fill gitlabId, gitlabOwner, gitlabRepository, gitlabBranch and gitlabBuildPath.", { applicationId: APPLICATION_ID, gitlabId: "", gitlabOwner: "", gitlabRepository: "", gitlabBranch: "main", gitlabBuildPath: "/" }),
      op("application.saveGiteaProvider", "POST", "Save Gitea provider", "Connect a Gitea repo. Fill giteaId, giteaOwner, giteaRepository, giteaBranch and giteaBuildPath.", { applicationId: APPLICATION_ID, giteaId: "", giteaOwner: "", giteaRepository: "", giteaBranch: "main", giteaBuildPath: "/" }),
      op("application.saveBitbucketProvider", "POST", "Save Bitbucket provider", "Connect a Bitbucket repo. Fill bitbucketId, bitbucketOwner, bitbucketRepository, bitbucketRepositorySlug, bitbucketBranch and bitbucketBuildPath.", { applicationId: APPLICATION_ID, bitbucketId: "", bitbucketOwner: "", bitbucketRepository: "", bitbucketRepositorySlug: "", bitbucketBranch: "main", bitbucketBuildPath: "/" }),
      op("application.saveDockerProvider", "POST", "Save Docker provider", "Deploy from a Docker image.", { applicationId: APPLICATION_ID, dockerImage: "nginx:latest", username: null, password: null, registryUrl: null }),
      op("application.disconnectGitProvider", "POST", "Disconnect Git provider", "Remove the connected git provider.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.readTraefikConfig", "GET", "Read Traefik config", "Read this application's generated Traefik config.", undefined, { applicationId: APPLICATION_ID }),
      op("application.updateTraefikConfig", "POST", "Update Traefik config", "Save Traefik config text.", { applicationId: APPLICATION_ID, config: "" }),
      op("application.readAppMonitoring", "GET", "Read app monitoring", "Fetch container monitoring metrics.", undefined, { appName: "" }),
      op("application.cancelDeployment", "POST", "Cancel deployment", "Cancel the active deployment.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.cleanQueues", "POST", "Clean queues", "Clean queued deployment jobs.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.clearDeployments", "POST", "Clear deployments", "Clear deployment history for this application.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.killBuild", "POST", "Kill build", "Kill the current build process.", { applicationId: APPLICATION_ID }, undefined, true),
      op("application.delete", "POST", "Delete application", "Delete this application service.", { applicationId: APPLICATION_ID }, undefined, true),
    ],
  },
  {
    value: "domains",
    label: "Domains",
    load: op("domain.byApplicationId", "GET", "List domains", "Fetch domain.byApplicationId", undefined, { applicationId: APPLICATION_ID }),
    operations: [
      op("domain.create", "POST", "Create domain", "Create a domain for this application.", { applicationId: APPLICATION_ID, host: "example.com", port: 3000, path: "/" }),
      op("domain.update", "POST", "Update domain", "Update a domain. Fill domainId and fields to change.", { domainId: "", host: "example.com", port: 3000, path: "/" }),
      op("domain.delete", "POST", "Delete domain", "Delete a domain by domainId.", { domainId: "" }, undefined, true),
      op("domain.toggleEnable", "POST", "Toggle domain", "Enable or disable a domain.", { domainId: "" }),
      op("domain.generateDomain", "POST", "Generate domain", "Generate a Dokploy-managed domain.", { applicationId: APPLICATION_ID }),
      op("domain.validateDomain", "POST", "Validate domain", "Validate DNS/routing for a domain.", { domainId: "" }),
    ],
  },
  {
    value: "deployments",
    label: "Deployments",
    load: op("deployment.allByType", "GET", "List deployments", "Fetch deployments for this application.", undefined, { applicationId: APPLICATION_ID, type: APPLICATION_TYPE }),
    operations: [
      op("deployment.readLogs", "GET", "Read deployment logs", "Read logs for a deploymentId.", undefined, { deploymentId: "" }),
      op("deployment.killProcess", "POST", "Kill deployment process", "Kill a deployment process.", { deploymentId: "" }, undefined, true),
      op("deployment.removeDeployment", "POST", "Remove deployment", "Remove a deployment record.", { deploymentId: "" }, undefined, true),
    ],
  },
  {
    value: "preview-deployments",
    label: "Previews",
    load: op("previewDeployment.all", "GET", "List previews", "Fetch preview deployments.", undefined, { applicationId: APPLICATION_ID }),
    operations: [
      op("previewDeployment.delete", "POST", "Delete preview", "Delete a preview deployment.", { previewDeploymentId: "" }, undefined, true),
      op("previewDeployment.redeploy", "POST", "Redeploy preview", "Redeploy a preview deployment.", { previewDeploymentId: "" }),
    ],
  },
  {
    value: "schedules",
    label: "Schedules",
    load: op("schedule.list", "GET", "List schedules", "Fetch schedules for this application.", undefined, { applicationId: APPLICATION_ID, type: APPLICATION_TYPE }),
    operations: [
      op("schedule.create", "POST", "Create schedule", "Create a cron schedule.", { applicationId: APPLICATION_ID, name: "Nightly job", schedule: "0 0 * * *", command: "echo ok", type: APPLICATION_TYPE }),
      op("schedule.update", "POST", "Update schedule", "Update a schedule. Fill scheduleId.", { scheduleId: "", name: "Nightly job", schedule: "0 0 * * *", command: "echo ok" }),
      op("schedule.delete", "POST", "Delete schedule", "Delete a schedule.", { scheduleId: "" }, undefined, true),
      op("schedule.runManually", "POST", "Run manually", "Run a schedule now.", { scheduleId: "" }),
    ],
  },
  {
    value: "volume-backups",
    label: "Volume backups",
    load: op("volumeBackups.list", "GET", "List volume backups", "Fetch volume backup jobs.", undefined, { applicationId: APPLICATION_ID, type: APPLICATION_TYPE }),
    operations: [
      op("volumeBackups.create", "POST", "Create volume backup", "Create a volume backup job.", { applicationId: APPLICATION_ID, name: "Volume backup", schedule: "0 0 * * *", volumeName: "", type: APPLICATION_TYPE }),
      op("volumeBackups.update", "POST", "Update volume backup", "Update a volume backup job. Fill volumeBackupId.", { volumeBackupId: "", name: "Volume backup", schedule: "0 0 * * *", volumeName: "" }),
      op("volumeBackups.delete", "POST", "Delete volume backup", "Delete a volume backup job.", { volumeBackupId: "" }, undefined, true),
      op("volumeBackups.runManually", "POST", "Run manually", "Run a volume backup now.", { volumeBackupId: "" }),
      op("volumeBackups.restoreVolumeBackupWithLogs", "POST", "Restore backup", "Absent from Dokploy v0.30.2 manifest; disabled instead of faked.", undefined, undefined, true, "Missing from v0.30.2 API manifest"),
    ],
  },
  {
    value: "patches",
    label: "Patches",
    load: op("patch.byEntityId", "GET", "List patches", "Fetch patches for this application.", undefined, { entityId: APPLICATION_ID, type: APPLICATION_TYPE }),
    operations: [
      op("patch.create", "POST", "Create patch", "Create a patch record.", { entityId: APPLICATION_ID, type: APPLICATION_TYPE, name: "Patch", description: "" }),
      op("patch.update", "POST", "Update patch", "Update a patch. Fill patchId.", { patchId: "", name: "Patch", description: "" }),
      op("patch.delete", "POST", "Delete patch", "Delete a patch.", { patchId: "" }, undefined, true),
      op("patch.toggleEnabled", "POST", "Toggle patch", "Enable or disable a patch.", { patchId: "" }),
    ],
  },
  {
    value: "mounts",
    label: "Mounts",
    load: op("mounts.listByServiceId", "GET", "List mounts", "Fetch mounts for this service.", undefined, { serviceId: SERVICE_ID }),
    operations: [
      op("mounts.create", "POST", "Create mount", "Create a volume or bind mount.", { serviceId: SERVICE_ID, type: "volume", source: "", target: "/data" }),
      op("mounts.update", "POST", "Update mount", "Update a mount. Fill mountId.", { mountId: "", type: "volume", source: "", target: "/data" }),
      op("mounts.remove", "POST", "Remove mount", "Remove a mount.", { mountId: "" }, undefined, true),
    ],
  },
  {
    value: "advanced-crud",
    label: "Advanced CRUD",
    operations: [
      op("redirects.one", "GET", "Read redirects", "Read redirect settings.", undefined, { applicationId: APPLICATION_ID }),
      op("redirects.create", "POST", "Create redirect", "Create redirect rule.", { applicationId: APPLICATION_ID, regex: "^www\\.(.*)", replacement: "https://$1", permanent: true }),
      op("redirects.update", "POST", "Update redirect", "Update redirect rule. Fill redirectId.", { redirectId: "", regex: "", replacement: "", permanent: true }),
      op("redirects.delete", "POST", "Delete redirect", "Delete redirect rule.", { redirectId: "" }, undefined, true),
      op("security.one", "GET", "Read security", "Read security headers/settings.", undefined, { applicationId: APPLICATION_ID }),
      op("security.create", "POST", "Create security", "Create security settings.", { applicationId: APPLICATION_ID }),
      op("security.update", "POST", "Update security", "Update security settings. Fill securityId.", { securityId: "" }),
      op("security.delete", "POST", "Delete security", "Delete security settings.", { securityId: "" }, undefined, true),
      op("port.one", "GET", "Read ports", "Read exposed port settings.", undefined, { applicationId: APPLICATION_ID }),
      op("port.create", "POST", "Create port", "Create port mapping.", { applicationId: APPLICATION_ID, publishedPort: 8080, targetPort: 3000, protocol: "tcp" }),
      op("port.update", "POST", "Update port", "Update port mapping. Fill portId.", { portId: "", publishedPort: 8080, targetPort: 3000, protocol: "tcp" }),
      op("port.delete", "POST", "Delete port", "Delete port mapping.", { portId: "" }, undefined, true),
    ],
  },
]

function op(
  opName: string,
  method: HttpMethod,
  title: string,
  description: string,
  defaultBody?: Row,
  defaultQuery?: Row,
  destructive = false,
  disabled?: string,
): Operation {
  return { op: opName, method, title, description, defaultBody, defaultQuery, destructive, disabled }
}

function deploymentBody(): Row {
  return {
    applicationId: APPLICATION_ID,
    title: "Console manual run",
    description: "Triggered from Kilat Cloud console",
  }
}

export default function DokployApplicationServicePage() {
  const params = useParams()
  const projectId = params.projectId ?? ""
  const environmentId = params.environmentId ?? ""
  const applicationId = params.applicationId ?? ""
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const app = useUpstream<Row>(
    () => dokploy<Row>("GET", "application.one", undefined, { applicationId }),
    [applicationId],
  )

  const rawTab = searchParams.get("tab") ?? "general"
  const activeTab = tabs.some((tab) => tab.value === rawTab) ? rawTab : "general"
  const tab = tabs.find((item) => item.value === activeTab) ?? tabs[0]

  const setTab = (next: string) => {
    const updated = new URLSearchParams(searchParams)
    updated.set("tab", next)
    setSearchParams(updated, { replace: true })
  }

  const title = text(app.data?.name) || applicationId || "Application"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy">Dokploy PaaS</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy/app">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/admin/dokploy/app/p/${projectId}/e/${environmentId}`}>Environment</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Application · {title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {app.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      ) : app.error ? (
        <ErrorBanner error={app.error} />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            <TooltipProvider delayDuration={0}>
              <StatusWithHint status={text(app.data?.applicationStatus)} />
            </TooltipProvider>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DeleteApplicationButton
              applicationId={applicationId}
              appName={title}
              onDeleted={() => navigate(`/admin/dokploy/app/p/${projectId}/e/${environmentId}`)}
            />
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          {tabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <OperationConsole
        key={tab.value}
        applicationId={applicationId}
        tab={tab}
        appName={text(app.data?.appName) || text(app.data?.name)}
        onApplicationChanged={app.reload}
      />
    </div>
  )
}

function OperationConsole({
  applicationId,
  tab,
  appName,
  onApplicationChanged,
}: {
  applicationId: string
  tab: Tab
  appName: string
  onApplicationChanged: () => void
}) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex w-full max-w-full min-w-0 flex-col gap-4">
        {tab.load ? (
          <ReadCard operation={tab.load} applicationId={applicationId} appName={appName} />
        ) : null}
        <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2">
          {tab.operations.map((operation) => (
            <OperationCard
              key={operation.op}
              operation={operation}
              applicationId={applicationId}
              appName={appName}
              onApplicationChanged={onApplicationChanged}
            />
          ))}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Required hints</CardTitle>
          <CardDescription>Payloads are sent directly to /api/v1/dokploy/{`{tag.op}`}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Replace placeholder identifiers before running mutations. This console does not invent rows; list/read cards fetch upstream data so you can copy the real IDs.
          </p>
          <p>
            The proxy relays upstream JSON directly. Successful mutation responses and upstream errors are shown exactly as returned.
          </p>
          <p>
            Destructive actions are gated by an AlertDialog. Missing v0.30.2 operations are rendered disabled.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ReadCard({ operation, applicationId, appName }: { operation: Operation; applicationId: string; appName: string }) {
  const query = useMemo(() => toQuery(replacePlaceholders(operation.defaultQuery, applicationId, appName)), [operation.defaultQuery, applicationId, appName])
  const result = useUpstream<unknown>(
    () => dokploy<unknown>(operation.method, operation.op, undefined, query),
    [operation.op, JSON.stringify(query)],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{operation.title}</CardTitle>
            <CardDescription>{operation.op}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={result.reload} disabled={result.loading}>
            {result.loading ? "Loading…" : "Reload"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {result.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : result.error ? (
          <ErrorBanner error={result.error} />
        ) : isEmpty(result.data) ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Upstream returned no rows.</div>
        ) : (
          <JsonBlock value={result.data} />
        )}
      </CardContent>
    </Card>
  )
}

function OperationCard({
  operation,
  applicationId,
  appName,
  onApplicationChanged,
}: {
  operation: Operation
  applicationId: string
  appName: string
  onApplicationChanged: () => void
}) {
  const initialBody = useMemo(
    () => stringifyJson(replacePlaceholders(operation.defaultBody, applicationId, appName) ?? {}),
    [operation.defaultBody, applicationId, appName],
  )
  const initialQuery = useMemo(
    () => stringifyJson(replacePlaceholders(operation.defaultQuery, applicationId, appName) ?? {}),
    [operation.defaultQuery, applicationId, appName],
  )
  const [bodyText, setBodyText] = useState(initialBody)
  const [queryText, setQueryText] = useState(initialQuery)
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<unknown>(null)
  const [error, setError] = useState<string>("")

  const run = async () => {
    setBusy(true)
    setError("")
    try {
      const query = parseQuery(queryText)
      const body = operation.method === "GET" ? undefined : parseObject(bodyText, "body")
      const data = await dokploy<unknown>(operation.method, operation.op, body, query)
      setResponse(data ?? null)
      toast.success(`${operation.title} completed`)
      if (operation.op.startsWith("application.")) onApplicationChanged()
    } catch (cause) {
      const message = toErrorMessage(cause)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={operation.disabled ? "opacity-70" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">{operation.title}</CardTitle>
        <CardDescription>
          {operation.method} {operation.op}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{operation.disabled ?? operation.description}</p>
        {operation.defaultQuery ? (
          <JsonTextarea label="Query JSON" value={queryText} onChange={setQueryText} disabled={busy || !!operation.disabled} />
        ) : null}
        {operation.method !== "GET" ? (
          <JsonTextarea label="Body JSON" value={bodyText} onChange={setBodyText} disabled={busy || !!operation.disabled} />
        ) : null}
        {operation.disabled ? (
          <Button disabled className="w-full">Unavailable in v0.30.2</Button>
        ) : operation.destructive ? (
          <ConfirmRunButton title={operation.title} description={operation.description} busy={busy} onConfirm={run} />
        ) : (
          <Button className="w-full" disabled={busy} onClick={run}>
            {busy ? "Running…" : "Run operation"}
          </Button>
        )}
        {error ? <ErrorBanner error={error} /> : null}
        {response !== null ? <JsonBlock value={response} /> : null}
      </CardContent>
    </Card>
  )
}

function JsonTextarea({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-1.5">
      <Label>{label}</Label>
      <Textarea
        className="min-h-28 font-mono text-xs"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function ConfirmRunButton({
  title,
  description,
  busy,
  onConfirm,
}: {
  title: string
  description: string
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-full" disabled={busy}>
          {busy ? "Running…" : "Run destructive operation"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Running…" : "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteApplicationButton({ applicationId, appName, onDeleted }: { applicationId: string; appName: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      const data = await dokploy("POST", "application.delete", { applicationId })
      toast.success("Application deleted")
      setOpen(false)
      onDeleted()
      console.info("application.delete", data)
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2Icon className="size-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete application “{appName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Type the application name to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={appName} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy || typed !== appName} onClick={remove}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function StatusWithHint({ status }: { status: string }) {
  const color = status === "running" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : status === "updating" ? "bg-amber-500" : "bg-slate-400"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1.5 capitalize">
          <span className={`size-2 rounded-full ${color}`} aria-hidden />
          {status || "unknown"}
        </span>
      </TooltipTrigger>
      <TooltipContent>Server reports: {status || "unknown"}</TooltipContent>
    </Tooltip>
  )
}

function ErrorBanner({ error }: { error: unknown }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {typeof error === "string" ? error : toErrorMessage(error)}
    </div>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs break-all whitespace-pre-wrap">{stringifyJson(value)}</pre>
}

function replacePlaceholders(value: Row | undefined, applicationId: string, appName: string): Row | undefined {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      item === APPLICATION_ID ? applicationId : item === SERVICE_ID ? applicationId : item === APPLICATION_TYPE ? "application" : item === "" && key === "appName" ? appName : item,
    ]),
  )
}

function toQuery(value: Row | undefined): Query | undefined {
  if (!value) return undefined
  const query: Query = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    if (typeof item === "string" || typeof item === "number") query[key] = item
    else query[key] = JSON.stringify(item)
  }
  return query
}

function parseObject(value: string, label: string): Row {
  const parsed = JSON.parse(value || "{}") as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} JSON must be an object`)
  }
  return parsed as Row
}

function parseQuery(value: string): Query {
  return toQuery(parseObject(value, "query")) ?? {}
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}
