// Profile page: editable identity form (PATCH /me/profile), profile-completion
// indicator, avatar upload with preview, verification documents and the
// email/phone change request flow with phone OTP. All endpoints are user
// scoped (JWT only). Note: locale/timezone/phone are returned by GET /me but
// are not accepted by PATCH /me/profile — they render read-only here.
import { useCallback, useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2Icon, MailIcon, PhoneIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import type { MeProfile } from "@/lib/auth"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { formatBytes } from "../../format"
import { uploadMultipart } from "../../upload"

interface ProfileCompletion {
  profile_completion_percent: number
  missing_requirements: string[]
}

interface DocumentRow {
  id: string
  document_type: string
  verification_status: string
  mime_type?: string
  size_bytes?: number
}

const MISSING_LABELS: Record<string, string> = {
  email_verification: "Verify your email",
  phone_verification: "Verify your phone",
  full_name: "Fill in your full name",
  country_code: "Set your country",
  billing_address: "Add a billing address",
  tax_id: "Add your tax ID",
  avatar: "Upload an avatar",
}

const DOCUMENT_TYPES = [
  { value: "id_card", label: "ID card" },
  { value: "passport", label: "Passport" },
  { value: "driver_license", label: "Driver license" },
  { value: "company_deed", label: "Company deed" },
]

function initials(profile: MeProfile | null): string {
  const source = profile?.full_name || profile?.display_name || profile?.email
  if (!source) return "?"
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
}

export default function AccountProfilePage() {
  const [profile, setProfile] = useState<MeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Form fields (only the ones PATCH /me/profile accepts).
  const [fullName, setFullName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [taxId, setTaxId] = useState("")
  const [saving, setSaving] = useState(false)

  const [completion, setCompletion] = useState<ProfileCompletion | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarPercent, setAvatarPercent] = useState<number | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [documents, setDocuments] = useState<DocumentRow[] | null>(null)
  const [docType, setDocType] = useState("id_card")
  const [docPercent, setDocPercent] = useState<number | null>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  const [contactKind, setContactKind] = useState<"email" | "phone">("email")
  const [contactValue, setContactValue] = useState("")
  const [contactOpen, setContactOpen] = useState(false)
  const [contactBusy, setContactBusy] = useState(false)

  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState("")
  const [otpBusy, setOtpBusy] = useState(false)

  const refreshCompletion = useCallback(async () => {
    try {
      const { data } = await apiGet<ProfileCompletion>("/me/profile-completion")
      setCompletion(data)
    } catch {
      // Indicator only; the form remains usable when it fails.
    }
  }, [])

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [meRes, completionRes, avatarRes, docsRes] = await Promise.allSettled([
        apiGet<MeProfile>("/me"),
        apiGet<ProfileCompletion>("/me/profile-completion"),
        apiGet<{ url?: string }>("/me/avatar"),
        apiGet<DocumentRow[]>("/me/documents"),
      ])
      if (meRes.status === "fulfilled") {
        setProfile(meRes.value.data)
        const me = meRes.value.data
        setFullName(me.full_name ?? "")
        setDisplayName(me.display_name ?? "")
        setCompanyName(me.company_name ?? "")
        setCountryCode(me.country_code ?? "")
        setTaxId(me.tax_id ?? "")
      } else {
        throw meRes.reason
      }
      if (completionRes.status === "fulfilled") setCompletion(completionRes.value.data)
      if (
        avatarRes.status === "fulfilled" &&
        typeof avatarRes.value.data?.url === "string"
      ) {
        setAvatarUrl(avatarRes.value.data.url)
      }
      if (docsRes.status === "fulfilled") setDocuments(docsRes.value.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void loadProfile(), 0)
    return () => clearTimeout(t)
  }, [loadProfile])

  const save = async () => {
    if (!fullName.trim()) {
      toast.error("Full name is required")
      return
    }
    const trimmedCountry = countryCode.trim().toUpperCase()
    if (trimmedCountry && trimmedCountry.length !== 2) {
      toast.error("Country code must be a 2-letter ISO code")
      return
    }
    setSaving(true)
    try {
      const { data } = await apiPatch<MeProfile>("/me/profile", {
        full_name: fullName.trim(),
        display_name: displayName.trim(),
        company_name: companyName.trim(),
        country_code: trimmedCountry,
        tax_id: taxId.trim(),
      })
      setProfile(data)
      toast.success("Profile saved")
      void refreshCompletion()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save profile")
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    setAvatarPercent(0)
    try {
      const form = new FormData()
      form.append("file", file)
      await uploadMultipart("/me/avatar", form, setAvatarPercent)
      toast.success("Avatar updated")
      const { data } = await apiGet<{ url?: string }>("/me/avatar")
      if (typeof data?.url === "string") setAvatarUrl(data.url)
      void refreshCompletion()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Avatar upload failed")
    } finally {
      setAvatarPercent(null)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
    }
  }

  const uploadDocument = async (file: File) => {
    setDocPercent(0)
    try {
      const form = new FormData()
      form.append("document_type", docType)
      form.append("file", file)
      await uploadMultipart("/me/documents", form, setDocPercent)
      toast.success("Document uploaded")
      const { data } = await apiGet<DocumentRow[]>("/me/documents")
      setDocuments(data ?? [])
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Document upload failed")
    } finally {
      setDocPercent(null)
      if (docInputRef.current) docInputRef.current.value = ""
    }
  }

  const requestContactChange = async () => {
    if (!contactValue.trim()) {
      toast.error(`New ${contactKind} is required`)
      return
    }
    setContactBusy(true)
    try {
      await apiPost("/me/contact-change", {
        kind: contactKind,
        new_value: contactValue.trim(),
      })
      toast.success(
        contactKind === "email"
          ? "Confirmation link sent to your new email address"
          : "Verification link sent to your current email address",
      )
      setContactOpen(false)
      setContactValue("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setContactBusy(false)
    }
  }

  const requestPhoneOtp = async () => {
    setOtpBusy(true)
    try {
      const { data } = await apiPost<Record<string, unknown>>("/me/phone/otp/request")
      setOtpSent(true)
      toast.success("OTP sent to your phone")
      const echo = data?.otp_dev_echo
      if (typeof echo === "string" && echo) {
        toast.info(`Dev mode OTP: ${echo}`)
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to send OTP")
    } finally {
      setOtpBusy(false)
    }
  }

  const verifyPhoneOtp = async () => {
    if (!otp.trim()) {
      toast.error("Enter the OTP you received")
      return
    }
    setOtpBusy(true)
    try {
      await apiPost("/me/phone/otp/verify", { otp: otp.trim() })
      toast.success("Phone verified")
      setOtp("")
      setOtpSent(false)
      await loadProfile()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "OTP verification failed")
    } finally {
      setOtpBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Profile" description="Your identity across Kilat Cloud." />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Your identity across Kilat Cloud."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/profile">Back to settings</Link>
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Identity form */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              Only the listed fields are editable; locale, timezone and username come
              from your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pf-full-name">Full name *</Label>
                <Input
                  id="pf-full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-display-name">Display name</Label>
                <Input
                  id="pf-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-company">Company name</Label>
                <Input
                  id="pf-company"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-country">Country code (ISO 3166-1 alpha-2)</Label>
                <Input
                  id="pf-country"
                  maxLength={2}
                  placeholder="ID"
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-tax">Tax ID</Label>
                <Input
                  id="pf-tax"
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-3">
              <ReadOnlyField label="Email" value={profile?.email} />
              <ReadOnlyField label="Locale" value={profile?.locale} />
              <ReadOnlyField label="Timezone" value={profile?.timezone} />
              <ReadOnlyField label="Phone" value={profile?.phone} />
              <ReadOnlyField label="Username" value={profile?.username} />
              <ReadOnlyField label="Status" value={profile?.status} />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2Icon className="animate-spin" /> : null} Save changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Completion + avatar + contacts */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={completion?.profile_completion_percent ?? 0} />
              <p className="text-sm text-muted-foreground">
                {completion ? `${completion.profile_completion_percent}% complete` : "…"}
              </p>
              {(completion?.missing_requirements ?? []).length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {(completion?.missing_requirements ?? []).map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {item.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-muted-foreground">
                        {MISSING_LABELS[item] ?? item}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Everything required is filled in.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Avatar</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <Avatar className="size-14 border">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt="Your avatar" /> : null}
                <AvatarFallback>{initials(profile)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1.5">
                <Input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadAvatar(file)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={avatarPercent !== null}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <UploadIcon /> Upload
                </Button>
                {avatarPercent !== null ? (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Uploading… {avatarPercent}%
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact details</CardTitle>
              <CardDescription>
                Email and phone changes must be confirmed via a link we email you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setContactKind("email")
                    setContactValue("")
                    setContactOpen(true)
                  }}
                >
                  <MailIcon /> Change email
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setContactKind("phone")
                    setContactValue("")
                    setContactOpen(true)
                  }}
                >
                  <PhoneIcon /> Change phone
                </Button>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Phone verification</p>
                {otpSent ? (
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="6-digit code"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                    />
                    <Button onClick={() => void verifyPhoneOtp()} disabled={otpBusy}>
                      Verify
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void requestPhoneOtp()}
                    disabled={otpBusy || !profile?.phone}
                  >
                    Send OTP{profile?.phone ? "" : " (set a phone first)"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Documents */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Verification documents</CardTitle>
            <CardDescription>KYC documents reviewed by our compliance team.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger aria-label="Document type" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              ref={docInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadDocument(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={docPercent !== null}
              onClick={() => docInputRef.current?.click()}
            >
              <UploadIcon /> Upload document
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {docPercent !== null ? (
            <p className="mb-3 text-xs tabular-nums text-muted-foreground">
              Uploading… {docPercent}%
            </p>
          ) : null}
          {!documents ? (
            <EmptyState
              message="Documents unavailable"
              description="The document store answered with an error; try again later."
            />
          ) : documents.length === 0 ? (
            <EmptyState message="No documents uploaded yet." />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>MIME</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="capitalize">
                        {document.document_type.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {document.verification_status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatBytes(document.size_bytes)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {document.mime_type || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact change dialog */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change {contactKind}</DialogTitle>
            <DialogDescription>
              We will send a confirmation to your{" "}
              {contactKind === "email" ? "new email address" : "current email"} to approve
              this change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cc-value">New {contactKind} *</Label>
            <Input
              id="cc-value"
              type={contactKind === "email" ? "email" : "tel"}
              value={contactValue}
              onChange={(event) => setContactValue(event.target.value)}
              placeholder={contactKind === "email" ? "you@example.com" : "+6281234567890"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactOpen(false)} disabled={contactBusy}>
              Cancel
            </Button>
            <Button onClick={() => void requestContactChange()} disabled={contactBusy}>
              {contactBusy ? <Loader2Icon className="animate-spin" /> : null} Send confirmation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value || "—"}</p>
    </div>
  )
}
