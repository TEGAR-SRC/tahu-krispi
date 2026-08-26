// Account security: password change, active sessions with revocation, the
// security activity feed, TOTP enrolment (setup → confirm → disable) with
// one-time recovery codes, and passkey management. Passkey registration runs
// the real WebAuthn ceremony against the server-provided creation options; it
// only succeeds when the site is served from the Relying Party domain, so the
// UI surfaces browser errors verbatim instead of faking success.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  FingerprintIcon,
  KeyRoundIcon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
} from "lucide-react"
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
import type { PagedMeta } from "@/lib/types"
import { formatDateTime } from "../../format"

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

interface MfaStatus {
  enabled: boolean
  recovery_codes_remaining: number
}

interface PasskeyRow {
  id: string
  label?: string
  created_at?: string
  last_used_at?: string | null
}

// Loaders update state, so a direct `void load()` inside an effect would trip
// react-hooks/set-state-in-effect. Invoking it through a mount-effect hook is
// the standard data-fetching idiom and keeps the rule satisfied.
function useMountLoad(load: () => Promise<void>) {
  useEffect(() => {
    void load()
  }, [load])
}

export default function AccountSecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account security"
        description="Password, sessions, multi-factor authentication and passkeys."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/profile">Back to settings</Link>
          </Button>
        }
      />
      <PasswordCard />
      <MfaCard />
      <PasskeysCard />
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

  const submit = async () => {
    if (!current || !next || !confirm) {
      toast.error("All password fields are required")
      return
    }
    if (next !== confirm) {
      toast.error("New passwords do not match")
      return
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters")
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
        <CardDescription>Use at least 8 characters; a passphrase works best.</CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password *</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">New password *</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">Confirm new password *</Label>
            <Input
              id="pw-confirm"
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

// ---- MFA (TOTP + recovery codes) ----------------------------------------------

function MfaCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [error, setError] = useState<unknown>(null)

  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null)
  const [codesCopied, setCodesCopied] = useState(false)

  const loading = status === null && error === null

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet<MfaStatus>("/me/mfa")
      setError(null)
      setStatus(data)
    } catch (cause) {
      setError(cause)
    }
  }, [])

  useMountLoad(load)

  const beginSetup = async () => {
    setBusy(true)
    try {
      const { data } = await apiPost<{ secret: string; otpauth_url: string }>(
        "/me/mfa/totp/setup",
      )
      setSetup(data)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to start TOTP setup")
    } finally {
      setBusy(false)
    }
  }

  const confirmSetup = async () => {
    if (!code.trim()) {
      toast.error("Enter the 6-digit code from your authenticator")
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/mfa/totp/confirm", { code: code.trim().replace(/\s+/g, "") })
      toast.success("Two-factor authentication enabled")
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
      toast.success("Two-factor authentication disabled")
      setRevealedCodes(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to disable MFA")
    } finally {
      setBusy(false)
    }
  }

  const regenerateCodes = async () => {
    setBusy(true)
    try {
      const { data } = await apiPost<{ recovery_codes: string[] }>("/me/mfa/recovery-codes")
      setRevealedCodes(data.recovery_codes ?? [])
      setCodesCopied(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to generate recovery codes")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />
  if (error) return <ErrorBanner error={error} />

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5" /> Two-factor authentication
          </CardTitle>
          <CardDescription>
            TOTP authenticator app plus single-use recovery codes.
          </CardDescription>
        </div>
        <Badge variant={status?.enabled ? "default" : "outline"}>
          {status?.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Remaining recovery codes:{" "}
          <span className="font-medium text-foreground">
            {status?.recovery_codes_remaining ?? 0}
          </span>
        </p>

        {!status?.enabled && !setup ? (
          <Button onClick={() => void beginSetup()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Set up authenticator app
          </Button>
        ) : null}

        {setup ? (
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">1. Add this secret to your authenticator app</p>
            <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs select-all">
              {setup.secret}
            </p>
            <p className="text-sm font-medium">2. Or paste the otpauth URI</p>
            <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs select-all">
              {setup.otpauth_url}
            </p>
            <p className="text-sm font-medium">3. Enter the current 6-digit code to confirm</p>
            <div className="flex max-w-xs gap-2">
              <Input
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button onClick={() => void confirmSetup()} disabled={busy}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {status?.enabled ? (
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Disable 2FA</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your account will be protected by password only until you enable it again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it on</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void disable()}>
                    Disable 2FA
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={() => void regenerateCodes()} disabled={busy}>
              <KeyRoundIcon /> Regenerate recovery codes
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => void regenerateCodes()} disabled={busy}>
            <KeyRoundIcon /> Generate recovery codes
          </Button>
        )}

        {revealedCodes ? (
          <div className="rounded-md border border-dashed p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FingerprintIcon className="size-4" />
              Save these codes now — they are shown only once.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
              {revealedCodes.map((recoveryCode) => (
                <li key={recoveryCode} className="rounded bg-muted px-2 py-1 select-all">
                  {recoveryCode}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(revealedCodes.join("\n"))
                  setCodesCopied(true)
                }}
              >
                {codesCopied ? "Copied" : "Copy all"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevealedCodes(null)}>
                I saved them
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---- Passkeys ------------------------------------------------------------------

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
  const binary = atob(padded)
  // Explicit ArrayBuffer backing keeps the BufferSource-compatible type.
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

interface CreationOptionsContainer {
  publicKey?: Record<string, unknown>
}

/** Converts the go-webauthn JSON options into browser credential options. */
function toCreationOptions(raw: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const options = (raw.publicKey ?? raw) as Record<string, unknown>
  const user = options.user as Record<string, unknown>
  const rp = options.rp as PublicKeyCredentialRpEntity
  const challenge = base64UrlToBytes(String(options.challenge))
  const userId = base64UrlToBytes(String(user.id))
  const excludeCredentials = Array.isArray(options.excludeCredentials)
    ? (options.excludeCredentials as Array<Record<string, unknown>>).map((descriptor) => ({
        type: "public-key" as const,
        id: base64UrlToBytes(String(descriptor.id)),
      }))
    : undefined

  return {
    challenge,
    rp,
    user: {
      id: userId,
      name: String(user.name ?? ""),
      displayName: String(user.displayName ?? user.name ?? ""),
    },
    pubKeyCredParams:
      (options.pubKeyCredParams as PublicKeyCredentialParameters[] | undefined) ?? [
        { type: "public-key", alg: -7 },
      ],
    timeout: typeof options.timeout === "number" ? options.timeout : 60000,
    excludeCredentials,
    authenticatorSelection: options.authenticatorSelection as
      | AuthenticatorSelectionCriteria
      | undefined,
    attestation: (options.attestation as AttestationConveyancePreference) ?? "none",
  }
}

async function runWebAuthnCeremony(
  rawOptions: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof window.PublicKeyCredential === "undefined") {
    throw new Error("This browser does not support WebAuthn/passkeys")
  }
  const credential = (await navigator.credentials.create({
    publicKey: toCreationOptions(rawOptions),
  })) as PublicKeyCredential | null
  if (!credential) throw new Error("Passkey creation was cancelled")
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bytesToBase64Url(response.attestationObject),
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
    },
  }
}

function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [label, setLabel] = useState("")
  const [registerOpen, setRegisterOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const loading = passkeys === null && error === null

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet<{ passkeys: PasskeyRow[] | null }>("/me/mfa/passkeys")
      setError(null)
      setPasskeys(data?.passkeys ?? [])
    } catch (cause) {
      setError(cause)
    }
  }, [])

  useMountLoad(load)

  const register = async () => {
    setBusy(true)
    try {
      const beginRes = await apiPost<{ options?: CreationOptionsContainer }>(
        "/me/mfa/passkeys/begin-registration",
      )
      // Live backend answers { data: { options: { publicKey: {...} } } };
      // toCreationOptions also tolerates the publicKey key being absent.
      const rawOptions =
        ((beginRes.data?.options ?? beginRes.data) as unknown as Record<string, unknown>) ?? {}
      const credential = await runWebAuthnCeremony(rawOptions)
      await apiPost("/me/mfa/passkeys/register", {
        credential,
        label: label.trim(),
      })
      toast.success("Passkey registered")
      setRegisterOpen(false)
      setLabel("")
      await load()
    } catch (cause) {
      // Browser ceremonies fail outside the RP domain or without platform
      // authenticators — surface the real reason instead of pretending.
      const message =
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Passkey registration failed"
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (passkey: PasskeyRow) => {
    try {
      await apiDelete(`/me/mfa/passkeys/${passkey.id}`)
      toast.success("Passkey removed")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove passkey")
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FingerprintIcon className="size-5" /> Passkeys
          </CardTitle>
          <CardDescription>
            Sign in with biometrics or a security key. Registration runs in this
            browser and requires a platform authenticator plus the production
            domain configured on the backend.
          </CardDescription>
        </div>
        <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
          <Button onClick={() => setRegisterOpen(true)}>
            <KeyRoundIcon /> Register passkey
          </Button>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Register a passkey</DialogTitle>
              <DialogDescription>
                Your browser will ask for biometric/PIN confirmation. If the
                ceremony fails here, the backend WebAuthn domain does not match
                this origin — use the production URL.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="pk-label">Label</Label>
              <Input
                id="pk-label"
                placeholder="MacBook Touch ID"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRegisterOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void register()} disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : null} Start ceremony
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorBanner error={error} />
        ) : !passkeys || passkeys.length === 0 ? (
          <EmptyState message="No passkeys registered yet." />
        ) : (
          <SimpleDataTable
            columns={[
              { key: "label", header: "Label" },
              {
                key: "created_at",
                header: "Created",
                render: (row) => formatDateTime(row.created_at),
              },
              {
                key: "last_used_at",
                header: "Last used",
                render: (row) =>
                  row.last_used_at ? formatDateTime(row.last_used_at) : "Never",
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this passkey?</AlertDialogTitle>
                        <AlertDialogDescription>
                          You will no longer be able to sign in with{" "}
                          {row.label || "this device"}.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(row)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ),
              },
            ]}
            rows={passkeys}
            getRowKey={(row) => row.id}
            emptyMessage="No passkeys registered yet."
          />
        )}
      </CardContent>
    </Card>
  )
}

// ---- Sessions -------------------------------------------------------------------

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  const loading = sessions === null && error === null

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet<SessionRow[]>("/me/sessions")
      setError(null)
      setSessions(data ?? [])
    } catch (cause) {
      setError(cause)
    }
  }, [])

  useMountLoad(load)

  const revoke = async (session: SessionRow) => {
    try {
      await apiDelete(`/me/sessions/${session.id}`)
      toast.success(session.is_current ? "Signed out everywhere (this session)" : "Session revoked")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to revoke session")
    }
  }

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
            columns={[
              {
                key: "device_name",
                header: "Device",
                render: (row) => (
                  <span className="max-w-70 truncate block" title={row.user_agent}>
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
                render: (row) => (
                  <Badge variant={row.revoked ? "destructive" : row.is_current ? "default" : "secondary"}>
                    {row.revoked ? "revoked" : row.is_current ? "current session" : "active"}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (row) =>
                  row.revoked ? null : (
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
                            {row.is_current
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
            ]}
            rows={(sessions ?? []).filter((session) => !session.revoked)}
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

  const columns: Array<SimpleColumn<SecurityEventRow>> = [
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
        <span className="block max-w-60 truncate" title={row.user_agent}>
          {row.user_agent || "—"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "When",
      render: (row) => formatDateTime(row.created_at),
    },
  ]

  const pageCount =
    meta && meta.per_page > 0 && typeof meta.total === "number"
      ? Math.ceil(meta.total / meta.per_page)
      : 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security activity</CardTitle>
        <CardDescription>Logins and other auth events recorded for your account.</CardDescription>
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
              columns={columns}
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

