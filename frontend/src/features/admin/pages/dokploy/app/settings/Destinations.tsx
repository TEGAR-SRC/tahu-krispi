// Dokploy parity #20 — settings/destinations.tsx +
// components/dashboard/settings/destination/show-destinations.tsx.
// S3 backup destinations backed by destination.{all,create,one,remove,
// testConnection,update}.
import { useState } from "react"
import { PencilIcon, PlugZapIcon, PlusIcon, Trash2Icon } from "lucide-react"
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
import { dokploy, useUpstream } from "../shared"
import { FieldErrorText, runMutation } from "./helpers"

type Row = Record<string, unknown>

/** Mirrors upstream `S3_PROVIDERS` (destination/constants.ts in the repo). */
const S3_PROVIDERS = [
  "AWS", "Alibaba", "ArvanCloud", "Ceph", "ChinaMobile", "Cloudflare", "DigitalOcean",
  "Dreamhost", "GCS", "HuaweiOBS", "IBMCOS", "IDrive", "IONOS", "LyveCloud", "Leviia",
  "Liara", "Linode", "Magalu", "Minio", "Netease", "Petabox", "RackCorp", "Rclone",
  "Scaleway", "SeaweedFS", "StackPath", "Storj", "Synology", "TencentCOS", "Wasabi",
  "Qiniu", "Other",
] as const

interface DestinationForm {
  open: boolean
  mode: "create" | "edit" | "test"
  destinationId: string
  values: {
    name: string
    provider: string
    accessKey: string
    secretAccessKey: string
    bucket: string
    region: string
    endpoint: string
    additionalFlags: string
  }
  errors: Record<string, string>
  saving: boolean
}

const emptyValues = {
  name: "",
  provider: "AWS",
  accessKey: "",
  secretAccessKey: "",
  bucket: "",
  region: "",
  endpoint: "",
  additionalFlags: "",
}

const initialForm: DestinationForm = {
  open: false,
  mode: "create",
  destinationId: "",
  values: { ...emptyValues },
  errors: {},
  saving: false,
}

function toBody(values: DestinationForm["values"]): Record<string, unknown> | { error: string } {
  const flags = values.additionalFlags
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean)
  for (const required of ["name", "accessKey", "bucket", "region", "endpoint", "secretAccessKey"]) {
    if (!values[required as keyof typeof values].trim()) {
      return { error: `${required} is required` }
    }
  }
  return {
    name: values.name.trim(),
    provider: values.provider || null,
    accessKey: values.accessKey.trim(),
    secretAccessKey: values.secretAccessKey.trim(),
    bucket: values.bucket.trim(),
    region: values.region.trim(),
    endpoint: values.endpoint.trim(),
    ...(flags.length > 0 ? { additionalFlags: flags } : {}),
  }
}

export default function DokploySettingsDestinationsPage() {
  const destinations = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "destination.all"), [])
  const [form, setForm] = useState<DestinationForm>(initialForm)
  const [removeRow, setRemoveRow] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)

  const openForm = (mode: DestinationForm["mode"], row?: Row) => {
    if (row) {
      setForm({
        open: true,
        mode,
        destinationId: String(row.destinationId ?? ""),
        values: {
          name: String(row.name ?? ""),
          provider: String(row.provider ?? "AWS"),
          accessKey: String(row.accessKey ?? ""),
          secretAccessKey: String(row.secretAccessKey ?? ""),
          bucket: String(row.bucket ?? ""),
          region: String(row.region ?? ""),
          endpoint: String(row.endpoint ?? ""),
          additionalFlags: Array.isArray(row.additionalFlags)
            ? (row.additionalFlags as string[]).join(", ")
            : "",
        },
        errors: {},
        saving: false,
      })
    } else {
      setForm({ ...initialForm, open: true, mode })
    }
  }

  const save = async () => {
    const body = toBody(form.values)
    if ("error" in body) {
      setForm((prev) => ({ ...prev, errors: { _form: String(body.error) } }))
      return
    }
    setForm((prev) => ({ ...prev, saving: true, errors: {} }))
    const op =
      form.mode === "create"
        ? "destination.create"
        : form.mode === "edit"
          ? "destination.update"
          : "destination.testConnection"
    const payload =
      form.mode === "edit" ? { ...body, destinationId: form.destinationId } : body
    const result = await runMutation(() => dokploy("POST", op, payload), {
      success:
        form.mode === "test"
          ? "Destination connection OK"
          : form.mode === "create"
            ? "Destination created"
            : "Destination updated",
      onDone: () => {
        setForm(initialForm)
        destinations.reload()
      },
    })
    if (!result.ok) {
      setForm((prev) => ({ ...prev, saving: false, errors: result.fieldErrors }))
    }
  }

  const removeDestination = async () => {
    if (!removeRow) return
    setRemoving(true)
    await runMutation(
      () =>
        dokploy("POST", "destination.remove", {
          destinationId: String(removeRow.destinationId ?? ""),
        }),
      {
        success: "Destination removed",
        onDone: () => {
          setRemoveRow(null)
          destinations.reload()
        },
      },
    )
    setRemoving(false)
  }

  const columns: Array<SimpleColumn<Row>> = [
    { key: "name", header: "Name" },
    { key: "provider", header: "Provider" },
    { key: "bucket", header: "Bucket" },
    { key: "region", header: "Region" },
    { key: "endpoint", header: "Endpoint" },
    { key: "createdAt", header: "Created" },
    {
      key: "actions",
      header: "",
      className: "w-44",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" title="Test connection" onClick={() => openForm("test", row)}>
            <PlugZapIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Edit" onClick={() => openForm("edit", row)}>
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
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="S3 Destinations"
        description="Backup storage targets — AWS S3, Cloudflare R2, Wasabi, DigitalOcean Spaces and any S3-compatible endpoint."
        actions={
          <Button onClick={() => openForm("create")}>
            <PlusIcon className="size-4" />
            Add destination
          </Button>
        }
      />

      {destinations.error ? <ErrorBanner error={destinations.error} /> : null}
      <SimpleDataTable
        columns={columns}
        rows={destinations.data ?? []}
        loading={destinations.loading}
        getRowKey={(row) => String(row.destinationId ?? row.name)}
        emptyMessage="No backup destinations yet. Add one before scheduling database backups."
      />

      {/* Create / edit / test dialog */}
      <Dialog open={form.open} onOpenChange={(open) => (open ? null : setForm(initialForm))}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.mode === "create" ? "Add destination" : form.mode === "edit" ? "Edit destination" : "Test destination"}
            </DialogTitle>
            <DialogDescription>
              {form.mode === "test"
                ? "Runs destination.testConnection with these credentials without saving anything."
                : "Credentials are stored by the connected Dokploy server."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="dst-name">Name *</Label>
              <Input
                id="dst-name"
                value={form.values.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, values: { ...prev.values, name: event.target.value } }))
                }
                required
              />
              <FieldErrorText>{form.errors.name}</FieldErrorText>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dst-provider">Provider</Label>
              <select
                id="dst-provider"
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                value={form.values.provider}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, values: { ...prev.values, provider: event.target.value } }))
                }
              >
                {S3_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ["accessKey", "Access Key", true],
                ["secretAccessKey", "Secret Access Key", true],
                ["bucket", "Bucket", true],
                ["region", "Region", true],
                ["endpoint", "Endpoint", true],
                ["additionalFlags", "Additional flags (comma-separated rclone flags)", false],
              ] as Array<[keyof DestinationForm["values"], string, boolean]>
            ).map(([key, label, required]) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`dst-${key}`}>
                  {label}
                  {required ? " *" : ""}
                </Label>
                <Input
                  id={`dst-${key}`}
                  type={key === "secretAccessKey" ? "password" : "text"}
                  value={form.values[key]}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: event.target.value } }))
                  }
                  placeholder={key === "additionalFlags" ? "--s3-provider=Other --no-check-bucket" : undefined}
                />
                <FieldErrorText>{form.errors[key]}</FieldErrorText>
              </div>
            ))}
            {form.errors._form ? <FieldErrorText>{form.errors._form}</FieldErrorText> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(initialForm)} disabled={form.saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={form.saving}>
              {form.saving ? <Spinner className="size-4" /> : null}
              {form.mode === "test" ? "Run test" : form.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog
        open={removeRow !== null}
        onOpenChange={(open) => (open ? null : setRemoveRow(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete destination?</AlertDialogTitle>
            <AlertDialogDescription>
              “{String(removeRow?.name ?? "")}” will be removed from the connected server. Existing
              backups already stored there are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                void removeDestination()
              }}
            >
              {removing ? <Spinner className="size-4" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
