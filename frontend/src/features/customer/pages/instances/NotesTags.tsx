// Instance notes & tags: the notes textarea autosaves after a short debounce
// and also offers an explicit save; tags are a chip editor capped at 32 tags
// of 64 characters each (backend limits), saved with PUT.
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { CheckIcon, Loader2Icon, SaveIcon, TagIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { apiGet, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { orgHeaders, useOrg } from "../../useOrg"
import { InstanceBreadcrumb, useInstance } from "./shared"

const AUTOSAVE_DELAY_MS = 1200
const MAX_TAGS = 32
const MAX_TAG_LENGTH = 64

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

export default function InstanceNotesTagsPage() {
  const { instanceId } = useParams()
  const { instance } = useInstance(instanceId)

  return (
    <div className="flex flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance?.name} section="Notes & tags" />
      <PageHeader
        title="Notes & tags"
        description="Free-form operational notes and labels. Notes autosave as you type."
      />
      <NotesCard instanceId={instanceId} />
      <TagsCard instanceId={instanceId} />
    </div>
  )
}

function NotesCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [notes, setNotes] = useState("")
  const [loadedValue, setLoadedValue] = useState("")
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<SaveState>("idle")
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    apiGet<{ notes?: string }>(`/instances/${instanceId}/notes`, {
      headers: orgHeaders(orgId),
    })
      .then(({ data }) => {
        if (cancelled) return
        setNotes(data?.notes ?? "")
        setLoadedValue(data?.notes ?? "")
      })
      .catch(() => {
        // Notes are optional; leave the editor empty on failure.
        if (!cancelled) setErrorText("Could not load existing notes.")
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  const save = useCallback(
    async (value: string) => {
      if (!instanceId || !orgId) return
      setState("saving")
      try {
        await apiPut(`/instances/${instanceId}/notes`, { notes: value }, {
          headers: orgHeaders(orgId),
        })
        setLoadedValue(value)
        setState("saved")
        setErrorText(null)
      } catch (cause) {
        setState("error")
        setErrorText(cause instanceof ApiError ? cause.message : "Failed to save notes")
      }
    },
    [instanceId, orgId],
  )

  // Debounced autosave while typing.
  const onChange = (value: string) => {
    setNotes(value)
    setState(value === loadedValue ? "idle" : "dirty")
  }

  useEffect(() => {
    if (state !== "dirty") return
    const timer = window.setTimeout(() => void save(notes), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [notes, state, save])

  const statusLabel =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "All changes saved"
        : state === "dirty"
          ? "Unsaved changes — autosaving…"
          : state === "error"
            ? errorText
            : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>Anything worth remembering about this instance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <Textarea
              aria-label="Instance notes"
              value={notes}
              onChange={(event) => onChange(event.target.value)}
              placeholder="e.g. holds the staging database, rebooted monthly…"
              rows={6}
            />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => void save(notes)}
                disabled={state === "saving" || notes === loadedValue}
              >
                {state === "saving" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SaveIcon />
                )}
                Save now
              </Button>
              {statusLabel ? (
                <span
                  className={`text-sm ${
                    state === "error"
                      ? "text-destructive"
                      : state === "saved"
                        ? "flex items-center gap-1 text-muted-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {state === "saved" ? <CheckIcon className="size-3.5" /> : null}
                  {statusLabel}
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TagsCard({ instanceId }: { instanceId: string | undefined }) {
  const { orgId } = useOrg()
  const [tags, setTags] = useState<string[]>([])
  const [savedTags, setSavedTags] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!instanceId || !orgId) return
    let cancelled = false
    apiGet<{ tags?: string[] }>(`/instances/${instanceId}/tags`, {
      headers: orgHeaders(orgId),
    })
      .then(({ data }) => {
        if (cancelled) return
        setTags(data?.tags ?? [])
        setSavedTags(data?.tags ?? [])
      })
      .catch(() => {
        // Tags are optional; leave the editor empty on failure.
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [instanceId, orgId])

  const addTag = () => {
    const value = draft.trim().slice(0, MAX_TAG_LENGTH)
    if (!value) return
    if (tags.length >= MAX_TAGS) {
      toast.error(`At most ${MAX_TAGS} tags are allowed`)
      return
    }
    if (!tags.includes(value)) setTags((current) => [...current, value])
    setDraft("")
  }

  const removeTag = (tag: string) =>
    setTags((current) => current.filter((item) => item !== tag))

  const dirty = JSON.stringify(tags) !== JSON.stringify(savedTags)

  const saveTags = async () => {
    if (!instanceId || !orgId) return
    setSaving(true)
    try {
      await apiPut(`/instances/${instanceId}/tags`, { tags }, {
        headers: orgHeaders(orgId),
      })
      setSavedTags(tags)
      toast.success("Tags saved")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save tags")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
        <CardDescription>
          Up to {MAX_TAGS} tags, each at most {MAX_TAG_LENGTH} characters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  <TagIcon className="size-3" />
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => removeTag(tag)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
              {tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tags yet.</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="new-tag" className="sr-only">
                New tag
              </Label>
              <Input
                id="new-tag"
                className="w-64"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, MAX_TAG_LENGTH))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addTag()
                  }
                }}
                placeholder={`Add a tag (${tags.length}/${MAX_TAGS})`}
              />
              <Button type="button" variant="outline" onClick={addTag}>
                Add
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => void saveTags()} disabled={saving || !dirty}>
                {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Save tags
              </Button>
              {!dirty ? (
                <span className="text-sm text-muted-foreground">All changes saved</span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
