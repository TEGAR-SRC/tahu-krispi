// Admin organization detail page (/admin/organizations/:orgId). The API has
// no single-org GET, so the row is resolved by walking GET /admin/organizations
// (see identityLookup.ts). Mutations: POST .../suspend (there is no reactivate
// endpoint) and PUT .../provider-account to upsert the external provider
// account mapping — the API exposes no read for that mapping either.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeftIcon } from "lucide-react"
import { apiPost, apiPut, ApiError } from "@/lib/api"
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
import { findAdminOrg, type AdminOrgRow } from "./identityLookup"

export default function OrganizationDetailPage() {
  const orgId = useParams().orgId ?? ""
  const [org, setOrg] = useState<AdminOrgRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [suspendOpen, setSuspendOpen] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    findAdminOrg(orgId)
      .then((row) => {
        if (cancelled) return
        setOrg(row)
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
  }, [orgId, reloadTick])

  const suspendOrg = useCallback(async () => {
    try {
      await apiPost(`/admin/organizations/${orgId}/suspend`)
      toast.success("Organization suspended")
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to suspend organization")
    }
  }, [orgId])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link to="/admin/organizations">
          <ArrowLeftIcon /> Back to organizations
        </Link>
      </Button>

      <PageHeader
        title={
          org ? org.name || org.slug : loading ? "Loading organization…" : "Organization detail"
        }
        description={org ? `${org.slug} · ${org.public_id}` : undefined}
        actions={
          org && org.status !== "suspended" ? (
            <Button variant="destructive" size="sm" onClick={() => setSuspendOpen(true)}>
              Suspend organization
            </Button>
          ) : null
        }
      />

      {error ? <ErrorBanner error={error} /> : null}
      {!error && loading ? (
        <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
      {!error && !loading && !org ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          No organization matches id <span className="font-mono">{orgId}</span> — it may have been
          deleted.
        </p>
      ) : null}

      {org ? (
        <>
          <dl className="grid w-full max-w-full min-w-0 gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailField label="Status">
              <StatusBadge status={org.status} />
            </DetailField>
            <DetailField label="Slug">{org.slug}</DetailField>
            <DetailField label="Billing email">{org.billing_email || "—"}</DetailField>
            <DetailField label="Members">{org.member_count}</DetailField>
            <DetailField label="Internal ID">
              <span className="font-mono text-xs break-all">{org.id}</span>
            </DetailField>
            <DetailField label="Public ID">
              <span className="font-mono text-xs break-all">{org.public_id}</span>
            </DetailField>
            <DetailField label="Created">{formatDateTime(org.created_at)}</DetailField>
          </dl>

          {org.status === "suspended" ? (
            <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              This organization is suspended. The API exposes only a suspend endpoint — there is no
              reactivate route to wire here.
            </p>
          ) : null}

          <ProviderAccountForm org={org} />
        </>
      ) : null}

      <AlertDialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {org?.slug ?? "this organization"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Members will lose access and running resources may be stopped. The API offers no
              reactivate endpoint, so this state can only be lifted server-side.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={() => {
                setSuspendOpen(false)
                void suspendOrg()
              }}
            >
              Suspend organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Upserts the provider account mapping via PUT /admin/organizations/:org_id/
 * provider-account. The API has no read endpoint for the mapping, so the form
 * starts blank; blanks are sent as empty strings which the backend stores as
 * NULL — i.e. saving with blank fields CLEARS those values.
 */
function ProviderAccountForm({ org }: { org: AdminOrgRow }) {
  const [providerCode, setProviderCode] = useState("")
  const [externalAccountId, setExternalAccountId] = useState("")
  const [externalAccountName, setExternalAccountName] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await apiPut(`/admin/organizations/${org.id}/provider-account`, {
        provider_code: providerCode.trim(),
        external_account_id: externalAccountId.trim(),
        external_account_name: externalAccountName.trim(),
      })
      toast.success("Provider account mapping saved")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save mapping")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div>
        <h2 className="text-sm font-semibold">Provider account</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Maps this organization onto its external provider account. The API exposes no read
          endpoint for the current mapping — fields saved blank are cleared.
        </p>
      </div>
      <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`provider-code-${org.id}`}>Provider code</Label>
          <Input
            id={`provider-code-${org.id}`}
            placeholder="onidel (default)"
            value={providerCode}
            onChange={(event) => setProviderCode(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ext-account-id-${org.id}`}>External account ID</Label>
          <Input
            id={`ext-account-id-${org.id}`}
            value={externalAccountId}
            onChange={(event) => setExternalAccountId(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ext-account-name-${org.id}`}>External account name</Label>
          <Input
            id={`ext-account-name-${org.id}`}
            value={externalAccountName}
            onChange={(event) => setExternalAccountName(event.target.value)}
          />
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => void submit()}>
        {saving ? "Saving…" : "Save mapping"}
      </Button>
    </section>
  )
}
