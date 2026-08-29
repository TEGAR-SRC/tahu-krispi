// Security tab: password change, active sessions with revoke, security event
// log and MFA (TOTP setup/confirm/disable + recovery codes).
import { useCallback, useEffect, useState } from "react"
import { KeyRoundIcon, Loader2Icon, LogOutIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime } from "../format"

interface SessionRow {
  id: string
  device_name?: string
  ip?: string
  user_agent?: string
  created_at?: string
  last_seen_at?: string | null
  expires_at?: string
  is_current: boolean
  revoked: boolean
}

interface SecurityEvent {
  id: number
  event_type: string
  success: boolean
  ip?: string
  user_agent?: string
  created_at?: string
}

export function SecurityTab() {
  return (
    <div className="grid w-full max-w-full min-w-0 gap-6 lg:grid-cols-2">
      <PasswordCard />
      <MfaCard />
      <SessionsCard />
      <SecurityEventsCard />
    </div>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!current || !next) {
      toast.error("Both fields are required")
      return
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters")
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/password/change", { current_password: current, new_password: next })
      toast.success("Password changed")
      setCurrent("")
      setNext("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to change password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <KeyRoundIcon /> Change password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password</Label>
          <Input id="pw-current" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next">New password</Label>
          <Input id="pw-next" type="password" value={next} onChange={(event) => setNext(event.target.value)} />
        </div>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Update password
        </Button>
      </CardContent>
    </Card>
  )
}

function MfaCard() {
  const [status, setStatus] = useState<{ enabled: boolean; recovery_codes_remaining: number } | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [code, setCode] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [disableOpen, setDisableOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet<{ enabled: boolean; recovery_codes_remaining: number }>("/me/mfa")
      setStatus(data)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const beginSetup = async () => {
    setBusy(true)
    try {
      const { data } = await apiPost<{ secret: string; otpauth_url: string }>("/me/mfa/totp/setup")
      setSetup(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to start TOTP setup")
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!code.trim()) {
      toast.error("Enter the 6-digit code")
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/mfa/totp/confirm", { code: code.trim() })
      toast.success("MFA enabled")
      setSetup(null)
      setCode("")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Invalid code")
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await apiPost("/me/mfa/totp/disable")
      toast.success("MFA disabled")
      setDisableOpen(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to disable MFA")
    } finally {
      setBusy(false)
    }
  }

  const regenerateRecovery = async () => {
    setBusy(true)
    try {
      const { data } = await apiPost<{ recovery_codes: string[] }>("/me/mfa/recovery-codes")
      setRecoveryCodes(data.recovery_codes ?? [])
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to regenerate codes")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <ShieldCheckIcon /> Two-factor authentication
        </CardTitle>
        <CardDescription>
          {status?.enabled ? (
            <Badge variant="default">Enabled · {status.recovery_codes_remaining} recovery codes left</Badge>
          ) : (
            <Badge variant="outline">Disabled</Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status?.enabled && !setup ? (
          <Button onClick={() => void beginSetup()} disabled={busy}>
            Set up authenticator app
          </Button>
        ) : null}

        {setup ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>Add this secret to your authenticator app:</p>
            <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{setup.secret}</p>
            <p className="break-all text-xs text-muted-foreground">{setup.otpauth_url}</p>
            <div className="flex min-w-0 items-center gap-2 pt-1">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                className="w-32"
              />
              <Button onClick={() => void confirm()} disabled={busy}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {status?.enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => setDisableOpen(true)}>
              Disable MFA
            </Button>
            <Button variant="outline" onClick={() => void regenerateRecovery()} disabled={busy}>
              Regenerate recovery codes
            </Button>
          </div>
        ) : null}

        {recoveryCodes.length > 0 ? (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium">Save these now — they are shown only once:</p>
            <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-xs">
              {recoveryCodes.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
            <AlertDialogDescription>Your account will be protected by password only.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void disable()
              }}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null)

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

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const revoke = async () => {
    if (!revokeTarget) return
    try {
      await apiDelete(`/me/sessions/${revokeTarget.id}`)
      toast.success(
        revokeTarget.is_current
          ? "Current session revoked — other tabs will sign out"
          : "Session revoked",
      )
      setRevokeTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to revoke session")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active sessions</CardTitle>
        <CardDescription>Devices holding a valid refresh token for your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ErrorBanner error={error} />
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="min-w-0 truncate">
                  {session.is_current ? <strong>This device</strong> : session.device_name || "Device"}
                  {" · "}
                  <span className="text-muted-foreground">{session.user_agent ?? session.ip ?? ""}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Created {formatDateTime(session.created_at)} · expires {formatDateTime(session.expires_at)}
                </p>
              </div>
              {!session.revoked ? (
                <Button size="sm" variant="outline" onClick={() => setRevokeTarget(session)}>
                  <LogOutIcon /> Revoke
                </Button>
              ) : (
                <StatusBadge status="revoked" />
              )}
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>The device must sign in again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function SecurityEventsCard() {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    apiGet<SecurityEvent[]>("/me/security/events", { query: { limit: 50 } })
      .then(({ data }) => setEvents(data ?? []))
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))
  }, [])

  const columns: Array<SimpleColumn<SecurityEvent>> = [
    {
      key: "event_type",
      header: "Event",
      render: (row) => <span className="capitalize">{row.event_type.replace(/_/g, " ")}</span>,
    },
    {
      key: "success",
      header: "Result",
      render: (row) => <StatusBadge status={row.success ? "active" : "failed"} />,
    },
    { key: "ip", header: "IP", render: (row) => <span className="font-mono text-xs">{row.ip ?? "—"}</span> },
    { key: "created_at", header: "When", render: (row) => formatDateTime(row.created_at) },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Security events</CardTitle>
        <CardDescription>Sign-ins and sensitive actions on your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={columns}
          rows={events}
          loading={loading}
          error={error}
          emptyMessage={error ? undefined : "No events recorded yet."}
          getRowKey={(row) => String(row.id)}
        />
      </CardContent>
    </Card>
  )
}

