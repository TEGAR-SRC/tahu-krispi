// SSH keys: full CRUD over /ssh-keys. These endpoints are organization
// scoped on the backend (X-Organization-ID required), so they reuse the
// active-org context from the layout. PATCH replaces name + public_key in one
// call — that is the shape the API accepts.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2Icon, PencilIcon, PlusIcon, TerminalSquareIcon } from "lucide-react"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
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
import { EmptyState } from "@/components/shared/EmptyState"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

interface SshKeyRow {
  id: string
  name: string
  public_key: string
  fingerprint?: string
  created_at?: string
}

export default function SshKeysPage() {
  const { orgId } = useOrg()
  const [keys, setKeys] = useState<SshKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [editing, setEditing] = useState<SshKeyRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [publicKey, setPublicKey] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<SshKeyRow[]>("/ssh-keys", { headers: orgHeaders(orgId) })
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

  const openCreate = () => {
    setEditing(null)
    setName("")
    setPublicKey("")
    setFormOpen(true)
  }

  const openEdit = (key: SshKeyRow) => {
    setEditing(key)
    setName(key.name)
    setPublicKey(key.public_key)
    setFormOpen(true)
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!publicKey.trim()) {
      toast.error("Public key is required")
      return
    }
    setBusy(true)
    try {
      const body = { name: name.trim(), public_key: publicKey.trim() }
      if (editing) {
        await apiPatch(`/ssh-keys/${editing.id}`, body, { headers: orgHeaders(orgId) })
        toast.success("SSH key updated")
      } else {
        await apiPost("/ssh-keys", body, { headers: orgHeaders(orgId) })
        toast.success("SSH key added")
      }
      setFormOpen(false)
      await load()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to save SSH key",
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (key: SshKeyRow) => {
    try {
      await apiDelete(`/ssh-keys/${key.id}`, { headers: orgHeaders(orgId) })
      toast.success("SSH key deleted")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete SSH key")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SSH keys"
        description="Public keys injected into new instances of the active organization."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon /> Add SSH key
            </Button>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : keys.length === 0 && !error ? (
        <EmptyState
          message="No SSH keys yet."
          description="Paste an OpenSSH public key (ssh-ed25519 … or ssh-rsa …)."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {keys.map((key) => (
            <Card key={key.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TerminalSquareIcon className="size-4 text-muted-foreground" />
                  <span className="truncate">{key.name}</span>
                </CardTitle>
                <CardDescription className="font-mono text-xs break-all">
                  {key.fingerprint || key.public_key.slice(0, 40) + "…"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-3 font-mono text-xs break-all text-muted-foreground" title={key.public_key}>
                  {key.public_key}
                </p>
                <p className="text-xs text-muted-foreground">
                  Added {formatDateTime(key.created_at)}
                </p>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(key)}>
                    <PencilIcon /> Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{key.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Existing instances keep working; new ones can no longer use this key.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(key)}>
                          Delete key
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit SSH key" : "Add SSH key"}</DialogTitle>
            <DialogDescription>
              Saving replaces both name and public key — paste the full key again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sk-name">Name *</Label>
              <Input
                id="sk-name"
                placeholder="laptop-work"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sk-key">Public key *</Label>
              <Textarea
                id="sk-key"
                rows={4}
                className="font-mono text-xs"
                placeholder="ssh-ed25519 AAAA… comment"
                value={publicKey}
                onChange={(event) => setPublicKey(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {editing ? "Save changes" : "Add key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
