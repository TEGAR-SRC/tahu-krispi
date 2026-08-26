// Staff self-security: password change (POST /me/password/change), active
// sessions with the current-session badge (matched against the JWT `sid`
// claim) and revocation, plus the paginated security activity feed. All
// endpoints are user-scoped JWT — no X-Organization-ID.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2Icon, MonitorSmartphoneIcon } from "lucide-react"
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
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
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
import { apiDelete, apiGet, apiPost, ApiError, getToken } from "@/lib/api"
import { decodeJwtPayload, useAuth } from "@/lib/auth"
import type { PagedMeta } from "@/lib/types"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { formatDateTime } from "./format"

interface SessionRow {
  id: string
  device_name?: string
  ip?: string
  user_agent?: string
  created_at?: string
  last_seen_at?: string | null
  expires_at?: string
  is_current?: boolean
  revoked?: boolean
}

interface SecurityEventRow {
  id: number | string
  event_type: string
  success?: boolean
  ip?: string
  user_agent?: string
  created_at?: string
}

// load() sets state synchronously before its first await; deferring the
// effect call keeps it asynchronous and clear of react-hooks/set-state-in-effect.
function useMountLoad(load: () => Promise<void>) {
  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])
}

export default function StaffSecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My security"
        description="Password, active sessions and account activity."
      />
      <PasswordCard />
      <SessionsCard />
      <SecurityEventsCard />
    </div>
  )
}

// ---- Password -----------------------------------------------------------------

function PasswordCard() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  // Backend enforces a minimum length of 10 characters (verified live:
  // VALIDATION_ERROR fields.password "minimum 10 characters").
  const MIN_LENGTH = 10

  const submit = async () => {
    if (!current || !next || !confirm) {
      toast.error("All password fields are required")
      return
    }
    if (next !== confirm) {
      toast.error("New passwords do not match")
      return
    }
    if (next.length < MIN_LENGTH) {
      toast.error(`New password must be at least ${MIN_LENGTH} characters`)
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/password/change", {
        current_password: current,
        new_password: next,
      })
      toast.success("Password changed")
      setCurrent("")
      setNext("")
      setConfirm("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to change password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Use at least {MIN_LENGTH} characters; a passphrase works best.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="spw-current">Current password *</Label>
          <Input
            id="spw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="spw-new">New password *</Label>
            <Input
              id="spw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spw-confirm">Confirm new password *</Label>
            <Input
              id="spw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Change password
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---- Sessions -------------------------------------------------------------------

function SessionsCard() {
  const { logout, token } = useAuth()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // The session this browser holds, taken from the JWT sid claim; falls back
  // to the backend's is_current flag when the claim is unreadable.
  const currentSid = useMemo(() => {
    const stored = token ?? getToken()
    return stored ? (decodeJwtPayload(stored)?.sid ?? null) : null
  }, [token])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<SessionRow[]>("/me/sessions")
      setSessions(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useMountLoad(load)

  const revoke = async (session: SessionRow) => {
    const isCurrent = session.id === currentSid || session.is_current === true
    try {
      await apiDelete(`/me/sessions/${session.id}`)
      if (isCurrent) {
        toast.success("This session was revoked — signing you out")
        logout()
      } else {
        toast.success("Session revoked")
        await load()
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to revoke session")
    }
  }

  const activeSessions = sessions.filter((session) => !session.revoked)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphoneIcon className="size-5" /> Active sessions
        </CardTitle>
        <CardDescription>
          Devices holding a valid session token. Revoking one signs that device out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorBanner error={error} />
        ) : (
          <SimpleDataTable
            columns={
              [
                {
                  key: "device_name",
                  header: "Device",
                  render: (row) => (
                    <span
                      className="block max-w-[280px] truncate"
                      title={row.user_agent}
                    >
                      {row.device_name || row.user_agent || "Unknown device"}
                    </span>
                  ),
                },
                { key: "ip", header: "IP" },
                {
                  key: "created_at",
                  header: "Started",
                  render: (row) => formatDateTime(row.created_at),
                },
                {
                  key: "expires_at",
                  header: "Expires",
                  render: (row) => formatDateTime(row.expires_at),
                },
                {
                  key: "state",
                  header: "State",
                  render: (row) =>
                    row.id === currentSid || row.is_current ? (
                      <Badge>current session</Badge>
                    ) : (
                      <Badge variant="secondary">active</Badge>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-24",
                  render: (row) => (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive">
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The device loses its token immediately and must log in again.
                            {row.id === currentSid || row.is_current
                              ? " This is YOUR current session — you will be signed out."
                              : ""}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void revoke(row)}>
                            Revoke session
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ),
                },
              ] satisfies Array<SimpleColumn<SessionRow>>
            }
            rows={activeSessions}
            getRowKey={(row) => row.id}
            skeletonRows={3}
            emptyMessage="No active sessions."
          />
        )}
      </CardContent>
    </Card>
  )
}

// ---- Security events --------------------------------------------------------------

function SecurityEventsCard() {
  const [events, setEvents] = useState<SecurityEventRow[]>([])
  const [meta, setMeta] = useState<PagedMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await apiGet<SecurityEventRow[]>("/me/security/events", {
          query: { page, limit: 10 },
        })
        if (cancelled) return
        setEvents(response.data ?? [])
        setMeta((response.meta as PagedMeta | undefined) ?? null)
      } catch (cause) {
        if (!cancelled) setError(cause)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  const pageCount =
    meta && meta.per_page > 0 && typeof meta.total === "number"
      ? Math.ceil(meta.total / meta.per_page)
      : 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security activity</CardTitle>
        <CardDescription>
          Logins and other auth events recorded for your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorBanner error={error} />
        ) : events.length === 0 ? (
          <EmptyState message="No security events recorded." />
        ) : (
          <>
            <SimpleDataTable
              columns={[
                { key: "event_type", header: "Event", className: "capitalize" },
                {
                  key: "success",
                  header: "Result",
                  render: (row) => (
                    <Badge variant={row.success === false ? "destructive" : "secondary"}>
                      {row.success === false ? "failed" : "success"}
                    </Badge>
                  ),
                },
                { key: "ip", header: "IP" },
                {
                  key: "user_agent",
                  header: "Client",
                  render: (row) => (
                    <span className="block max-w-[240px] truncate" title={row.user_agent}>
                      {row.user_agent || "—"}
                    </span>
                  ),
                },
                {
                  key: "created_at",
                  header: "When",
                  render: (row) => formatDateTime(row.created_at),
                },
              ]}
              rows={events}
              getRowKey={(row) => String(row.id)}
              skeletonRows={6}
              emptyMessage="No security events recorded."
            />
            {pageCount > 1 ? (
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
