// Documentation CRUD. Manage markdown docs served on the public docs site.
// Accessible to platform admins and NOC (area "marketing").
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { MediaUpload } from "@/components/shared/MediaUpload"
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
import { StatusBadge } from "./shared"

interface DocRow {
  id: string
  slug: string
  title: string
  description: string
  content: string
  sort_order: number
  published: boolean
}

export default function DocsPage() {
  const [rows, setRows] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editing, setEditing] = useState<DocRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DocRow | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<DocRow[]>("/admin/docs")
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
        title="Documentation"
        description="Markdown docs served on the public docs site. Create, edit, publish or delete pages."
        actions={<Button onClick={() => setCreating(true)}>New doc</Button>}
      />

      <SimpleDataTable<DocRow>
        columns={[
          {
            key: "title",
            header: "Title",
            render: (row) => (
              <div className="min-w-0">
                <span className="min-w-0 block truncate font-medium">{row.title}</span>
                <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  /{row.slug}
                </p>
              </div>
            ),
          },
          {
            key: "description",
            header: "Description",
            className: "hidden md:table-cell",
            render: (row) => (
              <span className="block max-w-64 truncate text-sm text-muted-foreground">
                {row.description || "—"}
              </span>
            ),
          },
          {
            key: "published",
            header: "State",
            render: (row) =>
              row.published ? <StatusBadge status="active" /> : <StatusBadge status="disabled" />,
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
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(row)}>
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
        emptyMessage="No documentation yet. Create a doc to get started."
        skeletonRows={5}
      />

      {creating ? (
        <DocEditorDialog
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false)
            toast.success(message)
            refresh()
          }}
        />
      ) : null}

      {editing ? (
        <DocEditorDialog
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            toast.success(message)
            refresh()
          }}
        />
      ) : null}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the doc from the public documentation site. This action cannot be undone.
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
                apiDelete(`/admin/docs/${target.id}`)
                  .then(() => {
                    toast.success(`"${target.title}" deleted`)
                    refresh()
                  })
                  .catch((cause) =>
                    toast.error(cause instanceof ApiError ? cause.message : "Failed to delete"),
                  )
              }}
            >
              Delete doc
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface DocEditorDialogProps {
  doc?: DocRow
  onClose: () => void
  onSaved: (message: string) => void
}

function DocEditorDialog({ doc, onClose, onSaved }: DocEditorDialogProps) {
  const [slug, setSlug] = useState(doc?.slug ?? "")
  const [title, setTitle] = useState(doc?.title ?? "")
  const [description, setDescription] = useState(doc?.description ?? "")
  const [content, setContent] = useState(doc?.content ?? "")
  const [sortOrder, setSortOrder] = useState(doc?.sort_order ?? 0)
  const [published, setPublished] = useState(doc?.published ?? true)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const submit = async () => {
    if (title.trim() === "") {
      setValidationError("Title is required.")
      return
    }
    if (doc && slug.trim() === "") {
      setValidationError("Slug is required.")
      return
    }
    setSaving(true)
    const payload = {
      slug: slug.trim(),
      title: title.trim(),
      description,
      content,
      sort_order: sortOrder,
      published,
    }
    try {
      if (doc) {
        await apiPut(`/admin/docs/${doc.id}`, payload)
        onSaved(`"${title.trim()}" updated`)
      } else {
        await apiPost("/admin/docs", payload)
        onSaved(`"${title.trim()}" created`)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save doc")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{doc ? "Edit doc" : "New doc"}</DialogTitle>
          <DialogDescription>
            Write in Markdown. Code blocks are syntax-highlighted automatically on the docs site.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-slug">Slug</Label>
            <Input
              id="doc-slug"
              value={slug}
              disabled={Boolean(doc)}
              placeholder="getting-started"
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-order">Sort order</Label>
            <Input
              id="doc-order"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-description">Description</Label>
            <Input
              id="doc-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <MediaUpload
              value=""
              onChange={(url) => {
                setContent((prev) => (prev ? `${prev}\n\n![image](${url})\n` : `![image](${url})\n`))
                toast.success("Image URL inserted into markdown")
              }}
              label="Attach an image (inserts its URL into the markdown)"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-content">Markdown</Label>
            <Textarea
              id="doc-content"
              value={content}
              rows={16}
              spellCheck={false}
              className="min-h-[320px] font-mono text-sm"
              onChange={(event) => setContent(event.target.value)}
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
            {saving ? "Saving…" : "Save doc"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
