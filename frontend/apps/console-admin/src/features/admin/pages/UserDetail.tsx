// Admin user detail page (/admin/users/:userId). The API has no single-user
// GET, so the row is resolved through the list endpoint (search first, then a
// full walk) — see identityLookup.ts. Covers profile fields, resource limits
// (PATCH /admin/users/:user_id/limits) and suspend/activate/grant-admin.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeftIcon } from "lucide-react"
import { apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { DetailField, StatusBadge } from "./shared"
import { formatDateTime } from "./format"
import { findAdminUser, type AdminUserRow } from "./identityLookup"

type ConfirmAction = "suspend" | "activate" | "grant" | "revoke"

const CONFIRM_COPY: Record<
  ConfirmAction,
  { title: string; body: string; label: string; destructive: boolean }
> = {
  suspend: {
    title: "Suspend this user?",
    body: "The account will no longer be able to sign in or use its resources.",
    label: "Suspend user",
    destructive: true,
  },
  activate: {
    title: "Activate this user?",
    body: "The account will regain full access.",
    label: "Activate user",
    destructive: false,
  },
  grant: {
    title: "Grant platform admin?",
    body: "This user will gain full platform-admin capabilities.",
    label: "Grant admin",
    destructive: false,
  },
  revoke: {
    title: "Revoke platform admin?",
    body: "This user will lose all platform-admin capabilities.",
    label: "Revoke admin",
    destructive: true,
  },
}

export default function UserDetailPage() {
  const userId = useParams().userId ?? ""
  const [user, setUser] = useState<AdminUserRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    findAdminUser(userId)
      .then((row) => {
        if (cancelled) return
        setUser(row)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, reloadTick])

  const runAction = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      try {
        await action()
        toast.success(successMessage)
        setReloadTick((tick) => tick + 1)
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      }
    },
    [],
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link to="/admin/users">
          <ArrowLeftIcon /> Back to users
        </Link>
      </Button>

      <PageHeader
        title={user ? user.email : loading ? "Loading user…" : "User detail"}
        description={user ? `Public ID ${user.public_id}` : undefined}
        actions={
          user ? (
            <div className="flex flex-wrap items-center gap-2">
              {user.status !== "suspended" ? (
                <Button variant="destructive" size="sm" onClick={() => setConfirmAction("suspend")}>
                  Suspend
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmAction("activate")}>
                  Activate
                </Button>
              )}
              {user.is_platform_admin ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmAction("revoke")}>
                  Revoke platform admin
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmAction("grant")}>
                  Grant platform admin
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {error ? <ErrorBanner error={error} /> : null}
      {!error && loading ? (
        <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
      {!error && !loading && !user ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          No user matches id <span className="font-mono">{userId}</span> — it may have been deleted.
        </p>
      ) : null}

      {user ? (
        <>
          <dl className="grid w-full max-w-full min-w-0 gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailField label="Full name">{user.full_name || "—"}</DetailField>
            <DetailField label="Username">{user.username || "—"}</DetailField>
            <DetailField label="Status">
              <StatusBadge status={user.status} />
            </DetailField>
            <DetailField label="Email status">
              <StatusBadge status={user.email_status} />
            </DetailField>
            <DetailField label="Internal ID">
              <span className="font-mono text-xs break-all">{user.id}</span>
            </DetailField>
            <DetailField label="Platform admin">
              {user.is_platform_admin ? (
                <span className="text-xs font-medium text-primary">yes</span>
              ) : (
                <span className="text-xs text-muted-foreground">no</span>
              )}
            </DetailField>
            <DetailField label="Last login">{formatDateTime(user.last_login_at)}</DetailField>
            <DetailField label="Created">{formatDateTime(user.created_at)}</DetailField>
          </dl>

          <LimitsEditor user={user} />
        </>
      ) : null}

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          {confirmAction ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{CONFIRM_COPY[confirmAction].title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {CONFIRM_COPY[confirmAction].body}
                  {user ? ` Target: ${user.email}.` : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={
                    CONFIRM_COPY[confirmAction].destructive
                      ? "bg-destructive text-primary-foreground hover:bg-destructive/90"
                      : ""
                  }
                  onClick={() => {
                    const action = confirmAction
                    setConfirmAction(null)
                    if (!action || !user) return
                    if (action === "suspend") {
                      void runAction(
                        () => apiPost(`/admin/users/${user.id}/suspend`),
                        "User suspended",
                      )
                    } else if (action === "activate") {
                      void runAction(
                        () => apiPost(`/admin/users/${user.id}/activate`),
                        "User activated",
                      )
                    } else {
                      const grant = action === "grant"
                      void runAction(
                        () => apiPost(`/admin/users/${user.id}/grant-admin`, { grant }),
                        grant ? "Platform admin granted" : "Platform admin revoked",
                      )
                    }
                  }}
                >
                  {CONFIRM_COPY[confirmAction].label}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Sets max_hourly_instances / max_instance_monthly_cost; blank keeps current. */
function LimitsEditor({ user }: { user: AdminUserRow }) {
  const [maxInstances, setMaxInstances] = useState("")
  const [maxCost, setMaxCost] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const body: Record<string, number> = {}
    const instances = Number(maxInstances)
    const cost = Number(maxCost)
    if (maxInstances.trim() !== "") {
      if (!Number.isFinite(instances) || instances <= 0) {
        toast.error("Max hourly instances must be a positive number")
        return
      }
      body.max_hourly_instances = instances
    }
    if (maxCost.trim() !== "") {
      if (!Number.isFinite(cost) || cost < 0) {
        toast.error("Max monthly cost must be zero or greater")
        return
      }
      body.max_instance_monthly_cost = cost
    }
    if (Object.keys(body).length === 0) {
      toast.error("Fill at least one limit field")
      return
    }
    setSaving(true)
    try {
      await apiPatch(`/admin/users/${user.id}/limits`, body)
      toast.success("Limits updated")
      setMaxInstances("")
      setMaxCost("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update limits")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div>
        <h2 className="text-sm font-semibold">Resource limits</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The API does not expose an endpoint to read current limits — leave a field blank to keep
          its existing value.
        </p>
      </div>
      <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`max-inst-${user.id}`}>Max hourly instances</Label>
          <Input
            id={`max-inst-${user.id}`}
            inputMode="numeric"
            placeholder="keep current"
            value={maxInstances}
            onChange={(event) => setMaxInstances(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`max-cost-${user.id}`}>Max instance monthly cost</Label>
          <Input
            id={`max-cost-${user.id}`}
            inputMode="decimal"
            placeholder="keep current"
            value={maxCost}
            onChange={(event) => setMaxCost(event.target.value)}
          />
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => void submit()}>
        {saving ? "Saving…" : "Save limits"}
      </Button>
    </section>
  )
}
