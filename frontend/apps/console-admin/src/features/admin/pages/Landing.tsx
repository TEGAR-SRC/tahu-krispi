// Landing / marketing content editor. Manage the sections rendered on the
// public marketing site (hero, features, pricing, testimonials, faq, blog,
// banner). Accessible to platform admins and NOC (area "marketing"); finance
// has no grant for this surface.
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "./shared"

interface LandingSectionRow {
  id: string
  section_key: string
  title: string
  subtitle: string
  body: string
  media_url: string
  data: Record<string, unknown>
  sort_order: number
  published: boolean
}

const SECTION_KEYS = [
  { value: "hero", label: "Hero" },
  { value: "features", label: "Features" },
  { value: "pricing", label: "Pricing" },
  { value: "testimonials", label: "Testimonials" },
  { value: "faq", label: "FAQ" },
  { value: "blog", label: "Blog" },
  { value: "banner", label: "Banner" },
]

export default function LandingPage() {
  const [rows, setRows] = useState<LandingSectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editing, setEditing] = useState<LandingSectionRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LandingSectionRow | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<LandingSectionRow[]>("/admin/landing")
      .then(({ data }) => {
        if (!cancelled) {
          setRows(data)
          setError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  const refresh = () => setReloadTick((tick) => tick + 1)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Landing Content"
        description="Sections rendered on the public marketing site. Edit titles, copy, images and structured data, then toggle published."
        actions={
          <Button onClick={() => setCreating(true)}>
            New section
          </Button>
        }
      />

      <SimpleDataTable<LandingSectionRow>
        columns={[
          {
            key: "title",
            header: "Title",
            render: (row) => (
              <div className="min-w-0">
                <span className="min-w-0 block truncate font-medium">{row.title}</span>
                <p className="min-w-0 truncate text-xs text-muted-foreground">{row.subtitle || "—"}</p>
              </div>
            ),
          },
          {
            key: "section_key",
            header: "Section",
            render: (row) => <Badge variant="outline">{row.section_key}</Badge>,
          },
          {
            key: "sort_order",
            header: "Order",
            className: "hidden md:table-cell",
            render: (row) => row.sort_order,
          },
          {
            key: "published",
            header: "State",
            render: (row) =>
              row.published ? (
                <StatusBadge status="active" />
              ) : (
                <StatusBadge status="disabled" />
              ),
          },
          {
            key: "actions",
            header: "",
            className: "w-40 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteTarget(row)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No landing content yet. Create a section to get started."
        skeletonRows={5}
      />

      {creating ? (
        <LandingEditorDialog
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false)
            toast.success(message)
            refresh()
          }}
        />
      ) : null}

      {editing ? (
        <LandingEditorDialog
          section={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            toast.success(message)
            refresh()
          }}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the section from the marketing site. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (!target) return
                apiDelete(`/admin/landing/${target.id}`)
                  .then(() => {
                    toast.success(`"${target.title}" deleted`)
                    refresh()
                  })
                  .catch((cause) =>
                    toast.error(
                      cause instanceof ApiError ? cause.message : "Failed to delete",
                    ),
                  )
              }}
            >
              Delete section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface LandingEditorDialogProps {
  section?: LandingSectionRow
  onClose: () => void
  onSaved: (message: string) => void
}

function LandingEditorDialog({ section, onClose, onSaved }: LandingEditorDialogProps) {
  const [sectionKey, setSectionKey] = useState(section?.section_key ?? "hero")
  const [title, setTitle] = useState(section?.title ?? "")
  const [subtitle, setSubtitle] = useState(section?.subtitle ?? "")
  const [body, setBody] = useState(section?.body ?? "")
  const [mediaUrl, setMediaUrl] = useState(section?.media_url ?? "")
  const [sortOrder, setSortOrder] = useState(section?.sort_order ?? 0)
  const [published, setPublished] = useState(section?.published ?? true)
  const [json, setJson] = useState(() => JSON.stringify(section?.data ?? {}, null, 2))
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const submit = async () => {
    if (title.trim() === "") {
      setValidationError("Title is required.")
      return
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = json.trim() === "" ? {} : JSON.parse(json)
    } catch {
      setValidationError("Structured data must be valid JSON.")
      return
    }
    setSaving(true)
    const payload = {
      section_key: sectionKey,
      title: title.trim(),
      subtitle,
      body,
      media_url: mediaUrl.trim(),
      data: parsed,
      sort_order: sortOrder,
      published,
    }
    try {
      if (section) {
        await apiPut(`/admin/landing/${section.id}`, payload)
        onSaved(`"${title.trim()}" updated`)
      } else {
        await apiPost("/admin/landing", payload)
        onSaved(`"${title.trim()}" created`)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save section")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{section ? "Edit section" : "New section"}</DialogTitle>
          <DialogDescription>
            Configure a landing/marketing content block. Structured data is free-form JSON
            (e.g. feature lists, pricing tables, FAQ items).
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="landing-section-key">Section type</Label>
            <Select value={sectionKey} onValueChange={setSectionKey}>
              <SelectTrigger id="landing-section-key">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTION_KEYS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="landing-order">Sort order</Label>
            <Input
              id="landing-order"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="landing-title">Title</Label>
            <Input
              id="landing-title"
              value={title}
              placeholder="e.g. Cloud infrastructure that scales"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="landing-subtitle">Subtitle</Label>
            <Input
              id="landing-subtitle"
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="landing-body">Body</Label>
            <Textarea
              id="landing-body"
              value={body}
              rows={4}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="landing-media">Media URL</Label>
            <Input
              id="landing-media"
              value={mediaUrl}
              placeholder="https://…/image.png"
              onChange={(event) => setMediaUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="landing-json">Structured data (JSON)</Label>
            <Textarea
              id="landing-json"
              value={json}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => setJson(event.target.value)}
            />
          </div>
          <label className="flex min-w-0 items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={published} onCheckedChange={(checked) => setPublished(checked === true)} />
            Published
          </label>
          {validationError ? (
            <p className="text-sm text-destructive sm:col-span-2">{validationError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save section"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
