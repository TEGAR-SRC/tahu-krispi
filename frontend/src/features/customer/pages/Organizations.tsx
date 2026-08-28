// Organizations: read-only membership list (switching lives in the layout
// top bar), create dialog, invitation sending per organization and the
// paste-token accept box. Invitation roles mirror iam.Role values.
import { useState } from "react"
import { Loader2Icon, MailPlusIcon, PlusIcon, UsersIcon } from "lucide-react"
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
import { apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { useOrg, type Organization } from "../useOrg"

const ROLES = ["owner", "admin", "billing", "operator", "developer", "viewer"] as const

export default function CustomerOrganizationsPage() {
  // The membership list comes from the shared OrgProvider (already loaded by
  // the layout); refresh() re-fetches it after creating or accepting.
  const { organizations, orgId, refresh } = useOrg()

  const [createOpen, setCreateOpen] = useState(false)
  const [inviteOpenFor, setInviteOpenFor] = useState<Organization | null>(null)

  const [token, setToken] = useState("")
  const [acceptBusy, setAcceptBusy] = useState(false)

  const acceptInvitation = async () => {
    if (!token.trim()) {
      toast.error("Paste the invitation token from your email")
      return
    }
    setAcceptBusy(true)
    try {
      await apiPost("/organizations/invitations/accept", { token: token.trim() })
      toast.success("Invitation accepted — you are now a member")
      setToken("")
      await refresh()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to accept invitation")
    } finally {
      setAcceptBusy(false)
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Organizations"
        description="Shared workspaces for instances, billing and members."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New organization
          </Button>
        }
      />

      {organizations.length === 0 ? (
        <EmptyState
          message="You do not belong to any organization yet."
          description="Create one or accept an invitation."
        />
      ) : (
        <div className="grid w-full max-w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {organizations.map((org) => (
            <Card key={org.id} className={org.id === orgId ? "border-primary/60" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                  <UsersIcon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {org.id === orgId ? <Badge>active</Badge> : null}
                </CardTitle>
                <CardDescription className="w-full max-w-full min-w-0 overflow-hidden break-all [overflow-wrap:anywhere]">
                  {org.slug ? `slug: ${org.slug}` : org.public_id ?? org.id}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  <p>Status: {org.status || "unknown"}</p>
                  {org.country_code ? <p>Country: {org.country_code}</p> : null}
                  {org.legal_name ? <p>Legal name: {org.legal_name}</p> : null}
                  {org.tax_id ? <p>Tax ID: {org.tax_id}</p> : null}
                </div>
                <Button size="sm" variant="outline" onClick={() => setInviteOpenFor(org)}>
                  <MailPlusIcon /> Invite member
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Accept invitation */}
      <Card>
        <CardHeader>
          <CardTitle>Join with an invitation</CardTitle>
          <CardDescription>Paste the token you received by email.</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-xl flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Invitation token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button onClick={() => void acceptInvitation()} disabled={acceptBusy}>
            {acceptBusy ? <Loader2Icon className="animate-spin" /> : null} Accept invitation
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Switching the active organization happens in the top bar; this page only manages
        creation and invitations.
      </p>

      <CreateOrgDialog
        open={createOpen}
        onOpenChange={(open) => setCreateOpen(open)}
        onCreated={() => {
          setCreateOpen(false)
          void refresh()
        }}
      />

      <InviteDialog org={inviteOpenFor} onClose={() => setInviteOpenFor(null)} />
    </div>
  )
}

// ---- Create -----------------------------------------------------------------------

function CreateOrgDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [countryCode, setCountryCode] = useState("ID")
  const [legalName, setLegalName] = useState("")
  const [taxId, setTaxId] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Organization name is required")
      return
    }
    if (!slug.trim()) {
      toast.error("Slug is required")
      return
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug.trim())) {
      toast.error("Slug may contain lowercase letters, digits and dashes")
      return
    }
    const trimmedCountry = countryCode.trim().toUpperCase()
    if (trimmedCountry && trimmedCountry.length !== 2) {
      toast.error("Country code must be a 2-letter ISO code")
      return
    }
    setBusy(true)
    try {
      await apiPost("/organizations", {
        name: name.trim(),
        slug: slug.trim(),
        country_code: trimmedCountry,
        legal_name: legalName.trim(),
        tax_id: taxId.trim(),
      })
      toast.success("Organization created")
      setName("")
      setSlug("")
      setLegalName("")
      setTaxId("")
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create organization")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>You become its first owner.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="og-name">Name *</Label>
            <Input
              id="og-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Cloud"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="og-slug">Slug *</Label>
            <Input
              id="og-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              placeholder="acme-cloud"
            />
          </div>
          <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="og-country">Country code</Label>
              <Input
                id="og-country"
                maxLength={2}
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="og-tax">Tax ID</Label>
              <Input
                id="og-tax"
                value={taxId}
                onChange={(event) => setTaxId(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="og-legal">Legal name</Label>
            <Input
              id="og-legal"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Invite ------------------------------------------------------------------------

function InviteDialog({ org, onClose }: { org: Organization | null; onClose: () => void }) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<string>("developer")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!org) return
    if (!email.trim()) {
      toast.error("Email is required")
      return
    }
    setBusy(true)
    try {
      await apiPost(`/organizations/${org.id}/invitations`, {
        email: email.trim(),
        role,
      })
      toast.success(`Invitation sent to ${email.trim()} as ${role}`)
      setEmail("")
      onClose()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to send invitation")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={org !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to “{org?.name}”</DialogTitle>
          <DialogDescription>The invitee receives a token link by email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="iv-email">Email *</Label>
            <Input
              id="iv-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((item) => (
                  <SelectItem key={item} value={item} className="capitalize">
                    {item}
                    {item === "owner" ? " — full control" : ""}
                    {item === "viewer" ? " — read only" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !org}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
