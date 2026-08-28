// Dokploy parity #19 — settings/notifications.tsx +
// components/dashboard/settings/notifications/{show,handle}-notifications.tsx.
// Notification channels across all 12 upstream provider families, backed by
// notification.{all,one,remove} + create{X}/update{X}/test{X}Connection ops.
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { BellIcon, PencilIcon, PlugZapIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import {
  FieldErrorText,
  NOTIFICATION_EVENTS,
  runMutation,
  type NotificationEvents,
} from "./helpers"

type Row = Record<string, unknown>

interface ProviderField {
  key: string
  label: string
  type?: "text" | "number" | "password"
  required?: boolean
  /** Comma-separated input parsed into `string[]`. */
  list?: boolean
  /** Free-form `Key: Value` lines parsed into a headers object. */
  object?: boolean
  placeholder?: string
}

interface ProviderConfig {
  key: string
  label: string
  createOp: string
  updateOp: string
  testOp: string
  /** Flat `{key}` column Dokploy stores on every notification row. */
  idField: string
  /** Nested object carrying this provider's secrets on a notification row. */
  nested: string
  fields: ProviderField[]
  /** Boolean extras rendered as switches (e.g. `decoration`). */
  flags?: Array<{ key: string; label: string }>
}

const PROVIDERS: ProviderConfig[] = [
  {
    key: "discord",
    label: "Discord",
    createOp: "notification.createDiscord",
    updateOp: "notification.updateDiscord",
    testOp: "notification.testDiscordConnection",
    idField: "discordId",
    nested: "discord",
    fields: [{ key: "webhookUrl", label: "Webhook URL", required: true }],
    flags: [{ key: "decoration", label: "Decoration (embeds)" }],
  },
  {
    key: "email",
    label: "Email (SMTP)",
    createOp: "notification.createEmail",
    updateOp: "notification.updateEmail",
    testOp: "notification.testEmailConnection",
    idField: "emailId",
    nested: "email",
    fields: [
      { key: "smtpServer", label: "SMTP Server", required: true },
      { key: "smtpPort", label: "SMTP Port", type: "number", required: true },
      { key: "username", label: "Username", required: true },
      { key: "password", label: "Password", type: "password", required: true },
      { key: "fromAddress", label: "From Address", required: true },
      {
        key: "toAddresses",
        label: "To Addresses (comma-separated)",
        required: true,
        list: true,
        placeholder: "ops@example.com, alerts@example.com",
      },
    ],
  },
  {
    key: "telegram",
    label: "Telegram",
    createOp: "notification.createTelegram",
    updateOp: "notification.updateTelegram",
    testOp: "notification.testTelegramConnection",
    idField: "telegramId",
    nested: "telegram",
    fields: [
      { key: "botToken", label: "Bot Token", required: true },
      { key: "chatId", label: "Chat ID", required: true },
      { key: "messageThreadId", label: "Message Thread ID" },
    ],
  },
  {
    key: "slack",
    label: "Slack",
    createOp: "notification.createSlack",
    updateOp: "notification.updateSlack",
    testOp: "notification.testSlackConnection",
    idField: "slackId",
    nested: "slack",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", required: true },
      { key: "channel", label: "Channel", required: true },
    ],
  },
  {
    key: "teams",
    label: "Microsoft Teams",
    createOp: "notification.createTeams",
    updateOp: "notification.updateTeams",
    testOp: "notification.testTeamsConnection",
    idField: "teamsId",
    nested: "teams",
    fields: [{ key: "webhookUrl", label: "Webhook URL", required: true }],
  },
  {
    key: "lark",
    label: "Lark",
    createOp: "notification.createLark",
    updateOp: "notification.updateLark",
    testOp: "notification.testLarkConnection",
    idField: "larkId",
    nested: "lark",
    fields: [{ key: "webhookUrl", label: "Webhook URL", required: true }],
  },
  {
    key: "mattermost",
    label: "Mattermost",
    createOp: "notification.createMattermost",
    updateOp: "notification.updateMattermost",
    testOp: "notification.testMattermostConnection",
    idField: "mattermostId",
    nested: "mattermost",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", required: true },
      { key: "channel", label: "Channel" },
      { key: "username", label: "Username" },
    ],
  },
  {
    key: "ntfy",
    label: "ntfy",
    createOp: "notification.createNtfy",
    updateOp: "notification.updateNtfy",
    testOp: "notification.testNtfyConnection",
    idField: "ntfyId",
    nested: "ntfy",
    fields: [
      { key: "serverUrl", label: "Server URL", required: true },
      { key: "topic", label: "Topic", required: true },
      { key: "accessToken", label: "Access Token", required: true },
      { key: "priority", label: "Priority", type: "number", required: true },
    ],
  },
  {
    key: "gotify",
    label: "Gotify",
    createOp: "notification.createGotify",
    updateOp: "notification.updateGotify",
    testOp: "notification.testGotifyConnection",
    idField: "gotifyId",
    nested: "gotify",
    fields: [
      { key: "serverUrl", label: "Server URL", required: true },
      { key: "appToken", label: "App Token", required: true },
      { key: "priority", label: "Priority", type: "number", required: true },
    ],
    flags: [{ key: "decoration", label: "Decoration (markdown)" }],
  },
  {
    key: "pushover",
    label: "Pushover",
    createOp: "notification.createPushover",
    updateOp: "notification.updatePushover",
    testOp: "notification.testPushoverConnection",
    idField: "pushoverId",
    nested: "pushover",
    fields: [
      { key: "userKey", label: "User Key", required: true },
      { key: "apiToken", label: "API Token", required: true },
      { key: "priority", label: "Priority", type: "number" },
      { key: "retry", label: "Retry (seconds)", type: "number" },
      { key: "expire", label: "Expire (seconds)", type: "number" },
    ],
  },
  {
    key: "resend",
    label: "Resend",
    createOp: "notification.createResend",
    updateOp: "notification.updateResend",
    testOp: "notification.testResendConnection",
    idField: "resendId",
    nested: "resend",
    fields: [
      { key: "apiKey", label: "API Key", required: true },
      { key: "fromAddress", label: "From Address", required: true },
      {
        key: "toAddresses",
        label: "To Addresses (comma-separated)",
        required: true,
        list: true,
        placeholder: "ops@example.com, alerts@example.com",
      },
    ],
  },
  {
    key: "custom",
    label: "Custom webhook",
    createOp: "notification.createCustom",
    updateOp: "notification.updateCustom",
    testOp: "notification.testCustomConnection",
    idField: "customId",
    nested: "custom",
    fields: [
      { key: "endpoint", label: "Endpoint URL", required: true },
      {
        key: "headers",
        label: "Headers (one per line: Key: Value)",
        object: true,
        placeholder: "X-Token: secret",
      },
    ],
  },
]

const EMPTY_EVENTS: NotificationEvents = {
  appDeploy: false,
  appBuildError: false,
  databaseBackup: false,
  dokployBackup: false,
  volumeBackup: false,
  dokployRestart: false,
  dockerCleanup: false,
  serverThreshold: false,
}

function parseObjectLines(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sep = trimmed.indexOf(":")
    if (sep <= 0) return null
    out[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim()
  }
  return out
}

/** Builds the upstream body shared by create/update/test for one provider. */
function buildPayload(
  cfg: ProviderConfig,
  values: Record<string, string>,
  flags: Record<string, boolean>,
  events: NotificationEvents,
): Record<string, unknown> | { error: string } {
  const body: Record<string, unknown> = {
    name: (values.name ?? "").trim(),
    ...events,
  }
  for (const field of cfg.fields) {
    const raw = (values[field.key] ?? "").trim()
    if (field.object) {
      if (!raw) continue
      const parsed = parseObjectLines(raw)
      if (!parsed) return { error: `${field.label}: use "Key: Value" per line` }
      body[field.key] = parsed
      continue
    }
    if (field.list) {
      const items = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      if (items.length > 0) body[field.key] = items
      continue
    }
    if (field.type === "number") {
      if (raw !== "") body[field.key] = Number(raw)
      continue
    }
    if (raw !== "") body[field.key] = raw
  }
  for (const flag of cfg.flags ?? []) body[flag.key] = Boolean(flags[flag.key])
  return body
}

function validateRequired(
  cfg: ProviderConfig,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of cfg.fields) {
    if (!field.required) continue
    if (!(values[field.key] ?? "").trim()) errors[field.key] = `${field.label} is required`
  }
  return errors
}

function readRowValues(cfg: ProviderConfig, row: Row): Record<string, string> {
  const nested = (row[cfg.nested] ?? {}) as Row
  const values: Record<string, string> = {}
  for (const field of cfg.fields) {
    const raw = nested[field.key]
    if (field.list && Array.isArray(raw)) values[field.key] = raw.join(", ")
    else if (field.object && raw !== undefined && raw !== null)
      values[field.key] =
        typeof raw === "object"
          ? Object.entries(raw as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join("\n")
          : String(raw)
    else if (raw !== undefined && raw !== null) values[field.key] = String(raw)
    else values[field.key] = ""
  }
  return values
}

interface FormState {
  open: boolean
  mode: "create" | "edit"
  providerKey: string
  row: Row | null
  values: Record<string, string>
  flags: Record<string, boolean>
  events: NotificationEvents
  errors: Record<string, string>
  saving: boolean
}

const initialForm: FormState = {
  open: false,
  mode: "create",
  providerKey: "discord",
  row: null,
  values: {},
  flags: {},
  events: { ...EMPTY_EVENTS },
  errors: {},
  saving: false,
}

export default function DokploySettingsNotificationsPage() {
  const notifications = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "notification.all"), [])
  const [form, setForm] = useState<FormState>(initialForm)
  const [removeRow, setRemoveRow] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)
  // Test-connection dialog state (per row).
  const [testCfg, setTestCfg] = useState<{ cfg: ProviderConfig; row: Row } | null>(null)
  const [testValues, setTestValues] = useState<Record<string, string>>({})
  const [testFlags, setTestFlags] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)

  const cfg = PROVIDERS.find((p) => p.key === form.providerKey) ?? PROVIDERS[0]

  const openCreate = () =>
    setForm({
      ...initialForm,
      open: true,
      values: Object.fromEntries(PROVIDERS[0].fields.map((f) => [f.key, ""])),
    })

  const openEdit = (row: Row) => {
    const providerKey = String(row.notificationType ?? "")
    const rowCfg = PROVIDERS.find((p) => p.key === providerKey)
    if (!rowCfg) {
      toast.error(`Unsupported notification type: ${providerKey}`)
      return
    }
    const flags: Record<string, boolean> = {}
    for (const flag of rowCfg.flags ?? []) flags[flag.key] = Boolean((row[rowCfg.nested] as Row)?.[flag.key])
    const events = { ...EMPTY_EVENTS }
    for (const event of NOTIFICATION_EVENTS) events[event.key] = Boolean(row[event.key])
    setForm({
      ...initialForm,
      open: true,
      mode: "edit",
      providerKey,
      row,
      values: readRowValues(rowCfg, row),
      flags,
      events,
    })
  }

  const openTest = (row: Row) => {
    const providerKey = String(row.notificationType ?? "")
    const rowCfg = PROVIDERS.find((p) => p.key === providerKey)
    if (!rowCfg) return
    setTestCfg({ cfg: rowCfg, row })
    setTestValues(readRowValues(rowCfg, row))
    const flags: Record<string, boolean> = {}
    for (const flag of rowCfg.flags ?? []) flags[flag.key] = Boolean((row[rowCfg.nested] as Row)?.[flag.key])
    setTestFlags(flags)
  }

  const saveForm = async () => {
    if (!cfg) return
    const localErrors = validateRequired(cfg, form.values)
    if (!(form.values.name ?? "").trim()) localErrors.name = "Name is required"
    if (Object.keys(localErrors).length > 0) {
      setForm((prev) => ({ ...prev, errors: localErrors }))
      return
    }
    const payload = buildPayload(cfg, form.values, form.flags, form.events)
    if ("error" in payload) {
      setForm((prev) => ({ ...prev, errors: { _form: String(payload.error) } }))
      return
    }
    setForm((prev) => ({ ...prev, saving: true, errors: {} }))
    const body =
      form.mode === "create"
        ? payload
        : {
            ...payload,
            notificationId: String(form.row?.notificationId ?? ""),
            [cfg.idField]: String(form.row?.[cfg.idField] ?? ""),
          }
    const result = await runMutation(
      () => dokploy("POST", form.mode === "create" ? cfg.createOp : cfg.updateOp, body),
      {
        success:
          form.mode === "create" ? "Notification created" : "Notification updated",
        onDone: () => {
          setForm(initialForm)
          notifications.reload()
        },
      },
    )
    if (!result.ok) {
      setForm((prev) => ({ ...prev, saving: false, errors: result.fieldErrors }))
    }
  }

  const runTest = async () => {
    if (!testCfg) return
    const payload = buildPayload(testCfg.cfg, testValues, testFlags, { ...EMPTY_EVENTS })
    if ("error" in payload) {
      toast.error(String(payload.error))
      return
    }
    setTesting(true)
    try {
      await dokploy("POST", testCfg.cfg.testOp, payload)
      toast.success(`Test notification sent via ${testCfg.cfg.label}`)
      setTestCfg(null)
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setTesting(false)
    }
  }

  const removeNotification = async () => {
    if (!removeRow) return
    setRemoving(true)
    await runMutation(
      () =>
        dokploy("POST", "notification.remove", {
          notificationId: String(removeRow.notificationId ?? ""),
        }),
      {
        success: "Notification removed",
        onDone: () => {
          setRemoveRow(null)
          notifications.reload()
        },
      },
    )
    setRemoving(false)
  }

  // Group rows by provider family so each family renders its own card+table.
  const grouped = useMemo(() => {
    const rows = notifications.data ?? []
    const map = new Map<string, Row[]>()
    for (const row of rows) {
      const key = String(row.notificationType ?? "unknown")
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [notifications.data])

  const activeProviderKeys = new Set(grouped.map(([key]) => key))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Channels that receive deploy, backup and cleanup events — Discord, Email, Telegram, Slack, Teams, Lark, Mattermost, ntfy, Gotify, Pushover, Resend and custom webhooks."
        actions={
          <Button onClick={openCreate}>
            <PlusIcon className="size-4" />
            Add provider
          </Button>
        }
      />

      {notifications.error ? <ErrorBanner error={notifications.error} /> : null}
      {notifications.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : grouped.length === 0 ? (
        <EmptyState
          message="No notification providers configured yet."
          description="Add at least one provider to receive deployment and backup notifications."
        />
      ) : (
        grouped.map(([familyKey, rows]) => {
          const family = PROVIDERS.find((p) => p.key === familyKey)
          const columns: Array<SimpleColumn<Row>> = [
            { key: "name", header: "Name" },
            {
              key: "events",
              header: "Events",
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  {NOTIFICATION_EVENTS.filter((e) => row[e.key]).map((e) => (
                    <Badge key={e.key} variant="secondary" className="text-[10px]">
                      {e.label}
                    </Badge>
                  ))}
                </div>
              ),
            },
            { key: "createdAt", header: "Created" },
            {
              key: "actions",
              header: "",
              className: "w-40",
              render: (row) => (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" title="Send test" onClick={() => openTest(row)}>
                    <PlugZapIcon className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(row)}>
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    title="Remove"
                    onClick={() => setRemoveRow(row)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ),
            },
          ]
          return (
            <Card key={familyKey}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BellIcon className="size-4 text-muted-foreground" />
                  {family?.label ?? familyKey}
                </CardTitle>
                <CardDescription>
                  Backing ops: {family ? `${family.createOp.split(".")[1]}, ${family.updateOp.split(".")[1]}, ${family.testOp.split(".")[1]}` : familyKey}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleDataTable
                  columns={columns}
                  rows={rows}
                  getRowKey={(row) => String(row.notificationId ?? row.name)}
                  emptyMessage="Nothing in this family."
                />
              </CardContent>
            </Card>
          )
        })
      )}

      {/* Create / edit dialog */}
      <Dialog open={form.open} onOpenChange={(open) => (open ? null : setForm(initialForm))}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.mode === "create" ? "Add" : "Edit"} notification provider
            </DialogTitle>
            <DialogDescription>
              {form.mode === "create"
                ? "Pick a provider family and fill in its connection details."
                : `Editing ${String(form.row?.name ?? "")} (${cfg.label})`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {form.mode === "create" ? (
              <div className="space-y-2">
                <Label htmlFor="np-provider">Provider</Label>
                <select
                  id="np-provider"
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                  value={form.providerKey}
                  onChange={(event) => {
                    const next = PROVIDERS.find((p) => p.key === event.target.value)
                    setForm((prev) => ({
                      ...prev,
                      providerKey: event.target.value,
                      values: Object.fromEntries((next?.fields ?? []).map((f) => [f.key, ""])),
                      flags: {},
                      errors: {},
                    }))
                  }}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="np-name">Name</Label>
              <Input
                id="np-name"
                value={form.values.name ?? ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, values: { ...prev.values, name: event.target.value } }))
                }
                placeholder={`My ${cfg.label}`}
                required
              />
              <FieldErrorText>{form.errors.name}</FieldErrorText>
            </div>

            {cfg.fields.map((field) => (
              <div className="space-y-2" key={field.key}>
                <Label htmlFor={`np-${field.key}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                {field.object ? (
                  <Textarea
                    id={`np-${field.key}`}
                    rows={3}
                    value={form.values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        values: { ...prev.values, [field.key]: event.target.value },
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`np-${field.key}`}
                    type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
                    value={form.values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        values: { ...prev.values, [field.key]: event.target.value },
                      }))
                    }
                  />
                )}
                <FieldErrorText>{form.errors[field.key]}</FieldErrorText>
              </div>
            ))}

            {(cfg.flags ?? []).map((flag) => (
              <div className="flex items-center justify-between rounded-md border p-3" key={flag.key}>
                <Label htmlFor={`np-flag-${flag.key}`}>{flag.label}</Label>
                <Switch
                  id={`np-flag-${flag.key}`}
                  checked={Boolean(form.flags[flag.key])}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, flags: { ...prev.flags, [flag.key]: checked } }))
                  }
                />
              </div>
            ))}

            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Notify on</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {NOTIFICATION_EVENTS.map((event) => (
                  <div className="flex items-center justify-between gap-2" key={event.key}>
                    <Label htmlFor={`np-ev-${event.key}`} className="text-xs">
                      {event.label}
                    </Label>
                    <Switch
                      id={`np-ev-${event.key}`}
                      checked={form.events[event.key]}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({
                          ...prev,
                          events: { ...prev.events, [event.key]: checked },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            {form.errors._form ? <FieldErrorText>{form.errors._form}</FieldErrorText> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(initialForm)} disabled={form.saving}>
              Cancel
            </Button>
            <Button onClick={saveForm} disabled={form.saving}>
              {form.saving ? <Spinner className="size-4" /> : null}
              {form.mode === "create" ? "Create provider" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test-connection dialog */}
      <Dialog open={testCfg !== null} onOpenChange={(open) => (open ? null : setTestCfg(null))}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Test {testCfg?.cfg.label}</DialogTitle>
            <DialogDescription>
              Sends a test payload through {testCfg?.cfg.testOp ?? ""}. Fields are prefilled from the
              stored provider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(testCfg?.cfg.fields ?? []).map((field) => (
              <div className="space-y-2" key={field.key}>
                <Label htmlFor={`np-test-${field.key}`}>{field.label}</Label>
                {field.object ? (
                  <Textarea
                    id={`np-test-${field.key}`}
                    rows={3}
                    value={testValues[field.key] ?? ""}
                    onChange={(event) =>
                      setTestValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                ) : (
                  <Input
                    id={`np-test-${field.key}`}
                    type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
                    value={testValues[field.key] ?? ""}
                    onChange={(event) =>
                      setTestValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            {(testCfg?.cfg.flags ?? []).map((flag) => (
              <div className="flex items-center justify-between rounded-md border p-3" key={flag.key}>
                <Label htmlFor={`np-test-flag-${flag.key}`}>{flag.label}</Label>
                <Switch
                  id={`np-test-flag-${flag.key}`}
                  checked={Boolean(testFlags[flag.key])}
                  onCheckedChange={(checked) =>
                    setTestFlags((prev) => ({ ...prev, [flag.key]: checked }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestCfg(null)} disabled={testing}>
              Cancel
            </Button>
            <Button onClick={runTest} disabled={testing}>
              {testing ? <Spinner className="size-4" /> : <PlugZapIcon className="size-4" />}
              Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={removeRow !== null} onOpenChange={(open) => (open ? null : setRemoveRow(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove notification provider?</AlertDialogTitle>
            <AlertDialogDescription>
              “{String(removeRow?.name ?? "")}” will stop receiving events immediately. This calls{" "}
              <code>notification.remove</code> upstream.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                void removeNotification()
              }}
            >
              {removing ? <Spinner className="size-4" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Family picker hint listing families not yet configured */}
      {!notifications.loading && grouped.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Configured families: {[...activeProviderKeys].join(", ")}. Use “Add provider” to add any of
          the other {PROVIDERS.length - activeProviderKeys.size} supported families.
        </p>
      ) : null}
    </div>
  )
}
