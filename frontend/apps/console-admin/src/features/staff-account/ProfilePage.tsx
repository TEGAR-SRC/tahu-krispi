// Staff self-profile: GET /me prefill, PATCH /me/profile for the five fields
// the backend accepts (full_name, display_name, company_name, country_code,
// tax_id) and avatar display via the presigned URL from GET /me/avatar with
// an initials fallback when it answers 404. Everything is user-scoped JWT —
// no X-Organization-ID. Email/phone/locale/timezone/username/status are
// account-managed and render read-only.
import { useCallback, useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Skeleton } from "@/components/ui/skeleton"
import { apiGet, apiPatch, ApiError } from "@/lib/api"
import type { MeProfile } from "@/lib/auth"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"

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

export default function StaffProfilePage() {
  const [profile, setProfile] = useState<MeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  // Editable form fields — exactly the set PATCH /me/profile accepts
  // (verified live: unknown keys are ignored, country_code must be 2 letters).
  const [fullName, setFullName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [countryCode, setCountryCode] = useState("")
  const [taxId, setTaxId] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const meRes = await apiGet<MeProfile>("/me")
      setProfile(meRes.data)
      setFullName(meRes.data.full_name ?? "")
      setDisplayName(meRes.data.display_name ?? "")
      setCompanyName(meRes.data.company_name ?? "")
      setCountryCode(meRes.data.country_code ?? "")
      setTaxId(meRes.data.tax_id ?? "")
      // Presigned avatar URL; a missing avatar answers 404 → initials fallback.
      const avatarRes = await apiGet<{ url?: string }>("/me/avatar").catch(() => null)
      if (avatarRes && typeof avatarRes.data?.url === "string") {
        setAvatarUrl(avatarRes.data.url)
      }
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  const save = async () => {
    setFormError(null)
    const trimmedCountry = countryCode.trim().toUpperCase()
    if (trimmedCountry && trimmedCountry.length !== 2) {
      setFormError("Country code must be a 2-letter ISO code (e.g. ID).")
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
      if (data) setProfile(data)
      toast.success("Profile saved")
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "Failed to save profile"
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
        <PageHeader title="My profile" description="Your identity across Kilat Cloud." />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader title="My profile" description="Your identity across Kilat Cloud." />

      <ErrorBanner error={error} />

      <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Identity form */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              Only the listed fields are editable; email, phone and locale come from
              your account settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sp-full-name">Full name</Label>
                <Input
                  id="sp-full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-display-name">Display name</Label>
                <Input
                  id="sp-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-company">Company name</Label>
                <Input
                  id="sp-company"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-country">Country code (ISO 3166-1 alpha-2)</Label>
                <Input
                  id="sp-country"
                  maxLength={2}
                  placeholder="ID"
                  value={countryCode}
                  onChange={(event) =>
                    setCountryCode(event.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-tax">Tax ID</Label>
                <Input
                  id="sp-tax"
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                />
              </div>
            </div>

            {formError ? (
              <p className="text-sm text-destructive">{formError}</p>
            ) : null}

            <div className="grid w-full max-w-full min-w-0 gap-3 rounded-md border p-3 text-sm sm:grid-cols-3">
              <ReadOnlyField label="Email" value={profile?.email} />
              <ReadOnlyField label="Phone" value={profile?.phone} />
              <ReadOnlyField label="Username" value={profile?.username} />
              <ReadOnlyField label="Status" value={profile?.status} />
              <ReadOnlyField label="Locale" value={profile?.locale} />
              <ReadOnlyField label="Timezone" value={profile?.timezone} />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2Icon className="animate-spin" /> : null} Save changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Avatar */}
        <Card>
          <CardHeader>
            <CardTitle>Avatar</CardTitle>
            <CardDescription>Shown next to your name across the console.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 items-center gap-4">
            <Avatar className="size-14 border">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="Your avatar" /> : null}
              <AvatarFallback>{initials(profile)}</AvatarFallback>
            </Avatar>
            <p className="text-sm text-muted-foreground">
              {avatarUrl
                ? "Custom avatar active."
                : "No custom avatar yet — your initials are shown."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="min-w-0 block max-w-full truncate font-medium [overflow-wrap:anywhere]">{value || "—"}</p>
    </div>
  )
}
