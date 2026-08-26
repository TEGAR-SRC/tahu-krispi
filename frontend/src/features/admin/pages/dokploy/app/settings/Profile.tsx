// K6 · Settings ▸ Profile — parity with pages/dashboard/settings/profile.tsx
// (+ profile-form.tsx, api/show-api-keys.tsx): account form (user.get/update),
// passkeys list (user.listPasskeys) and API/CLI keys (user.createApiKey /
// user.deleteApiKey with reveal-once).
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { FingerprintIcon, KeyRoundIcon, PlusIcon, Trash2Icon, UserIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { UpstreamError } from "../shared"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { ConfirmAction, FieldRow, K6Breadcrumbs, asDisplayError, fieldErrorsFrom, fmtDate } from "./k6-helpers"

interface ApiKeyRow {
  id: string
  name: string
  prefix?: string | null
  enabled?: boolean
  expiresAt?: string | null
  createdAt?: string
}

interface DokployUser {
  id: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  image?: string | null
  twoFactorEnabled?: boolean | null
  allowImpersonation?: boolean | null
  apiKeys?: ApiKeyRow[]
}

interface UserGetResponse {
  user?: DokployUser
  role?: string
}

interface PasskeyRow {
  id: string
  name?: string | null
  deviceType?: string | null
  createdAt?: string | null
}

const EXPIRATION_OPTIONS = [
  { label: "No expiration", days: 0 },
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
]

function ProfileForm() {
  const { data, error, loading, reload } = useUpstream<UserGetResponse>(
    () => dokploy<UserGetResponse>("GET", "user.get"),
    [],
  )
  const user = data?.user
  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    currentPassword: "",
    password: "",
    image: "",
  })
  const [hydratedEmail, setHydratedEmail] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<UpstreamError | null>(null)
  const [saving, setSaving] = useState(false)

  // Hydrate once per fetched profile without clobbering in-progress edits.
  const email = user?.email ?? ""
  useEffect(() => {
    if (!loading && email && hydratedEmail !== email) {
      const t = setTimeout(() => {
        setHydratedEmail(email)
        setValues((v) => ({
          ...v,
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          email,
          image: user?.image ?? "",
        }))
      }, 0)
      return () => clearTimeout(t)
    }
  }, [loading, email, hydratedEmail, user])

  const set = (key: keyof typeof values, value: string) =>
    setValues((v) => ({ ...v, [key]: value }))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (!values.email.trim()) errors.email = "Email is required"
    if (values.password && values.password.length < 8 && !values.currentPassword)
      errors.currentPassword = "Current password is required when setting a new password"
    setFieldErrors(errors)
    setSubmitError(null)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      await dokploy("POST", "user.update", {
        email: values.email.trim().toLowerCase(),
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        image: values.image || undefined,
        currentPassword: values.currentPassword || undefined,
        password: values.password || undefined,
      })
      toast.success("Profile updated")
      setValues((v) => ({ ...v, currentPassword: "", password: "" }))
      reload()
    } catch (cause: unknown) {
      const err = cause as UpstreamError
      setSubmitError(err)
      toast.error(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const zodErrors = submitError ? fieldErrorsFrom(submitError) : null
  const fieldError = (name: string) =>
    fieldErrors[name] ?? zodErrors?.[name]?.[0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserIcon className="text-muted-foreground size-5" />
          Account
        </CardTitle>
        <CardDescription>Change the details of your profile here.</CardDescription>
      </CardHeader>
      <CardContent className="border-t pt-6">
        {error ? (
          <p className="text-destructive text-sm">{toErrorMessage(error)}</p>
        ) : loading ? (
          <div className="space-y-3">
            {["First Name", "Last Name", "Email"].map((label) => (
              <div key={label} className="grid gap-1.5">
                <span className="text-sm font-medium">{label}</span>
                <div className="bg-muted h-9 w-full animate-pulse rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
            <FieldRow label="First Name" error={fieldError("firstName")}>
              <Input
                placeholder="John"
                value={values.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Last Name" error={fieldError("lastName")}>
              <Input
                placeholder="Doe"
                value={values.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Email" error={fieldError("email")}>
              <Input
                type="email"
                placeholder="Email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Current Password"
              hint="Only required when changing your password."
              error={fieldError("currentPassword")}
            >
              <Input
                type="password"
                placeholder="Current Password"
                value={values.currentPassword}
                onChange={(e) => set("currentPassword", e.target.value)}
              />
            </FieldRow>
            <FieldRow label="New Password" error={fieldError("password")}>
              <Input
                type="password"
                placeholder="Leave empty to keep the current one"
                value={values.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Avatar URL"
              hint="Image URL or a data: URI, as accepted by the upstream API."
              error={fieldError("image")}
            >
              <Input
                placeholder="https://… or data:image/png;base64,…"
                value={values.image}
                onChange={(e) => set("image", e.target.value)}
              />
            </FieldRow>
            {submitError ? (
              <p className="text-destructive text-sm">{toErrorMessage(submitError)}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function PasskeysCard() {
  const { data, error, loading, reload } = useUpstream<PasskeyRow[]>(
    () => dokploy<PasskeyRow[]>("GET", "user.listPasskeys"),
    [],
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FingerprintIcon className="text-muted-foreground size-5" />
          Passkeys
        </CardTitle>
        <CardDescription>
          Registered passkeys for this account. Adding/removing passkeys uses the
          interactive WebAuthn browser session on the upstream dashboard and has no
          proxy operation, so this panel is read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="border-t pt-6">
        <SimpleDataTable<PasskeyRow>
          columns={[
            {
              key: "name",
              header: "Name",
              render: (row) => row.name || "Unnamed passkey",
            },
            {
              key: "deviceType",
              header: "Type",
              render: (row) => (
                <Badge variant="outline">
                  {row.deviceType === "singleDevice" ? "Device" : "Synced"}
                </Badge>
              ),
            },
            { key: "createdAt", header: "Added", render: (row) => fmtDate(row.createdAt) },
          ]}
          rows={data ?? []}
          loading={loading}
          error={asDisplayError(error)}
          emptyMessage="No passkeys registered yet."
        />
        {!loading && !error ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
            Refresh
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ApiKeysCard() {
  const { data, error, loading, reload } = useUpstream<UserGetResponse>(
    () => dokploy<UserGetResponse>("GET", "user.get"),
    [],
  )
  const { data: activeOrg } = useUpstream<{ id: string; name: string }>(
    () => dokploy<{ id: string; name: string }>("GET", "organization.active"),
    [],
  )
  const keys = data?.user?.apiKeys ?? []

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [prefix, setPrefix] = useState("")
  const [expiresDays, setExpiresDays] = useState("0")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Reveal-once secret from the create response.
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setCreateError("Name is required")
      return
    }
    if (!activeOrg?.id) {
      setCreateError("Active organization not loaded yet")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const result = await dokploy<{ key?: string }>("POST", "user.createApiKey", {
        name: name.trim(),
        ...(prefix.trim() ? { prefix: prefix.trim() } : {}),
        expiresIn:
          expiresDays !== "0" ? Number(expiresDays) * 24 * 60 * 60 : undefined,
        metadata: { organizationId: activeOrg.id },
      })
      setRevealedKey(result?.key ?? null)
      setName("")
      setPrefix("")
      reload()
    } catch (cause: unknown) {
      setCreateError(toErrorMessage(cause))
    } finally {
      setCreating(false)
    }
  }

  const deleteKey = async (apiKeyId: string) => {
    try {
      await dokploy("POST", "user.deleteApiKey", { apiKeyId })
      toast.success("API key deleted successfully")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="text-muted-foreground size-5" />
            API/CLI Keys
          </CardTitle>
          <CardDescription>
            Generate and manage API keys to access the upstream API/CLI.
          </CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setRevealedKey(null)
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon className="size-4" /> Create Key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                The generated key is shown only once after creation.
              </DialogDescription>
            </DialogHeader>
            {revealedKey ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium">Copy your new API key now:</p>
                <pre className="bg-muted overflow-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">
                  {revealedKey}
                </pre>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      void navigator.clipboard.writeText(revealedKey)
                      toast.success("API key copied to clipboard")
                    }}
                  >
                    Copy & Close
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={createKey} className="grid gap-4">
                <FieldRow label="Name" error={createError && !name.trim() ? createError : undefined}>
                  <Input
                    placeholder="CI pipeline"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Prefix (optional)">
                  <Input
                    placeholder="kilat-ci"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Expires">
                  <Select value={expiresDays} onValueChange={setExpiresDays}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select expiration" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRATION_OPTIONS.map((option) => (
                        <SelectItem key={option.days} value={String(option.days)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
                {createError ? (
                  <p className="text-destructive text-sm">{createError}</p>
                ) : null}
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="border-t pt-6">
        <SimpleDataTable<ApiKeyRow>
          columns={[
            { key: "name", header: "Name" },
            {
              key: "prefix",
              header: "Prefix",
              render: (row) => row.prefix ? <Badge variant="secondary">{row.prefix}</Badge> : "—",
            },
            { key: "createdAt", header: "Created", render: (row) => fmtDate(row.createdAt) },
            {
              key: "expiresAt",
              header: "Expires",
              render: (row) => fmtDate(row.expiresAt),
            },
            {
              key: "actions",
              header: "",
              className: "text-right w-16",
              render: (row) => (
                <ConfirmAction
                  title="Delete API Key"
                  description={`Delete the API key "${row.name}"? Applications using it will stop working. This action cannot be undone.`}
                  confirmLabel="Delete Key"
                  onConfirm={() => deleteKey(row.id)}
                  trigger={
                    <Button variant="ghost" size="icon" className="size-8">
                      <Trash2Icon className="size-4 text-red-500" />
                    </Button>
                  }
                />
              ),
            },
          ]}
          rows={keys}
          loading={loading}
          error={asDisplayError(error)}
          getRowKey={(row) => row.id}
          emptyMessage="No API keys found."
        />
      </CardContent>
    </Card>
  )
}

export default function DokploySettingsProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="Profile" />
      <PageHeader
        title="Profile"
        description="Account details, passkeys and API/CLI keys of the upstream Dokploy user."
      />
      <ProfileForm />
      <ApiKeysCard />
      <PasskeysCard />
    </div>
  )
}
