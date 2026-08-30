// Blog CRUD. Manage markdown blog posts served on the public blog site.
// Accessible to platform admins and NOC (area "marketing").
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "./shared"

interface BlogPostRow {
  id: string
  slug: string
  title: string
  excerpt: string
  cover_image: string
  author_name: string
  content: string
  tags: string[]
  sort_order: number
  published: boolean
}

export default function BlogPage() {
  const [rows, setRows] = useState<BlogPostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [editing, setEditing] = useState<BlogPostRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BlogPostRow | null>(null)

  const bulk = useBulkSelection<BlogPostRow>((row) => row.id)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false)

  const runBulkDelete = async () => {
    const targets = bulk.resolve(rows)
    if (targets.length === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(targets.map((row) => apiDelete(`/admin/blog/${row.id}`)))
      toast.success(`Deleted ${targets.length} post${targets.length === 1 ? "" : "s"}`)
      setBulkConfirmDelete(false)
      bulk.clear()
      refresh()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete posts")
    } finally {
      setBulkBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    apiGet<BlogPostRow[]>("/admin/blog")
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
        title="Blog"
        description="Markdown blog posts served on the public blog site. Create, edit, publish or delete posts."
        actions={<Button onClick={() => setCreating(true)}>New post</Button>}
      />

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkBusy}
        actions={[
          {
            key: "delete",
            label: "Delete selected",
            destructive: true,
            onClick: () => setBulkConfirmDelete(true),
          },
        ]}
      />

      <SimpleDataTable<BlogPostRow>
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
            key: "author_name",
            header: "Author",
            className: "hidden md:table-cell",
            render: (row) => row.author_name || "—",
          },
          {
            key: "tags",
            header: "Tags",
            className: "hidden lg:table-cell",
            render: (row) => (
              <div className="flex min-w-0 flex-wrap gap-1">
                {row.tags?.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
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
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No blog posts yet. Create a post to get started."
        skeletonRows={5}
      />

      {creating ? (
        <BlogEditorDialog
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false)
            toast.success(message)
            refresh()
          }}
        />
      ) : null}

      {editing ? (
        <BlogEditorDialog
          post={editing}
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
              This removes the post from the public blog. This action cannot be undone.
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
                apiDelete(`/admin/blog/${target.id}`)
                  .then(() => {
                    toast.success(`"${target.title}" deleted`)
                    refresh()
                  })
                  .catch((cause) =>
                    toast.error(cause instanceof ApiError ? cause.message : "Failed to delete"),
                  )
              }}
            >
              Delete post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkConfirmDelete} onOpenChange={setBulkConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulk.selectedKeys.size} selected post{bulk.selectedKeys.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from the public blog. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={bulkBusy}
              onClick={(event) => {
                event.preventDefault()
                void runBulkDelete()
              }}
            >
              {bulkBusy ? "Deleting…" : "Delete selected"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface BlogEditorDialogProps {
  post?: BlogPostRow
  onClose: () => void
  onSaved: (message: string) => void
}

function BlogEditorDialog({ post, onClose, onSaved }: BlogEditorDialogProps) {
  const [slug, setSlug] = useState(post?.slug ?? "")
  const [title, setTitle] = useState(post?.title ?? "")
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "")
  const [coverImage, setCoverImage] = useState(post?.cover_image ?? "")
  const [authorName, setAuthorName] = useState(post?.author_name ?? "Kilat Cloud")
  const [content, setContent] = useState(post?.content ?? "")
  const [tagsText, setTagsText] = useState((post?.tags ?? []).join(", "))
  const [sortOrder, setSortOrder] = useState(post?.sort_order ?? 0)
  const [published, setPublished] = useState(post?.published ?? true)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const submit = async () => {
    if (title.trim() === "") {
      setValidationError("Title is required.")
      return
    }
    if (post && slug.trim() === "") {
      setValidationError("Slug is required.")
      return
    }
    const tags = tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
    setSaving(true)
    const payload = {
      slug: slug.trim(),
      title: title.trim(),
      excerpt,
      cover_image: coverImage,
      author_name: authorName.trim(),
      content,
      tags,
      sort_order: sortOrder,
      published,
    }
    try {
      if (post) {
        await apiPut(`/admin/blog/${post.id}`, payload)
        onSaved(`"${title.trim()}" updated`)
      } else {
        await apiPost("/admin/blog", payload)
        onSaved(`"${title.trim()}" created`)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save post")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{post ? "Edit post" : "New post"}</DialogTitle>
          <DialogDescription>
            Write in Markdown. Code blocks are syntax-highlighted automatically on the blog.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="blog-slug">Slug</Label>
            <Input
              id="blog-slug"
              value={slug}
              disabled={Boolean(post)}
              placeholder="hello-world"
              onChange={(event) => setSlug(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blog-author">Author</Label>
            <Input
              id="blog-author"
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="blog-title">Title</Label>
            <Input id="blog-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="blog-excerpt">Excerpt</Label>
            <Textarea
              id="blog-excerpt"
              value={excerpt}
              rows={2}
              onChange={(event) => setExcerpt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <MediaUpload value={coverImage} onChange={setCoverImage} label="Cover image" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blog-tags">Tags (comma-separated)</Label>
            <Input
              id="blog-tags"
              value={tagsText}
              placeholder="intro, news, guides"
              onChange={(event) => setTagsText(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blog-order">Sort order</Label>
            <Input
              id="blog-order"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="blog-content">Markdown</Label>
            <Textarea
              id="blog-content"
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
            {saving ? "Saving…" : "Save post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
