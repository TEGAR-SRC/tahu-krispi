// Notification preferences (GET/PATCH /notifications/preferences) and webhook
// management (GET/POST/DELETE /webhooks + GET /webhook-deliveries), combined
// into one component selected by `mode` from the Profile shell.
import { useCallback, useEffect, useState } from "react"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface NotificationPrefs {
  email_enabled: boolean
  web_enabled: boolean
  sms_enabled: boolean
  billing_events: boolean
  security_events: boolean
  product_events: boolean
  marketing_events: boolean
}

interface Webhook {
  id: string
  name?: string
  url: string
  events: string[]
  enabled: boolean
  created_at?: string
}

interface WebhookDelivery {
  id: string
  webhook_name: string
  response_status: number
  attempts: number
  last_error?: string
  delivered_at?: string
  created_at?: string
}

const PREF_LABELS: Array<{ key: keyof NotificationPrefs; label: string }> = [
  { key: "email_enabled", label: "Email notifications" },
  { key: "web_enabled", label: "In-console notifications" },
  { key: "sms_enabled", label: "SMS notifications" },
  { key: "billing_events", label: "Billing events" },
  { key: "security_events", label: "Security events" },
  { key: "product_events", label: "Product announcements" },
  { key: "marketing_events", label: "Marketing emails" },
]

const EVENT_CHOICES = [
  "invoice.created",
  "invoice.paid",
  "payment.paid",
  "instance.provisioned",
  "instance.deleted",
  "ticket.replied",
]

export function NotificationsWebhooksTab({ mode }: { mode: "notifications" | "webhooks" }) {
  return mode === "notifications" ? <NotificationPrefsCard /> : <WebhooksCard />
}

function NotificationPrefsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    apiGet<NotificationPrefs>("/notifications/preferences")
      .then(({ data }) => setPrefs(data))
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!prefs) return
    setSavingKey(key)
    try {
      const { data } = await apiPatch<NotificationPrefs>("/notifications/preferences", {
        [key]: value,
      })
      setPrefs(data)
      toast.success("Preference saved")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save preference")
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading preferences…</p>
  if (error) return <ErrorBanner error={error} />
  if (!prefs) return null

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Notification preferences</CardTitle>
        <CardDescription>Changes apply immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {PREF_LABELS.map(({ key, label }) => (
          <div key={key} className="flex min-w-0 items-center justify-between gap-4 rounded-md px-2 py-2.5 hover:bg-muted/50">
            <span className="text-sm">{label}</span>
            <Switch
              checked={prefs[key]}
              disabled={savingKey === key}
              onCheckedChange={(value) => void toggle(key, value)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function WebhooksCard() {
  const { orgId } = useOrg()
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null)
  // Secret shown once right after creation.
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const [hooksRes, deliveriesRes] = await Promise.all([
        apiGet<Webhook[]>("/webhooks", { headers: orgHeaders(orgId) }),
        apiGet<WebhookDelivery[]>("/webhook-deliveries", { headers: orgHeaders(orgId) }),
      ])
      setWebhooks(hooksRes.data ?? [])
      setDeliveries(deliveriesRes.data ?? [])
      setError(null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const runDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/webhooks/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success("Webhook deleted")
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete webhook")
    }
  }

  const columns: Array<SimpleColumn<Webhook>> = [
    {
      key: "url",
      header: "Endpoint",
      render: (row) => (
        <div className="min-w-0">
          <p className="min-w-0 truncate font-medium">{row.name || "Webhook"}</p>
          <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.url}</p>
        </div>
      ),
    },
    { key: "events", header: "Events", render: (row) => row.events.join(", ") || "—" },
    {
      key: "enabled",
      header: "State",
      render: (row) => <StatusBadge status={row.enabled ? "active" : "suspended"} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-14",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  const deliveryColumns: Array<SimpleColumn<WebhookDelivery>> = [
    { key: "webhook_name", header: "Webhook" },
    {
      key: "response_status",
      header: "Response",
      render: (row) => (
        <StatusBadge status={row.response_status >= 200 && row.response_status < 300 ? "active" : "failed"} />
      ),
    },
    { key: "attempts", header: "Attempts", render: (row) => String(row.attempts ?? 0) },
    { key: "last_error", header: "Error", render: (row) => row.last_error || "—" },
    { key: "created_at", header: "When", render: (row) => formatDateTime(row.created_at) },
  ]

  return (
    <div className="grid w-full max-w-full min-w-0 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Webhooks</CardTitle>
            <CardDescription>HTTP callbacks for billing and lifecycle events.</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New webhook
          </Button>
        </CardHeader>
        <CardContent>
          <SimpleDataTable
            columns={columns}
            rows={webhooks}
            loading={loading}
            error={error}
            emptyMessage={error ? undefined : "No webhooks yet."}
            getRowKey={(row) => row.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          <CardDescription>Latest 100 delivery attempts across all webhooks.</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleDataTable
            columns={deliveryColumns}
            rows={deliveries}
            loading={loading}
            error={error}
            skeletonRows={3}
            emptyMessage={error ? undefined : "No deliveries yet."}
            getRowKey={(row) => row.id}
          />
        </CardContent>
      </Card>

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(secret) => {
          setCreateOpen(false)
          setCreatedSecret(secret)
          void load()
        }}
      />

      <Dialog open={createdSecret !== null} onOpenChange={(open) => !open && setCreatedSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Webhook signing secret</DialogTitle>
            <DialogDescription>Verify payload signatures with it — shown only once.</DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
            {createdSecret}
          </code>
          <DialogFooter>
            <Button onClick={() => setCreatedSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>Events will no longer be delivered to it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (secret: string) => void
}) {
  const { orgId } = useOrg()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<string[]>(["invoice.created"])
  const [busy, setBusy] = useState(false)

  const toggleEvent = (event: string) => {
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    )
  }

  const submit = async () => {
    if (!/^https?:\/\//.test(url.trim())) {
      toast.error("Enter a valid http(s) URL")
      return
    }
    if (events.length === 0) {
      toast.error("Pick at least one event")
      return
    }
    setBusy(true)
    try {
      const { data } = await apiPost<{ secret?: string; webhook?: unknown }>(
        "/webhooks",
        { name: name.trim() || undefined, url: url.trim(), events },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Webhook created")
      setName("")
      setUrl("")
      onCreated(data?.secret ?? "")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create webhook")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New webhook</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">Name</Label>
            <Input id="wh-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="internal-billing" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">Payload URL *</Label>
            <Input
              id="wh-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/hooks/kilat"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Events *</Label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_CHOICES.map((event) => (
                <button
                  key={event}
                  type="button"
                  onClick={() => toggleEvent(event)}
                  className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
                    events.includes(event) ? "border-primary bg-primary/10" : "text-muted-foreground"
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create webhook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
