// API keys: list (personal + organization), create with scope checkboxes,
// edit name/scopes/allowed IPs/expiry, rotate with one-time secret reveal and
// revoke. The scope list mirrors the backend iam.validScopes registry; the
// API itself has no "list scopes" endpoint, so it is compiled into the UI.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import type { PagedMeta } from "@/lib/types"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

/** Mirrors internal/iam/iam.go validScopes — the backend validates against this. */
const VALID_SCOPES = [
  "profile.read",
  "instances.read",
  "instances.create",
  "instances.update",
  "instances.delete",
  "snapshots.read",
  "snapshots.create",
  "snapshots.delete",
  "backups.read",
  "backups.restore",
  "networks.read",
  "networks.write",
  "firewalls.read",
  "firewalls.write",
  "ssh_keys.read",
  "ssh_keys.write",
  "storage.read",
  "storage.write",
  "billing.read",
  "api_keys.read",
  "api_keys.write",
]

interface ApiKeyRow {
  id: string
  public_id?: string
  owner_type?: string
  name: string
  key_prefix?: string
  scopes: string[] | null
  allowed_ips?: string[] | null
  status?: string
  expires_at?: string | null
  last_used_at?: string | null
  last_used_ip?: string
  created_at?: string
  revoked_at?: string | null
}

const PER_PAGE = 20

export default function ApiKeysPage() {
  const { organizations, organization, orgId } = useOrg()
  const [ownerType, setOwnerType] = useState<"user" | "organization">("user")
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [meta, setMeta] = useState<PagedMeta | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ApiKeyRow | null>(null)
  // One-time secret returned by create/rotate, shown in a dedicated dialog.
  const [secretReveal, setSecretReveal] = useState<{ title: string; secret: string } | null>(
    null,
  )

  const headers = useMemo(
    () => (ownerType === "organization" && orgId ? orgHeaders(orgId) : undefined),
    [ownerType, orgId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiGet<ApiKeyRow[]>("/api-keys", {
        query: { owner_type: ownerType, page, per_page: PER_PAGE },
        headers,
      })
      setKeys(response.data ?? [])
      setMeta((response.meta as PagedMeta | undefined) ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [ownerType, page, headers])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Programmatic access tokens. Secrets are shown exactly once."
        actions={
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> Create key
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scope</CardTitle>
          <CardDescription>
            Personal keys belong to your user; organization keys are shared with members
            holding api_keys permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={ownerType}
            onValueChange={(value) => {
              setOwnerType(value === "organization" ? "organization" : "user")
              setPage(1)
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Personal keys</SelectItem>
              <SelectItem value="organization" disabled={organizations.length === 0}>
                Organization{organization ? `: ${organization.name}` : ""}
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <ErrorBanner error={error} />

      <SimpleDataTable
        columns={
          [
            {
              key: "name",
              header: "Name",
              className: "max-w-[200px] whitespace-normal",
              render: (row) => (
                <span className="min-w-0 block max-w-[160px] truncate font-medium" title={row.name}>
                  {row.name}
                </span>
              ),
            },
            { key: "key_prefix", header: "Prefix" },
            {
              key: "scopes",
              header: "Scopes",
              className: "max-w-[260px] whitespace-normal",
              render: (row) => (
                <span className="break-all [overflow-wrap:anywhere] whitespace-normal text-xs text-muted-foreground">
                  {(row.scopes ?? []).join(", ") || "—"}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <Badge variant={row.status === "active" ? "default" : "secondary"}>
                  {row.status ?? "unknown"}
                </Badge>
              ),
            },
            {
              key: "last_used_at",
              header: "Last used",
              render: (row) =>
                row.last_used_at
                  ? `${formatDateTime(row.last_used_at)}${row.last_used_ip ? ` · ${row.last_used_ip}` : ""}`
                  : "Never",
            },
            {
              key: "expires_at",
              header: "Expires",
              render: (row) =>
                row.expires_at ? formatDateTime(row.expires_at) : "No expiry",
            },
            {
              key: "actions",
              header: "",
              className: "w-56",
              render: (row) => (
                <KeyActions
                  row={row}
                  ownerType={ownerType}
                  headers={headers}
                  onChanged={() => void load()}
                  onEdit={() => setEditing(row)}
                  onRotated={(secret) => setSecretReveal({ title: `New secret for ${row.name}`, secret })}
                />
              ),
            },
          ] satisfies Array<SimpleColumn<ApiKeyRow>>
        }
        rows={keys}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        skeletonRows={4}
        emptyMessage="No API keys yet. Create one to call the API programmatically."
      />

      {meta && typeof meta.total === "number" && meta.per_page > 0 && meta.total > meta.per_page ? (
        <div className="flex min-w-0 items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {meta.page} of {Math.ceil(meta.total / meta.per_page)} · {meta.total} keys
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= Math.ceil(meta.total / meta.per_page)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        ownerType={ownerType}
        orgId={orgId}
        onCreated={(secret) => {
          setCreateOpen(false)
          setSecretReveal({ title: "Your new API key secret", secret })
          void load()
        }}
      />

      {editing ? (
        <EditKeyDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          row={editing}
          headers={headers}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}

      {/* One-time secret */}
      <Dialog
        open={secretReveal !== null}
        onOpenChange={(open) => !open && setSecretReveal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{secretReveal?.title}</DialogTitle>
            <DialogDescription>
              Copy it now — the backend never returns this value again.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all rounded bg-muted px-3 py-2 font-mono text-sm select-all">
            {secretReveal?.secret}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (secretReveal) {
                  void navigator.clipboard.writeText(secretReveal.secret)
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

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

// ---- Row actions ---------------------------------------------------------------

function KeyActions({
  row,
  ownerType,
  headers,
  onEdit,
  onRotated,
  onChanged,
}: {
  row: ApiKeyRow
  ownerType: "user" | "organization"
  headers: Record<string, string> | undefined
  onEdit: () => void
  onRotated: (secret: string) => void
  onChanged: () => Promise<void> | void
}) {
  const [rotating, setRotating] = useState(false)

  const rotate = async () => {
    setRotating(true)
    try {
      const { data } = await apiPost<{ secret?: string }>(
        `/api-keys/${row.id}/rotate`,
        {},
        { headers },
      )
      toast.success("Key rotated")
      await onChanged()
      if (typeof data?.secret === "string") onRotated(data.secret)
    } catch (cause) {
      toast.error(errorMessage(cause, "Failed to rotate key"))
    } finally {
      setRotating(false)
    }
  }

  const revoke = async () => {
    try {
      await apiDelete(`/api-keys/${row.id}`, { headers })
      toast.success("Key revoked")
      await onChanged()
    } catch (cause) {
      toast.error(errorMessage(cause, "Failed to revoke key"))
    }
  }

  const active = row.status === "active"

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" disabled={!active || rotating} onClick={() => void rotate()}>
        {rotating ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Rotate
      </Button>
      {active ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive">
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke “{row.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Any client using {ownerType === "user" ? "this personal key" : "this organization key"}{" "}
                stops working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void revoke()}>Revoke key</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

// ---- Create ----------------------------------------------------------------------

function CreateKeyDialog({
  open,
  onOpenChange,
  ownerType,
  orgId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ownerType: "user" | "organization"
  orgId: string
  onCreated: (secret: string) => void
}) {
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["profile.read"])
  const [allowedIps, setAllowedIps] = useState("")
  const [expiryDays, setExpiryDays] = useState("0")
  const [busy, setBusy] = useState(false)

  const toggleScope = (scope: string, checked: boolean) => {
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope),
    )
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Key name is required")
      return
    }
    if (scopes.length === 0) {
      toast.error("Pick at least one scope")
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        owner_type: ownerType,
        name: name.trim(),
        scopes,
      }
      const ips = allowedIps
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (ips.length > 0) body.allowed_ips = ips
      const days = Number(expiryDays)
      if (Number.isFinite(days) && days > 0) {
        body.expires_at = new Date(Date.now() + days * 86400000).toISOString()
      }
      const { data } = await apiPost<{ key?: ApiKeyRow; secret?: string }>("/api-keys", body, {
        headers: ownerType === "organization" && orgId ? orgHeaders(orgId) : undefined,
      })
      toast.success("API key created")
      setName("")
      setAllowedIps("")
      setExpiryDays("0")
      onCreated(typeof data?.secret === "string" ? data.secret : "")
    } catch (cause) {
      toast.error(errorMessage(cause, "Failed to create API key"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Grant only the scopes the client needs. The raw secret appears once after
            creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="ak-name">Name *</Label>
              <Input
                id="ak-name"
                placeholder="CI deployer"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ak-expiry">Expires (days)</Label>
              <Input
                id="ak-expiry"
                inputMode="numeric"
                placeholder="0 = never"
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ak-ips">Allowed IPs (comma or newline separated)</Label>
            <Input
              id="ak-ips"
              placeholder="203.0.113.10, 198.51.100.0/24"
              value={allowedIps}
              onChange={(event) => setAllowedIps(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Scopes *</Label>
            <div className="grid w-full max-w-full min-w-0 max-h-52 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">
              {VALID_SCOPES.map((scope) => (
                <label key={scope} className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                  />
                  <span className="font-mono text-xs">{scope}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {scopes.length} selected of {VALID_SCOPES.length} available scopes.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />} Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Edit -------------------------------------------------------------------------

function EditKeyDialog({
  open,
  onOpenChange,
  row,
  headers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ApiKeyRow
  headers: Record<string, string> | undefined
  onSaved: () => void
}) {
  const [name, setName] = useState(row.name)
  const [scopes, setScopes] = useState<string[]>(row.scopes ?? [])
  const [allowedIps, setAllowedIps] = useState((row.allowed_ips ?? []).join(", "))
  const [busy, setBusy] = useState(false)

  const toggleScope = (scope: string, checked: boolean) => {
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope),
    )
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Key name is required")
      return
    }
    if (scopes.length === 0) {
      toast.error("Pick at least one scope")
      return
    }
    setBusy(true)
    try {
      const ips = allowedIps
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      await apiPatch(
        `/api-keys/${row.id}`,
        { name: name.trim(), scopes, allowed_ips: ips },
        { headers },
      )
      toast.success("Key updated")
      onSaved()
    } catch (cause) {
      toast.error(errorMessage(cause, "Failed to update key"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit “{row.name}”</DialogTitle>
          <DialogDescription className="break-all [overflow-wrap:anywhere]">
            Prefix {row.key_prefix || row.public_id || row.id}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ake-name">Name *</Label>
            <Input id="ake-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ake-ips">Allowed IPs</Label>
            <Input
              id="ake-ips"
              value={allowedIps}
              onChange={(event) => setAllowedIps(event.target.value)}
              placeholder="Empty allows every IP"
            />
          </div>
          <div className="space-y-2">
            <Label>Scopes *</Label>
            <div className="grid w-full max-w-full min-w-0 max-h-52 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">
              {VALID_SCOPES.map((scope) => (
                <label key={scope} className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                  />
                  <span className="font-mono text-xs">{scope}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
