import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/shared/PageHeader"
import { dokploy, toErrorMessage, useUpstream } from "../shared"

type Row = Record<string, unknown>
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

const COMPOSE_ID = "__COMPOSE_ID__"
const SERVICE_ID = "__SERVICE_ID__"
const COMPOSE_TYPE = "__COMPOSE_TYPE__"
const APP_NAME = "__APP_NAME__"
const SERVICE_NAME = "__SERVICE_NAME__"

const tabs: Tab[] = [
  {
    value: "general",
    label: "General",
    load: op("compose.one", "GET", "Read compose", "Fetch compose.one for this service.", undefined, { composeId: COMPOSE_ID }),
    operations: [
      op("compose.update", "POST", "Update compose", "Update any compose field accepted by Dokploy.", { composeId: COMPOSE_ID, name: "", description: "" }),
      op("compose.start", "POST", "Start", "Start the compose stack.", { composeId: COMPOSE_ID }),
      op("compose.stop", "POST", "Stop", "Stop the compose stack.", { composeId: COMPOSE_ID }, undefined, true),
      op("compose.deploy", "POST", "Deploy", "Run a full compose deployment.", deploymentBody()),
      op("compose.redeploy", "POST", "Redeploy", "Redeploy using the current source/configuration.", deploymentBody()),
      op("compose.randomizeCompose", "POST", "Randomize compose", "Ask upstream to randomize compose-generated values.", { composeId: COMPOSE_ID }),
      op("compose.getConvertedCompose", "POST", "Get converted compose", "Convert compose content and return upstream output.", { composeId: COMPOSE_ID, composeFile: "services:\n  app:\n    image: nginx:latest" }),
      op("compose.getDefaultCommand", "GET", "Get default command", "Read the default compose command.", undefined, { composeId: COMPOSE_ID }),
      op("compose.fetchSourceType", "GET", "Fetch source type", "Read detected source type for the compose service.", undefined, { composeId: COMPOSE_ID }),
      op("compose.disconnectGitProvider", "POST", "Disconnect Git provider", "Remove the connected git provider.", { composeId: COMPOSE_ID }, undefined, true),
      op("compose.saveEnvironment", "POST", "Save environment", "Replace compose environment variables. Paste raw .env text in env.", { composeId: COMPOSE_ID, env: "KEY=value" }),
      op("compose.refreshToken", "POST", "Refresh token", "Rotate the compose webhook token.", { composeId: COMPOSE_ID }),
    ],
  },
  {
    value: "domains",
    label: "Domains",
    load: op("domain.byComposeId", "GET", "List domains", "Fetch domains attached to this compose service.", undefined, { composeId: COMPOSE_ID }),
    operations: [
      op("domain.create", "POST", "Create domain", "Create a domain for this compose service.", { composeId: COMPOSE_ID, host: "example.com", serviceName: SERVICE_NAME, port: 80, path: "/" }),
      op("domain.one", "GET", "Read domain", "Read a domain by domainId.", undefined, { domainId: "" }),
      op("domain.update", "POST", "Update domain", "Update a domain. Fill domainId and fields to change.", { domainId: "", host: "example.com", serviceName: SERVICE_NAME, port: 80, path: "/" }),
      op("domain.delete", "POST", "Delete domain", "Delete a domain by domainId.", { domainId: "" }, undefined, true),
      op("domain.toggleEnable", "POST", "Toggle domain", "Enable or disable a domain.", { domainId: "" }),
      op("domain.generateDomain", "POST", "Generate domain", "Generate a Dokploy-managed domain.", { composeId: COMPOSE_ID }),
      op("domain.validateDomain", "POST", "Validate domain", "Validate DNS/routing for a domain.", { domainId: "" }),
      op("domain.canGenerateTraefikMeDomains", "GET", "Traefik.me availability", "Check if managed traefik.me domain generation is available.", undefined, {}),
    ],
  },
  {
    value: "deployments",
    label: "Deployments",
    load: op("deployment.allByType", "GET", "List deployments", "Fetch deployments for this compose service.", undefined, { applicationId: COMPOSE_ID, type: COMPOSE_TYPE }),
    operations: [
      op("deployment.readLogs", "GET", "Read deployment logs", "Read logs for a deploymentId.", undefined, { deploymentId: "" }),
      op("deployment.killProcess", "POST", "Kill deployment process", "Kill a deployment process.", { deploymentId: "" }, undefined, true),
      op("deployment.removeDeployment", "POST", "Remove deployment", "Remove a deployment record.", { deploymentId: "" }, undefined, true),
      op("compose.cancelDeployment", "POST", "Cancel deployment", "Cancel the active compose deployment.", { composeId: COMPOSE_ID }, undefined, true),
      op("compose.cleanQueues", "POST", "Clean queues", "Clean queued deployment jobs.", { composeId: COMPOSE_ID }, undefined, true),
      op("compose.clearDeployments", "POST", "Clear deployments", "Clear deployment history for this compose service.", { composeId: COMPOSE_ID }, undefined, true),
      op("compose.killBuild", "POST", "Kill build", "Kill the current compose build process.", { composeId: COMPOSE_ID }, undefined, true),
    ],
  },
  {
    value: "containers",
    label: "Containers",
    load: op("docker.getStackContainersByAppName", "GET", "Stack containers", "Fetch stack containers by app name.", undefined, { appName: APP_NAME }),
    operations: [
      op("docker.getStackContainersByAppName", "GET", "Get stack containers", "Fetch stack containers by app name.", undefined, { appName: APP_NAME }),
      op("docker.getServiceContainersByAppName", "GET", "Get service containers", "Fetch containers for one compose service name.", undefined, { appName: APP_NAME, serviceName: SERVICE_NAME }),
      op("docker.startContainer", "POST", "Start container", "Start a container by containerId.", { containerId: "" }),
      op("docker.stopContainer", "POST", "Stop container", "Stop a container by containerId.", { containerId: "" }, undefined, true),
      op("docker.restartContainer", "POST", "Restart container", "Restart a container by containerId.", { containerId: "" }, undefined, true),
      op("docker.killContainer", "POST", "Kill container", "Kill a container by containerId.", { containerId: "" }, undefined, true),
      op("docker.removeContainer", "POST", "Remove container", "Remove a container by containerId.", { containerId: "" }, undefined, true),
    ],
  },
  {
    value: "backups",
    label: "Backups",
    load: op("backup.listBackupFiles", "GET", "List backup files", "Fetch backup files for this compose service.", undefined, { composeId: COMPOSE_ID }),
    operations: [
      op("backup.one", "GET", "Read backup", "Read a backup by backupId.", undefined, { backupId: "" }),
      op("backup.create", "POST", "Create backup", "Create a compose backup job.", { composeId: COMPOSE_ID, name: "Compose backup", schedule: "0 0 * * *", database: "", enabled: true }),
      op("backup.update", "POST", "Update backup", "Update a backup job. Fill backupId.", { backupId: "", name: "Compose backup", schedule: "0 0 * * *", enabled: true }),
      op("backup.remove", "POST", "Remove backup", "Remove a backup job.", { backupId: "" }, undefined, true),
      op("backup.listBackupFiles", "GET", "List backup files", "Fetch files for a backupId or composeId.", undefined, { composeId: COMPOSE_ID, backupId: "" }),
      op("backup.manualBackupCompose", "POST", "Manual backup", "Run a compose backup now.", { backupId: "" }),
    ],
  },
  {
    value: "schedules",
    label: "Schedules",
    load: op("schedule.list", "GET", "List schedules", "Fetch schedules for this compose service.", undefined, { applicationId: COMPOSE_ID, type: COMPOSE_TYPE }),
    operations: [
      op("schedule.one", "GET", "Read schedule", "Read a schedule by scheduleId.", undefined, { scheduleId: "" }),
      op("schedule.create", "POST", "Create schedule", "Create a cron schedule.", { applicationId: COMPOSE_ID, name: "Compose schedule", schedule: "0 0 * * *", command: "docker compose ps", type: COMPOSE_TYPE }),
      op("schedule.update", "POST", "Update schedule", "Update a schedule. Fill scheduleId.", { scheduleId: "", name: "Compose schedule", schedule: "0 0 * * *", command: "docker compose ps" }),
      op("schedule.delete", "POST", "Delete schedule", "Delete a schedule.", { scheduleId: "" }, undefined, true),
      op("schedule.runManually", "POST", "Run manually", "Run a schedule now.", { scheduleId: "" }),
    ],
  },
  {
    value: "volumeBackups",
    label: "Volume backups",
    load: op("volumeBackups.list", "GET", "List volume backups", "Fetch volume backup jobs for this compose service.", undefined, { applicationId: COMPOSE_ID, type: COMPOSE_TYPE }),
    operations: [
      op("volumeBackups.one", "GET", "Read volume backup", "Read a volume backup by volumeBackupId.", undefined, { volumeBackupId: "" }),
      op("volumeBackups.create", "POST", "Create volume backup", "Create a volume backup job.", { applicationId: COMPOSE_ID, name: "Volume backup", schedule: "0 0 * * *", volumeName: "", type: COMPOSE_TYPE }),
      op("volumeBackups.update", "POST", "Update volume backup", "Update a volume backup job. Fill volumeBackupId.", { volumeBackupId: "", name: "Volume backup", schedule: "0 0 * * *", volumeName: "" }),
      op("volumeBackups.delete", "POST", "Delete volume backup", "Delete a volume backup job.", { volumeBackupId: "" }, undefined, true),
      op("volumeBackups.runManually", "POST", "Run manually", "Run a volume backup now.", { volumeBackupId: "" }),
      op("volumeBackups.restoreVolumeBackupWithLogs", "POST", "Restore backup", "Absent from Dokploy v0.30.2 manifest; disabled instead of faked.", undefined, undefined, true, "Missing from v0.30.2 API manifest"),
    ],
  },
  {
    value: "logs",
    label: "Logs",
    load: op("compose.readLogs", "GET", "Read compose logs", "Fetch compose logs for this service.", undefined, { composeId: COMPOSE_ID, appName: APP_NAME }),
    operations: [
      op("compose.readLogs", "GET", "Read compose logs", "Fetch compose logs. Add serviceName if you want one service only.", undefined, { composeId: COMPOSE_ID, appName: APP_NAME, serviceName: SERVICE_NAME }),
      op("docker.getServiceContainersByAppName", "GET", "Service containers", "Use this result to choose a container before lifecycle actions.", undefined, { appName: APP_NAME, serviceName: SERVICE_NAME }),
      op("docker.getStackContainersByAppName", "GET", "Stack containers", "Fetch every container in the compose stack.", undefined, { appName: APP_NAME }),
    ],
  },
  {
    value: "patches",
    label: "Patches",
    load: op("patch.byEntityId", "GET", "List patches", "Fetch patches for this compose service.", undefined, { entityId: COMPOSE_ID, type: COMPOSE_TYPE }),
    operations: [
      op("patch.one", "GET", "Read patch", "Read a patch by patchId.", undefined, { patchId: "" }),
      op("patch.create", "POST", "Create patch", "Create a patch record.", { entityId: COMPOSE_ID, type: COMPOSE_TYPE, name: "Patch", description: "" }),
      op("patch.update", "POST", "Update patch", "Update a patch. Fill patchId.", { patchId: "", name: "Patch", description: "" }),
      op("patch.delete", "POST", "Delete patch", "Delete a patch.", { patchId: "" }, undefined, true),
      op("patch.toggleEnabled", "POST", "Toggle patch", "Enable or disable a patch.", { patchId: "" }),
      op("patch.ensureRepo", "POST", "Ensure patch repo", "Create or refresh the patch repository.", { entityId: COMPOSE_ID, type: COMPOSE_TYPE }),
      op("patch.readRepoDirectories", "GET", "Read patch directories", "Browse patch repo directories.", undefined, { entityId: COMPOSE_ID, type: COMPOSE_TYPE, path: "/" }),
      op("patch.readRepoFile", "GET", "Read patch file", "Read a file from the patch repository.", undefined, { entityId: COMPOSE_ID, type: COMPOSE_TYPE, path: "" }),
      op("patch.saveFileAsPatch", "POST", "Save file as patch", "Persist a repo file as patch content.", { entityId: COMPOSE_ID, type: COMPOSE_TYPE, path: "", content: "" }),
      op("patch.markFileForDeletion", "POST", "Mark file for deletion", "Mark a patch repo file for deletion.", { entityId: COMPOSE_ID, type: COMPOSE_TYPE, path: "" }, undefined, true),
      op("patch.cleanPatchRepos", "POST", "Clean patch repos", "Clean patch repositories.", {}, undefined, true),
    ],
  },
  {
    value: "advanced",
    label: "Advanced",
    load: op("network.all", "GET", "List networks", "Fetch Docker networks available for assignment.", undefined, {}),
    operations: [
      op("compose.getDefaultCommand", "GET", "Get default command", "Read upstream default command for this compose service.", undefined, { composeId: COMPOSE_ID }),
      op("compose.update", "POST", "Update advanced settings", "Update command, resources, networks, isolation, or any accepted compose fields.", { composeId: COMPOSE_ID, command: "", restartPolicy: "unless-stopped" }),
      op("compose.import", "POST", "Import compose", "Import compose content into this service.", { composeId: COMPOSE_ID, composeFile: "services:\n  app:\n    image: nginx:latest" }),
      op("compose.processTemplate", "POST", "Process template", "Process a compose template and return upstream output.", { composeId: COMPOSE_ID, template: "", variables: {} }),
      op("compose.loadMountsByService", "POST", "Load mounts by service", "Parse mounts from compose content for a service.", { composeId: COMPOSE_ID, serviceName: SERVICE_NAME }),
      op("compose.loadServices", "POST", "Load services", "Parse/list services from compose content.", { composeId: COMPOSE_ID }),
      op("compose.isolatedDeployment", "POST", "Isolated deployment", "Toggle or run isolated deployment settings.", { composeId: COMPOSE_ID, isolatedDeployment: true }),
      op("mounts.listByServiceId", "GET", "List mounts", "Fetch mounts for this compose service.", undefined, { serviceId: SERVICE_ID }),
      op("mounts.one", "GET", "Read mount", "Read a mount by mountId.", undefined, { mountId: "" }),
      op("mounts.create", "POST", "Create mount", "Create a volume or bind mount.", { serviceId: SERVICE_ID, type: "volume", source: "", target: "/data" }),
      op("mounts.update", "POST", "Update mount", "Update a mount. Fill mountId.", { mountId: "", type: "volume", source: "", target: "/data" }),
      op("mounts.remove", "POST", "Remove mount", "Remove a mount.", { mountId: "" }, undefined, true),
      op("mounts.allNamedByApplicationId", "GET", "Named app mounts", "Fetch named mounts using the compose id as application id when upstream supports it.", undefined, { applicationId: COMPOSE_ID }),
      op("network.all", "GET", "List networks", "Fetch Docker networks for assignment.", undefined, {}),
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
    composeId: COMPOSE_ID,
    title: "Console manual run",
    description: "Triggered from Kilat Cloud console",
  }
}

export default function DokployComposeServicePage() {
  const params = useParams()
  const projectId = params.projectId ?? ""
  const environmentId = params.environmentId ?? ""
  const composeId = params.composeId ?? ""
  const [searchParams, setSearchParams] = useSearchParams()

  const compose = useUpstream<Row>(
    () => dokploy<Row>("GET", "compose.one", undefined, { composeId }),
    [composeId],
  )

  const rawTab = searchParams.get("tab") ?? "general"
  const activeTab = tabs.some((tab) => tab.value === rawTab) ? rawTab : "general"
  const tab = tabs.find((item) => item.value === activeTab) ?? tabs[0]

  const setTab = (next: string) => {
    const updated = new URLSearchParams(searchParams)
    updated.set("tab", next)
    setSearchParams(updated, { replace: true })
  }

  const title = text(compose.data?.name) || composeId || "Compose"
  const appName = text(compose.data?.appName) || text(compose.data?.name)
  const serviceName = text(compose.data?.serviceName) || ""

  return (
    <div className="flex flex-col gap-4">
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
            <BreadcrumbPage>Compose · {title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {compose.loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      ) : compose.error ? (
        <ErrorBanner error={compose.error} />
      ) : (
        <PageHeader
          title={title}
          description={text(compose.data?.composeStatus) || text(compose.data?.applicationStatus) || "unknown"}
        />
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
        composeId={composeId}
        tab={tab}
        appName={appName}
        serviceName={serviceName}
        onComposeChanged={compose.reload}
      />
    </div>
  )
}

function OperationConsole({
  composeId,
  tab,
  appName,
  serviceName,
  onComposeChanged,
}: {
  composeId: string
  tab: Tab
  appName: string
  serviceName: string
  onComposeChanged: () => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        {tab.load ? (
          <ReadCard operation={tab.load} composeId={composeId} appName={appName} serviceName={serviceName} />
        ) : null}
        {tab.operations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No operations</EmptyTitle>
              <EmptyDescription>This tab has no upstream operations configured.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {tab.operations.map((operation) => (
              <OperationCard
                key={operation.op}
                operation={operation}
                composeId={composeId}
                appName={appName}
                serviceName={serviceName}
                onComposeChanged={onComposeChanged}
              />
            ))}
          </div>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Operation console</CardTitle>
          <CardDescription>Payloads are sent directly to /api/v1/dokploy/{`{tag.op}`}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>List/read cards fetch real upstream JSON. Copy IDs from those responses before running mutations.</p>
          <p>Update the JSON forms to match the target Dokploy operation. Responses and errors are shown verbatim from upstream.</p>
          <p>Destructive operations use AlertDialog confirmation. Missing v0.30.2 operations render as disabled cards instead of fake actions.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ReadCard({ operation, composeId, appName, serviceName }: { operation: Operation; composeId: string; appName: string; serviceName: string }) {
  const query = useMemo(
    () => toQuery(replacePlaceholders(operation.defaultQuery, composeId, appName, serviceName)),
    [operation.defaultQuery, composeId, appName, serviceName],
  )
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
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : result.error ? (
          <ErrorBanner error={result.error} />
        ) : isEmpty(result.data) ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No upstream rows</EmptyTitle>
              <EmptyDescription>The server returned an empty response for this operation.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <JsonBlock value={result.data} />
        )}
      </CardContent>
    </Card>
  )
}

function OperationCard({
  operation,
  composeId,
  appName,
  serviceName,
  onComposeChanged,
}: {
  operation: Operation
  composeId: string
  appName: string
  serviceName: string
  onComposeChanged: () => void
}) {
  const initialBody = useMemo(
    () => stringifyJson(replacePlaceholders(operation.defaultBody, composeId, appName, serviceName) ?? {}),
    [operation.defaultBody, composeId, appName, serviceName],
  )
  const initialQuery = useMemo(
    () => stringifyJson(replacePlaceholders(operation.defaultQuery, composeId, appName, serviceName) ?? {}),
    [operation.defaultQuery, composeId, appName, serviceName],
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
      if (operation.op.startsWith("compose.")) onComposeChanged()
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
      <CardContent className="flex flex-col gap-3">
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
    <FieldGroup>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel>{label}</FieldLabel>
        <Textarea
          className="min-h-28 font-mono text-xs"
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </FieldGroup>
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

function replacePlaceholders(value: Row | undefined, composeId: string, appName: string, serviceName: string): Row | undefined {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      item === COMPOSE_ID
        ? composeId
        : item === SERVICE_ID
          ? composeId
          : item === COMPOSE_TYPE
            ? "compose"
            : item === APP_NAME
              ? appName
              : item === SERVICE_NAME
                ? serviceName
                : item,
    ]),
  )
}

function parseObject(value: string, label: string): Row {
  const parsed = JSON.parse(value || "{}") as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} JSON must be an object`)
  }
  return parsed as Row
}

function parseQuery(value: string): Record<string, string | number | undefined> {
  const object = parseObject(value, "query")
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      typeof item === "number" || typeof item === "string" ? item : item == null ? undefined : String(item),
    ]),
  )
}

function toQuery(value: Row | undefined): Record<string, string | number | undefined> | undefined {
  if (!value) return undefined
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "number" || typeof item === "string" ? item : item == null ? undefined : String(item),
    ]),
  )
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
