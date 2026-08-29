import { Link, useParams } from "react-router-dom"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/shared/PageHeader"
import { dokploy, useUpstream } from "./shared"
import {
  ConfirmMutation,
  EmptyList,
  EntityCard,
  ErrorAlert,
  JsonMutationDialog,
  LoadingCards,
  RawJsonCard,
  firstString,
  rows,
  s,
  type Row,
} from "./k1-helpers"

const SERVICE_KINDS = [
  "application",
  "compose",
  "postgres",
  "mysql",
  "mariadb",
  "mongo",
  "redis",
  "libsql",
] as const

type ServiceKind = (typeof SERVICE_KINDS)[number]

const SERVICE_ID_KEYS: Record<ServiceKind, string[]> = {
  application: ["applicationId", "id"],
  compose: ["composeId", "id"],
  postgres: ["postgresId", "serviceId", "id"],
  mysql: ["mysqlId", "serviceId", "id"],
  mariadb: ["mariadbId", "serviceId", "id"],
  mongo: ["mongoId", "serviceId", "id"],
  redis: ["redisId", "serviceId", "id"],
  libsql: ["libsqlId", "serviceId", "id"],
}

interface EnvironmentPayload {
  environment: unknown
  projectEnvironments: unknown
  search: unknown
}

export default function DokployEnvironmentBoardPage() {
  const params = useParams()
  const projectId = params.projectId ?? ""
  const environmentId = params.environmentId ?? ""

  const upstream = useUpstream<EnvironmentPayload>(
    async () => {
      const [environment, projectEnvironments, search] = await Promise.all([
        dokploy("GET", "environment.one", undefined, { environmentId }),
        dokploy("GET", "environment.byProjectId", undefined, { projectId }),
        dokploy("GET", "environment.search", undefined, { query: "" }),
      ])
      return { environment, projectEnvironments, search }
    },
    [projectId, environmentId],
  )

  const environment = upstream.data?.environment && typeof upstream.data.environment === "object"
    ? (upstream.data.environment as Row)
    : null
  const envRows = rows(upstream.data?.projectEnvironments)
  const serviceRows = collectServices(environment)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title={firstString(environment, ["name", "environmentName"]) || "Environment services"}
        description="Live Dokploy environment board with generic service operations."
        actions={
          <div className="flex flex-wrap gap-2">
            <JsonMutationDialog
              title="Create environment"
              op="environment.create"
              initial={{ projectId, name: "New environment", description: "" }}
              onSuccess={upstream.reload}
              trigger={
                <Button variant="outline">
                  <PlusIcon data-icon="inline-start" />
                  Environment
                </Button>
              }
            />
            <JsonMutationDialog
              title="Update environment"
              op="environment.update"
              initial={{ environmentId, name: firstString(environment, ["name", "environmentName"]), description: s(environment?.description) }}
              onSuccess={upstream.reload}
              trigger={<Button variant="outline">Update</Button>}
            />
            <JsonMutationDialog
              title="Duplicate environment"
              op="environment.duplicate"
              initial={{ sourceEnvironmentId: environmentId, name: `${firstString(environment, ["name", "environmentName"]) || "Environment"} copy`, includeServices: true, selectedServices: serviceRows.map((service) => ({ id: service.id, type: service.kind })), duplicateInSameProject: true }}
              onSuccess={upstream.reload}
              trigger={<Button variant="outline">Duplicate</Button>}
            />
            <ConfirmMutation
              title="Remove environment"
              description="This submits environment.remove for this environment. This is destructive upstream."
              op="environment.remove"
              body={{ environmentId }}
              onSuccess={upstream.reload}
              trigger={<Button variant="destructive">Remove</Button>}
            />
          </div>
        }
      />

      {upstream.loading ? <LoadingCards count={6} /> : null}
      {upstream.error ? <ErrorAlert error={upstream.error} /> : null}

      {upstream.data ? (
        <>
          <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Project environments</CardTitle>
                <CardDescription>Fetched with environment.byProjectId.</CardDescription>
              </CardHeader>
              <CardContent className="flex w-full max-w-full min-w-0 flex-col gap-2 text-sm">
                {envRows.length ? envRows.map((env, index) => {
                  const envId = firstString(env, ["environmentId", "id"])
                  return (
                    <Link
                      key={envId || index.toString()}
                      className="rounded-md bg-muted px-2 py-1 hover:underline"
                      to={`/admin/dokploy/app/p/${projectId}/e/${envId || environmentId}`}
                    >
                      {firstString(env, ["name", "environmentName"]) || envId || "Environment"}
                    </Link>
                  )
                }) : <span className="text-muted-foreground">No environments returned.</span>}
              </CardContent>
            </Card>
            <RawJsonCard title="environment.one" value={upstream.data.environment} />
            <RawJsonCard title="environment.search" value={upstream.data.search} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Create service</CardTitle>
              <CardDescription>Minimal JSON forms for each Dokploy service kind. All submit real *.create operations.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {SERVICE_KINDS.map((kind) => (
                <JsonMutationDialog
                  key={kind}
                  title={`Create ${kind}`}
                  op={`${kind}.create`}
                  initial={createInitial(kind, environmentId)}
                  onSuccess={upstream.reload}
                  trigger={<Button variant="outline" size="sm">{kind}</Button>}
                />
              ))}
            </CardContent>
          </Card>

          {serviceRows.length ? (
            <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {serviceRows.map((service) => (
                <ServiceCard
                  key={`${service.kind}-${service.id}`}
                  projectId={projectId}
                  environmentId={environmentId}
                  service={service}
                  onChanged={upstream.reload}
                />
              ))}
            </div>
          ) : (
            <EmptyList message="No services" description="This environment returned no application, compose, or database service rows." />
          )}
        </>
      ) : null}
    </div>
  )
}

function ServiceCard({
  projectId,
  environmentId,
  service,
  onChanged,
}: {
  projectId: string
  environmentId: string
  service: ServiceRef
  onChanged: () => void
}) {
  const detailId = service.kind === "application" || service.kind === "compose" ? service.id : "serviceId"
  const to = `/admin/dokploy/app/p/${projectId}/e/${environmentId}/services/${service.kind}/${service.kind === "application" || service.kind === "compose" ? service.id : service.id}`

  const actionBody = idBody(service.kind, service.id)

  return (
    <EntityCard
      title={firstString(service.row, ["name", "appName", "serviceName"]) || service.kind}
      description={firstString(service.row, ["description", "appName", "createdAt"])}
      badge={firstString(service.row, ["applicationStatus", "composeStatus", "status", "databaseStatus"]) || service.kind}
      to={to}
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link to={to}>Details</Link>
          </Button>
          <ConfirmMutation
            title={`Start ${service.kind}`}
            description={`Submits ${service.kind}.start for ${detailId}.`}
            op={`${service.kind}.start`}
            body={actionBody}
            onSuccess={onChanged}
            trigger={<Button variant="outline" size="sm">Start</Button>}
          />
          <ConfirmMutation
            title={`Stop ${service.kind}`}
            description={`Submits ${service.kind}.stop for ${detailId}.`}
            op={`${service.kind}.stop`}
            body={actionBody}
            onSuccess={onChanged}
            trigger={<Button variant="outline" size="sm">Stop</Button>}
          />
          <ConfirmMutation
            title={`Deploy ${service.kind}`}
            description={`Submits ${service.kind}.deploy for ${detailId}.`}
            op={`${service.kind}.deploy`}
            body={actionBody}
            onSuccess={onChanged}
            trigger={<Button size="sm">Deploy</Button>}
          />
        </>
      }
    >
      <ServiceOnePreview kind={service.kind} id={service.id} fallback={service.row} />
    </EntityCard>
  )
}

function ServiceOnePreview({ kind, id, fallback }: { kind: ServiceKind; id: string; fallback: Row }) {
  const preview = useUpstream<unknown>(() => dokploy("GET", `${kind}.one`, undefined, idQuery(kind, id)), [kind, id])
  if (preview.loading) return <div className="text-sm text-muted-foreground">Loading {kind}.one...</div>
  if (preview.error) {
    return (
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
        {JSON.stringify(fallback, null, 2)}
      </pre>
    )
  }
  return (
    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
      {JSON.stringify(preview.data, null, 2)}
    </pre>
  )
}

type ServiceRef = { kind: ServiceKind; id: string; row: Row }

function collectServices(environment: Row | null): ServiceRef[] {
  if (!environment) return []
  return SERVICE_KINDS.flatMap((kind) => {
    const pluralRows = rows(environment[`${kind}s`])
    const single = environment[kind]
    const singleRows = single && typeof single === "object" && !Array.isArray(single) ? [single as Row] : []
    const direct = pluralRows.concat(singleRows)
    return direct.map((row) => ({ kind, id: firstString(row, SERVICE_ID_KEYS[kind]), row })).filter((item) => item.id)
  })
}

function idQuery(kind: ServiceKind, id: string): Record<string, string> {
  const key = SERVICE_ID_KEYS[kind][0]
  return { [key]: id }
}

function idBody(kind: ServiceKind, id: string): Row {
  const key = SERVICE_ID_KEYS[kind][0]
  return { [key]: id }
}

function createInitial(kind: ServiceKind, environmentId: string): Row {
  const base = { name: `New ${kind}`, appName: `new-${kind}`, environmentId }
  if (kind === "application") return { ...base, sourceType: "docker", description: "", serverId: null }
  if (kind === "compose") return { ...base, description: "", composeFile: "services:\n  app:\n    image: nginx:latest" }
  if (kind === "redis") return { ...base, databasePassword: "ChangeMe123", dockerImage: "redis:7" }
  if (kind === "mongo") return { ...base, databaseUser: "mongo", databasePassword: "ChangeMe123", dockerImage: "mongo:7" }
  if (kind === "libsql") return { ...base, databaseName: "app", dockerImage: "ghcr.io/tursodatabase/libsql-server:v0.24.32" }
  return { ...base, databaseName: "app", databaseUser: "app", databasePassword: "ChangeMe123", dockerImage: `${kind}:latest` }
}
