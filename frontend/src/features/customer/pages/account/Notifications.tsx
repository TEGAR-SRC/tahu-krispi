// Notification center: inbox with unread badge count, mark-read single/all,
// and the per-channel/per-event preference switches. The list endpoint
// answers `data: null` when empty and is capped at the latest 100 items by
// the backend (no pagination meta).
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { BellOffIcon, CheckCheckIcon, MailIcon, MessageSquareIcon, SmartphoneIcon } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { formatDateTime } from "../../format"

interface NotificationRow {
  id: string
  channel?: string
  event_type?: string
  subject?: string
  body?: string
  status?: string
  read_at?: string
  created_at?: string
}

interface Preferences {
  email_enabled: boolean
  web_enabled: boolean
  sms_enabled: boolean
  billing_events: boolean
  security_events: boolean
  product_events: boolean
  marketing_events: boolean
}

const CHANNEL_ICONS: Record<string, typeof MailIcon> = {
  email: MailIcon,
  web: MessageSquareIcon,
  sms: SmartphoneIcon,
}

function ChannelIcon({ channel }: { channel?: string }) {
  const Icon = (channel && CHANNEL_ICONS[channel]) || BellOffIcon
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}

export default function NotificationsCenterPage() {
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsError, setPrefsError] = useState<unknown>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<NotificationRow[]>("/notifications")
      setNotifications(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    setPrefsLoading(true)
    setPrefsError(null)
    try {
      const { data } = await apiGet<Preferences>("/notifications/preferences")
      setPreferences(data)
    } catch (cause) {
      setPrefsError(cause)
    } finally {
      setPrefsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadPreferences()
  }, [load, loadPreferences])

  const unreadCount = useMemo(
    () => (notifications ?? []).filter((row) => !row.read_at).length,
    [notifications],
  )

  const markRead = async (notification: NotificationRow) => {
    try {
      await apiPost(`/notifications/${notification.id}/read`)
      toast.success("Marked as read")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to mark as read")
    }
  }

  const markAllRead = async () => {
    try {
      await apiPost("/notifications/read-all")
      toast.success("All notifications marked as read")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to mark all read")
    }
  }

  const togglePreference = async (key: keyof Preferences, value: boolean) => {
    if (!preferences) return
    setSavingKey(key)
    // Optimistic flip; PATCH replaces the whole preference object.
    const previous = preferences
    setPreferences({ ...preferences, [key]: value })
    try {
      await apiPatch("/notifications/preferences", { ...preferences, [key]: value })
    } catch (cause) {
      setPreferences(previous)
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save preference")
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Platform events for your account."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={unreadCount > 0 ? "default" : "outline"}>
              {unreadCount} unread
            </Badge>
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={() => void markAllRead()} disabled={unreadCount === 0}>
              <CheckCheckIcon /> Mark all read
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Inbox */}
        <Card>
          <CardHeader>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>Latest events delivered in-app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))
            ) : error ? (
              <ErrorBanner error={error} />
            ) : !notifications || notifications.length === 0 ? (
              <EmptyState message="No notifications yet." description="Billing and instance events land here." />
            ) : (
              notifications.map((notification) => {
                const unread = !notification.read_at
                return (
                  <div
                    key={notification.id}
                    className={`flex items-start gap-3 rounded-md border p-3 ${
                      unread ? "bg-primary/5" : ""
                    }`}
                  >
                    <ChannelIcon channel={notification.channel} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`min-w-0 truncate text-sm ${unread ? "font-medium" : ""}`}>
                          {notification.subject || notification.event_type || "Notification"}
                        </p>
                        {unread ? <Badge className="shrink-0">new</Badge> : null}
                      </div>
                      {notification.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {notification.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[notification.event_type, notification.channel]
                          .filter(Boolean)
                          .map((item) => (
                            <span key={String(item)} className="mr-2 font-mono">
                              {item}
                            </span>
                          ))}
                        · {formatDateTime(notification.created_at)}
                      </p>
                    </div>
                    {unread ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void markRead(notification)}
                      >
                        Mark read
                      </Button>
                    ) : null}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Saved immediately when toggled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {prefsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : prefsError ? (
              <ErrorBanner error={prefsError} />
            ) : preferences ? (
              <>
                <PreferenceGroup title="Channels">
                  <PreferenceToggle
                    label="Email"
                    item="email_enabled"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("email_enabled", value)}
                  />
                  <PreferenceToggle
                    label="In-app (web)"
                    item="web_enabled"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("web_enabled", value)}
                  />
                  <PreferenceToggle
                    label="SMS"
                    item="sms_enabled"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("sms_enabled", value)}
                  />
                </PreferenceGroup>
                <PreferenceGroup title="Event categories">
                  <PreferenceToggle
                    label="Billing events"
                    item="billing_events"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("billing_events", value)}
                  />
                  <PreferenceToggle
                    label="Security events"
                    item="security_events"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("security_events", value)}
                  />
                  <PreferenceToggle
                    label="Product events"
                    item="product_events"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("product_events", value)}
                  />
                  <PreferenceToggle
                    label="Marketing events"
                    item="marketing_events"
                    preferences={preferences}
                    savingKey={savingKey}
                    onToggle={(value) => void togglePreference("marketing_events", value)}
                  />
                </PreferenceGroup>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PreferenceGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function PreferenceToggle({
  label,
  item,
  preferences,
  savingKey,
  onToggle,
}: {
  label: string
  item: keyof Preferences
  preferences: Preferences
  savingKey: string | null
  onToggle: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <Switch
        checked={preferences[item]}
        disabled={savingKey !== null && savingKey !== item}
        onCheckedChange={onToggle}
      />
    </label>
  )
}
