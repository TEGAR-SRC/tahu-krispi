// K6 · Settings ▸ Users — parity console for upstream members, invitations,
// permissions, sessions and custom roles. Uses only real Dokploy proxy ops.
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ShieldIcon, UsersIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { ConfirmAction, JsonViewerDialog, K6Breadcrumbs, asDisplayError, fmtDate } from "./k6-helpers"

type JsonRecord = Record<string, unknown>
type OperationMethod = "GET" | "POST"

interface UserRow extends JsonRecord {
  id?: string
  userId?: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  role?: string | null
  image?: string | null
  createdAt?: string | null
}

interface InvitationRow extends JsonRecord {
  id?: string
  invitationId?: string
  email?: string | null
  role?: string | null
  status?: string | null
  expiresAt?: string | null
  createdAt?: string | null
}

interface CustomRoleRow extends JsonRecord {
  id?: string
  customRoleId?: string
  name?: string
  description?: string | null
  statements?: unknown
  createdAt?: string | null
}

interface OperationSpec {
  op: string
  method?: OperationMethod
  title: string
  description: string
  defaultBody?: JsonRecord
  destructive?: boolean
}

const USER_OPERATIONS: OperationSpec[] = [
  { op: "user.one", method: "GET", title: "Get user", description: "Fetch one user by userId/id.", defaultBody: { userId: "" } },
  { op: "user.createUserWithCredentials", title: "Create user with credentials", description: "Create a local Dokploy user.", defaultBody: { email: "", password: "", name: "" } },
  { op: "user.sendInvitation", title: "Send invitation", description: "Send an invitation email using upstream notification providers.", defaultBody: { email: "" } },
  { op: "user.assignPermissions", title: "Assign permissions", description: "Apply a raw upstream permissions payload.", defaultBody: { userId: "", permissions: [] } },
  { op: "user.session", method: "GET", title: "Current session", description: "Read the upstream authenticated session." },
  { op: "organization.updateMemberRole", title: "Update member role", description: "Change an organization member role.", defaultBody: { memberId: "", role: "member" } },
  { op: "organization.inviteMember", title: "Invite organization member", description: "Create an organization invitation.", defaultBody: { email: "", role: "member" } },
]

const ROLE_OPERATIONS: OperationSpec[] = [
  { op: "customRole.getStatements", method: "GET", title: "Get available statements", description: "List permission statements accepted by custom roles." },
  { op: "customRole.create", title: "Create custom role", description: "Create a role from a raw statements payload.", defaultBody: { name: "", description: "", statements: [] } },
  { op: "customRole.update", title: "Update custom role", description: "Update a role by customRoleId/id.", defaultBody: { customRoleId: "", name: "", description: "", statements: [] } },
  { op: "customRole.membersByRole", method: "GET", title: "Members by role", description: "Fetch members assigned to a custom role.", defaultBody: { customRoleId: "" } },
]

function rowId(row: JsonRecord): string {
  return String(row.id ?? row.userId ?? row.invitationId ?? row.customRoleId ?? "")
}

function displayName(row: UserRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || String(row.name ?? "—")
}

function queryFromBody(body: JsonRecord | undefined): Record<string, string | number | undefined> | undefined {
  if (!body) return undefined
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => typeof value === "string" || typeof value === "number"),
  ) as Record<string, string | number | undefined>
}

function parseJsonObject(text: string): JsonRecord | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object")
  }
  return parsed as JsonRecord
}

function OperationDialog({ spec, onSuccess }: { spec: OperationSpec; onSuccess?: () => void }) {
  const [open, setOpen] = useState(false)
  const [bodyText, setBodyText] = useState(() => JSON.stringify(spec.defaultBody ?? {}, null, 2))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const body = parseJsonObject(bodyText)
      const method = spec.method ?? "POST"
      const response = await dokploy(method, spec.op, method === "GET" ? undefined : body, method === "GET" ? queryFromBody(body) : undefined)
      setResult(response ?? { ok: true })
      toast.success(`${spec.op} completed`)
      onSuccess?.()
    } catch (cause: unknown) {
      setError(toErrorMessage(cause))
      toast.error(toErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const trigger = (
    <Button variant={spec.destructive ? "destructive" : "outline"} size="sm">
      {spec.title}
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{spec.method ?? "POST"}</Badge>
            <code className="text-muted-foreground text-xs">{spec.op}</code>
          </div>
          <Textarea
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            className="min-h-40 font-mono text-xs"
            placeholder="{}"
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {result !== null ? (
            <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </div>
        <DialogFooter>
          {spec.destructive ? (
            <ConfirmAction
              title={`Run ${spec.op}`}
              description="This operation can remove or revoke upstream data. Confirm before sending the real request."
              confirmLabel="Run operation"
              onConfirm={run}
              busy={busy}
              trigger={<Button variant="destructive" disabled={busy}>{busy ? "Running…" : "Run"}</Button>}
            />
          ) : (
            <Button onClick={run} disabled={busy}>{busy ? "Running…" : "Run"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OperationsCard({ title, description, specs, onSuccess }: { title: string; description: string; specs: OperationSpec[]; onSuccess?: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 border-t pt-6">
        {specs.map((spec) => <OperationDialog key={spec.op} spec={spec} onSuccess={onSuccess} />)}
      </CardContent>
    </Card>
  )
}

function UsersPanel() {
  const { data, error, loading, reload } = useUpstream<UserRow[]>(() => dokploy<UserRow[]>("GET", "user.all"), [])
  const [filter, setFilter] = useState("")
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((user) => [user.email, user.firstName, user.lastName, user.role].filter(Boolean).join(" ").toLowerCase().includes(q))
  }, [data, filter])

  const removeUser = async (user: UserRow) => {
    try {
      await dokploy("POST", "user.remove", { userId: rowId(user) })
      toast.success("User removed")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }

  const columns: Array<SimpleColumn<UserRow>> = [
    { key: "name", header: "Name", render: displayName },
    { key: "email", header: "Email", render: (row) => row.email || "—" },
    { key: "role", header: "Role", render: (row) => row.role ? <Badge variant="secondary">{row.role}</Badge> : "—" },
    { key: "createdAt", header: "Created", render: (row) => fmtDate(row.createdAt) },
    { key: "raw", header: "Raw", className: "w-20", render: (row) => <JsonViewerDialog label="JSON" title="User payload" value={row} /> },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      render: (row) => rowId(row) ? (
        <ConfirmAction
          title="Remove user"
          description={`Remove ${row.email ?? rowId(row)} from Dokploy? This is a real upstream mutation.`}
          confirmLabel="Remove"
          onConfirm={() => removeUser(row)}
          trigger={<Button variant="destructive" size="sm">Remove</Button>}
        />
      ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input className="max-w-sm" placeholder="Filter users…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <Button variant="outline" size="sm" onClick={reload}>Refresh</Button>
      </div>
      <SimpleDataTable<UserRow>
        columns={columns}
        rows={rows}
        loading={loading}
        error={asDisplayError(error)}
        getRowKey={(row, index) => rowId(row) || String(index)}
        emptyMessage={(data ?? []).length === 0 ? "No users returned by upstream." : "No users match your filter."}
      />
    </div>
  )
}

function InvitationsPanel() {
  const { data, error, loading, reload } = useUpstream<InvitationRow[]>(() => dokploy<InvitationRow[]>("GET", "organization.allInvitations"), [])
  const removeInvitation = async (invitation: InvitationRow) => {
    try {
      await dokploy("POST", "organization.removeInvitation", { invitationId: rowId(invitation) })
      toast.success("Invitation removed")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }
  const columns: Array<SimpleColumn<InvitationRow>> = [
    { key: "email", header: "Email", render: (row) => row.email || "—" },
    { key: "role", header: "Role", render: (row) => row.role ? <Badge variant="outline">{row.role}</Badge> : "—" },
    { key: "status", header: "Status", render: (row) => row.status ? <Badge variant="secondary">{row.status}</Badge> : "—" },
    { key: "expiresAt", header: "Expires", render: (row) => fmtDate(row.expiresAt) },
    { key: "raw", header: "Raw", className: "w-20", render: (row) => <JsonViewerDialog label="JSON" title="Invitation payload" value={row} /> },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      render: (row) => rowId(row) ? (
        <ConfirmAction
          title="Remove invitation"
          description={`Remove invitation for ${row.email ?? rowId(row)}?`}
          confirmLabel="Remove"
          onConfirm={() => removeInvitation(row)}
          trigger={<Button variant="destructive" size="sm">Remove</Button>}
        />
      ) : null,
    },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={reload}>Refresh</Button></div>
      <SimpleDataTable<InvitationRow>
        columns={columns}
        rows={data ?? []}
        loading={loading}
        error={asDisplayError(error)}
        getRowKey={(row, index) => rowId(row) || String(index)}
        emptyMessage="No pending invitations returned by upstream."
      />
    </div>
  )
}

function RolesPanel() {
  const { data, error, loading, reload } = useUpstream<CustomRoleRow[]>(() => dokploy<CustomRoleRow[]>("GET", "customRole.all"), [])
  const removeRole = async (role: CustomRoleRow) => {
    try {
      await dokploy("POST", "customRole.remove", { customRoleId: rowId(role) })
      toast.success("Custom role removed")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    }
  }
  const columns: Array<SimpleColumn<CustomRoleRow>> = [
    { key: "name", header: "Name", render: (row) => row.name || "—" },
    { key: "description", header: "Description", render: (row) => row.description || "—" },
    { key: "createdAt", header: "Created", render: (row) => fmtDate(row.createdAt) },
    { key: "raw", header: "Raw", className: "w-20", render: (row) => <JsonViewerDialog label="JSON" title="Custom role payload" value={row} /> },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      render: (row) => rowId(row) ? (
        <ConfirmAction
          title="Remove custom role"
          description={`Remove role ${row.name ?? rowId(row)}? Members using it may lose permissions.`}
          confirmLabel="Remove"
          onConfirm={() => removeRole(row)}
          trigger={<Button variant="destructive" size="sm">Remove</Button>}
        />
      ) : null,
    },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={reload}>Refresh</Button></div>
      <SimpleDataTable<CustomRoleRow>
        columns={columns}
        rows={data ?? []}
        loading={loading}
        error={asDisplayError(error)}
        getRowKey={(row, index) => rowId(row) || String(index)}
        emptyMessage="No custom roles returned by upstream."
      />
    </div>
  )
}

export default function DokploySettingsUsersPage() {
  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="Users" />
      <PageHeader
        title="Users"
        description="Real upstream Dokploy user, invitation and custom-role operations."
      />
      <Alert>
        <ShieldIcon />
        <AlertTitle>Generic operation console</AlertTitle>
        <AlertDescription>
          Forms below send raw JSON to the upstream v0.30.2 proxy operations; destructive operations require confirmation and surface upstream responses/errors.
        </AlertDescription>
      </Alert>
      <Tabs defaultValue="users" className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="users">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="roles">Custom Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UsersIcon className="text-muted-foreground size-5" /> Members</CardTitle>
              <CardDescription>Backed by user.all and user.remove.</CardDescription>
            </CardHeader>
            <CardContent className="border-t pt-6"><UsersPanel /></CardContent>
          </Card>
          <OperationsCard title="User and organization operations" description="Create users, invitations, permission assignments and inspect sessions." specs={USER_OPERATIONS} />
        </TabsContent>
        <TabsContent value="invitations" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
              <CardDescription>Backed by organization.allInvitations and organization.removeInvitation.</CardDescription>
            </CardHeader>
            <CardContent className="border-t pt-6"><InvitationsPanel /></CardContent>
          </Card>
          <OperationsCard title="Invitation operations" description="Invite members through user.sendInvitation or organization.inviteMember." specs={USER_OPERATIONS.filter((spec) => spec.op.includes("Invitation") || spec.op.includes("inviteMember"))} />
        </TabsContent>
        <TabsContent value="roles" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Custom Roles</CardTitle>
              <CardDescription>Backed by customRole.all and customRole.remove.</CardDescription>
            </CardHeader>
            <CardContent className="border-t pt-6"><RolesPanel /></CardContent>
          </Card>
          <OperationsCard title="Custom role operations" description="Manage role definitions and inspect assignable statements/members." specs={ROLE_OPERATIONS} onSuccess={() => window.setTimeout(() => window.location.reload(), 300)} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
