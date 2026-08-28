// Address book: full CRUD over /me/addresses plus the set-default action.
// The backend accepts Indonesian-style fields (RT/RW, subdistrict) which stay
// optional; address_line1 is the only hard requirement server-side.
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2Icon, MapPinIcon, PencilIcon, PlusIcon, StarIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

interface AddressRow {
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
  created_at?: string
}

interface AddressFormState {
  type: string
  label: string
  recipient_name: string
  company_name: string
  country_code: string
  province: string
  city_or_regency: string
  district: string
  subdistrict: string
  postal_code: string
  address_line1: string
  address_line2: string
  rt: string
  rw: string
  contact_phone_e164: string
}

const EMPTY_FORM: AddressFormState = {
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
  address_line2: "",
  rt: "",
  rw: "",
  contact_phone_e164: "",
}

export default function AccountAddressesPage() {
  const [addresses, setAddresses] = useState<AddressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [editing, setEditing] = useState<AddressRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<AddressRow[]>("/me/addresses")
      setAddresses(data ?? [])
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

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  const openEdit = (address: AddressRow) => {
    setEditing(address)
    setForm({
      type: address.type || "billing",
      label: address.label ?? "",
      recipient_name: address.recipient_name ?? "",
      company_name: address.company_name ?? "",
      country_code: address.country_code ?? "",
      province: address.province ?? "",
      city_or_regency: address.city_or_regency ?? "",
      district: address.district ?? "",
      subdistrict: address.subdistrict ?? "",
      postal_code: address.postal_code ?? "",
      address_line1: address.address_line1 ?? "",
      address_line2: address.address_line2 ?? "",
      rt: address.rt ?? "",
      rw: address.rw ?? "",
      contact_phone_e164: address.contact_phone_e164 ?? "",
    })
    setFormOpen(true)
  }

  const submit = async () => {
    if (!form.address_line1.trim()) {
      toast.error("Street address (line 1) is required")
      return
    }
    const trimmedCountry = form.country_code.trim().toUpperCase()
    if (trimmedCountry && trimmedCountry.length !== 2) {
      toast.error("Country code must be a 2-letter ISO code")
      return
    }
    setBusy(true)
    try {
      if (editing) {
        await apiPatch(`/me/addresses/${editing.id}`, form)
        toast.success("Address updated")
      } else {
        await apiPost("/me/addresses", form)
        toast.success("Address added")
      }
      setFormOpen(false)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save address")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (address: AddressRow) => {
    try {
      await apiDelete(`/me/addresses/${address.id}`)
      toast.success("Address deleted")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete address")
    }
  }

  const setDefault = async (address: AddressRow) => {
    try {
      await apiPost(`/me/addresses/${address.id}/default`)
      toast.success("Default address updated")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to set default")
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Addresses"
        description="Billing and shipping addresses used across your account."
        actions={
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/app/profile">Back to settings</Link>
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon /> Add address
            </Button>
          </div>
        }
      />

      <ErrorBanner error={error} />

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : addresses.length === 0 && !error ? (
        <EmptyState message="No addresses yet." description="Add a billing address to complete your profile." />
      ) : (
        <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {addresses.map((address) => (
            <Card key={address.id} className={address.is_default ? "border-primary/60" : ""}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                  <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{address.label || (address.type === "shipping" ? "Shipping" : "Billing")}</span>
                </CardTitle>
                {address.is_default ? <Badge>Default</Badge> : null}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {address.recipient_name ? <p className="font-medium text-foreground">{address.recipient_name}</p> : null}
                  {address.company_name ? <p>{address.company_name}</p> : null}
                  <p>{address.address_line1}</p>
                  {address.address_line2 ? <p>{address.address_line2}</p> : null}
                  <p>
                    {[
                      address.subdistrict,
                      address.district,
                      address.city_or_regency,
                      address.province,
                      address.postal_code,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    {address.country_code ? ` · ${address.country_code}` : ""}
                  </p>
                  {address.contact_phone_e164 ? <p>{address.contact_phone_e164}</p> : null}
                </div>
                <p className="text-xs text-muted-foreground">Added {formatDateTime(address.created_at)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {!address.is_default ? (
                    <Button size="sm" variant="outline" onClick={() => void setDefault(address)}>
                      <StarIcon /> Set default
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(address)}>
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
                        <AlertDialogTitle>Delete this address?</AlertDialogTitle>
                        <AlertDialogDescription>
                          It is removed from your address book immediately.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(address)}>
                          Delete address
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit address" : "Add address"}</DialogTitle>
            <DialogDescription>Fields marked * are required.</DialogDescription>
          </DialogHeader>
          <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="shipping">Shipping</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-label">Label</Label>
              <Input
                id="ad-label"
                placeholder="Home office"
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-recipient">Recipient name</Label>
              <Input
                id="ad-recipient"
                value={form.recipient_name}
                onChange={(event) => setForm({ ...form, recipient_name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-company">Company</Label>
              <Input
                id="ad-company"
                value={form.company_name}
                onChange={(event) => setForm({ ...form, company_name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-line1">Street address (line 1) *</Label>
              <Input
                id="ad-line1"
                value={form.address_line1}
                onChange={(event) => setForm({ ...form, address_line1: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-line2">Street address (line 2)</Label>
              <Input
                id="ad-line2"
                value={form.address_line2}
                onChange={(event) => setForm({ ...form, address_line2: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-country">Country code</Label>
              <Input
                id="ad-country"
                maxLength={2}
                placeholder="ID"
                value={form.country_code}
                onChange={(event) =>
                  setForm({ ...form, country_code: event.target.value.toUpperCase() })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-postal">Postal code</Label>
              <Input
                id="ad-postal"
                value={form.postal_code}
                onChange={(event) => setForm({ ...form, postal_code: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-province">Province</Label>
              <Input
                id="ad-province"
                value={form.province}
                onChange={(event) => setForm({ ...form, province: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-city">City / regency</Label>
              <Input
                id="ad-city"
                value={form.city_or_regency}
                onChange={(event) => setForm({ ...form, city_or_regency: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-district">District (kecamatan)</Label>
              <Input
                id="ad-district"
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-subdistrict">Subdistrict (kelurahan)</Label>
              <Input
                id="ad-subdistrict"
                value={form.subdistrict}
                onChange={(event) => setForm({ ...form, subdistrict: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-rt">RT</Label>
              <Input
                id="ad-rt"
                value={form.rt}
                onChange={(event) => setForm({ ...form, rt: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-rw">RW</Label>
              <Input
                id="ad-rw"
                value={form.rw}
                onChange={(event) => setForm({ ...form, rw: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ad-phone">Contact phone (E.164)</Label>
              <Input
                id="ad-phone"
                placeholder="+6281234567890"
                value={form.contact_phone_e164}
                onChange={(event) => setForm({ ...form, contact_phone_e164: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {editing ? "Save changes" : "Add address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
