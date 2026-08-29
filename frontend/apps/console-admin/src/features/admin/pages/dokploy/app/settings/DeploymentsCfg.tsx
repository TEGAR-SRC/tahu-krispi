// Dokploy parity #25 — settings/deployments.tsx + builds-concurrency.tsx.
// Concurrent builds configuration for the local Dokploy server and per remote server.
import { useEffect, useState } from "react"
import { GaugeIcon, SaveIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { dokploy, useUpstream } from "../shared"
import { FieldErrorText, runMutation } from "./helpers"

type Row = Record<string, unknown>

function numberFrom(value: unknown, fallback: number): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? String(n) : String(fallback)
}

export default function DokploySettingsDeploymentsPage() {
  const settings = useUpstream<Row>(() => dokploy<Row>("GET", "settings.getWebServerSettings"), [])
  const servers = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.all"), [])
  const [globalConcurrency, setGlobalConcurrency] = useState("1")
  const [serverDrafts, setServerDrafts] = useState<Record<string, string>>({})
  const [savingGlobal, setSavingGlobal] = useState(false)
  const [savingServerId, setSavingServerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      if (settings.data) setGlobalConcurrency(numberFrom(settings.data.buildsConcurrency, 1))
    }, 0)
    return () => clearTimeout(t)
  }, [settings.data])

  useEffect(() => {
    const t = setTimeout(() => {
      const drafts: Record<string, string> = {}
      for (const row of servers.data ?? []) {
        const id = String(row.serverId ?? "")
        if (id) drafts[id] = numberFrom(row.buildsConcurrency, 1)
      }
      setServerDrafts(drafts)
    }, 0)
    return () => clearTimeout(t)
  }, [servers.data])

  const parse = (value: string): number | null => {
    const next = Number(value)
    if (!Number.isInteger(next) || next < 1) return null
    return next
  }

  const saveGlobal = async () => {
    const next = parse(globalConcurrency)
    if (next === null) {
      setError("Concurrency must be a positive integer")
      return
    }
    setError(null)
    setSavingGlobal(true)
    await runMutation(() => dokploy("POST", "settings.updateBuildsConcurrency", { buildsConcurrency: next }), {
      success: "Global build concurrency updated",
      onDone: () => settings.reload(),
    })
    setSavingGlobal(false)
  }

  const saveServer = async (serverId: string) => {
    const next = parse(serverDrafts[serverId] ?? "")
    if (next === null) {
      setError("Concurrency must be a positive integer")
      return
    }
    setError(null)
    setSavingServerId(serverId)
    await runMutation(
      () => dokploy("POST", "server.updateBuildsConcurrency", { serverId, buildsConcurrency: next }),
      {
        success: "Server build concurrency updated",
        onDone: () => servers.reload(),
      },
    )
    setSavingServerId(null)
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Builds concurrency"
        description="Tune how many builds Dokploy may execute concurrently on the local server and on each remote build server."
      />

      {settings.error ? <ErrorBanner error={settings.error} /> : null}
      {servers.error ? <ErrorBanner error={servers.error} /> : null}
      {error ? <ErrorBanner error={new Error(error)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <GaugeIcon className="size-4 text-muted-foreground" />
            Local Dokploy server
          </CardTitle>
          <CardDescription>settings.updateBuildsConcurrency</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-sm items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="global-builds-concurrency">Concurrent builds</Label>
            <Input
              id="global-builds-concurrency"
              type="number"
              min={1}
              value={globalConcurrency}
              onChange={(event) => setGlobalConcurrency(event.target.value)}
              disabled={settings.loading}
            />
            {parse(globalConcurrency) === null ? (
              <FieldErrorText>Use a positive integer.</FieldErrorText>
            ) : null}
          </div>
          <Button onClick={() => void saveGlobal()} disabled={savingGlobal || settings.loading}>
            {savingGlobal ? <Spinner className="size-4" /> : <SaveIcon className="size-4" />}
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remote servers</CardTitle>
          <CardDescription>server.updateBuildsConcurrency per registered server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {servers.loading ? (
            <p className="text-sm text-muted-foreground">Loading servers…</p>
          ) : (servers.data ?? []).length === 0 ? (
            <EmptyState message="No remote servers registered." />
          ) : (
            (servers.data ?? []).map((server) => {
              const serverId = String(server.serverId ?? "")
              return (
                <div key={serverId} className="flex items-end gap-3 rounded-md border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="min-w-0 truncate text-sm font-medium">{String(server.name ?? serverId)}</p>
                    <p className="text-xs text-muted-foreground">{String(server.serverType ?? "deploy")}</p>
                  </div>
                  <div className="w-36 space-y-2">
                    <Label htmlFor={`server-builds-${serverId}`}>Concurrency</Label>
                    <Input
                      id={`server-builds-${serverId}`}
                      type="number"
                      min={1}
                      value={serverDrafts[serverId] ?? "1"}
                      onChange={(event) =>
                        setServerDrafts((prev) => ({ ...prev, [serverId]: event.target.value }))
                      }
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void saveServer(serverId)}
                    disabled={savingServerId !== null || !serverId}
                  >
                    {savingServerId === serverId ? <Spinner className="size-4" /> : <SaveIcon className="size-4" />}
                    Save
                  </Button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
