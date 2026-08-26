import { useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dokploy, toErrorMessage, useUpstream } from "./shared"
import {
  FieldCard,
  JsonBlock,
  K5Page,
  RawResultCard,
  ResourceTable,
  ServerSelect,
  StatusBadge,
  TextField,
  isRow,
  mutate,
  rowsFrom,
  textValue,
  type Row,
} from "./k5-common"

export default function DokployMonitoringPage() {
  const [serverId, setServerId] = useState("")
  const [appName, setAppName] = useState("")
  const [token, setToken] = useState<unknown>(null)
  const [metricsUrl, setMetricsUrl] = useState("")
  const [dataPoints, setDataPoints] = useState("60")

  const servers = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.all"), [])
  const serverRows = useMemo(() => rowsFrom(servers.data), [servers.data])
  const selectedServer = useMemo(
    () => serverRows.find((row) => String(row.serverId ?? row.id ?? "") === serverId) ?? null,
    [serverId, serverRows],
  )

  useEffect(() => {
    if (!selectedServer) return
    const host = textValue(selectedServer, ["ipAddress", "host", "url"], "")
    if (!host) return
    const t = setTimeout(() => setMetricsUrl(`http://${host}:4500/metrics`), 0)
    return () => clearTimeout(t)
  }, [selectedServer])

  const appMonitoring = useUpstream<unknown>(
    () => (appName.trim() ? dokploy("GET", "application.readAppMonitoring", undefined, { appName: appName.trim() }) : Promise.resolve(null)),
    [appName],
  )

  const canQueryServerMetrics = Boolean(metricsUrl.trim() && dataPoints.trim() && token)
  const serverMetrics = useUpstream<unknown>(
    () =>
      canQueryServerMetrics
        ? dokploy("GET", "server.getServerMetrics", undefined, {
            url: metricsUrl.trim(),
            token: extractToken(token),
            dataPoints: dataPoints.trim(),
          })
        : Promise.resolve(null),
    [metricsUrl, dataPoints, token],
  )

  return (
    <K5Page title="Monitoring" description="CE monitoring probes backed by Dokploy metrics operations.">
      <FieldCard title="Scope" description="Dokploy CE exposes app monitoring directly by appName. Server metrics need a metrics URL, token, and datapoint window because server.getServerMetrics does not accept serverId alone.">
        <ServerSelect value={serverId} onChange={setServerId} />
        <TextField label="Metrics URL" value={metricsUrl} onChange={setMetricsUrl} placeholder="http://server-ip:4500/metrics" description="Pre-filled from the selected server IP when available. Adjust if your monitoring endpoint differs." />
        <TextField label="Data points" value={dataPoints} onChange={setDataPoints} placeholder="60" description="Required by server.getServerMetrics." />
        <TextField label="App/container name" value={appName} onChange={setAppName} placeholder="my-app" description="Passed directly to application.readAppMonitoring." />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void mutate(() => dokploy("GET", "user.getMetricsToken"), "Metrics token loaded", undefined).then((result) => setToken(result.result))
            }
          >
            Load metrics token
          </Button>
          <Button variant="outline" disabled={!canQueryServerMetrics} onClick={serverMetrics.reload}>
            Refresh server metrics
          </Button>
          <Button variant="outline" disabled={!appName.trim()} onClick={appMonitoring.reload}>
            Refresh app monitoring
          </Button>
        </div>
      </FieldCard>

      <MonitoringSummaryCard appRows={rowsFrom(appMonitoring.data)} serverRows={rowsFrom(serverMetrics.data)} />
      <RawResultCard title="Metrics token response" result={token} />

      {!serverId ? (
        <Alert>
          <AlertTitle>Server metrics need explicit endpoint inputs</AlertTitle>
          <AlertDescription>Select a server to prefill `http://ip:4500/metrics`, then load a token. The upstream spec only exposes `server.getServerMetrics(url, token, dataPoints)`; there is no serverId-based shortcut to invent here.</AlertDescription>
        </Alert>
      ) : null}

      {selectedServer ? <RawResultCard title="Selected server" result={selectedServer} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Server metrics</CardTitle>
          <CardDescription>Live `server.getServerMetrics` output when URL, token, and datapoints are all present.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canQueryServerMetrics ? (
            <Alert>
              <AlertTitle>Waiting for required monitoring inputs</AlertTitle>
              <AlertDescription>Load `user.getMetricsToken`, keep a valid metrics URL, and provide `dataPoints`. This limitation comes from the upstream API contract, not the UI.</AlertDescription>
            </Alert>
          ) : null}
          {serverMetrics.error ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load server metrics</AlertTitle>
              <AlertDescription>{toErrorMessage(serverMetrics.error)}</AlertDescription>
            </Alert>
          ) : null}
          {serverMetrics.data !== null ? <JsonBlock value={serverMetrics.data} /> : null}
        </CardContent>
      </Card>

      <ResourceTable
        title="Application monitoring"
        description="Rows derived from application.readAppMonitoring."
        loader={() => Promise.resolve(rowsFrom(appMonitoring.data))}
        columns={appMonitoringColumns}
        emptyMessage={appName.trim() ? "No monitoring rows returned for this app name." : "Enter an app/container name to load monitoring data."}
        reloadKey={`${appName}:${rowsFrom(appMonitoring.data).length}`}
      />
      {appMonitoring.error ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to load app monitoring</AlertTitle>
          <AlertDescription>{toErrorMessage(appMonitoring.error)}</AlertDescription>
        </Alert>
      ) : null}
      <RawResultCard title="Application monitoring raw response" result={appMonitoring.data} />
    </K5Page>
  )
}

function MonitoringSummaryCard({ appRows, serverRows }: { appRows: Row[]; serverRows: Row[] }) {
  const cards = [
    { title: "App series", value: appRows.length, description: "application.readAppMonitoring rows" },
    { title: "Server series", value: serverRows.length, description: "server.getServerMetrics rows" },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{card.description}</CardContent>
        </Card>
      ))}
    </div>
  )
}

function extractToken(value: unknown) {
  if (typeof value === "string") return value
  if (!isRow(value)) return ""
  return textValue(value, ["token", "metricsToken", "accessToken", "value"], "")
}

const appMonitoringColumns = [
  { key: "name", header: "Name", render: (row: Row) => textValue(row, ["name", "metric", "label", "containerName"]) },
  { key: "value", header: "Value", render: (row: Row) => textValue(row, ["value", "current", "usage", "metricValue"]) },
  { key: "unit", header: "Unit", render: (row: Row) => textValue(row, ["unit", "suffix", "type"]) },
  { key: "status", header: "Status", render: (row: Row) => <StatusBadge value={textValue(row, ["status", "state", "health"], "—")} /> },
]
