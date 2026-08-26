// Cluster firewall console: PVE security groups (fw-groups CRUD) with a
// per-group rule browser (rules add/delete by position) and the cluster-level
// firewall-rules list with the same rule editor. Mutations are
// platform-admin-only server side; every one is confirmed.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "../shared"
import {
  ConfirmDialog,
  ProviderShell,
  useInfraGet,
  type FirewallGroup,
  type FirewallRule,
} from "./shared"

export default function ProviderFirewallPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = `/admin/providers/${providerId}`

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  return (
    <ProviderShell
      providerId={providerId}
      title="Firewall"
      description="Security groups with their rules plus cluster-level firewall rules."
    >
      <Tabs defaultValue="groups">
        <TabsList>
          <TabsTrigger value="groups">Security groups</TabsTrigger>
          <TabsTrigger value="cluster">Cluster rules</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-4 pt-4">
          <GroupsSection providerId={providerId} base={base} selectedGroup={selectedGroup} onSelectGroup={setSelectedGroup} />
        </TabsContent>

        <TabsContent value="cluster" className="pt-4">
          <RulesSection
            providerId={providerId}
            // Cluster-level rules live directly under /firewall-rules.
            listPath={`${base}/firewall-rules`}
            createPath={`${base}/firewall-rules`}
            deletePath={(pos) => `${base}/firewall-rules/${pos}`}
          />
        </TabsContent>
      </Tabs>
    </ProviderShell>
  )
}

function GroupsSection({
  providerId,
  base,
  selectedGroup,
  onSelectGroup,
}: {
  providerId: string
  base: string
  selectedGroup: string | null
  onSelectGroup: (group: string | null) => void
}) {
  const groups = useInfraGet<FirewallGroup[]>(`${base}/fw-groups`)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FirewallGroup | null>(null)
  const [busy, setBusy] = useState(false)

  const runAction = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      groups.reload()
      done?.()
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add group…
        </Button>
      </div>
      <SimpleDataTable<FirewallGroup>
        columns={[
          {
            key: "group",
            header: "Group",
            render: (row) => (
              <button
                type="button"
                className={`font-mono text-sm font-medium underline-offset-4 hover:underline ${
                  selectedGroup === row.group ? "text-primary underline" : ""
                }`}
                onClick={() => onSelectGroup(row.group ?? null)}
              >
                {row.group || "—"}
              </button>
            ),
          },
          {
            key: "comment",
            header: "Comment",
            render: (row) => row.comment || "—",
          },
          {
            key: "rule_count",
            header: "Rules",
            render: (row) =>
              Array.isArray(row.rules) ? (
                <Badge variant="outline">{row.rules.length}</Badge>
              ) : (
                "—"
              ),
          },
          {
            key: "actions",
            header: "",
            className: "w-44 text-right",
            render: (row) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!row.group}
                  onClick={() => onSelectGroup(row.group ?? null)}
                >
                  Rules
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(row)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={groups.data ?? []}
        loading={groups.loading}
        error={groups.error}
        getRowKey={(row) => String(row.group ?? "?")}
        emptyMessage="No security groups defined."
        skeletonRows={3}
      />

      {selectedGroup ? (
        <RulesSection
          providerId={providerId}
          listPath={`${base}/fw-groups/${encodeURIComponent(selectedGroup)}/rules`}
          createPath={`${base}/fw-groups/${encodeURIComponent(selectedGroup)}/rules`}
          deletePath={(pos) =>
            `${base}/fw-groups/${encodeURIComponent(selectedGroup)}/rules/${pos}`
          }
          heading={`Rules of group ${selectedGroup}`}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Select a group above to browse and edit its rules.
        </p>
      )}

      <AddGroupDialog
        open={addOpen}
        busy={busy}
        onOpenChange={setAddOpen}
        onSubmit={(body, done) => void runAction(() => apiPost(`${base}/fw-groups`, body), `Security group ${String(body.group)} created`, done)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete security group "${deleteTarget?.group}"?`}
        body="The group and its rules disappear from the cluster configuration. Members referencing it lose the protection immediately."
        confirmLabel="Delete group"
        busy={busy}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target?.group) return
          void runAction(
            () => apiDelete(`${base}/fw-groups`, { query: { name: String(target.group) } }),
            `Security group ${target.group} deleted`,
          )
          if (selectedGroup === target.group) onSelectGroup(null)
        }}
      />
    </div>
  )
}

interface RulesSectionProps {
  providerId: string
  listPath: string
  createPath: string
  deletePath: (pos: number) => string
  heading?: string
}

/** Rule table shared by security groups and the cluster level. */
function RulesSection({ providerId, listPath, createPath, deletePath, heading }: RulesSectionProps) {
  const rules = useInfraGet<FirewallRule[]>(listPath)
  const [addOpen, setAddOpen] = useState(false)
  const [deletePos, setDeletePos] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  void providerId

  const runAction = async (action: () => Promise<unknown>, success: string, done?: () => void) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      rules.reload()
      done?.()
      return true
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{heading ?? "Firewall rules"}</h3>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Add rule…
        </Button>
      </div>
      <SimpleDataTable<FirewallRule>
        columns={[
          { key: "pos", header: "Pos", render: (row) => row.pos ?? "—" },
          {
            key: "enable",
            header: "Enabled",
            render: (row) =>
              row.enable === 1 ? <StatusBadge status="active" /> : <StatusBadge status="disabled" />,
          },
          {
            key: "type",
            header: "Direction",
            render: (row) => <Badge variant="outline">{row.type || "in"}</Badge>,
          },
          {
            key: "action",
            header: "Action",
            render: (row) => (
              <span className={row.action === "DROP" ? "font-medium text-destructive" : ""}>
                {row.action || "—"}
              </span>
            ),
          },
          {
            key: "source",
            header: "Source",
            className: "hidden md:table-cell",
            render: (row) => joinAddrPort(row.source, row.dport) || "any",
          },
          {
            key: "dest",
            header: "Destination",
            className: "hidden lg:table-cell",
            render: (row) => joinAddrPort(row.dest, "") || "any",
          },
          {
            key: "proto",
            header: "Proto",
            className: "hidden xl:table-cell",
            render: (row) => row.proto || row.macro || "—",
          },
          {
            key: "comment",
            header: "Comment",
            className: "hidden xl:table-cell max-w-56 truncate",
            render: (row) => row.comment || "—",
          },
          {
            key: "actions",
            header: "",
            className: "w-24 text-right",
            render: (row) => (
              <Button
                variant="destructive"
                size="sm"
                disabled={typeof row.pos !== "number"}
                onClick={() => setDeletePos(row.pos as number)}
              >
                Delete
              </Button>
            ),
          },
        ]}
        rows={rules.data ?? []}
        loading={rules.loading}
        error={rules.error}
        getRowKey={(row, index) => String(row.pos ?? index)}
        emptyMessage="No rules defined here yet."
        skeletonRows={3}
      />

      <AddRuleDialog
        open={addOpen}
        busy={busy}
        onOpenChange={setAddOpen}
        onSubmit={(body, done) => void runAction(() => apiPost(createPath, body), "Rule created", done)}
      />

      <ConfirmDialog
        open={deletePos !== null}
        onOpenChange={(open) => !open && setDeletePos(null)}
        title={`Delete rule at position ${deletePos}?`}
        body="Positions shift automatically after deletion — verify the resulting order afterwards."
        confirmLabel="Delete rule"
        busy={busy}
        onConfirm={() => {
          const pos = deletePos
          setDeletePos(null)
          if (pos === null) return
          void runAction(() => apiDelete(deletePath(pos)), `Rule ${pos} deleted`)
        }}
      />
    </section>
  )
}

function joinAddrPort(addr?: string, port?: string): string {
  if (!addr && !port) return ""
  if (!port) return addr ?? ""
  return `${addr ?? "*"}:${port}`
}

function AddGroupDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}) {
  const [group, setGroup] = useState("")
  const [comment, setComment] = useState("")

  const submit = () => {
    if (!group.trim()) {
      toast.error("Group name is required.")
      return
    }
    const body: Record<string, unknown> = { group: group.trim() }
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => onOpenChange(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add security group</DialogTitle>
          <DialogDescription>Groups bundle reusable firewall rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fw-group-name">Name *</Label>
          <Input id="fw-group-name" value={group} onChange={(event) => setGroup(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fw-group-comment">Comment</Label>
          <Input id="fw-group-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddRuleDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: Record<string, unknown>, done: () => void) => void
}) {
  const [type, setType] = useState("in")
  const [action, setAction] = useState("ACCEPT")
  const [enabled, setEnabled] = useState(true)
  const [source, setSource] = useState("")
  const [dest, setDest] = useState("")
  const [dport, setDport] = useState("")
  const [sport, setSport] = useState("")
  const [proto, setProto] = useState("")
  const [macro, setMacro] = useState("")
  const [iface, setIface] = useState("")
  const [comment, setComment] = useState("")

  const submit = () => {
    const body: Record<string, unknown> = { type, action }
    if (enabled) body.enable = 1
    if (source.trim()) body.source = source.trim()
    if (dest.trim()) body.dest = dest.trim()
    if (dport.trim()) body.dport = dport.trim()
    if (sport.trim()) body.sport = sport.trim()
    if (proto.trim()) body.proto = proto.trim()
    if (macro.trim()) body.macro = macro.trim()
    if (iface.trim()) body.iface = iface.trim()
    if (comment.trim()) body.comment = comment.trim()
    onSubmit(body, () => {
      onOpenChange(false)
      setSource("")
      setDest("")
      setDport("")
      setSport("")
      setComment("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add firewall rule</DialogTitle>
          <DialogDescription>PVE rule syntax — source/dest accept CIDRs, IP sets or +setname refs.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="fr-type">Direction *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="fr-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">in</SelectItem>
                <SelectItem value="out">out</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-action">Action *</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="fr-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ACCEPT", "DROP", "REJECT"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-proto">Protocol</Label>
            <Input id="fr-proto" value={proto} onChange={(event) => setProto(event.target.value)} placeholder="tcp / udp" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-macro">Macro</Label>
            <Input id="fr-macro" value={macro} onChange={(event) => setMacro(event.target.value)} placeholder="SSH" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-source">Source</Label>
            <Input id="fr-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="10.0.0.0/8" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-dest">Destination</Label>
            <Input id="fr-dest" value={dest} onChange={(event) => setDest(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-dport">Dest ports</Label>
            <Input id="fr-dport" value={dport} onChange={(event) => setDport(event.target.value)} placeholder="22,8006" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-sport">Source ports</Label>
            <Input id="fr-sport" value={sport} onChange={(event) => setSport(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-iface">Interface</Label>
            <Input id="fr-iface" value={iface} onChange={(event) => setIface(event.target.value)} placeholder="vmbr0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr-comment">Comment</Label>
            <Input id="fr-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Rule enabled
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={submit}>
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
