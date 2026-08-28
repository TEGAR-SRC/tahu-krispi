// Billing/shipping addresses CRUD (GET/POST/PATCH/DELETE /me/addresses plus
// the set-default action).
import { useCallback, useEffect, useState } from "react"
import { CheckIcon, Loader2Icon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
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
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"

interface Address {
  id: string
  type?: string
  label?: string
  recipient_name?: string
  company_name?: string
  country_code?: string
  province?: string
  city_or_regency?: string
  district?: string
  subdistrict?: string
  postal_code?: string
  address_line1?: string
  address_line2?: string
  rt?: string
  rw?: string
  contact_phone_e164?: string
  is_default?: boolean
}

const emptyForm = {
  type: "billing",
  label: "",
  recipient_name: "",
  company_name: "",
  country_code: "ID",
  province: "",
  city_or_regency: "",
  district: "",
  subdistrict: "",
  postal_code: "",
  address_line1: "",
  rt: "",
  rw: "",
  contact_phone_e164: "",
}

export function AddressesTab() {
  const [list, setList] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Address | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await apiGet<Address[]>("/me/addresses")
      setList(data ?? [])
      setError(null)
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

  const setDefault = async (address: Address) => {
    try {
      await apiPost(`/me/addresses/${address.id}/default`)
      toast.success("Default address updated")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to set default")
    }
  }

  const runDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await apiDelete(`/me/addresses/${deleteTarget.id}`)
      toast.success("Address deleted")
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete address")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<Address>> = [
    {
      key: "label",
      header: "Address",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.label || row.recipient_name || "Address"}
            {row.is_default ? (
              <Badgeish />
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.address_line1, row.district, row.city_or_regency, row.province, row.postal_code]
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
      ),
    },
    { key: "type", header: "Type", render: (row) => <span className="capitalize">{row.type ?? "—"}</span> },
    {
      key: "contact_phone_e164",
      header: "Phone",
      render: (row) => <span className="font-mono text-xs">{row.contact_phone_e164 || "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      className: "w-28",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {!row.is_default ? (
            <Button size="icon" variant="ghost" title="Set default" onClick={() => void setDefault(row)}>
              <StarIcon />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" title="Delete…" onClick={() => setDeleteTarget(row)}>
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardContent className="space-y-4 px-4">
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New address
          </Button>
        </div>
        <SimpleDataTable
          columns={columns}
          rows={list}
          loading={loading}
          error={error}
          emptyMessage={error ? undefined : "No addresses yet."}
          getRowKey={(row) => row.id}
        />
      </CardContent>

      <AddressDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => void load()}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this address?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function Badgeish() {
  return (
    <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <CheckIcon className="size-2.5" /> default
    </span>
  )
}

function AddressDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  const field = (
    key: keyof typeof emptyForm,
    label: string,
    placeholder?: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`addr-${key}`}>{label}</Label>
      <Input
        id={`addr-${key}`}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        placeholder={placeholder}
      />
    </div>
  )

  const submit = async () => {
    if (!form.address_line1.trim() || !form.city_or_regency.trim()) {
      toast.error("Street address and city are required")
      return
    }
    setBusy(true)
    try {
      await apiPost("/me/addresses", form)
      toast.success("Address added")
      setForm(emptyForm)
      onOpenChange(false)
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save address")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New address</DialogTitle>
          <DialogDescription>Used for invoices and SIM registration.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("recipient_name", "Recipient name *")}
          {field("company_name", "Company")}
          {field("country_code", "Country code", "ID")}
          {field("province", "Province")}
          {field("city_or_regency", "City / regency *")}
          {field("district", "District")}
          {field("subdistrict", "Subdistrict")}
          {field("postal_code", "Postal code")}
          {field("address_line1", "Street address *")}
          {field("rt", "RT")}
          {field("rw", "RW")}
          {field("contact_phone_e164", "Phone (E.164)", "+6281234567890")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Save address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
