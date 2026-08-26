// Staff API keys: full CRUD over /v1/api-keys (user-scoped only — no org
// toggle). Create with scopes/expiry/allowed IPs, edit via fresh GET of the
// key, rotate and revoke; create/rotate answer a one-time secret that is
// shown exactly once in a dedicated dialog. The scope checkbox list mirrors
// internal/iam/iam.go validScopes — there is no scope-catalog endpoint, and
// the live backend rejects anything outside this registry.
import { useCallback, useEffect, useState } from "react"
import {
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import type { PagedMeta } from "@/lib/types"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { formatDateTime } from "./format"

/** Mirrors internal/iam/iam.go validScopes (verified against live validation). */
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
  created_at?: string
  revoked_at?: string | null
}

interface CreateKeyResponse {
  key?: ApiKeyRow
  secret?: string
}

const PER_PAGE = 20

export default function StaffApiKeysPage() {
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiGet<ApiKeyRow[]>("/api-keys", {
        query: { owner_type: "user", page, per_page: PER_PAGE },
      })
      setKeys(response.data ?? [])
      setMeta((response.meta as PagedMeta | undefined) ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  const rotate = async (row: ApiKeyRow) => {
    try {
      const { data } = await apiPost<CreateKeyResponse>(`/api-keys/${row.id}/rotate`, {})
      toast.success("Key rotated")
      await load()
      if (typeof data?.secret === "string") {
        setSecretReveal({ title: `New secret for ${row.name}`, secret: data.secret })
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to rotate key")
    }
  }

  const revoke = async (row: ApiKeyRow) => {
    try {
      await apiDelete(`/api-keys/${row.id}`)
      toast.success("Key revoked")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to revoke key")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My API keys"
        description="Personal programmatic access tokens. Secrets are shown exactly once."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> Create key
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scope</CardTitle>
          <CardDescription>
            These keys authenticate as your user account and inherit your permissions.
          </CardDescription>
        </CardHeader>
      </Card>

      <SimpleDataTable
        columns={
          [
            {
              key: "name",
              header: "Name",
              render: (row) => <span className="font-medium">{row.name}</span>,
            },
            { key: "key_prefix", header: "Prefix" },
            {
              key: "scopes",
              header: "Scopes",
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {(row.scopes ?? []).join(", ") || "—"}
                </span>
              ),
            },
            {
              key: "allowed_ips",
              header: "Allowed IPs",
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {(row.allowed_ips ?? []).length > 0
                    ? (row.allowed_ips ?? []).join(", ")
                    : "Any"}
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
              key: "expires_at",
              header: "Expires",
              render: (row) =>
                row.expires_at ? formatDateTime(row.expires_at) : "No expiry",
            },
            {
              key: "created_at",
              header: "Created",
              render: (row) => formatDateTime(row.created_at),
            },
            {
              key: "actions",
              header: "",
              className: "w-56",
              render: (row) =>
                row.status === "active" ? (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void rotate(row)}>
                      <RefreshCwIcon /> Rotate
                    </Button>
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
                            Any client using this key stops working immediately. This
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void revoke(row)}>
                            Revoke key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : (
                  <span className="block text-right text-xs text-muted-foreground">
                    Revoked {formatDateTime(row.revoked_at)}
                  </span>
                ),
            },
          ] satisfies Array<SimpleColumn<ApiKeyRow>>
        }
        rows={keys}
        loading={loading}
        getRowKey={(row) => row.id}
        skeletonRows={4}
        emptyMessage="No API keys yet. Create one to call the API programmatically."
      />

      {meta && typeof meta.total === "number" && meta.per_page > 0 && meta.total > meta.per_page ? (
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

// ---- Scope picker -----------------------------------------------------------------

function ScopePicker({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (scope: string, checked: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <Label>Scopes *</Label>
      <div className="grid max-h-52 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-3">
        {VALID_SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(scope)}
              onCheckedChange={(checked) => onToggle(scope, checked === true)}
            />
            <span className="font-mono text-xs">{scope}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.length} selected of {VALID_SCOPES.length} available scopes.
      </p>
    </div>
  )
}

function parseAllowedIps(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

// ---- Create -------------------------------------------------------------------------

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (secret: string) => void
}) {
  const [name, setName] = useState("")
  // Safe default scope; everything else is opt-in.
  const [scopes, setScopes] = useState<string[]>(["profile.read"])
  const [allowedIps, setAllowedIps] = useState("")
  const [expiryDays, setExpiryDays] = useState("")
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
        owner_type: "user",
        name: name.trim(),
        scopes,
      }
      const ips = parseAllowedIps(allowedIps)
      if (ips.length > 0) body.allowed_ips = ips
      const days = Number(expiryDays)
      if (expiryDays && Number.isFinite(days) && days > 0) {
        body.expires_at = new Date(Date.now() + days * 86400000).toISOString()
      }
      const { data } = await apiPost<CreateKeyResponse>("/api-keys", body)
      toast.success("API key created")
      setName("")
      setAllowedIps("")
      setExpiryDays("")
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
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="sak-name">Name *</Label>
              <Input
                id="sak-name"
                placeholder="CI deployer"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sak-expiry">Expires (days)</Label>
              <Input
                id="sak-expiry"
                inputMode="numeric"
                placeholder="Empty = never"
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sak-ips">Allowed IPs (comma or newline separated)</Label>
            <Input
              id="sak-ips"
              placeholder="203.0.113.10, 198.51.100.0/24"
              value={allowedIps}
              onChange={(event) => setAllowedIps(event.target.value)}
            />
          </div>
          <ScopePicker selected={scopes} onToggle={toggleScope} />
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

// ---- Edit ----------------------------------------------------------------------------

function EditKeyDialog({
  open,
  onOpenChange,
  row,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ApiKeyRow
  onSaved: () => void
}) {
  // Prefill from the list row, then refresh via GET /api-keys/:key_id so the
  // form reflects the authoritative server state.
  const [name, setName] = useState(row.name)
  const [scopes, setScopes] = useState<string[]>(row.scopes ?? [])
  const [allowedIps, setAllowedIps] = useState((row.allowed_ips ?? []).join(", "))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await apiGet<ApiKeyRow>(`/api-keys/${row.id}`)
        if (cancelled || !data) return
        setName(data.name)
        setScopes(data.scopes ?? [])
        setAllowedIps((data.allowed_ips ?? []).join(", "))
      } catch {
        // Keep list-row values when the refetch fails.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [row.id])

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
      await apiPatch(`/api-keys/${row.id}`, {
        name: name.trim(),
        scopes,
        allowed_ips: parseAllowedIps(allowedIps),
      })
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
          <DialogDescription>Prefix {row.key_prefix || row.public_id || row.id}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sake-name">Name *</Label>
            <Input
              id="sake-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sake-ips">Allowed IPs</Label>
            <Input
              id="sake-ips"
              value={allowedIps}
              onChange={(event) => setAllowedIps(event.target.value)}
              placeholder="Empty allows every IP"
            />
          </div>
          <ScopePicker selected={scopes} onToggle={toggleScope} />
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
