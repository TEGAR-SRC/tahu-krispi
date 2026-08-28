// Dokploy parity #21 — settings/certificates.tsx +
// components/dashboard/settings/certificates/show-certificates.tsx.
// Traefik TLS certificates backed by certificates.{all,create,one,remove,
// update}. Renewal is expressed as an update that replaces the PEM pair
// (the spec has no dedicated renew op).
import { useState } from "react"
import { KeyRoundIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { dokploy, toErrorMessage, useUpstream, type UpstreamError } from "../shared"
import { FieldErrorText, runMutation } from "./helpers"

type Row = Record<string, unknown>

interface CertForm {
  open: boolean
  mode: "create" | "update"
  certificateId: string
  name: string
  certificateData: string
  privateKey: string
  errors: Record<string, string>
  saving: boolean
}

const initialForm: CertForm = {
  open: false,
  mode: "create",
  certificateId: "",
  name: "",
  certificateData: "",
  privateKey: "",
  errors: {},
  saving: false,
}

export default function DokploySettingsCertificatesPage() {
  const certificates = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "certificates.all"), [])
  // certificates.create requires organizationId upstream — resolved once from
  // the signed-in Dokploy user.
  const me = useUpstream<Row>(() => dokploy<Row>("GET", "user.get"), [])
  const [form, setForm] = useState<CertForm>(initialForm)
  const [removeRow, setRemoveRow] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)

  const openEdit = (row: Row) =>
    setForm({
      open: true,
      mode: "update",
      certificateId: String(row.certificateId ?? ""),
      name: String(row.name ?? ""),
      certificateData: String(row.certificateData ?? ""),
      privateKey: "",
      errors: {},
      saving: false,
    })

  const save = async () => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = "Name is required"
    if (form.mode === "create") {
      if (!form.certificateData.trim()) errors.certificateData = "Certificate PEM is required"
      if (!form.privateKey.trim()) errors.privateKey = "Private key PEM is required"
    }
    if (Object.keys(errors).length > 0) {
      setForm((prev) => ({ ...prev, errors }))
      return
    }
    setForm((prev) => ({ ...prev, saving: true, errors: {} }))
    const body: Record<string, unknown> = { name: form.name.trim() }
    if (form.certificateData.trim()) body.certificateData = form.certificateData
    if (form.privateKey.trim()) body.privateKey = form.privateKey
    if (form.mode === "create") {
      const organizationId = String(me.data?.organizationId ?? "").trim()
      if (!organizationId) {
        setForm((prev) => ({
          ...prev,
          saving: false,
          errors: { ...prev.errors, _form: "Active organization is required for certificate uploads" },
        }))
        return
      }
      body.organizationId = organizationId
    } else {
      body.certificateId = form.certificateId
    }
    const result = await runMutation(
      () =>
        dokploy("POST", form.mode === "create" ? "certificates.create" : "certificates.update", body),
      {
        success: form.mode === "create" ? "Certificate uploaded" : "Certificate renewed",
        onDone: () => {
          setForm(initialForm)
          certificates.reload()
        },
      },
    )
    if (!result.ok) {
      setForm((prev) => ({ ...prev, saving: false, errors: result.fieldErrors }))
    }
  }

  const removeCertificate = async () => {
    if (!removeRow) return
    setRemoving(true)
    await runMutation(
      () =>
        dokploy("POST", "certificates.remove", {
          certificateId: String(removeRow.certificateId ?? ""),
        }),
      {
        success: "Certificate removed",
        onDone: () => {
          setRemoveRow(null)
          certificates.reload()
        },
      },
    )
    setRemoving(false)
  }

  const columns: Array<SimpleColumn<Row>> = [
    { key: "name", header: "Name" },
    { key: "certificatePath", header: "Path", render: (row) => String(row.certificatePath ?? "—") },
    {
      key: "autoRenew",
      header: "Auto-renew",
      render: (row) =>
        row.autoRenew ? (
          <Badge variant="secondary">enabled</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">manual</span>
        ),
    },
    { key: "createdAt", header: "Created" },
    {
      key: "actions",
      header: "",
      className: "w-32",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" title="Update / renew" onClick={() => openEdit(row)}>
            <RefreshCwIcon className="size-4" />
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
        title="Certificates"
        description="Custom TLS certificates served by Traefik. Upload a full chain plus its private key."
        actions={
          <Button onClick={() => setForm({ ...initialForm, open: true })}>
            <PlusIcon className="size-4" />
            Upload certificate
          </Button>
        }
      />

      {certificates.error ? <ErrorBanner error={certificates.error} /> : null}
      <SimpleDataTable
        columns={columns}
        rows={certificates.data ?? []}
        loading={certificates.loading}
        getRowKey={(row) => String(row.certificateId ?? row.name)}
        emptyMessage="No custom certificates uploaded yet."
      />

      {/* Create / update dialog */}
      <Dialog open={form.open} onOpenChange={(open) => (open ? null : setForm(initialForm))}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.mode === "create" ? "Upload certificate" : "Update / renew certificate"}
            </DialogTitle>
            <DialogDescription>
              {form.mode === "create"
                ? "Paste PEM-encoded certificate (full chain) and private key."
                : "Leave a field empty to keep the stored value. Replacing the pair renews the certificate."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="crt-name">Name *</Label>
              <Input
                id="crt-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="*.example.com"
                required
              />
              <FieldErrorText>{form.errors.name}</FieldErrorText>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crt-data">
                Certificate (PEM)
                {form.mode === "create" ? " *" : ""}
              </Label>
              <Textarea
                id="crt-data"
                rows={6}
                className="font-mono text-xs"
                value={form.certificateData}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, certificateData: event.target.value }))
                }
                placeholder={"-----BEGIN CERTIFICATE-----\n…"}
              />
              <FieldErrorText>{form.errors.certificateData}</FieldErrorText>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crt-key">
                Private key (PEM)
                {form.mode === "create" ? " *" : ""}
              </Label>
              <Textarea
                id="crt-key"
                rows={6}
                className="font-mono text-xs"
                value={form.privateKey}
                onChange={(event) => setForm((prev) => ({ ...prev, privateKey: event.target.value }))}
                placeholder={form.mode === "update" ? "Unchanged unless pasted" : "-----BEGIN PRIVATE KEY-----\n…"}
              />
              <FieldErrorText>{form.errors.privateKey}</FieldErrorText>
            </div>
            {form.errors._form ? <FieldErrorText>{form.errors._form}</FieldErrorText> : null}
            {me.error ? (
              <p className="text-xs text-muted-foreground">
                Could not resolve organization for upload ({toErrorMessage(me.error as UpstreamError)}).
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(initialForm)} disabled={form.saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={form.saving}>
              {form.saving ? <Spinner className="size-4" /> : <KeyRoundIcon className="size-4" />}
              {form.mode === "create" ? "Upload" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={removeRow !== null} onOpenChange={(open) => (open ? null : setRemoveRow(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove certificate?</AlertDialogTitle>
            <AlertDialogDescription>
              Domains currently serving “{String(removeRow?.name ?? "")}” will fall back to Traefik's
              default or Let's Encrypt certificates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault()
                void removeCertificate()
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
