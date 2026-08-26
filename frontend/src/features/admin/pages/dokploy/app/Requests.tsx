import { useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { dokploy, toErrorMessage, useUpstream } from "./shared"
import {
  DisabledOpCard,
  FieldCard,
  JsonBlock,
  K5Page,
  TextField,
  ToggleField,
  isRow,
  mutate,
  textValue,
} from "./k5-common"

export default function DokployRequestsPage() {
  const active = useUpstream<unknown>(() => dokploy("GET", "settings.haveActivateRequests"), [])
  const cleanup = useUpstream<unknown>(() => dokploy("GET", "settings.getLogCleanupStatus"), [])
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const data = active.data
    if (typeof data === "boolean") setEnabled(data)
    else if (isRow(data)) setEnabled(Boolean(data.enabled ?? data.enable ?? data.active ?? data.haveActivateRequests))
  }, [active.data])

  const toggle = async (next: boolean) => {
    setBusy(true)
    const result = await mutate(() => dokploy("POST", "settings.toggleRequests", { enable: next }), "Request logging updated", active.reload)
    if (result.ok) setEnabled(next)
    setBusy(false)
  }

  return (
    <K5Page title="Requests" description="Traefik access-log controls backed by the Dokploy v0.30.2 settings endpoints that actually exist.">
      <FieldCard title="Access-log collection" description="settings.haveActivateRequests + settings.toggleRequests.">
        <ToggleField
          label="Enable request logging"
          description={active.loading ? "Loading current upstream state…" : "Toggles Dokploy request log collection."}
          checked={enabled}
          disabled={active.loading || busy || Boolean(active.error)}
          onCheckedChange={(next) => void toggle(next)}
        />
        {active.error ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to read request setting</AlertTitle>
            <AlertDescription>{toErrorMessage(active.error)}</AlertDescription>
          </Alert>
        ) : null}
        {active.data !== null && active.data !== undefined ? <JsonBlock value={active.data} /> : null}
      </FieldCard>
      <CleanupCard data={cleanup.data} loading={cleanup.loading} error={cleanup.error} reload={cleanup.reload} />
      <DisabledOpCard title="Request analytics" description="settings.readStats and settings.readStatsLogs are absent from the connected Dokploy v0.30.2 manifest, so charts and streamed request logs stay disabled instead of using fake data." />
    </K5Page>
  )
}

function CleanupCard({ data, loading, error, reload }: { data: unknown; loading: boolean; error: unknown; reload: () => void }) {
  const [cronExpression, setCronExpression] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (typeof data === "string") {
      setCronExpression(data)
      return
    }
    if (!isRow(data)) return
    const value = textValue(data, ["cronExpression", "cron", "schedule", "value"], "")
    setCronExpression(value === "—" ? "" : value)
  }, [data])

  const save = async () => {
    setSaving(true)
    await mutate(
      () =>
        dokploy("POST", "settings.updateLogCleanup", {
          cronExpression: cronExpression.trim() || null,
        }),
      cronExpression.trim() ? "Log cleanup schedule updated" : "Log cleanup schedule disabled",
      reload,
    )
    setSaving(false)
  }

  return (
    <FieldCard
      title="Log cleanup schedule"
      description="settings.getLogCleanupStatus + settings.updateLogCleanup. The upstream spec only accepts a single cronExpression field here, so this page edits that value directly."
      footer={
        <Button onClick={() => void save()} disabled={saving || loading || Boolean(error)}>
          {saving ? <Spinner /> : null}
          Save cleanup schedule
        </Button>
      }
    >
      <TextField
        label="Cron expression"
        value={cronExpression}
        onChange={setCronExpression}
        placeholder="0 0 * * *"
        description="Leave empty to send null and disable the cleanup schedule if the upstream server supports that behavior."
      />
      <ToggleField
        label="Schedule configured"
        description="Derived from whether a cron expression is currently present; there is no dedicated enable/disable endpoint in the v0.30.2 spec."
        checked={Boolean(cronExpression.trim())}
        disabled
        onCheckedChange={() => undefined}
      />
      {loading ? (
        <Alert>
          <AlertTitle>Loading cleanup status…</AlertTitle>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to read cleanup status</AlertTitle>
          <AlertDescription>{toErrorMessage(error)}</AlertDescription>
        </Alert>
      ) : null}
      {data !== null && data !== undefined ? <JsonBlock value={data} /> : null}
    </FieldCard>
  )
}
