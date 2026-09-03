import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import { StatusBadge } from "@/features/admin/pages/shared"

interface HAResource {
  sid?: string
  type?: string
  group?: string
  state?: string
  comment?: string
  max_restart?: number
  max_relocate?: number
  failback?: number | boolean
  digest?: string
  [key: string]: unknown
}

interface HAGroup {
  group?: string
  nodes?: string
  type?: string
  comment?: string
  restricted?: number | boolean
  nofailback?: number | boolean
  digest?: string
  [key: string]: unknown
}

interface HARule {
  rule?: string
  type?: string
  affinity?: string
  resources?: string
  nodes?: string
  comment?: string
  strict?: number | boolean
  disable?: number | boolean
  digest?: string
  [key: string]: unknown
}

const RESOURCE_TYPES = ["vm", "ct"]

export default function ProxmoxHaPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [typeFilter, setTypeFilter] = useState("all")
  const [resources, setResources] = useState<HAResource[]>([])
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [resourcesError, setResourcesError] = useState<unknown>(null)

  const [groups, setGroups] = useState<HAGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError] = useState<unknown>(null)

  const [rules, setRules] = useState<HARule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesError, setRulesError] = useState<unknown>(null)

  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)

  const [addResourceOpen, setAddResourceOpen] = useState(false)
  const [deleteResourceTarget, setDeleteResourceTarget] = useState<{ sid: string; purge: boolean } | null>(null)
  const [disarmOpen, setDisarmOpen] = useState(false)

  const [groupCreateOpen, setGroupCreateOpen] = useState(false)
  const [groupEditTarget, setGroupEditTarget] = useState<HAGroup | null>(null)
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<HAGroup | null>(null)

  const [ruleCreateOpen, setRuleCreateOpen] = useState(false)
  const [ruleEditTarget, setRuleEditTarget] = useState<HARule | null>(null)
  const [ruleDeleteTarget, setRuleDeleteTarget] = useState<HARule | null>(null)

  const reload = useCallback(() => setTick((v) => v + 1), [])

  const loadResources = useCallback(async () => {
    if (!providerId) return
    setResourcesLoading(true)
    setResourcesError(null)
    try {
      const query = typeFilter === "all" ? undefined : { type: typeFilter }
      const res = await apiGet<HAResource[]>(`${base}/ha-resources`, query ? { query } : undefined)
      setResources(Array.isArray(res.data) ? res.data : [])
    } catch (cause) {
      setResourcesError(cause)
    } finally {
      setResourcesLoading(false)
    }
  }, [base, providerId, typeFilter])

  const loadGroups = useCallback(async () => {
    if (!providerId) return
    setGroupsLoading(true)
    setGroupsError(null)
    try {
      const res = await apiGet<HAGroup[]>(`${base}/ha/groups`)
      setGroups(Array.isArray(res.data) ? res.data : [])
    } catch (cause) {
      setGroupsError(cause)
    } finally {
      setGroupsLoading(false)
    }
  }, [base, providerId])

  const loadRules = useCallback(async () => {
    if (!providerId) return
    setRulesLoading(true)
    setRulesError(null)
    try {
      const res = await apiGet<HARule[]>(`${base}/ha/rules`)
      setRules(Array.isArray(res.data) ? res.data : [])
    } catch (cause) {
      setRulesError(cause)
    } finally {
      setRulesLoading(false)
    }
  }, [base, providerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadResources()
  }, [loadResources, tick])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadGroups()
  }, [loadGroups, tick])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadRules()
  }, [loadRules, tick])

  const runAction = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reload()
      done?.()
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!providerId) {
    return (
      <ProviderShell providerId={providerId} title="HA" description="High availability for this Proxmox cluster.">
        <p className="text-sm text-destructive">Missing providerId in route.</p>
      </ProviderShell>
    )
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="HA"
      description="HA resources, groups and rules plus watchdog arm/disarm. Resources bind guests (vm:100) to HA; groups pin node affinity (deprecated, kept for existing clusters); rules are the modern affinity unit. GET is infra-readable (NOC), mutations require platform_admin."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void runAction(() => apiPost(`${base}/ha/arm`, {}), "Watchdog armed")}>
            Arm watchdog
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDisarmOpen(true)}>
            Disarm…
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="resources">
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">HA resources</CardTitle>
                  <CardDescription>Guests managed by the HA stack — SID is vm:&lt;vmid&gt; or ct:&lt;ctid&gt;. Filter by type server-side.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setAddResourceOpen(true)}>
                  Add resource…
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex min-w-0 items-center gap-2">
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {RESOURCE_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => void loadResources()} disabled={resourcesLoading}>
                  Refresh
                </Button>
              </div>

              <SimpleDataTable<HAResource>
                columns={[
                  { key: "sid", header: "SID", render: (r) => <span className="font-mono text-sm">{r.sid || "—"}</span> },
                  { key: "type", header: "Type", render: (r) => <Badge variant="outline">{r.type || r.sid?.split(":")[0] || "—"}</Badge> },
                  { key: "state", header: "State", render: (r) => <StatusBadge status={r.state ?? null} /> },
                  { key: "group", header: "Group", className: "hidden md:table-cell", render: (r) => r.group || "—" },
                  { key: "limits", header: "Restart / relocate", className: "hidden lg:table-cell", render: (r) => `${r.max_restart ?? 1} / ${r.max_relocate ?? 1}` },
                  { key: "comment", header: "Comment", className: "hidden xl:table-cell max-w-64 truncate", render: (r) => (r.comment as string) || "—" },
                  {
                    key: "actions",
                    header: "",
                    className: "w-24 text-right",
                    render: (r) => (
                      <Button variant="destructive" size="sm" disabled={!r.sid} onClick={() => setDeleteResourceTarget({ sid: String(r.sid), purge: false })}>
                        Delete
                      </Button>
                    ),
                  },
                ]}
                rows={resources}
                loading={resourcesLoading}
                error={resourcesError}
                getRowKey={(r) => String(r.sid ?? "?")}
                emptyMessage="No HA resources registered."
                skeletonRows={4}
              />
              <p className="text-xs text-muted-foreground">
                Endpoints: <span className="font-mono">GET /admin/proxmox/:id/ha-resources?type=</span> · <span className="font-mono">POST /admin/proxmox/:id/ha-resources</span> · <span className="font-mono">DELETE /admin/proxmox/:id/ha-resources?sid=&purge=</span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">HA groups</CardTitle>
                  <CardDescription>Node-affinity groups (deprecated by PVE in favor of rules, still honoured). GET is infra-readable, mutations are platform_admin-only.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setGroupCreateOpen(true)}>
                  Create group…
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<HAGroup>
                columns={[
                  { key: "group", header: "Group", render: (r) => <span className="font-mono text-sm font-medium">{r.group || "—"}</span> },
                  { key: "nodes", header: "Nodes", render: (r) => (r.nodes as string) || "—" },
                  { key: "restricted", header: "Restricted", render: (r) => String(r.restricted ?? "—") },
                  { key: "nofailback", header: "No failback", render: (r) => String(r.nofailback ?? "—") },
                  { key: "comment", header: "Comment", className: "hidden md:table-cell max-w-48 truncate", render: (r) => (r.comment as string) || "—" },
                  {
                    key: "actions",
                    header: "",
                    className: "w-40 text-right",
                    render: (r) => (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={!r.group} onClick={() => setGroupEditTarget(r)}>
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" disabled={!r.group} onClick={() => setGroupDeleteTarget(r)}>
                          Delete
                        </Button>
                      </div>
                    ),
                  },
                ]}
                rows={groups}
                loading={groupsLoading}
                error={groupsError}
                getRowKey={(r) => String(r.group ?? "?")}
                emptyMessage="No HA groups configured."
                skeletonRows={3}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Endpoints: <span className="font-mono">GET /admin/proxmox/:id/ha/groups</span> · <span className="font-mono">POST /admin/proxmox/:id/ha/groups</span> · <span className="font-mono">PUT /admin/proxmox/:id/ha/groups/:group</span> · <span className="font-mono">DELETE /admin/proxmox/:id/ha/groups/:group</span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">HA rules</CardTitle>
                  <CardDescription>Modern HA affinity rules — type node-affinity or resource-affinity, with resources as comma list of SIDs. Replaces groups on newer PVE.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setRuleCreateOpen(true)}>
                  Create rule…
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <SimpleDataTable<HARule>
                columns={[
                  { key: "rule", header: "Rule", render: (r) => <span className="font-mono text-sm font-medium">{r.rule || "—"}</span> },
                  { key: "type", header: "Type", render: (r) => <Badge variant="outline">{(r.type as string) || "—"}</Badge> },
                  { key: "affinity", header: "Affinity", className: "hidden md:table-cell", render: (r) => (r.affinity as string) || "—" },
                  { key: "resources", header: "Resources", className: "hidden lg:table-cell max-w-48 truncate", render: (r) => (r.resources as string) || "—" },
                  { key: "nodes", header: "Nodes", className: "hidden xl:table-cell max-w-40 truncate", render: (r) => (r.nodes as string) || "—" },
                  { key: "comment", header: "Comment", className: "hidden xl:table-cell max-w-40 truncate", render: (r) => (r.comment as string) || "—" },
                  {
                    key: "actions",
                    header: "",
                    className: "w-40 text-right",
                    render: (r) => (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" disabled={!r.rule} onClick={() => setRuleEditTarget(r)}>
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" disabled={!r.rule} onClick={() => setRuleDeleteTarget(r)}>
                          Delete
                        </Button>
                      </div>
                    ),
                  },
                ]}
                rows={rules}
                loading={rulesLoading}
                error={rulesError}
                getRowKey={(r) => String(r.rule ?? "?")}
                emptyMessage="No HA rules configured."
                skeletonRows={3}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Endpoints: <span className="font-mono">GET /admin/proxmox/:id/ha/rules</span> · <span className="font-mono">POST /admin/proxmox/:id/ha/rules</span> · <span className="font-mono">PUT /admin/proxmox/:id/ha/rules/:rule</span> · <span className="font-mono">DELETE /admin/proxmox/:id/ha/rules/:rule</span>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Watchdog: <span className="font-mono">POST /admin/proxmox/:id/ha/arm</span> · <span className="font-mono">POST /admin/proxmox/:id/ha/disarm {"{mode: freeze|ignore}"}</span>
      </p>

      <AddResourceDialog open={addResourceOpen} busy={busy} onOpenChange={setAddResourceOpen} onSubmit={(body, done) => void runAction(() => apiPost(`${base}/ha-resources`, body), `HA resource ${String(body.sid)} added`, done)} />

      <ConfirmDialog
        open={deleteResourceTarget !== null}
        onOpenChange={(open) => !open && setDeleteResourceTarget(null)}
        title={`Delete HA resource "${deleteResourceTarget?.sid}"?`}
        body="Removes the guest from HA management."
        confirmLabel="Delete resource"
        busy={busy}
        onConfirm={() => {
          const t = deleteResourceTarget
          setDeleteResourceTarget(null)
          if (!t) return
          void runAction(() => apiDelete(`${base}/ha-resources`, { query: { sid: t.sid, purge: t.purge ? "true" : null } }), `HA resource ${t.sid} deleted`)
        }}
      >
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <Checkbox
            checked={deleteResourceTarget?.purge ?? false}
            onCheckedChange={(checked) => setDeleteResourceTarget((cur) => (cur ? { ...cur, purge: checked === true } : cur))}
          />
          Also purge the resource from the config file
        </label>
      </ConfirmDialog>

      <DisarmDialog open={disarmOpen} busy={busy} onOpenChange={setDisarmOpen} onSubmit={(mode, done) => void runAction(() => apiPost(`${base}/ha/disarm`, { mode }), `Watchdog disarmed (${mode})`, done)} />

      <CreateGroupDialog open={groupCreateOpen} busy={busy} onOpenChange={setGroupCreateOpen} onSubmit={(body, done) => void runAction(() => apiPost(`${base}/ha/groups`, body), `HA group ${String(body.group)} created`, done)} />
      {groupEditTarget?.group ? (
        <EditGroupDialog
          open
          target={groupEditTarget}
          busy={busy}
          onOpenChange={(open) => !open && setGroupEditTarget(null)}
          onSubmit={(body, done) => void runAction(() => apiPut(`${base}/ha/groups/${encodeURIComponent(String(groupEditTarget.group))}`, body), `HA group ${groupEditTarget.group} updated`, done)}
        />
      ) : null}
      <ConfirmDialog
        open={groupDeleteTarget !== null}
        onOpenChange={(open) => !open && setGroupDeleteTarget(null)}
        title={`Delete HA group "${groupDeleteTarget?.group}"?`}
        body="Removes the HA group. Resources bound to it become ungrouped."
        confirmLabel="Delete group"
        busy={busy}
        onConfirm={() => {
          const t = groupDeleteTarget
          setGroupDeleteTarget(null)
          if (!t?.group) return
          void runAction(() => apiDelete(`${base}/ha/groups/${encodeURIComponent(String(t.group))}`), `HA group ${t.group} deleted`)
        }}
      />

      <CreateRuleDialog open={ruleCreateOpen} busy={busy} onOpenChange={setRuleCreateOpen} onSubmit={(body, done) => void runAction(() => apiPost(`${base}/ha/rules`, body), `HA rule ${String(body.rule)} created`, done)} />
      {ruleEditTarget?.rule ? (
        <EditRuleDialog
          open
          target={ruleEditTarget}
          busy={busy}
          onOpenChange={(open) => !open && setRuleEditTarget(null)}
          onSubmit={(body, done) => void runAction(() => apiPut(`${base}/ha/rules/${encodeURIComponent(String(ruleEditTarget.rule))}`, body), `HA rule ${ruleEditTarget.rule} updated`, done)}
        />
      ) : null}
      <ConfirmDialog
        open={ruleDeleteTarget !== null}
        onOpenChange={(open) => !open && setRuleDeleteTarget(null)}
        title={`Delete HA rule "${ruleDeleteTarget?.rule}"?`}
        body="Removes the HA rule entirely."
        confirmLabel="Delete rule"
        busy={busy}
        onConfirm={() => {
          const t = ruleDeleteTarget
          setRuleDeleteTarget(null)
          if (!t?.rule) return
          void runAction(() => apiDelete(`${base}/ha/rules/${encodeURIComponent(String(t.rule))}`), `HA rule ${t.rule} deleted`)
        }}
      />
    </ProviderShell>
  )
}

function AddResourceDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, unknown>, done: () => void) => void }) {
  const [sid, setSid] = useState("")
  const [type, setType] = useState("vm")
  const [state, setState] = useState("started")
  const [group, setGroup] = useState("")
  const [maxRestart, setMaxRestart] = useState("1")
  const [maxRelocate, setMaxRelocate] = useState("1")
  const [comment, setComment] = useState("")
  const submit = () => {
    if (!sid.trim()) {
      toast.error("SID is required (e.g. vm:100).")
      return
    }
    const body: Record<string, unknown> = { sid: sid.trim(), state }
    if (type.trim()) body.type = type.trim()
    if (group.trim()) body.group = group.trim()
    if (maxRestart.trim()) body.max_restart = Number.parseInt(maxRestart, 10)
    if (maxRelocate.trim()) body.max_relocate = Number.parseInt(maxRelocate, 10)
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => onOpenChange(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add HA resource</DialogTitle>
          <DialogDescription>SID format is vm:&lt;vmid&gt; or ct:&lt;ctid&gt;.</DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ha-sid">SID *</Label>
            <Input id="ha-sid" value={sid} onChange={(e) => setSid(e.target.value)} placeholder="vm:100" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ha-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-state">State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id="ha-state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["started", "stopped", "enabled", "disabled"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group">Group</Label>
            <Input id="ha-group" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Optional group" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-restart">Max restarts</Label>
            <Input id="ha-restart" inputMode="numeric" value={maxRestart} onChange={(e) => setMaxRestart(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-relocate">Max relocations</Label>
            <Input id="ha-relocate" inputMode="numeric" value={maxRelocate} onChange={(e) => setMaxRelocate(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ha-comment">Comment</Label>
            <Input id="ha-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Add resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisarmDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (m: string, done: () => void) => void }) {
  const [mode, setMode] = useState("freeze")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Disarm the HA watchdog</DialogTitle>
          <DialogDescription>freeze pauses recovery decisions; ignore stops tracking entirely.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="ha-disarm-mode">Mode *</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id="ha-disarm-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="freeze">freeze</SelectItem>
              <SelectItem value="ignore">ignore</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => onSubmit(mode, () => onOpenChange(false))}>
            Disarm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateGroupDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, unknown>, done: () => void) => void }) {
  const [group, setGroup] = useState("")
  const [nodes, setNodes] = useState("")
  const [comment, setComment] = useState("")
  const [restricted, setRestricted] = useState(false)
  const [nofailback, setNofailback] = useState(false)
  const submit = () => {
    if (!group.trim()) {
      toast.error("Group name is required.")
      return
    }
    if (!nodes.trim()) {
      toast.error("Nodes is required (comma list).")
      return
    }
    const body: Record<string, unknown> = { group: group.trim(), nodes: nodes.trim() }
    if (comment.trim()) body.comment = comment.trim()
    if (restricted) body.restricted = 1
    if (nofailback) body.nofailback = 1
    onSubmit(body, () => {
      setGroup("")
      setNodes("")
      setComment("")
      onOpenChange(false)
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create HA group</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/ha/groups — group + nodes are mandatory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ha-group-name">Group *</Label>
            <Input id="ha-group-name" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="ha-group-01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group-nodes">Nodes *</Label>
            <Input id="ha-group-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="pve01,pve02" />
            <p className="text-xs text-muted-foreground">Comma-separated, ordered by priority.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group-comment">Comment</Label>
            <Input id="ha-group-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={restricted} onCheckedChange={(v) => setRestricted(v === true)} />
            Restricted (only run on listed nodes)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={nofailback} onCheckedChange={(v) => setNofailback(v === true)} />
            No failback
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !group.trim() || !nodes.trim()} onClick={submit}>
            {busy ? "Creating…" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditGroupDialog({ open, busy, target, onOpenChange, onSubmit }: { open: boolean; busy: boolean; target: HAGroup; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, unknown>, done: () => void) => void }) {
  const [nodes, setNodes] = useState((target.nodes as string) || "")
  const [comment, setComment] = useState((target.comment as string) || "")
  const [restricted, setRestricted] = useState(Boolean(target.restricted))
  const [nofailback, setNofailback] = useState(Boolean(target.nofailback))
  const submit = () => {
    if (!nodes.trim()) {
      toast.error("Nodes is required.")
      return
    }
    const body: Record<string, unknown> = { nodes: nodes.trim() }
    body.comment = comment.trim()
    body.restricted = restricted ? 1 : 0
    body.nofailback = nofailback ? 1 : 0
    if (target.digest) body.digest = target.digest
    onSubmit(body, () => onOpenChange(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit HA group {target.group}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/ha/groups/:group</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Input value={String(target.group)} disabled className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group-edit-nodes">Nodes *</Label>
            <Input id="ha-group-edit-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-group-edit-comment">Comment</Label>
            <Input id="ha-group-edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={restricted} onCheckedChange={(v) => setRestricted(v === true)} />
            Restricted
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={nofailback} onCheckedChange={(v) => setNofailback(v === true)} />
            No failback
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateRuleDialog({ open, busy, onOpenChange, onSubmit }: { open: boolean; busy: boolean; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, unknown>, done: () => void) => void }) {
  const [rule, setRule] = useState("")
  const [type, setType] = useState("node-affinity")
  const [affinity, setAffinity] = useState("positive")
  const [resources, setResources] = useState("")
  const [nodes, setNodes] = useState("")
  const [comment, setComment] = useState("")
  const [strict, setStrict] = useState(false)
  const [disable, setDisable] = useState(false)
  const submit = () => {
    if (!rule.trim()) {
      toast.error("Rule name is required.")
      return
    }
    if (!type.trim()) {
      toast.error("Type is required.")
      return
    }
    if (!resources.trim()) {
      toast.error("Resources is required (comma SIDs).")
      return
    }
    const body: Record<string, unknown> = { rule: rule.trim(), type: type.trim(), resources: resources.trim() }
    if (affinity.trim()) body.affinity = affinity.trim()
    if (nodes.trim()) body.nodes = nodes.trim()
    if (comment.trim()) body.comment = comment.trim()
    if (strict) body.strict = 1
    if (disable) body.disable = 1
    onSubmit(body, () => {
      setRule("")
      setResources("")
      setNodes("")
      setComment("")
      onOpenChange(false)
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create HA rule</DialogTitle>
          <DialogDescription>POST /admin/proxmox/:id/ha/rules — rule + type + resources are mandatory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-name">Rule *</Label>
            <Input id="ha-rule-name" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="rule-01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-type">Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ha-rule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="node-affinity">node-affinity</SelectItem>
                <SelectItem value="resource-affinity">resource-affinity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-affinity">Affinity</Label>
            <Select value={affinity} onValueChange={setAffinity}>
              <SelectTrigger id="ha-rule-affinity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="positive">positive</SelectItem>
                <SelectItem value="negative">negative</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-resources">Resources *</Label>
            <Input id="ha-rule-resources" value={resources} onChange={(e) => setResources(e.target.value)} placeholder="vm:100,ct:101" />
            <p className="text-xs text-muted-foreground">Comma list of SIDs.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-nodes">Nodes</Label>
            <Input id="ha-rule-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} placeholder="pve01,pve02" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-comment">Comment</Label>
            <Input id="ha-rule-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={strict} onCheckedChange={(v) => setStrict(v === true)} />
            Strict
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={disable} onCheckedChange={(v) => setDisable(v === true)} />
            Disabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !rule.trim() || !resources.trim()} onClick={submit}>
            {busy ? "Creating…" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditRuleDialog({ open, busy, target, onOpenChange, onSubmit }: { open: boolean; busy: boolean; target: HARule; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, unknown>, done: () => void) => void }) {
  const [type, setType] = useState((target.type as string) || "node-affinity")
  const [affinity, setAffinity] = useState((target.affinity as string) || "positive")
  const [resources, setResources] = useState((target.resources as string) || "")
  const [nodes, setNodes] = useState((target.nodes as string) || "")
  const [comment, setComment] = useState((target.comment as string) || "")
  const [strict, setStrict] = useState(Boolean(target.strict))
  const [disable, setDisable] = useState(Boolean(target.disable))
  const submit = () => {
    if (!resources.trim()) {
      toast.error("Resources is required.")
      return
    }
    const body: Record<string, unknown> = { resources: resources.trim(), type: type.trim() }
    if (affinity.trim()) body.affinity = affinity.trim()
    body.nodes = nodes.trim()
    body.comment = comment.trim()
    body.strict = strict ? 1 : 0
    body.disable = disable ? 1 : 0
    if (target.digest) body.digest = target.digest
    onSubmit(body, () => onOpenChange(false))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit HA rule {target.rule}</DialogTitle>
          <DialogDescription>PUT /admin/proxmox/:id/ha/rules/:rule</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Rule</Label>
            <Input value={String(target.rule)} disabled className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-edit-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ha-rule-edit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="node-affinity">node-affinity</SelectItem>
                <SelectItem value="resource-affinity">resource-affinity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-edit-affinity">Affinity</Label>
            <Select value={affinity} onValueChange={setAffinity}>
              <SelectTrigger id="ha-rule-edit-affinity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="positive">positive</SelectItem>
                <SelectItem value="negative">negative</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-edit-resources">Resources *</Label>
            <Input id="ha-rule-edit-resources" value={resources} onChange={(e) => setResources(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-edit-nodes">Nodes</Label>
            <Input id="ha-rule-edit-nodes" value={nodes} onChange={(e) => setNodes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ha-rule-edit-comment">Comment</Label>
            <Input id="ha-rule-edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={strict} onCheckedChange={(v) => setStrict(v === true)} />
            Strict
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={disable} onCheckedChange={(v) => setDisable(v === true)} />
            Disabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
