// Dokploy parity #22 — settings/tags.tsx +
// components/dashboard/settings/tags/tag-manager.tsx.
// Tag CRUD backed by tag.{all,create,one,remove,update}.
import { useState } from "react"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
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
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { dokploy, useUpstream } from "../shared"
import { FieldErrorText, runMutation } from "./helpers"

type Row = Record<string, unknown>

interface TagForm {
  open: boolean
  mode: "create" | "edit"
  tagId: string
  name: string
  color: string
  errors: Record<string, string>
  saving: boolean
}

const initialForm: TagForm = {
  open: false,
  mode: "create",
  tagId: "",
  name: "",
  color: "",
  errors: {},
  saving: false,
}

export default function DokploySettingsTagsPage() {
  const tags = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "tag.all"), [])
  const [form, setForm] = useState<TagForm>(initialForm)
  const [removeRow, setRemoveRow] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)

  const openEdit = (row: Row) =>
    setForm({
      open: true,
      mode: "edit",
      tagId: String(row.tagId ?? ""),
      name: String(row.name ?? ""),
      color: String(row.color ?? ""),
      errors: {},
      saving: false,
    })

  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      setForm((prev) => ({ ...prev, errors: { name: "Name is required" } }))
      return
    }
    setForm((prev) => ({ ...prev, saving: true, errors: {} }))
    const body: Record<string, unknown> = { name }
    if (form.color.trim()) body.color = form.color.trim()
    const result = await runMutation(
      () =>
        dokploy(
          "POST",
          form.mode === "create" ? "tag.create" : "tag.update",
          form.mode === "create" ? body : { ...body, tagId: form.tagId },
        ),
      {
        success: form.mode === "create" ? "Tag created" : "Tag updated",
        onDone: () => {
          setForm(initialForm)
          tags.reload()
        },
      },
    )
    if (!result.ok) {
      setForm((prev) => ({ ...prev, saving: false, errors: result.fieldErrors }))
    }
  }

  const removeTag = async () => {
    if (!removeRow) return
    setRemoving(true)
    await runMutation(
      () => dokploy("POST", "tag.remove", { tagId: String(removeRow.tagId ?? "") }),
      {
        success: "Tag removed",
        onDone: () => {
          setRemoveRow(null)
          tags.reload()
        },
      },
    )
    setRemoving(false)
  }

  const columns: Array<SimpleColumn<Row>> = [
    {
      key: "name",
      header: "Tag",
      render: (row) => (
        <Badge
          variant="outline"
          style={row.color ? { borderColor: String(row.color), color: String(row.color) } : undefined}
        >
          {String(row.name ?? "")}
        </Badge>
      ),
    },
    { key: "color", header: "Color", render: (row) => String(row.color ?? "—") },
    { key: "createdAt", header: "Created" },
    {
      key: "actions",
      header: "",
      className: "w-28",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(row)}>
            <PencilIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            title="Remove"
            onClick={() => setRemoveRow(row)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tags"
        description="Labels you can attach to projects and services for filtering and bulk assignment."
        actions={
          <Button onClick={() => setForm({ ...initialForm, open: true })}>
            <PlusIcon className="size-4" />
            Create tag
          </Button>
        }
      />

      {tags.error ? <ErrorBanner error={tags.error} /> : null}
      <SimpleDataTable
        columns={columns}
        rows={tags.data ?? []}
        loading={tags.loading}
        getRowKey={(row) => String(row.tagId ?? row.name)}
        emptyMessage="No tags yet. Create one to start labeling services."
      />

      {/* Create / edit dialog */}
      <Dialog open={form.open} onOpenChange={(open) => (open ? null : setForm(initialForm))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{form.mode === "create" ? "Create tag" : "Edit tag"}</DialogTitle>
            <DialogDescription>
              {form.mode === "edit" ? `Updating “${form.name}”.` : "Tags group projects and services."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name *</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
              <FieldErrorText>{form.errors.name}</FieldErrorText>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-color">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tag-color"
                  type="color"
                  className="h-9 w-14 cursor-pointer p-1"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#2563eb"}
                  onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                />
                <Input
                  aria-label="Hex color"
                  value={form.color}
                  placeholder="#2563eb"
                  onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                />
              </div>
              <FieldErrorText>{form.errors.color}</FieldErrorText>
            </div>
            {form.errors._form ? <FieldErrorText>{form.errors._form}</FieldErrorText> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(initialForm)} disabled={form.saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={form.saving}>
              {form.saving ? <Spinner className="size-4" /> : null}
              {form.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={removeRow !== null} onOpenChange={(open) => (open ? null : setRemoveRow(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tag?</AlertDialogTitle>
            <AlertDialogDescription>
              “{String(removeRow?.name ?? "")}” will be detached from every project that uses it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                void removeTag()
              }}
            >
              {removing ? <Spinner className="size-4" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
