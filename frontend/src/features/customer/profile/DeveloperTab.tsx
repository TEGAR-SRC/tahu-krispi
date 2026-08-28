// Developer tab: SSH keys, startup scripts (org-scoped) and API keys
// (user-scoped) with one-time secret reveal and rotate.
import { useCallback, useEffect, useState } from "react"
import { CopyIcon, Loader2Icon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface SshKey {
  id: string
  name: string
  public_key?: string
  fingerprint?: string
  created_at?: string
}

interface StartupScript {
  id: string
  name: string
  content?: string
  created_at?: string
}

interface ApiKey {
  id: string
  public_id?: string
  name: string
  key_prefix?: string
  scopes: string[]
  status: string
  last_used_at?: string | null
  created_at?: string
}

export function DeveloperTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SshKeysCard />
      <StartupScriptsCard />
      <ApiKeysCard />
    </div>
  )
}

// ---- SSH keys -----------------------------------------------------------------

function SshKeysCard() {
  const { orgId } = useOrg()
  const [keys, setKeys] = useState<SshKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [name, setName] = useState("")
  const [publicKey, setPublicKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SshKey | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<SshKey[]>("/ssh-keys", { headers: orgHeaders(orgId) })
      setKeys(data ?? [])
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

  const add = async () => {
    if (!name.trim() || !publicKey.trim()) {
      toast.error("Name and public key are required")
      return
    }
    setBusy(true)
    try {
      await apiPost("/ssh-keys", { name: name.trim(), public_key: publicKey.trim() }, { headers: orgHeaders(orgId) })
      toast.success("SSH key added")
      setName("")
      setPublicKey("")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to add SSH key")
    } finally {
      setBusy(false)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/ssh-keys/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Key "${deleteTarget.name}" removed`)
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove key")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">SSH keys</CardTitle>
        <CardDescription>Injected into new instances at provisioning time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBanner error={error} />
        {!error && !loading && keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SSH keys yet.</p>
        ) : null}
        <ul className="space-y-1.5">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{key.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {key.fingerprint || key.public_key?.slice(0, 40) || ""}
                </p>
              </div>
              <Button size="icon" variant="ghost" title="Remove" onClick={() => setDeleteTarget(key)}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="ssh-name">Name</Label>
            <Input id="ssh-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="work-laptop" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ssh-key">Public key</Label>
            <Textarea
              id="ssh-key"
              rows={2}
              value={publicKey}
              onChange={(event) => setPublicKey(event.target.value)}
              placeholder="ssh-ed25519 AAAA…"
              className="font-mono text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void add()} disabled={busy}>
            <PlusIcon /> Add key
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.name}”?</AlertDialogTitle>
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
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---- Startup scripts ----------------------------------------------------------

function StartupScriptsCard() {
  const { orgId } = useOrg()
  const [scripts, setScripts] = useState<StartupScript[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StartupScript | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<StartupScript[]>("/startup-scripts", { headers: orgHeaders(orgId) })
      setScripts(data ?? [])
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

  const add = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error("Name and script content are required")
      return
    }
    setBusy(true)
    try {
      await apiPost(
        "/startup-scripts",
        { name: name.trim(), content },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Startup script saved")
      setName("")
      setContent("")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save script")
    } finally {
      setBusy(false)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/startup-scripts/${deleteTarget.id}`, { headers: orgHeaders(orgId) })
      toast.success(`Script "${deleteTarget.name}" removed`)
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove script")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Startup scripts</CardTitle>
        <CardDescription>Cloud-init style scripts executed on first boot.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBanner error={error} />
        {!error && !loading && scripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No startup scripts yet.</p>
        ) : null}
        <ul className="space-y-1.5">
          {scripts.map((script) => (
            <li key={script.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{script.name}</p>
                <p className="truncate text-xs text-muted-foreground">{script.content?.slice(0, 60)}</p>
              </div>
              <Button size="icon" variant="ghost" title="Remove" onClick={() => setDeleteTarget(script)}>
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="ss-name">Name</Label>
            <Input id="ss-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="docker-install" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ss-content">Script</Label>
            <Textarea
              id="ss-content"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="#!/bin/bash"
              className="font-mono text-xs"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void add()} disabled={busy}>
            <PlusIcon /> Save script
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.name}”?</AlertDialogTitle>
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
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---- API keys -----------------------------------------------------------------

const SCOPE_CHOICES = [
  "*",
  "instances.read",
  "instances.create",
  "instances.update",
  "instances.delete",
  "snapshots.read",
  "backups.read",
  "networks.read",
  "networks.write",
  "billing.read",
]

function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<ApiKey[]>("/api-keys", { query: { owner_type: "user" } })
      setKeys(data ?? [])
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
      await apiDelete(`/api-keys/${revokeTarget.id}`)
      toast.success(`API key "${revokeTarget.name}" revoked`)
      setRevokeTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to revoke key")
    }
  }

  const rotate = async (key: ApiKey) => {
    try {
      const { data } = await apiPost<{ secret?: string }>(`/api-keys/${key.id}/rotate`)
      toast.success("Key rotated — update your integrations")
      if (data?.secret) setCreatedSecret(data.secret)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Rotation failed")
    }
  }

  const columns: Array<SimpleColumn<ApiKey>> = [
    {
      key: "name",
      header: "Key",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{row.key_prefix ?? row.public_id ?? ""}…</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "scopes", header: "Scopes", render: (row) => row.scopes.join(", ") || "—" },
    {
      key: "last_used_at",
      header: "Last used",
      render: (row) => formatDateTime(row.last_used_at ?? null),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (row) =>
        row.status === "active" ? (
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" title="Rotate" onClick={() => void rotate(row)}>
              <RefreshCwIcon />
            </Button>
            <Button size="icon" variant="ghost" title="Revoke…" onClick={() => setRevokeTarget(row)}>
              <Trash2Icon />
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">API keys</CardTitle>
          <CardDescription>
            Machine credentials for the REST API — send as X-API-Key with X-Organization-ID.
          </CardDescription>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New API key
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <SimpleDataTable
          columns={columns}
          rows={keys}
          loading={loading}
          error={error}
          emptyMessage={error ? undefined : "No API keys yet."}
          getRowKey={(row) => row.id}
        />
      </CardContent>

      <CreateApiKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(secret) => {
        setCreateOpen(false)
        setCreatedSecret(secret)
        void load()
      }} />

      {/* One-time secret */}
      <Dialog open={createdSecret !== null} onOpenChange={(open) => !open && setCreatedSecret(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your new API key secret</DialogTitle>
            <DialogDescription>
              Copy it now — it is never shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-xs">
              {createdSecret}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(createdSecret ?? "")
                  toast.success("Secret copied")
                } catch {
                  toast.error("Clipboard unavailable")
                }
              }}
            >
              <CopyIcon /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Integrations using this key stop working immediately.</AlertDialogDescription>
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

function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (secret: string) => void
}) {
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<string[]>(["instances.read"])
  const [allowedIps, setAllowedIps] = useState("")
  const [busy, setBusy] = useState(false)

  const toggleScope = (scope: string) => {
    if (scope === "*") {
      setSelected(["*"])
      return
    }
    setSelected((current) => {
      const withoutStar = current.filter((item) => item !== "*")
      return withoutStar.includes(scope)
        ? withoutStar.filter((item) => item !== scope)
        : [...withoutStar, scope]
    })
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give the key a name")
      return
    }
    if (selected.length === 0) {
      toast.error("Pick at least one scope")
      return
    }
    setBusy(true)
    try {
      const { data } = await apiPost<{ key: ApiKey; secret: string }>(
        "/api-keys",
        {
          owner_type: "user",
          name: name.trim(),
          scopes: selected,
          allowed_ips: allowedIps
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
      )
      toast.success("API key created")
      setName("")
      setAllowedIps("")
      onCreated(data?.secret ?? "")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create key")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>Scope the key down to only what it needs.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ak-name">Name *</Label>
            <Input id="ak-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ci-pipeline" />
          </div>
          <div className="space-y-1.5">
            <Label>Scopes *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SCOPE_CHOICES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="accent-current"
                  />
                  <span className="font-mono">{scope}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ak-ips">Allowed IPs (optional)</Label>
            <Textarea
              id="ak-ips"
              rows={2}
              value={allowedIps}
              onChange={(event) => setAllowedIps(event.target.value)}
              placeholder={"203.0.113.10\n198.51.100.0/24"}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
