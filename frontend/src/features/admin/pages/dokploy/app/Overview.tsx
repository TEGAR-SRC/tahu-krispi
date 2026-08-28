import { useMemo, useState } from "react"
import { toast } from "sonner"
import { PlayIcon, SquareIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dokploy, toErrorMessage, useUpstream } from "./shared"
import {
  ConfirmButton,
  K5Page,
  OperationConsole,
  ResourceTable,
  StatusBadge,
  boolValue,
  idFrom,
  mutate,
  rowsFrom,
  textValue,
  type Row,
} from "./k5-common"

const KIND_IDS: Record<string, string> = {
  application: "applicationId",
  compose: "composeId",
  postgres: "postgresId",
  mysql: "mysqlId",
  mariadb: "mariadbId",
  mongo: "mongoId",
  redis: "redisId",
  libsql: "libsqlId",
}

interface OverviewPayload {
  services: unknown
  backups: unknown
  domains: unknown
  deployments: unknown
  queue: unknown
}

export default function DokployOverviewPage() {
  const overview = useUpstream<OverviewPayload>(
    async () => {
      const [services, backups, domains, deployments, queue] = await Promise.all([
        dokploy("GET", "overview.services"),
        dokploy("GET", "overview.backups"),
        dokploy("GET", "overview.domains"),
        dokploy("GET", "deployment.allCentralized"),
        dokploy("GET", "deployment.queueList"),
      ])
      return { services, backups, domains, deployments, queue }
    },
    [],
  )

  const serviceRows = useMemo(() => rowsFrom(overview.data?.services), [overview.data?.services])
  const backupRows = useMemo(() => rowsFrom(overview.data?.backups), [overview.data?.backups])
  const domainRows = useMemo(() => rowsFrom(overview.data?.domains), [overview.data?.domains])
  const deploymentRows = useMemo(() => rowsFrom(overview.data?.deployments), [overview.data?.deployments])
  const queueRows = useMemo(() => rowsFrom(overview.data?.queue), [overview.data?.queue])

  return (
    <K5Page title="Overview" description="Cross-project Dokploy services, backups, domains and centralized deployments.">
      <OverviewSummaryCards
        services={serviceRows}
        backups={backupRows}
        domains={domainRows}
        deployments={deploymentRows}
        queue={queueRows}
      />
      {overview.error ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to load one or more overview datasets</AlertTitle>
          <AlertDescription>{toErrorMessage(overview.error)}</AlertDescription>
        </Alert>
      ) : null}
      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
        </TabsList>
        <TabsContent value="services">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="backups">
          <ResourceTable
            title="Backups"
            description="Real upstream overview.backups output."
            loader={() => dokploy("GET", "overview.backups")}
            columns={backupColumns}
            emptyMessage="No backups returned by Dokploy."
          />
        </TabsContent>
        <TabsContent value="domains">
          <DomainsTab />
        </TabsContent>
        <TabsContent value="deployments">
          <DeploymentTabs />
        </TabsContent>
      </Tabs>
    </K5Page>
  )
}

function OverviewSummaryCards({
  services,
  backups,
  domains,
  deployments,
  queue,
}: {
  services: Row[]
  backups: Row[]
  domains: Row[]
  deployments: Row[]
  queue: Row[]
}) {
  const runningServices = services.filter((row) => {
    const status = textValue(row, ["status", "applicationStatus", "composeStatus"], "").toLowerCase()
    return status.includes("running") || status.includes("active") || status.includes("healthy")
  }).length
  const enabledDomains = domains.filter((row) => boolValue(row, ["enabled", "enable", "active"]))
    .length

  const cards = [
    { title: "Services", description: `${runningServices} active`, value: services.length },
    { title: "Backups", description: "overview.backups", value: backups.length },
    { title: "Domains", description: `${enabledDomains} enabled`, value: domains.length },
    { title: "Deployments", description: `${queue.length} queued`, value: deployments.length },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-lg sm:text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{card.description}</CardContent>
        </Card>
      ))}
    </div>
  )
}

function ServicesTab() {
  const [nonce, setNonce] = useState(0)
  return (
    <OperationConsole
      title="Services"
      description="overview.services with deploy/stop quick actions by service kind."
      reloadKey={nonce}
      loader={() => dokploy("GET", "overview.services")}
      columns={serviceColumns}
      actions={(row, reload) => (
        <ServiceActions
          row={row}
          reload={() => {
            reload()
            setNonce((value) => value + 1)
          }}
        />
      )}
    />
  )
}

function ServiceActions({ row, reload }: { row: Row; reload: () => void }) {
  const kind = textValue(row, ["type", "kind", "serviceType"], "").toLowerCase()
  const idKey = KIND_IDS[kind]
  const serviceId = idKey ? idFrom(row, [idKey, "id", "serviceId"]) : ""
  const run = async (action: "deploy" | "stop") => {
    if (!kind || !idKey || !serviceId) {
      toast.error("Cannot infer Dokploy service kind/id for this row")
      return
    }
    await mutate(() => dokploy("POST", `${kind}.${action}`, { [idKey]: serviceId }), `${kind}.${action} accepted`, reload)
  }
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" onClick={() => void run("deploy")} disabled={!idKey || !serviceId}>
        <PlayIcon data-icon="inline-start" />
        Deploy
      </Button>
      <ConfirmButton
        label="Stop"
        title="Stop service?"
        description="This sends the upstream stop operation for the inferred service kind."
        variant="outline"
        disabled={!idKey || !serviceId}
        onConfirm={() => run("stop")}
      />
    </div>
  )
}

function DomainsTab() {
  return (
    <OperationConsole
      title="Domains"
      description="overview.domains with domain.toggleEnable."
      loader={() => dokploy("GET", "overview.domains")}
      columns={domainColumns}
      actions={(row, reload) => {
        const domainId = idFrom(row, ["domainId", "id"])
        return (
          <Button
            variant="outline"
            size="sm"
            disabled={!domainId}
            onClick={() => void mutate(() => dokploy("POST", "domain.toggleEnable", { domainId }), "Domain toggled", reload)}
          >
            <SquareIcon data-icon="inline-start" />
            Toggle
          </Button>
        )
      }}
    />
  )
}

function DeploymentTabs() {
  const deployments = useUpstream<unknown>(() => dokploy("GET", "deployment.allCentralized"), [])
  const queue = useUpstream<unknown>(() => dokploy("GET", "deployment.queueList"), [])
  const deploymentRows = useMemo(() => rowsFrom(deployments.data), [deployments.data])
  const queueRows = useMemo(() => rowsFrom(queue.data), [queue.data])
  return (
    <Tabs defaultValue="all">
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="queue">Queue</TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <ResourceTable
          title="Centralized deployments"
          description="deployment.allCentralized rendered as live upstream rows."
          loader={() => Promise.resolve(deploymentRows)}
          columns={deploymentColumns}
          emptyMessage="No centralized deployments returned by Dokploy."
          reloadKey={deploymentRows.length}
        />
        {deployments.error ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load deployments</AlertTitle>
            <AlertDescription>{toErrorMessage(deployments.error)}</AlertDescription>
          </Alert>
        ) : null}
      </TabsContent>
      <TabsContent value="queue">
        <ResourceTable
          title="Deployment queue"
          description="deployment.queueList rendered as live upstream rows."
          loader={() => Promise.resolve(queueRows)}
          columns={deploymentColumns}
          emptyMessage="No queued deployments returned by Dokploy."
          reloadKey={queueRows.length}
        />
        {queue.error ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load queue</AlertTitle>
            <AlertDescription>{toErrorMessage(queue.error)}</AlertDescription>
          </Alert>
        ) : null}
      </TabsContent>
    </Tabs>
  )
}

const serviceColumns = [
  { key: "name", header: "Name", render: (row: Row) => textValue(row, ["name", "appName", "serviceName"]) },
  { key: "kind", header: "Kind", render: (row: Row) => textValue(row, ["type", "kind", "serviceType"]) },
  { key: "project", header: "Project", render: (row: Row) => textValue(row, ["projectName", "project", "environmentName"]) },
  {
    key: "status",
    header: "Status",
    render: (row: Row) => <StatusBadge value={textValue(row, ["status", "applicationStatus", "composeStatus"], "unknown")} />,
  },
]

const backupColumns = [
  { key: "name", header: "Backup", render: (row: Row) => textValue(row, ["name", "backupName", "fileName"]) },
  { key: "service", header: "Service", render: (row: Row) => textValue(row, ["appName", "serviceName", "applicationName", "composeName"]) },
  { key: "destination", header: "Destination", render: (row: Row) => textValue(row, ["destinationName", "bucket", "provider", "storageProvider"]) },
  { key: "createdAt", header: "Created", render: (row: Row) => textValue(row, ["createdAt", "updatedAt", "date"]) },
]

const domainColumns = [
  { key: "host", header: "Host", render: (row: Row) => textValue(row, ["host", "domain", "url"]) },
  { key: "service", header: "Service", render: (row: Row) => textValue(row, ["appName", "serviceName", "applicationName", "composeName"]) },
  { key: "path", header: "Path", render: (row: Row) => textValue(row, ["path", "uri"]) },
  { key: "enabled", header: "Enabled", render: (row: Row) => <StatusBadge value={boolValue(row, ["enabled", "enable", "active"])} /> },
]

const deploymentColumns = [
  { key: "name", header: "Service", render: (row: Row) => textValue(row, ["name", "appName", "serviceName"]) },
  { key: "status", header: "Status", render: (row: Row) => <StatusBadge value={textValue(row, ["status", "deploymentStatus"], "unknown")} /> },
  { key: "createdAt", header: "Created", render: (row: Row) => textValue(row, ["createdAt", "startedAt", "date"]) },
]
