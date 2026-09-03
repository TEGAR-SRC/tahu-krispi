import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, apiPut, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"

type AccessUser = {
  userid?: string
  email?: string
  firstname?: string
  lastname?: string
  comment?: string
  enable?: number | boolean
  expire?: number
  groups?: string | string[]
  keys?: string
  "realm-type"?: string
  [k: string]: unknown
}

type AccessGroup = {
  groupid?: string
  comment?: string
  users?: string
  [k: string]: unknown
}

type AccessRole = {
  roleid?: string
  privs?: string
  special?: number | boolean
  [k: string]: unknown
}

function userEnabled(u: AccessUser): string {
  const v = u.enable
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (typeof v === "number") return v ? "yes" : "no"
  return "—"
}

function normalizeGroups(v: unknown): string[] {
  if (Array.isArray(v)) return (v as unknown[]).map((x) => String(x)).filter(Boolean)
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

export default function ProxmoxAccessPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="Access" description="PVE access: users, groups, roles.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }
  return (
    <ProviderShell
      providerId={providerId}
      title="Access"
      description="Proxmox access control: users (GET/POST/PUT/DELETE), plus read-only groups and roles. GET is infra-readable (NOC), mutations require platform_admin."
    >
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="pt-4">
          <UsersTab providerId={providerId} />
        </TabsContent>
        <TabsContent value="groups" className="pt-4">
          <GroupsTab providerId={providerId} />
        </TabsContent>
        <TabsContent value="roles" className="pt-4">
          <RolesTab providerId={providerId} />
        </TabsContent>
      </Tabs>
    </ProviderShell>
  )
}

function UsersTab({ providerId }: { providerId: string }) {
  const base = `/admin/proxmox/${providerId}`
  const path = providerId ? `${base}/access/users` : null
  const state = useInfraGet<AccessUser[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as AccessUser[]
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AccessUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccessUser | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      state.reload()
      done?.()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-xs text-muted-foreground">GET /admin/proxmox/:id/access/users — polled every 5s.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>Create user</Button>
        </div>
      </div>
      <SimpleDataTable<AccessUser>
        columns={[
          { key: "userid", header: "User", render: (r) => <span className="font-mono text-sm font-medium">{r.userid || "—"}</span> },
          { key: "realm-type", header: "Realm", render: (r) => (r["realm-type"] as string) || String((r.userid || "").split("@")[1] || "—") },
          { key: "email", header: "Email", render: (r) => r.email || "—" },
          { key: "name", header: "Name", render: (r) => [r.firstname, r.lastname].filter(Boolean).join(" ") || "—" },
          { key: "groups", header: "Groups", render: (r) => {
            const gs = normalizeGroups(r.groups)
            if (gs.length === 0) return <span className="text-muted-foreground">—</span>
            return <span className="flex flex-wrap gap-1">{gs.map((g) => <Badge key={g} variant="outline">{g}</Badge>)}</span>
          } },
          { key: "enable", header: "Enabled", render: (r) => userEnabled(r) },
          { key: "comment", header: "Comment", className: "hidden lg:table-cell max-w-48 truncate", render: (r) => r.comment || "—" },
          { key: "actions", header: "", className: "w-40 text-right", render: (r) => (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditTarget(r)}>Edit</Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(r)}>Delete</Button>
            </div>
          ) },
        ]}
        rows={rows}
        loading={state.loading}
        error={state.error}
        getRowKey={(r) => String(r.userid ?? Math.random())}
        emptyMessage="No users. Create one with userid like alice@pve."
        skeletonRows={3}
      />
      <CreateUserDialog open={createOpen} busy={busy} onOpenChange={setCreateOpen} onSubmit={(body, done) => void run(() => apiPost(`${base}/access/users`, body), `User ${String(body.userid)} created`, done)} />
      {editTarget ? (
        <EditUserDialog open target={editTarget} busy={busy} onOpenChange={(o) => !o && setEditTarget(null)} onSubmit={(body, done) => {
          const uid = String(editTarget.userid ?? "")
          void run(() => apiPut(`${base}/access/users/${encodeURIComponent(uid)}`, body), `User ${uid} updated`, () => { setEditTarget(null); done?.() })
        }} />
      ) : null}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete user "${String((deleteTarget as AccessUser | null)?.userid ?? "")}"?`}
        body="The PVE user and its tokens disappear from /access/users."
        confirmLabel="Delete user"
        busy={busy}
        onConfirm={() => {
          const t = deleteTarget
          setDeleteTarget(null)
          if (!t?.userid) return
          void run(() => apiDelete(`${base}/access/users/${encodeURIComponent(String(t.userid))}`), `User ${String(t.userid)} deleted`)
        }}
      />
    </div>
  )
}

function GroupsTab({ providerId }: { providerId: string }) {
  const path = providerId ? `/admin/proxmox/${providerId}/access/groups` : null
  const state = useInfraGet<AccessGroup[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as AccessGroup[]
  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-xs text-muted-foreground">GET /admin/proxmox/:id/access/groups — polled every 5s (read-only).</p>
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>
      </div>
      <SimpleDataTable<AccessGroup>
        columns={[
          { key: "groupid", header: "Group", render: (r) => <span className="font-mono text-sm font-medium">{r.groupid || "—"}</span> },
          { key: "comment", header: "Comment", render: (r) => r.comment || "—" },
          { key: "users", header: "Users", render: (r) => r.users || "—" },
        ]}
        rows={rows}
        loading={state.loading}
        error={state.error}
        getRowKey={(r) => String(r.groupid ?? Math.random())}
        emptyMessage="No groups on this cluster."
        skeletonRows={3}
      />
    </div>
  )
}

function RolesTab({ providerId }: { providerId: string }) {
  const path = providerId ? `/admin/proxmox/${providerId}/access/roles` : null
  const state = useInfraGet<AccessRole[]>(path, undefined, { intervalMs: 5000 })
  const rows = (Array.isArray(state.data) ? state.data : []) as AccessRole[]
  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-xs text-muted-foreground">GET /admin/proxmox/:id/access/roles — polled every 5s (read-only).</p>
        <Button variant="outline" size="sm" onClick={() => state.reload()} disabled={state.loading}>Refresh</Button>
      </div>
      <SimpleDataTable<AccessRole>
        columns={[
          { key: "roleid", header: "Role", render: (r) => <span className="font-mono text-sm font-medium">{r.roleid || "—"}</span> },
          { key: "special", header: "Built-in", render: (r) => r.special ? <Badge variant="outline">special</Badge> : "—" },
          { key: "privs", header: "Privileges", className: "max-w-xl", render: (r) => {
            const v = String(r.privs || "")
            if (!v) return "—"
            const parts = v.split(",").map((s) => s.trim()).filter(Boolean)
            return <span className="line-clamp-2 text-xs">{parts.join(", ")}</span>
          } },
        ]}
        rows={rows}
        loading={state.loading}
        error={state.error}
        getRowKey={(r) => String(r.roleid ?? Math.random())}
        emptyMessage="No roles."
        skeletonRows={3}
      />
    </div>
  )
}

function CreateUserDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (body: Record<string, unknown>, done: () => void) => void }) {
  const [userid, setUserid] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [firstname, setFirstname] = useState("")
  const [lastname, setLastname] = useState("")
  const [comment, setComment] = useState("")
  const [groups, setGroups] = useState("")
  const [keys, setKeys] = useState("")
  const submit = () => {
    if (!userid.trim() || !userid.includes("@")) { toast.error("userid must look like alice@pve"); return }
    if (!password.trim()) { toast.error("password is required"); return }
    const body: Record<string, unknown> = { userid: userid.trim(), password }
    if (email.trim()) body.email = email.trim()
    if (firstname.trim()) body.firstname = firstname.trim()
    if (lastname.trim()) body.lastname = lastname.trim()
    if (comment.trim()) body.comment = comment.trim()
    if (groups.trim()) body.groups = groups.trim()
    if (keys.trim()) body.keys = keys.trim()
    onSubmit(body, () => { onOpenChange(false); setPassword(""); })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create PVE user</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/access/users — userid must include realm (e.g. alice@pve).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="au-userid">User ID *</Label><Input id="au-userid" value={userid} onChange={(e) => setUserid(e.target.value)} placeholder="alice@pve" /></div>
          <div className="space-y-1.5"><Label htmlFor="au-password">Password *</Label><Input id="au-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="au-email">Email</Label><Input id="au-email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="au-firstname">First name</Label><Input id="au-firstname" value={firstname} onChange={(e) => setFirstname(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="au-lastname">Last name</Label><Input id="au-lastname" value={lastname} onChange={(e) => setLastname(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="au-groups">Groups (comma)</Label><Input id="au-groups" value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="admins,users" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="au-comment">Comment</Label><Input id="au-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="au-keys">SSH keys</Label><Textarea id="au-keys" value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="ssh-rsa ..." rows={3} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create user"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({ open, target, busy, onOpenChange, onSubmit }: { open: boolean; target: AccessUser; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (body: Record<string, unknown>, done: () => void) => void }) {
  const [email, setEmail] = useState(String(target.email ?? ""))
  const [firstname, setFirstname] = useState(String(target.firstname ?? ""))
  const [lastname, setLastname] = useState(String(target.lastname ?? ""))
  const [comment, setComment] = useState(String(target.comment ?? ""))
  const [groups, setGroups] = useState(normalizeGroups(target.groups).join(","))
  const [enable, setEnable] = useState(() => {
    const v = target.enable
    if (typeof v === "boolean") return v
    if (typeof v === "number") return Boolean(v)
    return true
  })
  const submit = () => {
    const body: Record<string, unknown> = { email: email.trim(), firstname: firstname.trim(), lastname: lastname.trim(), comment: comment.trim(), groups: groups.trim(), enable }
    onSubmit(body, () => onOpenChange(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {String(target.userid)}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/access/users/:userid — leaves keys/password untouched unless supplied.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="eu-email">Email</Label><Input id="eu-email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="eu-firstname">First name</Label><Input id="eu-firstname" value={firstname} onChange={(e) => setFirstname(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="eu-lastname">Last name</Label><Input id="eu-lastname" value={lastname} onChange={(e) => setLastname(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="eu-groups">Groups (comma)</Label><Input id="eu-groups" value={groups} onChange={(e) => setGroups(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="eu-comment">Comment</Label><Input id="eu-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-primary" checked={enable} onChange={(e) => setEnable(e.target.checked)} /> Enabled</label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
