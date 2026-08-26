// Account tab: profile fields (PATCH /me/profile), avatar upload
// (POST /me/avatar multipart) and verification documents.
import { useEffect, useRef, useState } from "react"
import { Loader2Icon, SaveIcon, UploadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { apiGet, apiPatch, getToken, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { formatBytes, formatDateTime } from "../format"
import { uploadMultipart } from "../upload"

interface MeProfile {
  email: string
  phone?: string
  status?: string
  locale?: string
  timezone?: string
  full_name?: string
  display_name?: string
  company_name?: string
  country_code?: string
  tax_id?: string
}

interface DocumentRow {
  id: string
  document_type: string
  verification_status: string
  mime_type?: string
  size_bytes?: number
  url?: string
  created_at?: string
}

export function AccountTab() {
  const [profile, setProfile] = useState<MeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [form, setForm] = useState({ full_name: "", display_name: "", company_name: "", country_code: "", tax_id: "" })
  const [saving, setSaving] = useState(false)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [docsError, setDocsError] = useState<unknown>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState("id_card")
  const [docBusy, setDocBusy] = useState(false)

  useEffect(() => {
    apiGet<MeProfile>("/me")
      .then(({ data }) => {
        setProfile(data)
        setForm({
          full_name: data?.full_name ?? "",
          display_name: data?.display_name ?? "",
          company_name: data?.company_name ?? "",
          country_code: data?.country_code ?? "",
          tax_id: data?.tax_id ?? "",
        })
      })
      .catch((cause) => setError(cause))
      .finally(() => setLoading(false))

    // Avatar is served from an authenticated endpoint; fetch as blob.
    void (async () => {
      try {
        const response = await fetch("/api/v1/me/avatar", {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        })
        if (!response.ok) return
        const blob = await response.blob()
        setAvatarUrl(URL.createObjectURL(blob))
      } catch {
        // No avatar set; fallback initials render instead.
      }
    })()

    apiGet<DocumentRow[]>("/me/documents")
      .then(({ data }) => setDocuments(data ?? []))
      .catch((cause) => setDocsError(cause))
  }, [])

  const save = async () => {
    if (form.country_code && form.country_code.length !== 2) {
      toast.error("Country code must be a 2-letter ISO code")
      return
    }
    setSaving(true)
    try {
      const { data } = await apiPatch<MeProfile>("/me/profile", form)
      setProfile((current) => ({ ...(current ?? {}), ...data }))
      toast.success("Profile saved")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async () => {
    const file = avatarInputRef.current?.files?.[0]
    if (!file) {
      toast.error("Choose an image first")
      return
    }
    setAvatarBusy(true)
    try {
      const form = new FormData()
      form.append("file", file)
      await uploadMultipart("/me/avatar", form)
      toast.success("Avatar updated")
      const response = await fetch("/api/v1/me/avatar", {
        headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Cache-Control": "no-cache" },
      })
      if (response.ok) setAvatarUrl(URL.createObjectURL(await response.blob()))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Avatar upload failed")
    } finally {
      setAvatarBusy(false)
    }
  }

  const uploadDocument = async () => {
    const file = docInputRef.current?.files?.[0]
    if (!file) {
      toast.error("Choose a document file first")
      return
    }
    setDocBusy(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("document_type", docType)
      await uploadMultipart("/me/documents", form)
      toast.success("Document uploaded — pending verification")
      const { data } = await apiGet<DocumentRow[]>("/me/documents")
      setDocuments(data ?? [])
      setDocsError(null)
      if (docInputRef.current) docInputRef.current.value = ""
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Document upload failed")
    } finally {
      setDocBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading profile…</p>
  if (error) return <ErrorBanner error={error} />

  const field = (key: keyof typeof form, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pf-${key}`}>{label}</Label>
      <Input
        id={`pf-${key}`}
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        placeholder={placeholder}
      />
    </div>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal information</CardTitle>
          <CardDescription>
            Signed in as {profile?.email}
            {profile?.phone ? ` · ${profile.phone}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {field("full_name", "Full name")}
          {field("display_name", "Display name")}
          {field("company_name", "Company")}
          <div className="grid grid-cols-2 gap-2">
            {field("country_code", "Country code", "ID")}
            {field("tax_id", "Tax ID")}
          </div>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Save changes
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avatar</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Avatar className="size-16">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="Avatar" /> : null}
              <AvatarFallback>{(profile?.full_name || profile?.email || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1.5">
              <Input ref={avatarInputRef} type="file" accept="image/*" />
              <Button size="sm" variant="outline" onClick={() => void uploadAvatar()} disabled={avatarBusy}>
                {avatarBusy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification documents</CardTitle>
            <CardDescription>ID or business documents used for account verification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {docsError ? <ErrorBanner error={docsError} /> : null}
            {!docsError && documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents uploaded.</p>
            ) : null}
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="capitalize">{doc.document_type.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(doc.size_bytes)} · {formatDateTime(doc.created_at)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="doc-type">Type</Label>
                <select
                  id="doc-type"
                  value={docType}
                  onChange={(event) => setDocType(event.target.value)}
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                >
                  <option value="id_card">ID card</option>
                  <option value="passport">Passport</option>
                  <option value="business_license">Business license</option>
                  <option value="tax_certificate">Tax certificate</option>
                </select>
              </div>
              <Input ref={docInputRef} type="file" accept="image/*,application/pdf" />
              <Button variant="outline" onClick={() => void uploadDocument()} disabled={docBusy}>
                {docBusy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
