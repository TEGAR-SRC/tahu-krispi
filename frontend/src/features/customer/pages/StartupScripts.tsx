// Startup scripts: full CRUD over /startup-scripts (organization scoped on
// the backend, like SSH keys). Content is capped by the API at 48 000 bytes.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { FileCodeIcon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react"
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
import { formatDateTime } from "../format"
import { orgHeaders, useOrg } from "../useOrg"

interface ScriptRow {
  id: string
  name: string
  content: string
  content_sha256?: string
  created_at?: string
}

const MAX_CONTENT_BYTES = 48000

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export default function StartupScriptsPage() {
  const { orgId } = useOrg()
  const [scripts, setScripts] = useState<ScriptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [editing, setEditing] = useState<ScriptRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<ScriptRow[]>("/startup-scripts", {
        headers: orgHeaders(orgId),
      })
      setScripts(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setName("")
    setContent("#!/bin/bash\n")
    setFormOpen(true)
  }

  const openEdit = (script: ScriptRow) => {
    setEditing(script)
    setName(script.name)
    setContent(script.content)
    setFormOpen(true)
  }

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!content.trim()) {
      toast.error("Script content is required")
      return
    }
    if (byteLength(content) > MAX_CONTENT_BYTES) {
      toast.error(`Script exceeds the ${MAX_CONTENT_BYTES} byte limit`)
      return
    }
    setBusy(true)
    try {
      const body = { name: name.trim(), content }
      if (editing) {
        await apiPatch(`/startup-scripts/${editing.id}`, body, {
          headers: orgHeaders(orgId),
        })
        toast.success("Startup script updated")
      } else {
        await apiPost("/startup-scripts", body, { headers: orgHeaders(orgId) })
        toast.success("Startup script created")
      }
      setFormOpen(false)
      await load()
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Failed to save startup script",
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (script: ScriptRow) => {
    try {
      await apiDelete(`/startup-scripts/${script.id}`, { headers: orgHeaders(orgId) })
      toast.success("Startup script deleted")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete script")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Startup scripts"
        description="Scripts executed when instances of the active organization boot."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon /> New script
            </Button>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : scripts.length === 0 && !error ? (
        <EmptyState
          message="No startup scripts yet."
          description="Create a script and pick it when provisioning an instance."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scripts.map((script) => (
            <Card key={script.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCodeIcon className="size-4 text-muted-foreground" />
                  <span className="truncate">{script.name}</span>
                </CardTitle>
                <CardDescription>
                  {formatDateTime(script.created_at)} · {byteLength(script.content)} bytes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="max-h-32 overflow-hidden rounded bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {script.content.split("\n").slice(0, 6).join("\n")}
                </pre>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(script)}>
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
                        <AlertDialogTitle>Delete “{script.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Instances already provisioned keep their copy; future ones cannot
                          select it anymore.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(script)}>
                          Delete script
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit startup script" : "New startup script"}</DialogTitle>
            <DialogDescription>
              Runs as root on first boot. Max {MAX_CONTENT_BYTES.toLocaleString()} bytes —
              currently {byteLength(content)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ss-name">Name *</Label>
              <Input
                id="ss-name"
                placeholder="install-docker"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ss-content">Script *</Label>
              <Textarea
                id="ss-content"
                rows={12}
                className="font-mono text-xs"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {editing ? "Save changes" : "Create script"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
