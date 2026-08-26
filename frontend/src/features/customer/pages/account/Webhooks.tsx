// Webhooks: create (with one-time signing secret), list and delete, plus the
// organization-wide delivery log filtered client-side per webhook. The API
// accepts any non-empty event-name strings and does not expose a catalog
// endpoint or delivery payloads — deliveries carry response status, attempt
// count, last error and timestamps only.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CopyIcon, Loader2Icon, PlusIcon, WebhookIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

interface WebhookRow {
  id: string
  name?: string
  url: string
  events: string[] | null
  enabled?: boolean
  created_at?: string
}

interface DeliveryRow {
  id: string
  webhook_id: string
  webhook_name?: string
  event_id?: string
  response_status?: number
  attempts?: number
  delivered_at?: string
  last_error?: string
  created_at?: string
}

export default function WebhooksPage() {
  const { orgId } = useOrg()
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null)
  const [deliveryFilter, setDeliveryFilter] = useState("all")
  const [deliveryError, setDeliveryError] = useState<unknown>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [secretReveal, setSecretReveal] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<WebhookRow[]>("/webhooks", { headers: orgHeaders(orgId) })
      setWebhooks(data ?? [])
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!orgId) return
      try {
        const { data } = await apiGet<DeliveryRow[]>("/webhook-deliveries", {
          headers: orgHeaders(orgId),
        })
        if (!cancelled) {
          setDeliveries(data ?? [])
          setDeliveryError(null)
        }
      } catch (cause) {
        if (!cancelled) setDeliveryError(cause)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const filteredDeliveries = useMemo(() => {
    if (!deliveries) return []
    if (deliveryFilter === "all") return deliveries
    return deliveries.filter((delivery) => delivery.webhook_id === deliveryFilter)
  }, [deliveries, deliveryFilter])

  const remove = async (webhook: WebhookRow) => {
    try {
      await apiDelete(`/webhooks/${webhook.id}`, { headers: orgHeaders(orgId) })
      toast.success("Webhook deleted")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete webhook")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Webhooks"
        description="HTTP endpoints receiving HMAC-signed events for the active organization."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> New webhook
            </Button>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {/* Webhook cards */}
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : webhooks.length === 0 && !error ? (
        <EmptyState message="No webhooks yet." description="Register an HTTPS endpoint to start receiving events." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {webhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <WebhookIcon className="size-4 text-muted-foreground" />
                  <span className="truncate">{webhook.name || "Untitled webhook"}</span>
                </CardTitle>
                <CardDescription className="break-all">{webhook.url}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {(webhook.events ?? []).map((event) => (
                    <Badge key={event} variant="outline" className="font-mono text-xs">
                      {event}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {formatDateTime(webhook.created_at)}
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deliveries stop immediately; past delivery records remain.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void remove(webhook)}>
                        Delete webhook
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Deliveries */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent deliveries</CardTitle>
            <CardDescription>Latest 100 attempts across your endpoints.</CardDescription>
          </div>
          <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All webhooks</SelectItem>
              {webhooks.map((webhook) => (
                <SelectItem key={webhook.id} value={webhook.id}>
                  {webhook.name || "Untitled webhook"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-3">
          {deliveryError ? (
            <ErrorBanner error={deliveryError} />
          ) : deliveries === null ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <SimpleDataTable
              columns={
                [
                  {
                    key: "webhook_name",
                    header: "Webhook",
                    render: (row) => row.webhook_name || "—",
                  },
                  {
                    key: "event_id",
                    header: "Event",
                    render: (row) =>
                      row.event_id ? (
                        <span className="font-mono text-xs">{row.event_id.slice(0, 8)}</span>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "response_status",
                    header: "Response",
                    render: (row) => {
                      const code = row.response_status ?? 0
                      const tone =
                        code >= 200 && code < 300 ? "default" : code === 0 ? "secondary" : "destructive"
                      return <Badge variant={tone}>{code > 0 ? `HTTP ${code}` : "no answer"}</Badge>
                    },
                  },
                  { key: "attempts", header: "Attempts" },
                  {
                    key: "last_error",
                    header: "Last error",
                    render: (row) => (
                      <span
                        className="block max-w-[220px] truncate text-xs"
                        title={row.last_error}
                      >
                        {row.last_error || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "delivered_at",
                    header: "Delivered",
                    render: (row) => formatDateTime(row.delivered_at || null),
                  },
                  {
                    key: "created_at",
                    header: "Queued",
                    render: (row) => formatDateTime(row.created_at),
                  },
                ] satisfies Array<SimpleColumn<DeliveryRow>>
              }
              rows={filteredDeliveries}
              getRowKey={(row) => row.id}
              skeletonRows={4}
              emptyMessage="No deliveries recorded yet."
            />
          )}
          <p className="text-xs text-muted-foreground">
            Payload bodies are not exposed by the deliveries endpoint; verify signatures
            with the secret shown once at creation.
          </p>
        </CardContent>
      </Card>

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        onCreated={(secret) => {
          setCreateOpen(false)
          if (secret) setSecretReveal(secret)
          void load()
        }}
      />

      {/* One-time signing secret */}
      <Dialog open={secretReveal !== null} onOpenChange={(open) => !open && setSecretReveal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Webhook signing secret</DialogTitle>
            <DialogDescription>
              Shown once. Verify the X-Kilat-Signature header (HMAC-SHA256, base64url).
            </DialogDescription>
          </DialogHeader>
          <p className="break-all rounded bg-muted px-3 py-2 font-mono text-sm select-all">
            {secretReveal}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (secretReveal) {
                  void navigator.clipboard.writeText(secretReveal)
                  toast.success("Secret copied to clipboard")
                }
              }}
            >
              <CopyIcon /> Copy
            </Button>
            <Button onClick={() => setSecretReveal(null)}>Done, I saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  orgId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  onCreated: (secret: string) => void
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [eventsText, setEventsText] = useState("instance.created")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const events = eventsText
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (!url.trim().startsWith("https://")) {
      toast.error("Endpoint must be an https:// URL")
      return
    }
    if (events.length === 0) {
      toast.error("List at least one event name")
      return
    }
    setBusy(true)
    try {
      const { data } = await apiPost<{ secret?: string }>(
        "/webhooks",
        { name: name.trim(), url: url.trim(), events },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Webhook created")
      setName("")
      setUrl("")
      setEventsText("instance.created")
      onCreated(typeof data?.secret === "string" ? data.secret : "")
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
          <DialogDescription>
            Event names are free-form strings; use dotted names like instance.created.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">Name</Label>
            <Input
              id="wh-name"
              placeholder="Internal monitor"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">Endpoint URL *</Label>
            <Input
              id="wh-url"
              type="url"
              placeholder="https://example.com/hooks/kilat"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-events">Events * (space or comma separated)</Label>
            <Input
              id="wh-events"
              value={eventsText}
              onChange={(event) => setEventsText(event.target.value)}
            />
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
