// Firewall group detail: the API has no single-group GET, so the group is
// resolved by walking GET /firewall-groups. Covers the description editor
// (PUT — the name is not writable) and full rule CRUD with inline note edits.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { SimpleColumn } from "@/components/shared/SimpleDataTable"
import { StatusBadge } from "../../components"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

interface FirewallGroup {
  id: string
  name: string
  description: string
  instance_count: number
  rule_count: number
  created_at?: string
}

interface FirewallRule {
  id: string
  group?: string
  direction?: string
  protocol: string
  port_from: number
  port_to: number
  subnet: string
  action: string
  desc?: string
}

export default function FirewallGroupDetailPage() {
  const { firewallId } = useParams()
  const { orgId } = useOrg()
  const [group, setGroup] = useState<FirewallGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  /** The backend has no single-group endpoint; resolve by walking the list. */
  const load = useCallback(async () => {
    if (!orgId || !firewallId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<FirewallGroup[]>("/firewall-groups", {
        headers: orgHeaders(orgId),
      })
      setGroup((data ?? []).find((candidate) => candidate.id === firewallId) ?? null)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, firewallId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/network">Network</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {group ? <BreadcrumbPage>{group.name}</BreadcrumbPage> : <BreadcrumbPage>…</BreadcrumbPage>}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading && !group ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <>
          <PageHeader title="Firewall group" />
          <LoadError error={error} onRetry={() => void load()} />
        </>
      ) : !group ? (
        <>
          <PageHeader title="Firewall group" />
          <p className="text-sm text-muted-foreground">
            Firewall group not found.{" "}
            <Link to="/app/network" className="underline underline-offset-2">
              Back to network
            </Link>
          </p>
        </>
      ) : (
        <>
          <PageHeader
            title={group.name}
            description={
              group.description || "No description yet."
            }
          />

          <GroupEditor group={group} onSaved={() => void load()} />

          <RulesSection group={group} onChanged={() => void load()} />
        </>
      )}
    </div>
  )
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load firewall groups."}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

// ---- Description editor ---------------------------------------------------------

function GroupEditor({ group, onSaved }: { group: FirewallGroup; onSaved: () => void }) {
  const { orgId } = useOrg()
  const [description, setDescription] = useState(group.description)
  const [saving, setSaving] = useState(false)

  // Re-seed when the group identity changes (navigation between groups).
  useEffect(() => {
    const t = setTimeout(() => setDescription(group.description), 0)
    return () => clearTimeout(t)
  }, [group.id, group.description])

  const save = async () => {
    if (!description.trim()) {
      toast.error("Description is required")
      return
    }
    setSaving(true)
    try {
      await apiPut(
        `/firewall-groups/${group.id}`,
        { description: description.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Description updated")
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update group")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            Created <span className="tabular-nums">{formatDateTime(group.created_at)}</span>
          </span>
          <span>
            Rules <span className="tabular-nums">{group.rule_count ?? 0}</span>
          </span>
          <span>
            Instances <span className="tabular-nums">{group.instance_count ?? 0}</span>
          </span>
        </div>
        <div className="max-w-xl space-y-1.5">
          <Label htmlFor="fwg-desc">Description</Label>
          <Textarea
            id="fwg-desc"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Only the description can be edited after creation; the name is fixed.
          </p>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : null} Save description
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- Rules ----------------------------------------------------------------------

function RulesSection({ group, onChanged }: { group: FirewallGroup; onChanged: () => void }) {
  const { orgId } = useOrg()
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [deleteTarget, setDeleteTarget] = useState<FirewallRule | null>(null)
  const [busy, setBusy] = useState(false)

  // Create form.
  const [protocol, setProtocol] = useState("tcp")
  const [portFrom, setPortFrom] = useState("443")
  const [subnet, setSubnet] = useState("0.0.0.0/0")
  const [action, setAction] = useState("accept")
  const [desc, setDesc] = useState("")
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<FirewallRule[]>(`/firewall-groups/${group.id}/rules`, {
        headers: orgHeaders(orgId),
      })
      setRules(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [group.id, orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const addRule = async () => {
    if (!subnet.trim()) {
      toast.error("Source subnet is required (e.g. 0.0.0.0/0)")
      return
    }
    if (protocol !== "icmp") {
      const port = Number(portFrom)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        toast.error("Port must be a number between 1 and 65535")
        return
      }
    }
    setCreating(true)
    try {
      const port = Number(portFrom)
      await apiPost(
        `/firewall-groups/${group.id}/rules`,
        {
          protocol,
          port_from: port,
          port_to: port,
          subnet: subnet.trim(),
          action,
          desc: desc.trim(),
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Rule added")
      setDesc("")
      onChanged()
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to add rule")
    } finally {
      setCreating(false)
    }
  }

  const runDelete = async () => {
    if (!deleteTarget || !orgId) return
    setBusy(true)
    try {
      await apiDelete(`/firewall-groups/${group.id}/rules/${deleteTarget.id}`, {
        headers: orgHeaders(orgId),
      })
      toast.success("Rule removed")
      setDeleteTarget(null)
      onChanged()
      void load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to remove rule")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<FirewallRule>> = [
    { key: "direction", header: "Dir", render: (row) => row.direction ?? "inbound" },
    { key: "protocol", header: "Proto", render: (row) => row.protocol.toUpperCase() },
    {
      key: "ports",
      header: "Ports",
      render: (row) =>
        row.port_from === row.port_to ? String(row.port_from) : `${row.port_from}–${row.port_to}`,
    },
    {
      key: "subnet",
      header: "Source",
      render: (row) => <span className="font-mono text-xs">{row.subnet}</span>,
    },
    { key: "action", header: "Action", render: (row) => <StatusBadge status={row.action} /> },
    {
      key: "desc",
      header: "Note",
      render: (row) => <RuleDescEditor rule={row} groupId={group.id} onSaved={() => void load()} />,
    },
    {
      key: "actions",
      header: "",
      className: "w-14",
      render: (row) => (
        <div className="flex justify-end">
          <Button
            size="icon"
            variant="ghost"
            title="Remove rule…"
            onClick={() => setDeleteTarget(row)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardContent className="space-y-4 px-4 py-4">
        <h2 className="font-semibold">Rules</h2>

        <SimpleDataTable
          columns={columns}
          rows={rules}
          loading={loading}
          error={error}
          skeletonRows={3}
          emptyMessage={
            error
              ? undefined
              : "No rules yet — this group accepts nothing until a rule matches."
          }
          getRowKey={(row) => row.id}
        />

        {/* Add-rule form */}
        <div className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label>Protocol</Label>
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
                <SelectItem value="icmp">ICMP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fwgr-port">Port</Label>
            <Input
              id="fwgr-port"
              type="number"
              min={1}
              max={65535}
              disabled={protocol === "icmp"}
              value={portFrom}
              onChange={(event) => setPortFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fwgr-subnet">Source CIDR *</Label>
            <Input
              id="fwgr-subnet"
              value={subnet}
              onChange={(event) => setSubnet(event.target.value)}
              placeholder="203.0.113.0/24"
            />
          </div>
          <div className="space-y-1">
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accept">Accept</SelectItem>
                <SelectItem value="drop">Drop</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void addRule()}
              disabled={creating}
            >
              {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add rule
            </Button>
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-5">
            <Label htmlFor="fwgr-desc">Note (optional)</Label>
            <Input
              id="fwgr-desc"
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
              placeholder="Allow HTTPS from anywhere"
            />
          </div>
        </div>
      </CardContent>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.protocol.toUpperCase()} {deleteTarget?.port_from} from{" "}
              {deleteTarget?.subnet} ({deleteTarget?.action}) stops applying immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/** Inline note cell: click the pencil to edit, save PATCHes only `desc`. */
function RuleDescEditor({
  rule,
  groupId,
  onSaved,
}: {
  rule: FirewallRule
  groupId: string
  onSaved: () => void
}) {
  const { orgId } = useOrg()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(rule.desc ?? "")
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setValue(rule.desc ?? "")
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await apiPatch(
        `/firewall-groups/${groupId}/rules/${rule.id}`,
        { desc: value.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Note updated")
      setEditing(false)
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update note")
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void save()
            }
            if (event.key === "Escape") setEditing(false)
          }}
          className="h-7 w-40 text-xs"
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={saving}
          title="Save note"
          onClick={() => void save()}
        >
          {saving ? <Loader2Icon className="size-3 animate-spin" /> : <PencilIcon className="size-3" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title="Cancel"
          onClick={() => setEditing(false)}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="group flex max-w-48 items-center gap-1 text-left"
      onClick={startEdit}
      title="Edit note"
    >
      <span className="truncate text-muted-foreground group-hover:underline">
        {rule.desc || "—"}
      </span>
      <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
