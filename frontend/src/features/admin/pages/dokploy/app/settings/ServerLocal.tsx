// Dokploy parity #23 — settings/server.tsx + web-domain.tsx +
// components/dashboard/settings/web-server/*.
// The Dokploy web server itself: domain assignment, IP, Traefik env/ports,
// version/update panel, infrastructure health and web-server DB backups.
import { useState } from "react"
import { toast } from "sonner"
import {
  ActivityIcon,
  DatabaseBackupIcon,
  GlobeIcon,
  HardDriveDownloadIcon,
  NetworkIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerCogIcon,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { FieldErrorText, JsonBlock, runMutation } from "./helpers"

type Row = Record<string, unknown>

type DomainForm = {
  host: string
  certificateType: "none" | "letsencrypt" | "custom"
  letsEncryptEmail: string
  https: boolean
}

export default function DokploySettingsServerLocalPage() {
  const settings = useUpstream<Row>(() => dokploy<Row>("GET", "settings.getWebServerSettings"), [])
  const version = useUpstream<string>(() => dokploy<string>("GET", "settings.getDokployVersion"), [])
  const releaseTag = useUpstream<string>(() => dokploy<string>("GET", "settings.getReleaseTag"), [])
  const traefikEnv = useUpstream<string>(
    () => dokploy<string>("GET", "settings.readTraefikEnv", undefined, { serverId: "" }),
    [],
  )
  const traefikPorts = useUpstream<Row[]>(
    () => dokploy<Row[]>("GET", "settings.getTraefikPorts", undefined, { serverId: "" }),
    [],
  )
  const backups = useUpstream<Row>(() => dokploy<Row>("GET", "user.getBackups"), [])

  const [domainForm, setDomainForm] = useState<DomainForm | null>(null)
  const [ipValue, setIpValue] = useState("")
  const [envValue, setEnvValue] = useState<string | null>(null)
  const [savingDomain, setSavingDomain] = useState(false)
  const [savingIp, setSavingIp] = useState(false)
  const [savingEnv, setSavingEnv] = useState(false)
  const [portsDraft, setPortsDraft] = useState("80,443")
  const [savingPorts, setSavingPorts] = useState(false)
  const [health, setHealth] = useState<unknown>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  // Double-confirm gate for the upstream update (settings.updateServer).
  const [updateConfirm1, setUpdateConfirm1] = useState(false)
  const [updateConfirm2, setUpdateConfirm2] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [backingUpId, setBackingUpId] = useState<string | null>(null)

  const data = settings.data

  const startDomainEdit = () => {
    if (!data) return
    setDomainForm({
      host: String(data.host ?? ""),
      certificateType: (["letsencrypt", "none", "custom"].includes(String(data.certificateType))
        ? String(data.certificateType)
        : "none") as DomainForm["certificateType"],
      letsEncryptEmail: String(data.letsEncryptEmail ?? ""),
      https: Boolean(data.https),
    })
  }

  const saveDomain = async () => {
    if (!domainForm) return
    if (!domainForm.host.trim()) return
    setSavingDomain(true)
    await runMutation(
      () =>
        dokploy("POST", "settings.assignDomainServer", {
          host: domainForm.host.trim(),
          certificateType: domainForm.certificateType,
          letsEncryptEmail:
            domainForm.certificateType === "letsencrypt" && domainForm.letsEncryptEmail.trim()
              ? domainForm.letsEncryptEmail.trim()
              : undefined,
          https: domainForm.https,
        }),
      {
        success: "Web domain updated",
        onDone: () => {
          setDomainForm(null)
          settings.reload()
        },
      },
    )
    setSavingDomain(false)
  }

  const saveIp = async () => {
    if (!ipValue.trim()) return
    setSavingIp(true)
    await runMutation(
      () => dokploy("POST", "settings.updateServerIp", { serverIp: ipValue.trim() }),
      {
        success: "Server IP updated",
        onDone: () => {
          setIpValue("")
          settings.reload()
        },
      },
    )
    setSavingIp(false)
  }

  const saveEnv = async () => {
    if (envValue === null) return
    setSavingEnv(true)
    await runMutation(
      () =>
        dokploy("POST", "settings.writeTraefikEnv", {
          env: envValue,
          serverId: "",
        }),
      {
        success: "Traefik environment saved",
        onDone: () => traefikEnv.reload(),
      },
    )
    setSavingEnv(false)
  }

  const savePorts = async () => {
    const ports = portsDraft
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({
        targetPort: Number(part),
        publishedPort: Number(part),
        protocol: "tcp",
      }))
    if (ports.some((port) => !Number.isFinite(port.targetPort) || port.targetPort <= 0)) {
      return
    }
    setSavingPorts(true)
    await runMutation(
      () =>
        dokploy("POST", "settings.updateTraefikPorts", {
          serverId: "",
          additionalPorts: ports,
        }),
      {
        success: "Traefik ports updated",
        onDone: () => traefikPorts.reload(),
      },
    )
    setSavingPorts(false)
  }

  const runHealthCheck = async () => {
    setHealthLoading(true)
    try {
      setHealth(await dokploy("GET", "settings.checkInfrastructureHealth"))
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setHealthLoading(false)
    }
  }

  const triggerServerUpdate = async () => {
    setUpdating(true)
    await runMutation(() => dokploy("POST", "settings.updateServer", {}), {
      success: "Dokploy update started — this can take a few minutes",
      onDone: () => setUpdateConfirm1(false),
    })
    setUpdating(false)
  }

  const runManualBackup = async (backupId: string) => {
    setBackingUpId(backupId)
    await runMutation(
      () => dokploy("POST", "backup.manualBackupWebServer", { backupId }),
      {
        success: "Manual web-server backup triggered",
      },
    )
    setBackingUpId(null)
  }

  const backupRows = Array.isArray(backups.data?.backups) ? (backups.data!.backups as Row[]) : []
  const backupColumns: Array<SimpleColumn<Row>> = [
    { key: "name", header: "Name" },
    { key: "schedule", header: "Schedule" },
    { key: "enabled", header: "Enabled", render: (row) => (row.enabled ? "yes" : "no") },
    { key: "destination", header: "Destination" },
    {
      key: "actions",
      header: "",
      className: "w-40",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          disabled={backingUpId !== null}
          onClick={() => void runManualBackup(String(row.backupId ?? ""))}
        >
          {backingUpId === String(row.backupId ?? "") ? (
            <Spinner className="size-4" />
          ) : (
            <HardDriveDownloadIcon className="size-4" />
          )}
          Back up now
        </Button>
      ),
    },
  ]

  if (settings.error) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <PageHeader title="Web Server" />
        <ErrorBanner error={settings.error} />
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Web Server"
        description="The local Dokploy control plane itself — domain, IP, Traefik wiring and updates."
      />

      {settings.loading || !data ? <Skeleton className="h-64 w-full" /> : (
        <>
          {/* Version / update card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <RefreshCwIcon className="size-4 text-muted-foreground" />
                Version
              </CardTitle>
              <CardDescription>
                getDokployVersion · getReleaseTag · POST getUpdateData
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="secondary" className="text-sm">
                {version.data ?? "?"}
              </Badge>
              <span className="text-muted-foreground">release channel:</span>
              <code>{releaseTag.data ?? "?"}</code>
              {version.error ? <ErrorBanner error={version.error} /> : null}
            </CardContent>
            <CardFooter className="gap-2">
              <Button variant="destructive" onClick={() => setUpdateConfirm1(true)} disabled={updating}>
                {updating ? <Spinner className="size-4" /> : null}
                Check &amp; update server
              </Button>
            </CardFooter>
          </Card>

          {/* Infrastructure health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <ActivityIcon className="size-4 text-muted-foreground" />
                Infrastructure health
              </CardTitle>
              <CardDescription>settings.checkInfrastructureHealth</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" size="sm" onClick={() => void runHealthCheck()} disabled={healthLoading}>
                {healthLoading ? <Spinner className="size-4" /> : null}
                Run check
              </Button>
              {health !== null ? <JsonBlock value={health} /> : null}
            </CardContent>
          </Card>

          {/* Web domain */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <GlobeIcon className="size-4 text-muted-foreground" />
                Web domain
              </CardTitle>
              <CardDescription>
                Currently serving{" "}
                {data.host ? (
                  <code>{String(data.host)}</code>
                ) : (
                  <span>the raw IP ({String(data.serverIp ?? "?")})</span>
                )}{" "}
                · certificate: {String(data.certificateType ?? "none")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {domainForm ? (
                <div className="grid w-full max-w-full min-w-0 max-w-xl gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ws-host">Host *</Label>
                    <Input
                      id="ws-host"
                      value={domainForm.host}
                      placeholder="panel.example.com"
                      onChange={(event) =>
                        setDomainForm({ ...domainForm, host: event.target.value })
                      }
                    />
                    <FieldErrorText>{!domainForm.host.trim() ? "Host is required" : undefined}</FieldErrorText>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ws-cert">Certificate type</Label>
                    <select
                      id="ws-cert"
                      className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                      value={domainForm.certificateType}
                      onChange={(event) =>
                        setDomainForm({
                          ...domainForm,
                          certificateType: event.target.value as DomainForm["certificateType"],
                        })
                      }
                    >
                      <option value="none">none</option>
                      <option value="letsencrypt">letsencrypt</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>
                  {domainForm.certificateType === "letsencrypt" ? (
                    <div className="space-y-2">
                      <Label htmlFor="ws-le-email">Let's Encrypt email</Label>
                      <Input
                        id="ws-le-email"
                        type="email"
                        value={domainForm.letsEncryptEmail}
                        onChange={(event) =>
                          setDomainForm({ ...domainForm, letsEncryptEmail: event.target.value })
                        }
                      />
                    </div>
                  ) : null}
                  <div className="flex min-w-0 items-center justify-between rounded-md border p-3">
                    <Label htmlFor="ws-https">Serve over HTTPS</Label>
                    <Switch
                      id="ws-https"
                      checked={domainForm.https}
                      onCheckedChange={(checked) => setDomainForm({ ...domainForm, https: checked })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => void saveDomain()} disabled={savingDomain}>
                      {savingDomain ? <Spinner className="size-4" /> : <SaveIcon className="size-4" />}
                      Assign domain
                    </Button>
                    <Button variant="outline" onClick={() => setDomainForm(null)} disabled={savingDomain}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={startDomainEdit}>
                  Edit domain…
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Server IP */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <NetworkIcon className="size-4 text-muted-foreground" />
                Server IP
              </CardTitle>
              <CardDescription>
                Public address the dashboard reports: <code>{String(data.serverIp ?? "?")}</code>{" "}
                (settings.updateServerIp)
              </CardDescription>
            </CardHeader>
            <CardContent className="flex max-w-md gap-2">
              <Input
                value={ipValue}
                onChange={(event) => setIpValue(event.target.value)}
                placeholder={String(data.serverIp ?? "203.0.113.10")}
              />
              <Button variant="outline" onClick={() => void saveIp()} disabled={savingIp || !ipValue.trim()}>
                {savingIp ? <Spinner className="size-4" /> : null}
                Update IP
              </Button>
            </CardContent>
          </Card>

          {/* Traefik env */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <ServerCogIcon className="size-4 text-muted-foreground" />
                Traefik environment file
              </CardTitle>
              <CardDescription>
                Raw KEY=VALUE lines read via settings.readTraefikEnv and written back with
                settings.writeTraefikEnv.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {traefikEnv.error ? <ErrorBanner error={traefikEnv.error} /> : null}
              {traefikEnv.loading && envValue === null ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <Textarea
                  rows={6}
                  className="font-mono text-xs"
                  value={envValue ?? traefikEnv.data ?? ""}
                  onChange={(event) => setEnvValue(event.target.value)}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void saveEnv()}
                disabled={savingEnv || envValue === null}
              >
                {savingEnv ? <Spinner className="size-4" /> : <SaveIcon className="size-4" />}
                Write env
              </Button>
            </CardContent>
          </Card>

          {/* Traefik ports */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <NetworkIcon className="size-4 text-muted-foreground" />
                Traefik published ports
              </CardTitle>
              <CardDescription>settings.getTraefikPorts / settings.updateTraefikPorts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {traefikPorts.error ? <ErrorBanner error={traefikPorts.error} /> : null}
              {!traefikPorts.loading && !traefikPorts.error ? (
                (traefikPorts.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No additional ports configured beyond the defaults.
                  </p>
                ) : (
                  <JsonBlock value={traefikPorts.data} />
                )
              ) : null}
              <div className="flex max-w-md items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="ws-ports">Additional ports (comma-separated, TCP)</Label>
                  <Input
                    id="ws-ports"
                    value={portsDraft}
                    onChange={(event) => setPortsDraft(event.target.value)}
                    placeholder="8080,8443"
                  />
                </div>
                <Button variant="outline" onClick={() => void savePorts()} disabled={savingPorts}>
                  {savingPorts ? <Spinner className="size-4" /> : null}
                  Apply
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Web-server database backups */}
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <DatabaseBackupIcon className="size-4 text-muted-foreground" />
                Web-server database backups
              </CardTitle>
              <CardDescription>
                Scheduled backups of Dokploy's own database (user.getBackups); “Back up now” runs{" "}
                <code>backup.manualBackupWebServer</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {backups.error ? <ErrorBanner error={backups.error} /> : null}
              {backups.loading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <SimpleDataTable
                  columns={backupColumns}
                  rows={backupRows}
                  emptyMessage="No scheduled web-server backup configurations exist yet."
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Double confirm for the upstream update */}
      <AlertDialog open={updateConfirm1} onOpenChange={(open) => (open ? null : setUpdateConfirm1(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Step 1 of 2 — really update Dokploy?</AlertDialogTitle>
            <AlertDialogDescription>
              This calls <code>settings.updateServer</code> on the connected server. The panel will be
              unavailable for a short window while containers are replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                setUpdateConfirm1(false)
                setUpdateConfirm2(true)
              }}
            >
              Continue to final confirmation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Final destructive confirmation */}
      <AlertDialog open={updateConfirm2} onOpenChange={(open) => (open ? null : setUpdateConfirm2(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Step 2 — run settings.updateServer now?</AlertDialogTitle>
            <AlertDialogDescription>This replaces the running Dokploy containers.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abort</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void triggerServerUpdate()
              }}
            >
              Update now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
