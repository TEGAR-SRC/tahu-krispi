/* eslint-disable react-refresh/only-export-components */
// Shared engine for the six database service detail pages (postgres / mysql /
// mariadb / mongo / redis / libsql). Mirrors the upstream Dokploy dashboard
// skeleton: general (deploy + credentials), environment, logs, monitoring,
// backups (not redis) and advanced tabs. All calls go through the universal
// proxy `{METHOD} /api/v1/dokploy/{tag.op}` via the helpers in ../shared.ts;
// responses arrive verbatim (no platform envelope). Per-kind differences stay
// declarative in KIND_CONFIGS so each page file is a one-liner.
import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  BanIcon,
  CheckCircle2Icon,
  ClipboardIcon,
  DatabaseBackupIcon,
  EyeIcon,
  EyeOffIcon,
  HardDriveIcon,
  KeyRoundIcon,
  PlayIcon,
  PlusIcon,
  RefreshCcwIcon,
  RocketIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { PageHeader } from "@/components/shared/PageHeader"
import {
  dokploy,
  toErrorMessage,
  useUpstream,
  type UpstreamError,
} from "../shared"

// ---- Kind configuration --------------------------------------------------------

export type DbKind =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongo"
  | "redis"
  | "libsql"

type Row = Record<string, unknown>

/** Live-upstream password rule: rejects $ ! ' " \ / and spaces. */
const DATABASE_PASSWORD_PATTERN =
  /^[a-zA-Z0-9@#%^&*()_+\-=[\]{}|;,.<>?~`]*$/

const PASSWORD_RULE =
  "Allowed: letters, digits and @#%^&*()_+-=[]{}|;,.<>?~` (no spaces)"

interface FieldDef {
  key: string
  label: string
  kind: "text" | "password" | "textarea" | "select" | "switch"
  required?: boolean
  placeholder?: string
  options?: readonly string[]
  hint?: string
  /** Send the key with null even when untouched (nullable-but-required keys). */
  sendNull?: boolean
  /** Prefill for the create dialog. */
  initial?: string
}

interface PortDef {
  key: string
  label: string
  placeholder: string
}

interface KindConfig {
  kind: DbKind
  label: string
  idKey: string
  defaultImage: string
  internalPort: string
  hasChangePassword: boolean
  hasBackups: boolean
  ports: PortDef[]
  createFields: FieldDef[]
  internalUrl: (row: Row) => string
  replicationUrl?: (row: Row) => string
  externalUrl: (row: Row, hostIp: string, ports: Record<string, string>) => string
  /** Extra disabled rows shown between password and connection URLs. */
  extraRows?: (row: Row) => Array<{ label: string; value: string }>
}

function str(value: unknown): string {
  if (value === undefined || value === null) return ""
  return String(value)
}

const DESCRIPTION_FIELD: FieldDef = {
  key: "description",
  label: "Description",
  kind: "textarea",
  placeholder: "Description about your database...",
}

const LIBSQL_IMAGE = "ghcr.io/tursodatabase/libsql-server:v0.24.32"

const IMAGE_FIELD_HINT =
  "Changing the image does not migrate existing data — keep volume mount paths compatible."

function sqlCreateFields(defaultImage: string): FieldDef[] {
  return [
    { key: "name", label: "Name", kind: "text", required: true, placeholder: "My database" },
    { key: "appName", label: "App Name", kind: "text", hint: "Optional — auto-generated with a random suffix when omitted." },
    { key: "databaseName", label: "Database Name", kind: "text", required: true, placeholder: "app_db" },
    { key: "databaseUser", label: "Database User", kind: "text", required: true, placeholder: "app_user" },
    { key: "databasePassword", label: "Database Password", kind: "password", required: true, hint: PASSWORD_RULE },
    {
      key: "databaseRootPassword",
      label: "Database Root Password",
      kind: "password",
      hint: `Optional. ${PASSWORD_RULE}`,
    },
    { key: "dockerImage", label: "Docker Image", kind: "text", placeholder: defaultImage, initial: defaultImage, hint: IMAGE_FIELD_HINT },
    DESCRIPTION_FIELD,
  ]
}

export const KIND_CONFIGS: Record<DbKind, KindConfig> = {
  postgres: {
    kind: "postgres",
    label: "PostgreSQL",
    idKey: "postgresId",
    defaultImage: "postgres:18",
    internalPort: "5432",
    hasChangePassword: true,
    hasBackups: true,
    ports: [{ key: "externalPort", label: "External Port (Internet)", placeholder: "5432" }],
    createFields: sqlCreateFields("postgres:18").filter((f) => f.key !== "databaseRootPassword"),
    internalUrl: (r) =>
      `postgresql://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.postgres.internalPort}/${str(r.databaseName)}`,
    externalUrl: (r, ip, ports) =>
      `postgresql://${str(r.databaseUser)}:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}/${str(r.databaseName)}`,
  },
  mysql: {
    kind: "mysql",
    label: "MySQL",
    idKey: "mysqlId",
    defaultImage: "mysql:8",
    internalPort: "3306",
    hasChangePassword: true,
    hasBackups: true,
    ports: [{ key: "externalPort", label: "External Port (Internet)", placeholder: "3306" }],
    createFields: sqlCreateFields("mysql:8"),
    internalUrl: (r) =>
      `mysql://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.mysql.internalPort}/${str(r.databaseName)}`,
    externalUrl: (r, ip, ports) =>
      `mysql://${str(r.databaseUser)}:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}/${str(r.databaseName)}`,
  },
  mariadb: {
    kind: "mariadb",
    label: "MariaDB",
    idKey: "mariadbId",
    defaultImage: "mariadb:6",
    internalPort: "3306",
    hasChangePassword: true,
    hasBackups: true,
    ports: [{ key: "externalPort", label: "External Port (Internet)", placeholder: "3306" }],
    createFields: sqlCreateFields("mariadb:6"),
    internalUrl: (r) =>
      `mariadb://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.mariadb.internalPort}/${str(r.databaseName)}`,
    externalUrl: (r, ip, ports) =>
      `mariadb://${str(r.databaseUser)}:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}/${str(r.databaseName)}`,
  },
  mongo: {
    kind: "mongo",
    label: "MongoDB",
    idKey: "mongoId",
    defaultImage: "mongo:15",
    internalPort: "27017",
    hasChangePassword: true,
    hasBackups: true,
    ports: [{ key: "externalPort", label: "External Port (Internet)", placeholder: "27017" }],
    createFields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "My database" },
      { key: "appName", label: "App Name", kind: "text", hint: "Optional — auto-generated with a random suffix when omitted." },
      { key: "databaseUser", label: "Database User", kind: "text", required: true, placeholder: "app_user" },
      { key: "databasePassword", label: "Database Password", kind: "password", required: true, hint: PASSWORD_RULE },
      {
        key: "replicaSets",
        label: "Replica Sets",
        kind: "switch",
        hint: "Enable MongoDB replica sets (single-node).",
      },
      { key: "dockerImage", label: "Docker Image", kind: "text", placeholder: "mongo:15", initial: "mongo:15", hint: IMAGE_FIELD_HINT },
      DESCRIPTION_FIELD,
    ],
    internalUrl: (r) => {
      const params = str(r.replicaSets) === "true" || r.replicaSets === true
        ? "authSource=admin"
        : "authSource=admin&directConnection=true"
      return `mongodb://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.mongo.internalPort}/?${params}`
    },
    externalUrl: (r, ip, ports) => {
      const params = str(r.replicaSets) === "true" || r.replicaSets === true
        ? "authSource=admin"
        : "authSource=admin&directConnection=true"
      return `mongodb://${str(r.databaseUser)}:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}/?${params}`
    },
  },
  redis: {
    kind: "redis",
    label: "Redis",
    idKey: "redisId",
    defaultImage: "redis:8",
    internalPort: "6379",
    hasChangePassword: true,
    hasBackups: false,
    ports: [{ key: "externalPort", label: "External Port (Internet)", placeholder: "6379" }],
    createFields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "My cache" },
      { key: "appName", label: "App Name", kind: "text", hint: "Optional — auto-generated with a random suffix when omitted." },
      { key: "databasePassword", label: "Database Password", kind: "password", required: true, hint: PASSWORD_RULE },
      { key: "dockerImage", label: "Docker Image", kind: "text", placeholder: "redis:8", initial: "redis:8", hint: IMAGE_FIELD_HINT },
      DESCRIPTION_FIELD,
    ],
    internalUrl: (r) =>
      `redis://default:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.redis.internalPort}`,
    externalUrl: (r, ip, ports) =>
      `redis://default:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}`,
  },
  libsql: {
    kind: "libsql",
    label: "LibSQL",
    idKey: "libsqlId",
    defaultImage: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
    internalPort: "8080",
    hasChangePassword: false,
    hasBackups: true,
    ports: [
      { key: "externalPort", label: "External Port (HTTP)", placeholder: "8080" },
      { key: "externalGRPCPort", label: "External GRPC Port", placeholder: "5001" },
      { key: "externalAdminPort", label: "External Admin Port", placeholder: "5000" },
    ],
    // libsql.create requires every key (several nullable), so sendNull marks them.
    createFields: [
      { key: "name", label: "Name", kind: "text", required: true, placeholder: "My database" },
      { key: "appName", label: "App Name", kind: "text", required: true, placeholder: "my-libsql" },
      { key: "databaseUser", label: "Database User", kind: "text", required: true, placeholder: "app_user" },
      { key: "databasePassword", label: "Database Password", kind: "password", required: true, hint: PASSWORD_RULE },
      { key: "sqldNode", label: "Sqld Node", kind: "select", required: true, options: ["primary", "replica"], initial: "primary" },
      { key: "sqldPrimaryUrl", label: "Sqld Primary URL", kind: "text", sendNull: true, hint: "Required for replica nodes; sent as null when empty." },
      { key: "enableNamespaces", label: "Enable Namespaces", kind: "switch", initial: "false" },
      { key: "dockerImage", label: "Docker Image", kind: "text", required: true, placeholder: LIBSQL_IMAGE, initial: LIBSQL_IMAGE, hint: IMAGE_FIELD_HINT },
      { ...DESCRIPTION_FIELD, required: true, sendNull: true },
      { key: "serverId", label: "Server ID", kind: "text", sendNull: true, hint: "Optional remote server; sent as null when empty." },
    ],
    internalUrl: (r) =>
      `http://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:${KIND_CONFIGS.libsql.internalPort}`,
    replicationUrl: (r) =>
      `http://${str(r.databaseUser)}:${str(r.databasePassword)}@${str(r.appName)}:5001`,
    externalUrl: (r, ip, ports) =>
      `http://${str(r.databaseUser)}:${str(r.databasePassword)}@${ip}:${ports.externalPort || str(r.externalPort)}`,
    extraRows: (r) => [
      { label: "Sqld Node", value: str(r.sqldNode) || "—" },
      { label: "Enable Namespaces", value: r.enableNamespaces === true ? "true" : "false" },
      { label: "Internal GRPC Port (Container)", value: "5001" },
      { label: "Internal Admin Port (Container)", value: "5000" },
    ],
  },
}

/** Manual-run op name per kind (backup.manualBackup{Suffix}). */
const MANUAL_BACKUP_OP: Partial<Record<DbKind, string>> = {
  postgres: "backup.manualBackupPostgres",
  mysql: "backup.manualBackupMySql",
  mariadb: "backup.manualBackupMariadb",
  mongo: "backup.manualBackupMongo",
  libsql: "backup.manualBackupLibsql",
}

// ---- Small utilities -------------------------------------------------------------

type FieldErrors = Record<string, string>

/**
 * Maps a relayed upstream zod error onto `{ field: message }`. The proxy
 * forwards the tRPC error verbatim: `{ message, code, data: { zodError } }`,
 * while some paths nest zodError at the top level.
 */
function extractFieldErrors(error: UpstreamError): FieldErrors {
  const out: FieldErrors = {}
  let parsed: unknown
  try {
    parsed = typeof error.body === "string" ? JSON.parse(error.body) : error.body
  } catch {
    return out
  }
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  const data = root["data"] && typeof root["data"] === "object" ? (root["data"] as Record<string, unknown>) : root
  const zod = data["zodError"] && typeof data["zodError"] === "object" ? (data["zodError"] as Record<string, unknown>) : undefined
  const nested = zod?.["fieldErrors"]
  if (nested && typeof nested === "object") {
    for (const [key, messages] of Object.entries(nested as Record<string, unknown>)) {
      if (Array.isArray(messages) && messages.length > 0) {
        out[key] = messages.map(String).join("; ")
      }
    }
  }
  return out
}

async function runMutation(
  fn: () => Promise<unknown>,
  successMessage: string,
): Promise<boolean> {
  try {
    await fn()
    toast.success(successMessage)
    return true
  } catch (cause) {
    toast.error(toErrorMessage(cause))
    return false
  }
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "running" || status === "done"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "error"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground"
  return (
    <Badge variant="secondary" className={tone}>
      {status || "idle"}
    </Badge>
  )
}

/** Disabled single-value field with a copy affordance. */
function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input readOnly value={value} className={mono ? "font-mono text-xs" : undefined} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Copy ${label}`}
          disabled={!value}
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          }}
        >
          <ClipboardIcon />
        </Button>
      </div>
      {copied ? <p className="text-xs text-muted-foreground">Copied.</p> : null}
    </div>
  )
}

/** Secret value hidden behind an eye toggle (mirrors ToggleVisibilityInput). */
function SecretRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input readOnly value={visible ? value : "•".repeat(Math.min(value.length || 8, 24))} className="font-mono text-xs" />
        <Button
          variant="ghost"
          size="icon"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        {action}
      </div>
    </div>
  )
}

/** Upstream errors are plain objects (not Error instances) — render verbatim. */
function UpstreamBanner({ error }: { error: UpstreamError }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{toErrorMessage(error)}</AlertTitle>
      {error.body ? (
        <AlertDescription>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(error.body ?? ""), null, 2)
              } catch {
                return error.body
              }
            })()}
          </pre>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}

function JsonViewer({ payload }: { payload: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(payload, null, 2)
    } catch {
      return String(payload)
    }
  }, [payload])
  return (
    <pre className="max-h-105 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
      {text}
    </pre>
  )
}

// ---- Header dialogs ----------------------------------------------------------------

function UpdateServiceDialog({
  config,
  row,
  onDone,
}: {
  config: KindConfig
  row: Row
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(str(row.name))
  const [description, setDescription] = useState(str(row.description))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setName(str(row.name))
      setDescription(str(row.description))
      setError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, row])

  const submit = async () => {
    if (!name.trim()) {
      setError("Name is required.")
      return
    }
    setBusy(true)
    const ok = await runMutation(
      () =>
        dokploy("POST", `${config.kind}.update`, {
          [config.idKey]: str(row[config.idKey]),
          name: name.trim(),
          description: description || null,
        }),
      `${config.label} updated successfully`,
    )
    setBusy(false)
    if (ok) {
      setOpen(false)
      onDone()
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Modify
      </Button>
      <Dialog open={open} onOpenChange={(o) => (!o ? setOpen(false) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modify {config.label}</DialogTitle>
            <DialogDescription>Update the {config.kind} name and description.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="k4-update-name">
                Name<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="k4-update-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k4-update-description">Description</Label>
              <Textarea
                id="k4-update-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeleteServiceDialog({
  config,
  row,
}: {
  config: KindConfig
  row: Row
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const expected = `${str(row.name)}/${str(row.appName)}`
  const running = str(row.applicationStatus) === "running"

  const submit = async () => {
    if (confirmation !== expected) return
    setBusy(true)
    try {
      await dokploy("POST", `${config.kind}.remove`, {
        [config.idKey]: str(row[config.idKey]),
      })
      toast.success("Service deleted successfully")
      setOpen(false)
      navigate(`/admin/dokploy/app/p/${str((row.environment as Row | undefined)?.projectId)}/e/${str(row.environmentId)}`)
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon /> Delete
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setConfirmation("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the service. If you are
              sure please enter{" "}
              <span className="font-mono font-semibold text-foreground">{expected}</span> to delete
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={`Type ${expected} to confirm`}
            autoComplete="off"
          />
          {running ? (
            <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <TriangleAlertIcon /> Cannot delete the service while it is running.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || confirmation !== expected || running}
              onClick={(event) => {
                event.preventDefault()
                void submit()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---- General tab ---------------------------------------------------------------------

function DeploySettingsCard({
  config,
  row,
  reload,
}: {
  config: KindConfig
  row: Row
  reload: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ action: string; title: string; description: string } | null>(null)
  const id = str(row[config.idKey])
  const appName = str(row.appName)
  const idle = str(row.applicationStatus) === "idle"

  const runAction = async (action: string, body: Row, successMessage: string) => {
    setBusy(action)
    await runMutation(() => dokploy("POST", `${config.kind}.${action}`, body), successMessage)
    setBusy(null)
    setConfirming(null)
    reload()
  }

  const confirmSpecs: Record<string, { title: string; description: string }> = {
    deploy: { title: `Deploy ${config.label}`, description: "Downloads and sets up the database service." },
    reload: { title: `Reload ${config.label}`, description: "Restarts the service without rebuilding it." },
    rebuild: { title: `Rebuild ${config.label}`, description: "Stops the service, deletes existing data and volumes, then starts from a clean state." },
    start: { title: `Start ${config.label}`, description: "Starts the database (requires a previous successful setup)." },
    stop: { title: `Stop ${config.label}`, description: "Stops the currently running database service." },
  }

  const buttons: Array<{
    action: string
    label: string
    icon: ReactNode
    variant: "default" | "secondary" | "destructive"
    body: Row
  }> = [
    { action: "deploy", label: "Deploy", icon: <RocketIcon />, variant: "default", body: { [config.idKey]: id } },
    { action: "reload", label: "Reload", icon: <RefreshCcwIcon />, variant: "secondary", body: { [config.idKey]: id, appName } },
    { action: "rebuild", label: "Rebuild", icon: <TriangleAlertIcon />, variant: "destructive", body: { [config.idKey]: id } },
  ]
  if (idle) {
    buttons.push({ action: "start", label: "Start", icon: <CheckCircle2Icon />, variant: "secondary", body: { [config.idKey]: id } })
  } else {
    buttons.push({ action: "stop", label: "Stop", icon: <BanIcon />, variant: "destructive", body: { [config.idKey]: id } })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Deploy Settings</CardTitle>
          <CardDescription>
            Deployments stream their logs into the Logs tab — the upstream live log drawer is not
            available through the proxy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-row flex-wrap gap-3">
          {buttons.map(({ action, label, icon, variant }) => (
            <Button
              key={action}
              variant={variant}
              disabled={busy !== null}
              onClick={() => setConfirming({ action, ...confirmSpecs[action] })}
            >
              {icon} {busy === action ? `${label}…` : label}
            </Button>
          ))}
        </CardContent>
      </Card>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.description} Are you sure?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault()
                if (confirming) {
                  void runAction(confirming.action, buttons.find((b) => b.action === confirming.action)?.body ?? {}, `${config.label} ${confirming.action} request sent`)
                }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ChangePasswordDialog({
  config,
  row,
  onChanged,
}: {
  config: KindConfig
  row: Row
  onChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!password) {
      setError("New password is required.")
      return
    }
    if (!DATABASE_PASSWORD_PATTERN.test(password)) {
      setError(`Invalid characters in password. ${PASSWORD_RULE}`)
      return
    }
    setBusy(true)
    const ok = await runMutation(
      () =>
        dokploy("POST", `${config.kind}.changePassword`, {
          [config.idKey]: str(row[config.idKey]),
          password,
        }),
      "Password updated successfully",
    )
    setBusy(false)
    if (ok) {
      setOpen(false)
      setPassword("")
      onChanged?.()
    }
  }

  return (
    <>
      <Button variant="outline" size="icon" aria-label="Change password" onClick={() => setOpen(true)}>
        <KeyRoundIcon />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change database password</DialogTitle>
            <DialogDescription>
              Runs <span className="font-mono text-xs">{config.kind}.changePassword</span>; the
              container applies it immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="k4-new-password">
              New password<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="k4-new-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
            />
            {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Applying…" : "Change password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InternalCredentialsCard({
  config,
  row,
  reload,
}: {
  config: KindConfig
  row: Row
  reload: () => void
}) {
  const rows: ReactNode[] = [
    <CopyRow key="user" label="User" value={config.kind === "redis" ? "default" : str(row.databaseUser)} />,
  ]
  if (config.kind !== "redis") {
    rows.push(<CopyRow key="db" label="Database Name" value={str(row.databaseName)} mono />)
  }
  rows.push(
    <SecretRow
      key="password"
      label="Password"
      value={str(row.databasePassword)}
      action={
        config.hasChangePassword ? (
          <ChangePasswordDialog config={config} row={row} onChanged={reload} />
        ) : undefined
      }
    />,
  )
  rows.push(<CopyRow key="port" label="Internal Port (Container)" value={config.internalPort} />)
  rows.push(<CopyRow key="host" label="Internal Host" value={str(row.appName)} mono />)
  for (const extra of config.extraRows?.(row) ?? []) {
    rows.push(<CopyRow key={extra.label} label={extra.label} value={extra.value} />)
  }
  rows.push(
    <div key="url" className="flex flex-col gap-2 md:col-span-2">
      <CopyRow label="Internal Connection URL" value={config.internalUrl(row)} mono />
    </div>,
  )
  if (config.replicationUrl) {
    rows.push(
      <div key="replication-url" className="flex flex-col gap-2 md:col-span-2">
        <CopyRow label="Internal Replication Connection URL" value={config.replicationUrl(row)} mono />
      </div>,
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Internal Credentials</CardTitle>
        <CardDescription>
          Reachable inside the Dokploy network via the app name as host.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid w-full gap-4 md:grid-cols-2">{rows}</div>
      </CardContent>
    </Card>
  )
}

function ExternalCredentialsCard({
  config,
  row,
  reload,
}: {
  config: KindConfig
  row: Row
  reload: () => void
}) {
  const op = config.kind === "libsql" ? "saveExternalPorts" : "saveExternalPort"
  const [ports, setPorts] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.ports.map((port) => [port.key, str(row[port.key])])),
  )
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    const t = setTimeout(() => {
      setPorts(Object.fromEntries(config.ports.map((port) => [port.key, str(row[port.key])])))
    }, 0)
    return () => clearTimeout(t)
  }, [config, row])

  const anyPortSet = Object.values(ports).some((value) => value.trim() !== "")
  const hostIp = str((row.server as Row | undefined)?.ipAddress) || "your-server-ip"
  const body: Row = { [config.idKey]: str(row[config.idKey]) }
  for (const port of config.ports) {
    const raw = ports[port.key].trim()
    body[port.key] = raw === "" ? null : Number(raw)
  }

  const save = async () => {
    const nextErrors: FieldErrors = {}
    for (const port of config.ports) {
      const raw = ports[port.key].trim()
      if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 65535)) {
        nextErrors[port.key] = "Range must be 0 - 65535."
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setBusy(true)
    try {
      await dokploy("POST", `${config.kind}.${op}`, body)
      toast.success("External port updated")
      reload()
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">External Credentials</CardTitle>
        <CardDescription>
          In order to make the database reachable through the internet, you must set a port and
          ensure that the port is not being used by another application or database.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {config.ports.map((port) => (
            <div key={port.key} className="grid gap-2">
              <Label htmlFor={`k4-${port.key}`}>{port.label}</Label>
              <Input
                id={`k4-${port.key}`}
                inputMode="numeric"
                placeholder={port.placeholder}
                value={ports[port.key] ?? ""}
                onChange={(e) => setPorts((prev) => ({ ...prev, [port.key]: e.target.value }))}
                aria-invalid={errors[port.key] ? true : undefined}
              />
              {errors[port.key] ? (
                <p className="text-xs font-medium text-destructive">{errors[port.key]}</p>
              ) : null}
            </div>
          ))}
        </div>
        {anyPortSet ? (
          <div className="grid gap-2">
            <Label className="text-muted-foreground">External Host</Label>
            <Input readOnly value={config.externalUrl(row, hostIp, ports)} className="font-mono text-xs" />
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function GeneralTab({
  config,
  row,
  reload,
}: {
  config: KindConfig
  row: Row
  reload: () => void
}) {
  const [status, setStatus] = useState(str(row.applicationStatus) || "idle")
  useEffect(() => {
    const t = setTimeout(() => setStatus(str(row.applicationStatus) || "idle"), 0)
    return () => clearTimeout(t)
  }, [row])

  return (
    <div className="flex flex-col gap-4">
      <DeploySettingsCard config={config} row={row} reload={reload} />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Service Status</CardTitle>
          <CardDescription>
            Manually override the lifecycle status stored upstream (mirrors the status tooltip on
            the service title).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select
            value={status}
            onValueChange={(value) => {
              void runMutation(
                () =>
                  dokploy("POST", `${config.kind}.changeStatus`, {
                    [config.idKey]: str(row[config.idKey]),
                    applicationStatus: value,
                  }),
                "Application status updated",
              ).then(reload).catch(() => {})
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Set status" />
            </SelectTrigger>
            <SelectContent>
              {["idle", "running", "done", "error"].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <StatusBadge status={str(row.applicationStatus)} />
        </CardContent>
      </Card>
      <InternalCredentialsCard config={config} row={row} reload={reload} />
      <ExternalCredentialsCard config={config} row={row} reload={reload} />
    </div>
  )
}

// ---- Environment tab -------------------------------------------------------------------

function EnvironmentTab({ config, row, reload }: { config: KindConfig; row: Row; reload: () => void }) {
  const original = str(row.env)
  const [env, setEnv] = useState(original)
  useEffect(() => {
    const t = setTimeout(() => setEnv(str(row.env)), 0)
    return () => clearTimeout(t)
  }, [row])
  const [busy, setBusy] = useState(false)
  const dirty = env !== original

  const save = async () => {
    setBusy(true)
    const ok = await runMutation(
      () =>
        dokploy("POST", `${config.kind}.saveEnvironment`, {
          [config.idKey]: str(row[config.idKey]),
          env,
        }),
      "Environment saved successfully",
    )
    setBusy(false)
    if (ok) reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Environment</CardTitle>
        <CardDescription>
          Service-level variables merged over the project and environment ones by Dokploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          aria-label="Environment variables"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          placeholder="KEY=value"
          className="min-h-64 font-mono text-xs"
        />
        <div className="flex items-center justify-end gap-3">
          {!dirty ? <p className="text-xs text-muted-foreground">No changes</p> : null}
          <Button onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---- Logs tab ------------------------------------------------------------------------------

interface ContainerRow {
  containerId: string
  name: string
  state: string
  status: string
}

function LogsTab({ config, row }: { config: KindConfig; row: Row }) {
  const appName = str(row.appName)
  const containers = useUpstream<ContainerRow[]>(
    () => dokploy<ContainerRow[]>("GET", "docker.getContainersByAppNameMatch", undefined, { appName }),
    [appName],
  )
  const [containerId, setContainerId] = useState("")
  const [tail, setTail] = useState("100")
  const [search, setSearch] = useState("")
  const [logs, setLogs] = useState<string | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<UpstreamError | null>(null)
  const requestedRef = useRef(false)

  useEffect(() => {
    if (requestedRef.current || !containers.data) return
    requestedRef.current = true
    if (containers.data.length > 0) {
      const firstId = containers.data[0].containerId
      const t = setTimeout(() => setContainerId(firstId), 0)
      return () => clearTimeout(t)
    }
  }, [containers.data])

  const fetchLogs = async () => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const result = await dokploy<unknown>("GET", `${config.kind}.readLogs`, undefined, {
        [config.idKey]: str(row[config.idKey]),
        tail: tail || "100",
        ...(search ? { search } : {}),
      })
      // Upstream returns either a plain string or a JSON-encoded string.
      setLogs(typeof result === "string" ? result : JSON.stringify(result, null, 2))
    } catch (cause) {
      setLogsError(cause as UpstreamError)
    } finally {
      setLogsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Logs</CardTitle>
        <CardDescription>Container logs streamed from the Dokploy server.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {containers.loading ? (
          <Skeleton className="h-10 w-full" />
        ) : containers.error ? (
          <ErrorBanner error={containers.error} />
        ) : (containers.data?.length ?? 0) === 0 ? (
          <EmptyState
            message="No containers found for this service"
            description="Deploy the database first — logs become available once its container runs."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid w-full max-w-sm gap-2">
                <Label htmlFor="k4-log-container">Container</Label>
                <Select value={containerId} onValueChange={setContainerId}>
                  <SelectTrigger id="k4-log-container">
                    <SelectValue placeholder="Pick a container" />
                  </SelectTrigger>
                  <SelectContent>
                    {(containers.data ?? []).map((container) => (
                      <SelectItem key={container.containerId} value={container.containerId}>
                        <span className="font-mono text-xs">
                          {container.name} · {container.state}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid w-28 gap-2">
                <Label htmlFor="k4-log-tail">Tail lines</Label>
                <Input
                  id="k4-log-tail"
                  inputMode="numeric"
                  value={tail}
                  onChange={(e) => setTail(e.target.value)}
                />
              </div>
              <div className="grid w-56 gap-2">
                <Label htmlFor="k4-log-search">Search</Label>
                <Input
                  id="k4-log-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter log lines"
                />
              </div>
              <Button onClick={() => void fetchLogs()} disabled={logsLoading}>
                {logsLoading ? "Fetching…" : "Fetch logs"}
              </Button>
            </div>
            {logsError ? <UpstreamBanner error={logsError} /> : null}
            {logs !== null ? (
              <pre className="max-h-120 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                {logs || "(empty log output)"}
              </pre>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---- Monitoring tab ---------------------------------------------------------------------------

interface MetricPoint {
  value?: unknown
  time?: string
}

interface AppMonitoring {
  cpu?: MetricPoint[]
  memory?: Array<{ value?: { used?: number; total?: number }; time?: string }>
  block?: Array<{ value?: { readMb?: number; writeMb?: number }; time?: string }>
  network?: Array<{ value?: { inputMb?: number; outputMb?: number }; time?: string }>
  disk?: Array<{ value?: { diskTotal?: number; diskUsage?: number; diskUsedPercentage?: number; diskFree?: number }; time?: string }>
}

function last<T>(points: T[] | undefined): T | undefined {
  if (!Array.isArray(points) || points.length === 0) return undefined
  return points[points.length - 1]
}

function formatBytesNumber(value: number | undefined, unit: string): string {
  if (value === undefined || Number.isNaN(value)) return "—"
  return `${value.toFixed(2)}${unit}`
}

function MonitoringTab({ row }: { row: Row }) {
  const appName = str(row.appName)
  const monitoring = useUpstream<AppMonitoring>(
    () => dokploy<AppMonitoring>("GET", "application.readAppMonitoring", undefined, { appName }),
    [appName],
  )

  if (monitoring.loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    )
  }
  if (monitoring.error) return <ErrorBanner error={monitoring.error} />

  const data = monitoring.data ?? {}
  const cpu = last(data.cpu)?.value
  const memory = last(data.memory)?.value
  const block = last(data.block)?.value
  const network = last(data.network)?.value
  const disk = last(data.disk)?.value
  const isEmpty =
    !Array.isArray(data.cpu) ||
    (data.cpu.length === 0 &&
      (data.memory?.length ?? 0) === 0 &&
      (data.block?.length ?? 0) === 0 &&
      (data.network?.length ?? 0) === 0)

  return (
    <div className="flex flex-col gap-4">
      {isEmpty ? (
        <EmptyState
          message="No metrics reported yet"
          description={`The Dokploy collector has not recorded any samples for ${appName || "this container"} yet. Metrics appear once the container runs.`}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">CPU</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-2xl">{typeof cpu === "string" ? cpu : "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">last sample · {last(data.cpu)?.time || "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Memory</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-2xl">
                {formatBytesNumber(memory?.used, "MB")} / {formatBytesNumber(memory?.total, "MB")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">used / total · {last(data.memory)?.time || "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Block I/O</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-2xl">
                ↓ {formatBytesNumber(block?.readMb, "MB")} ↑ {formatBytesNumber(block?.writeMb, "MB")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">read / write · {last(data.block)?.time || "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Network</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-2xl">
                ↓ {formatBytesNumber(network?.inputMb, "MB")} ↑ {formatBytesNumber(network?.outputMb, "MB")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">input / output · {last(data.network)?.time || "—"}</p>
            </CardContent>
          </Card>
          {disk ? (
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Disk</CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-sm">
                total {formatBytesNumber(disk.diskTotal, "MB")} · used {formatBytesNumber(disk.diskUsage, "MB")} · free{" "}
                {formatBytesNumber(disk.diskFree, "MB")} · {disk.diskUsedPercentage ?? "—"}% used
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
      <JsonViewer payload={data} />
    </div>
  )
}

// ---- Backups tab ---------------------------------------------------------------------------------

interface BackupRow {
  backupId: string
  schedule: string
  prefix: string
  database: string
  enabled: boolean
  keepLatestCount: number | null
  destinationId: string
  destination?: { name?: string }
  databaseType?: string
}

interface DestinationRow {
  destinationId: string
  name: string
  provider?: string
}

function BackupFormDialog({
  config,
  row,
  backup,
  destinations,
  onClose,
  onSaved,
}: {
  config: KindConfig
  row: Row
  backup: BackupRow | null
  destinations: DestinationRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const defaultDatabase =
    config.kind === "libsql" ? str(row.databaseName) || "iku.db" : str(row.databaseName)
  const [schedule, setSchedule] = useState(backup?.schedule ?? "")
  const [prefix, setPrefix] = useState(backup?.prefix ?? "/")
  const [destinationId, setDestinationId] = useState(backup?.destinationId ?? "")
  const [database, setDatabase] = useState(backup?.database ?? defaultDatabase)
  const [enabled, setEnabled] = useState(backup?.enabled ?? true)
  const [keepLatestCount, setKeepLatestCount] = useState(
    backup?.keepLatestCount != null ? String(backup.keepLatestCount) : "",
  )
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  const validate = (): boolean => {
    const next: FieldErrors = {}
    if (!schedule.trim()) next.schedule = "Schedule (Cron) required."
    if (!prefix.trim()) next.prefix = "Prefix required."
    if (!destinationId) next.destinationId = "Destination required."
    if (!database.trim()) next.database = "Database required."
    if (keepLatestCount.trim() !== "" && !Number.isFinite(Number(keepLatestCount))) {
      next.keepLatestCount = "Keep latest count must be a number."
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      if (backup) {
        await dokploy("POST", "backup.update", {
          backupId: backup.backupId,
          schedule: schedule.trim(),
          prefix: prefix.trim(),
          destinationId,
          database: database.trim(),
          enabled,
          keepLatestCount: keepLatestCount.trim() === "" ? null : Number(keepLatestCount),
          serviceName: null,
          metadata: null,
          databaseType: config.kind,
          includeEncryptionKey: false,
        })
      } else {
        await dokploy("POST", "backup.create", {
          schedule: schedule.trim(),
          prefix: prefix.trim(),
          destinationId,
          database: database.trim(),
          enabled,
          keepLatestCount: keepLatestCount.trim() === "" ? null : Number(keepLatestCount),
          databaseType: config.kind,
          backupType: "database",
          userId: null,
          serviceName: null,
          composeId: null,
          includeEncryptionKey: false,
          metadata: null,
          [config.idKey]: str(row[config.idKey]),
        })
      }
      toast.success(backup ? "Backup updated successfully" : "Backup created successfully")
      onSaved()
      onClose()
    } catch (cause) {
      const upstream = cause as UpstreamError
      const fieldErrors = extractFieldErrors(upstream)
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors)
        toast.error("Upstream rejected the backup form — fix the highlighted fields.")
      } else {
        toast.error(toErrorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{backup ? "Update Backup" : "Add Backup"}</DialogTitle>
          <DialogDescription>
            Scheduled dumps of <span className="font-mono text-xs">{database || "the database"}</span>{" "}
            pushed to an S3 destination.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="k4-bk-dest">
              Destination<span className="text-destructive"> *</span>
            </Label>
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger id="k4-bk-dest" aria-invalid={errors.destinationId ? true : undefined}>
                <SelectValue placeholder="Pick an S3 destination" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((destination) => (
                  <SelectItem key={destination.destinationId} value={destination.destinationId}>
                    {destination.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.destinationId ? (
              <p className="text-xs font-medium text-destructive">{errors.destinationId}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="k4-bk-schedule">
              Schedule (Cron)<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="k4-bk-schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 0 * * *"
              aria-invalid={errors.schedule ? true : undefined}
            />
            {errors.schedule ? (
              <p className="text-xs font-medium text-destructive">{errors.schedule}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="k4-bk-prefix">
              Prefix<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="k4-bk-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="/"
              aria-invalid={errors.prefix ? true : undefined}
            />
            {errors.prefix ? (
              <p className="text-xs font-medium text-destructive">{errors.prefix}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="k4-bk-db">
              Database<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="k4-bk-db"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              aria-invalid={errors.database ? true : undefined}
            />
            {errors.database ? (
              <p className="text-xs font-medium text-destructive">{errors.database}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="k4-bk-keep">Keep Latest Count</Label>
            <Input
              id="k4-bk-keep"
              inputMode="numeric"
              value={keepLatestCount}
              onChange={(e) => setKeepLatestCount(e.target.value)}
              placeholder="All"
              aria-invalid={errors.keepLatestCount ? true : undefined}
            />
            {errors.keepLatestCount ? (
              <p className="text-xs font-medium text-destructive">{errors.keepLatestCount}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="k4-bk-enabled" className="font-normal">
              Enabled
            </Label>
            <Switch id="k4-bk-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : backup ? "Save changes" : "Create backup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface BackupFileRow {
  fileName?: string
  path?: string
  size?: number
  lastModified?: string
  [key: string]: unknown
}

function BackupFilesSheet({
  backup,
  onClose,
}: {
  backup: BackupRow
  onClose: () => void
}) {
  const [search, setSearch] = useState(backup.prefix || "/")
  const files = useUpstream<BackupFileRow[]>(
    () =>
      dokploy<BackupFileRow[]>("GET", "backup.listBackupFiles", undefined, {
        destinationId: backup.destinationId,
        search,
      }),
    [backup.destinationId, search],
  )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Backup files</DialogTitle>
          <DialogDescription>
            Objects under <span className="font-mono text-xs">{search}</span> in the backup&apos;s S3
            destination.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="k4-files-search">Search prefix</Label>
          <Input id="k4-files-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {files.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : files.error ? (
          <ErrorBanner error={files.error} />
        ) : (files.data?.length ?? 0) === 0 ? (
          <EmptyState message="No backup files found" description="Adjust the search prefix once backups have run." />
        ) : (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(files.data, null, 2)}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BackupsTab({
  config,
  row,
  reload,
}: {
  config: KindConfig
  row: Row
  reload: () => void
}) {
  const destinations = useUpstream<DestinationRow[]>(() => dokploy<DestinationRow[]>("GET", "destination.all"), [])
  const backups = Array.isArray(row.backups) ? (row.backups as BackupRow[]) : []
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BackupRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BackupRow | null>(null)
  const [runTarget, setRunTarget] = useState<BackupRow | null>(null)
  const [filesTarget, setFilesTarget] = useState<BackupRow | null>(null)
  const [busy, setBusy] = useState(false)

  if (destinations.error) return <ErrorBanner error={destinations.error} />

  if ((destinations.data?.length ?? 0) === 0 && !destinations.loading) {
    return (
      <Card>
        <CardContent className="py-10">
          <EmptyState
            message="To create a backup it is required to set at least 1 provider"
            description="Configure an S3 destination first (Settings › Destinations in the upstream dashboard)."
          />
        </CardContent>
      </Card>
    )
  }

  const remove = async () => {
    if (!removeTarget) return
    setBusy(true)
    const ok = await runMutation(
      () => dokploy("POST", "backup.remove", { backupId: removeTarget.backupId }),
      "Backup deleted successfully",
    )
    setBusy(false)
    setRemoveTarget(null)
    if (ok) reload()
  }

  const runManual = async () => {
    if (!runTarget) return
    setBusy(true)
    const ok = await runMutation(
      () => dokploy("POST", MANUAL_BACKUP_OP[config.kind] ?? "", { backupId: runTarget.backupId }),
      "Manual Backup Successful",
    )
    setBusy(false)
    setRunTarget(null)
    if (ok) reload()
  }

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-xl">
            <DatabaseBackupIcon className="size-5 text-muted-foreground" /> Backups
          </CardTitle>
          <CardDescription>Add backups to your database to save the data to a different provider.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <PlusIcon /> Create Backup
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {backups.length === 0 ? (
          <EmptyState
            message="No backups configured"
            description="Create one to schedule recurring dumps to your S3 destination."
          />
        ) : (
          backups.map((backup) => (
            <div
              key={backup.backupId}
              className="flex flex-col justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50 md:flex-row"
            >
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Destination</p>
                  <p className="mt-0.5 text-sm font-medium">{backup.destination?.name || backup.destinationId}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Database</p>
                  <p className="mt-0.5 font-mono text-sm font-medium">{backup.database}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Schedule</p>
                  <p className="mt-0.5 font-mono text-sm font-medium">{backup.schedule}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Prefix Storage</p>
                  <p className="mt-0.5 font-mono text-sm font-medium">{backup.prefix}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Keep Latest</p>
                  <p className="mt-0.5 text-sm font-medium">{backup.keepLatestCount || "All"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <p className="mt-0.5 flex items-center gap-2 text-sm font-medium">
                    <span
                      className={`inline-block size-1.5 rounded-full ${backup.enabled ? "bg-green-500" : "bg-red-500"}`}
                    />
                    {backup.enabled ? "Active" : "Inactive"}
                  </p>
                </div>
              </div>
              <div className="flex flex-row gap-1.5 md:flex-col">
                <Button variant="ghost" size="icon" aria-label="Browse backup files" onClick={() => setFilesTarget(backup)}>
                  <HardDriveIcon />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Run manual backup" onClick={() => setRunTarget(backup)}>
                  <PlayIcon />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Edit backup" onClick={() => setEditTarget(backup)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete backup"
                  className="text-destructive"
                  onClick={() => setRemoveTarget(backup)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {formOpen ? (
        <BackupFormDialog
          config={config}
          row={row}
          backup={null}
          destinations={destinations.data ?? []}
          onClose={() => setFormOpen(false)}
          onSaved={reload}
        />
      ) : null}
      {editTarget ? (
        <BackupFormDialog
          config={config}
          row={row}
          backup={editTarget}
          destinations={destinations.data ?? []}
          onClose={() => setEditTarget(null)}
          onSaved={reload}
        />
      ) : null}
      {filesTarget ? <BackupFilesSheet backup={filesTarget} onClose={() => setFilesTarget(null)} /> : null}

      <AlertDialog open={runTarget !== null} onOpenChange={(open) => !open && setRunTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Manual Backup</AlertDialogTitle>
            <AlertDialogDescription>
              This streams a dump of <span className="font-mono">{runTarget?.database}</span> to the
              configured S3 destination right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runManual()
              }}
            >
              {busy ? "Running…" : "Run backup"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this backup schedule?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void remove()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Yes, delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---- Advanced tab -----------------------------------------------------------------------------

function CustomCommandCard({ config, row, reload }: { config: KindConfig; row: Row; reload: () => void }) {
  const [dockerImage, setDockerImage] = useState(str(row.dockerImage))
  const [command, setCommand] = useState(str(row.command))
  const [args, setArgs] = useState<string[]>(() =>
    Array.isArray(row.args) ? (row.args as unknown[]).map(String) : [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      setDockerImage(str(row.dockerImage))
      setCommand(str(row.command))
      setArgs(Array.isArray(row.args) ? (row.args as unknown[]).map(String) : [])
    }, 0)
    return () => clearTimeout(t)
  }, [row])

  const save = async () => {
    if (!dockerImage.trim()) {
      setError("Docker image is required.")
      return
    }
    setError(null)
    setBusy(true)
    const ok = await runMutation(
      () =>
        dokploy("POST", `${config.kind}.update`, {
          [config.idKey]: str(row[config.idKey]),
          dockerImage: dockerImage.trim(),
          command,
          args: args.filter((arg) => arg.trim() !== ""),
        }),
      "Custom command updated",
    )
    setBusy(false)
    if (ok) reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Custom Command</CardTitle>
        <CardDescription>Docker image, custom command and command arguments.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="k4-image">
            Docker Image<span className="text-destructive"> *</span>
          </Label>
          <Input
            id="k4-image"
            value={dockerImage}
            onChange={(e) => setDockerImage(e.target.value)}
            placeholder={config.defaultImage}
            aria-invalid={error ? true : undefined}
          />
          {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="k4-command">Command</Label>
          <Input
            id="k4-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={
              config.kind === "libsql"
                ? "sqld --db-path iku.db --http-listen-addr 0.0.0.0:8080 ..."
                : "Custom command"
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Arguments (Args)</Label>
            <Button variant="outline" size="sm" onClick={() => setArgs((prev) => [...prev, ""])}>
              <PlusIcon /> Add Argument
            </Button>
          </div>
          {args.length === 0 ? (
            <p className="text-sm text-muted-foreground">No arguments added yet.</p>
          ) : (
            args.map((arg, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={arg}
                  onChange={(e) =>
                    setArgs((prev) => prev.map((value, i) => (i === index ? e.target.value : value)))
                  }
                  placeholder={index === 0 ? "-c" : "argument value"}
                />
                <Button
                  variant="destructive"
                  size="icon"
                  aria-label={`Remove argument ${index + 1}`}
                  onClick={() => setArgs((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ResourcesCard({ config, row, reload }: { config: KindConfig; row: Row; reload: () => void }) {
  const fields = [
    { key: "memoryLimit", label: "Memory Limit (mb)" },
    { key: "memoryReservation", label: "Memory Reservation (mb)" },
    { key: "cpuLimit", label: "CPU Limit (0.5, 1.0 …)" },
    { key: "cpuReservation", label: "CPU Reservation (0.5, 1.0 …)" },
  ] as const
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, str(row[field.key])])),
  )
  const [replicas, setReplicas] = useState(str(row.replicas) || "1")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      setValues(Object.fromEntries(fields.map((field) => [field.key, str(row[field.key])])))
      setReplicas(str(row.replicas) || "1")
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row])

  const save = async () => {
    setBusy(true)
    const body: Row = { [config.idKey]: str(row[config.idKey]) }
    for (const field of fields) {
      const raw = values[field.key].trim()
      if (raw !== "") body[field.key] = raw
    }
    if (replicas.trim() !== "" && Number.isFinite(Number(replicas))) {
      body.replicas = Number(replicas)
    }
    const ok = await runMutation(
      () => dokploy("POST", `${config.kind}.update`, body),
      "Resource limits updated",
    )
    setBusy(false)
    if (ok) reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Resource Limits</CardTitle>
        <CardDescription>Memory / CPU limits &amp; reservations plus swarm replicas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`k4-${field.key}`}>{field.label}</Label>
              <Input
                id={`k4-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="k4-replicas">Swarm Replicas</Label>
            <Input
              id="k4-replicas"
              inputMode="numeric"
              value={replicas}
              onChange={(e) => setReplicas(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function JsonUpdateCard({ config, row, reload }: { config: KindConfig; row: Row; reload: () => void }) {
  const defaultPayload = useMemo(
    () =>
      JSON.stringify(
        {
          [config.idKey]: str(row[config.idKey]),
          dockerImage: str(row.dockerImage),
          command: row.command ?? null,
          args: Array.isArray(row.args) ? row.args : [],
          memoryReservation: row.memoryReservation ?? null,
          memoryLimit: row.memoryLimit ?? null,
          cpuReservation: row.cpuReservation ?? null,
          cpuLimit: row.cpuLimit ?? null,
          replicas: row.replicas ?? 1,
        },
        null,
        2,
      ),
    [config.idKey, row],
  )
  const [payload, setPayload] = useState(defaultPayload)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setPayload(defaultPayload)
      setError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [defaultPayload])

  const save = async () => {
    let body: Row
    try {
      const parsed = JSON.parse(payload) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Payload must be a JSON object.")
        return
      }
      body = parsed as Row
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid JSON payload.")
      return
    }
    if (!str(body[config.idKey])) body[config.idKey] = str(row[config.idKey])
    setBusy(true)
    const ok = await runMutation(
      () => dokploy("POST", `${config.kind}.update`, body),
      "Advanced JSON update applied",
    )
    setBusy(false)
    if (ok) reload()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Advanced JSON Update</CardTitle>
        <CardDescription>
          Generic console for <span className="font-mono text-xs">{config.kind}.update</span>. This sends the JSON body directly to upstream.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          aria-label="Advanced update JSON body"
          value={payload}
          onChange={(event) => {
            setPayload(event.target.value)
            setError(null)
          }}
          className="min-h-80 font-mono text-xs"
          aria-invalid={error ? true : undefined}
        />
        {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Send update"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AdvancedTab({ config, row, reload }: { config: KindConfig; row: Row; reload: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <JsonUpdateCard config={config} row={row} reload={reload} />
      <CustomCommandCard config={config} row={row} reload={reload} />
      <ResourcesCard config={config} row={row} reload={reload} />
    </div>
  )
}

// ---- Create dialog (reusable from the environment board) ------------------------------------------

/**
 * Create dialog for any database kind. Exported so the environment board can
 * mount it next to the application/compose create flows; the field sets mirror
 * the `{kind}.create` schemas in docs/dokploy.yaml exactly.
 */
export function DatabaseCreateDialog({
  kind,
  environmentId,
  onClose,
  onCreated,
}: {
  kind: DbKind
  environmentId: string
  onClose: () => void
  onCreated?: (created: Row) => void
}) {
  const config = KIND_CONFIGS[kind]
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      config.createFields.map((field) => [
        field.key,
        field.kind === "switch" ? (field.initial ?? "false") : (field.initial ?? ""),
      ]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const submit = async () => {
    const nextErrors: FieldErrors = {}
    const body: Row = { environmentId }
    for (const field of config.createFields) {
      const raw = (values[field.key] ?? "").trim()
      if (field.kind === "switch") {
        body[field.key] = raw === "true"
        continue
      }
      if (field.required && raw === "") {
        nextErrors[field.key] = `${field.label} is required.`
        continue
      }
      if (field.key.toLowerCase().includes("password")) {
        if (raw !== "" && !DATABASE_PASSWORD_PATTERN.test(raw)) {
          nextErrors[field.key] = `Invalid characters. ${PASSWORD_RULE}`
          continue
        }
      }
      if (raw !== "") {
        body[field.key] = field.kind === "textarea" ? values[field.key] : raw
      } else if (field.sendNull) {
        body[field.key] = null
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please fix the highlighted fields.")
      return
    }
    setBusy(true)
    try {
      const created = await dokploy<Row>("POST", `${config.kind}.create`, body)
      toast.success(`${config.label} created successfully`)
      onCreated?.(created ?? {})
      onClose()
    } catch (cause) {
      const upstream = cause as UpstreamError
      const fieldErrors = extractFieldErrors(upstream)
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors)
        toast.error("Upstream rejected the form — fix the highlighted fields.")
      } else {
        toast.error(toErrorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create {config.label}</DialogTitle>
          <DialogDescription>
            Posts <span className="font-mono text-xs">{config.kind}.create</span> to the live
            Dokploy server.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {config.createFields.map((field) => {
            const error = errors[field.key]
            const labeled = (
              <Label htmlFor={`k4-create-${field.key}`}>
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </Label>
            )
            if (field.kind === "switch") {
              return (
                <div key={field.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor={`k4-create-${field.key}`} className="font-normal">
                    {field.label}
                    {field.hint ? (
                      <span className="block text-xs text-muted-foreground">{field.hint}</span>
                    ) : null}
                  </Label>
                  <Switch
                    id={`k4-create-${field.key}`}
                    checked={values[field.key] === "true"}
                    onCheckedChange={(checked) => setValue(field.key, checked ? "true" : "false")}
                  />
                </div>
              )
            }
            return (
              <div key={field.key} className="grid gap-2">
                {labeled}
                {field.kind === "textarea" ? (
                  <Textarea
                    id={`k4-create-${field.key}`}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="resize-none"
                    aria-invalid={error ? true : undefined}
                  />
                ) : field.kind === "select" ? (
                  <Select value={values[field.key] ?? ""} onValueChange={(value) => setValue(field.key, value)}>
                    <SelectTrigger id={`k4-create-${field.key}`} aria-invalid={error ? true : undefined}>
                      <SelectValue placeholder="Pick one" />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`k4-create-${field.key}`}
                    type={field.kind === "password" ? "password" : "text"}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                  />
                )}
                {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
                {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : `Create ${config.label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Page shell ------------------------------------------------------------------------------------

export function DatabaseServicePage({ kind }: { kind: DbKind }) {
  const config = KIND_CONFIGS[kind]
  const params = useParams()
  const projectId = params.projectId ?? ""
  const environmentId = params.environmentId ?? ""
  const serviceId = params.serviceId ?? ""

  const service = useUpstream<Row>(
    () => dokploy<Row>("GET", `${config.kind}.one`, undefined, { [config.idKey]: serviceId }),
    [config.kind, config.idKey, serviceId],
  )

  const row = service.data
  const environment = (row?.environment as Row | undefined) ?? {}
  const project = (environment.project as Row | undefined) ?? {}
  const environmentBoardHref = `/admin/dokploy/app/p/${projectId}/e/${environmentId}`

  return (
    <div className="flex flex-col gap-6 pb-10">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy/app/projects">Projects</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={environmentBoardHref}>{str(project.name) || "Project"}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={environmentBoardHref}>{str(environment.name) || "Environment"}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{str(row?.name) || config.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {service.loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : service.error ? (
        <div className="flex flex-col gap-4">
          <PageHeader title={config.label} description={`Route parameter serviceId: ${serviceId}`} />
          <ErrorBanner error={service.error} />
        </div>
      ) : row ? (
        <>
          <PageHeader
            title={str(row.name) || config.label}
            description={`${str(row.appName)} · ${str(row.dockerImage)}`}
            actions={
              <>
                <StatusBadge status={str(row.applicationStatus)} />
                <UpdateServiceDialog config={config} row={row} onDone={service.reload} />
                <DeleteServiceDialog config={config} row={row} />
              </>
            }
          />
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="justify-start">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="environment">Environment</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
              {config.hasBackups ? <TabsTrigger value="backups">Backups</TabsTrigger> : null}
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="pt-4">
              <GeneralTab config={config} row={row} reload={service.reload} />
            </TabsContent>
            <TabsContent value="environment" className="pt-4">
              <EnvironmentTab config={config} row={row} reload={service.reload} />
            </TabsContent>
            <TabsContent value="logs" className="pt-4">
              <LogsTab config={config} row={row} />
            </TabsContent>
            <TabsContent value="monitoring" className="pt-4">
              <MonitoringTab row={row} />
            </TabsContent>
            {config.hasBackups ? (
              <TabsContent value="backups" className="pt-4">
                <BackupsTab config={config} row={row} reload={service.reload} />
              </TabsContent>
            ) : null}
            <TabsContent value="advanced" className="pt-4">
              <AdvancedTab config={config} row={row} reload={service.reload} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  )
}
