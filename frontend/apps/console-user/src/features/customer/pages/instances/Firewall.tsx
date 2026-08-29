// Per-instance firewall (PVE-native): position-ordered rules with CRUD,
// free-form firewall options (rule-level keys rejected), and named ipsets
// with their CIDR entries. All shapes follow the live backend handlers.
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { Loader2Icon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { orgHeaders, useOrg } from "../../useOrg"
import { InstanceBreadcrumb, useInstance } from "./shared"
import type { FirewallIPSet, FirewallRule, IPSetEntry } from "./shared"

const IPSET_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/
/** Keys that belong on rules — the options PUT rejects them server-side too. */
const RULE_LEVEL_KEYS = new Set(["dport", "proto", "action"])

function first<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

function rulePos(rule: FirewallRule): number {
  return first(rule.Pos, first(rule.pos, -1))
}

function ruleField(rule: FirewallRule, camel: string, snake: string): string {
  const record = rule as unknown as Record<string, unknown>
  const value = record[camel] ?? record[snake]
  return value === undefined || value === null ? "" : String(value)
}

function ipsetName(set: FirewallIPSet): string {
  return String(first(set.Name, set.name ?? ""))
}

function ipsetComment(set: FirewallIPSet): string {
  return String(first(set.Comment, set.comment ?? ""))
}

interface RuleForm {
  enabled: boolean
  type: "in" | "out"
  action: "ACCEPT" | "DROP" | "REJECT"
  proto: string // "", tcp, udp, icmp, gre
  source: string
  destination: string
  dest_port: string
  source_port: string
  comment: string
}

const EMPTY_RULE: RuleForm = {
  enabled: true,
  type: "in",
  action: "ACCEPT",
  proto: "",
  source: "",
  destination: "",
  dest_port: "",
  source_port: "",
  comment: "",
}

export default function InstanceFirewallPage() {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const { instance } = useInstance(instanceId)

  const [rules, setRules] = useState<FirewallRule[]>([])
  const [options, setOptions] = useState<Record<string, string>>({})
  const [ipsets, setIpsets] = useState<FirewallIPSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const loadAll = useCallback(async () => {
    if (!instanceId || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const headers = orgHeaders(orgId)
      const [rulesRes, optionsRes, ipsetsRes] = await Promise.all([
        apiGet<{ rules?: FirewallRule[] }>(`/instances/${instanceId}/firewall/rules`, { headers }),
        apiGet<{ options?: Record<string, unknown> }>(
          `/instances/${instanceId}/firewall/options`,
          { headers },
        ),
        apiGet<{ ipsets?: FirewallIPSet[] }>(`/instances/${instanceId}/firewall/ipsets`, {
          headers,
        }),
      ])
      setRules(rulesRes.data?.rules ?? [])
      setOptions(normalizeOptions(optionsRes.data?.options))
      setIpsets(ipsetsRes.data?.ipsets ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId, orgId])

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0)
    return () => clearTimeout(t)
  }, [loadAll])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <InstanceBreadcrumb instanceName={instance?.name} section="Firewall" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Instance firewall"
          description="PVE-native per-instance firewall: rules are evaluated by position, options toggle whole directions."
        />
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCwIcon /> Refresh
        </Button>
      </div>

      <ErrorBanner error={error} />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="ipsets">IP sets ({ipsets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <RulesTab
            rules={rules}
            loading={loading}
            onChanged={loadAll}
          />
        </TabsContent>

        <TabsContent value="options" className="mt-4">
          <OptionsTab
            options={options}
            loading={loading}
            onChanged={loadAll}
          />
        </TabsContent>

        <TabsContent value="ipsets" className="mt-4">
          <IPSetsTab
            ipsets={ipsets}
            loading={loading}
            onChanged={loadAll}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function normalizeOptions(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value !== null && typeof value !== "object") out[key] = String(value)
  }
  return out
}

// ---- Rules -------------------------------------------------------------------

function RulesTab({
  rules,
  loading,
  onChanged,
}: {
  rules: FirewallRule[]
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FirewallRule | null>(null)
  const [busy, setBusy] = useState(false)

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => rulePos(a) - rulePos(b)),
    [rules],
  )

  const runDelete = async () => {
    if (!deleteTarget || !instanceId || !orgId) return
    setBusy(true)
    try {
      await apiDelete(`/instances/${instanceId}/firewall/rules/${rulePos(deleteTarget)}`, {
        headers: orgHeaders(orgId),
      })
      toast.success(`Rule at position ${rulePos(deleteTarget)} deleted`)
      setDeleteTarget(null)
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete rule")
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<SimpleColumn<FirewallRule>> = [
    {
      key: "pos",
      header: "#",
      className: "w-12 tabular-nums",
      render: (row) => rulePos(row),
    },
    {
      key: "enabled",
      header: "On",
      className: "w-14",
      render: (row) => (
        <Badge variant={first(row.Enabled, row.enabled ?? false) ? "default" : "outline"}>
          {first(row.Enabled, row.enabled ?? false) ? "yes" : "no"}
        </Badge>
      ),
    },
    { key: "type", header: "Dir", render: (row) => ruleField(row, "Type", "type") || "—" },
    {
      key: "action",
      header: "Action",
      render: (row) => ruleField(row, "Action", "action") || "—",
    },
    { key: "proto", header: "Proto", render: (row) => ruleField(row, "Proto", "proto") || "any" },
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <span className="font-mono text-xs">{ruleField(row, "Source", "source") || "—"}</span>
      ),
    },
    {
      key: "dest",
      header: "Dest port",
      render: (row) => (
        <span className="font-mono text-xs">{ruleField(row, "DestPort", "dest_port") || "—"}</span>
      ),
    },
    {
      key: "comment",
      header: "Comment",
      render: (row) => (
        <span className="text-muted-foreground">{ruleField(row, "Comment", "comment") || "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          size="icon"
          variant="ghost"
          title={`Delete rule at position ${rulePos(row)}…`}
          onClick={() => setDeleteTarget(row)}
        >
          <Trash2Icon />
        </Button>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            Evaluated top-down by position. Deleting shifts later rules up.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> Add rule
        </Button>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={columns}
          rows={sortedRules}
          loading={loading}
          skeletonRows={3}
          emptyMessage="No firewall rules — traffic follows the default options below."
          getRowKey={(row) => String(rulePos(row))}
        />
      </CardContent>

      <CreateRuleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onChanged}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete rule at position {deleteTarget ? rulePos(deleteTarget) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Later rules shift up one position immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null} Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function CreateRuleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void | Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE)
  const [submitting, setSubmitting] = useState(false)

  const setField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    if (!instanceId || !orgId) return
    if ((form.proto === "tcp" || form.proto === "udp") && !form.dest_port.trim()) {
      toast.error("Destination port is required for tcp/udp rules")
      return
    }
    setSubmitting(true)
    try {
      await apiPost(
        `/instances/${instanceId}/firewall/rules`,
        {
          enabled: form.enabled,
          type: form.type,
          action: form.action,
          proto: form.proto,
          source: form.source.trim(),
          destination: form.destination.trim(),
          dest_port: form.dest_port.trim(),
          source_port: form.source_port.trim(),
          comment: form.comment.trim(),
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Firewall rule created")
      setForm(EMPTY_RULE)
      onOpenChange(false)
      await onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create rule")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add firewall rule</DialogTitle>
          <DialogDescription>
            Empty fields are omitted; the provider applies its defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Direction *</Label>
            <Select
              value={form.type}
              onValueChange={(value) => setField("type", value as RuleForm["type"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">in (incoming)</SelectItem>
                <SelectItem value="out">out (outgoing)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Action *</Label>
            <Select
              value={form.action}
              onValueChange={(value) => setField("action", value as RuleForm["action"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACCEPT">ACCEPT</SelectItem>
                <SelectItem value="DROP">DROP</SelectItem>
                <SelectItem value="REJECT">REJECT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={form.proto} onValueChange={(value) => setField("proto", value)}>
              <SelectTrigger>
                <SelectValue placeholder="any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">any</SelectItem>
                <SelectItem value="tcp">tcp</SelectItem>
                <SelectItem value="udp">udp</SelectItem>
                <SelectItem value="icmp">icmp</SelectItem>
                <SelectItem value="gre">gre</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch
              id="rule-enabled"
              checked={form.enabled}
              onCheckedChange={(checked) => setField("enabled", checked)}
            />
            <Label htmlFor="rule-enabled">Enabled</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-source">Source</Label>
            <Input
              id="rule-source"
              value={form.source}
              onChange={(event) => setField("source", event.target.value)}
              placeholder="10.0.0.0/8 or +ipset/name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-dest">Destination</Label>
            <Input
              id="rule-dest"
              value={form.destination}
              onChange={(event) => setField("destination", event.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-dport">Dest port</Label>
            <Input
              id="rule-dport"
              value={form.dest_port}
              onChange={(event) => setField("dest_port", event.target.value)}
              placeholder="22 or 8000:9000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-sport">Source port</Label>
            <Input
              id="rule-sport"
              value={form.source_port}
              onChange={(event) => setField("source_port", event.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rule-comment">Comment</Label>
            <Input
              id="rule-comment"
              value={form.comment}
              onChange={(event) => setField("comment", event.target.value)}
              placeholder="e.g. allow SSH from office"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2Icon className="animate-spin" /> : null} Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Options -----------------------------------------------------------------

function OptionsTab({
  options,
  loading,
  onChanged,
}: {
  options: Record<string, string>
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([])
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setRows(Object.entries(options).map(([key, value]) => ({ key, value })))
      setDirty(false)
    }, 0)
    return () => clearTimeout(t)
  }, [options])

  const invalidKeys = rows.filter((row) => RULE_LEVEL_KEYS.has(row.key)).map((row) => row.key)

  const addRow = () => {
    const key = newKey.trim().toLowerCase()
    if (!key) {
      toast.error("Option name is required")
      return
    }
    if (rows.some((row) => row.key === key)) {
      toast.error(`Option "${key}" already exists`)
      return
    }
    if (RULE_LEVEL_KEYS.has(key)) {
      toast.error('"dport"/"proto"/"action" belong on rules, not options')
      return
    }
    setRows((current) => [...current, { key, value: newValue.trim() }])
    setNewKey("")
    setNewValue("")
    setDirty(true)
  }

  const removeRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key))
    setDirty(true)
  }

  const saveOptions = async () => {
    if (!instanceId || !orgId) return
    if (invalidKeys.length > 0) {
      toast.error(`Remove rule-level keys first: ${invalidKeys.join(", ")}`)
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, string> = {}
      for (const row of rows) payload[row.key] = row.value
      await apiPut(`/instances/${instanceId}/firewall/options`, payload, {
        headers: orgHeaders(orgId),
      })
      toast.success("Firewall options saved")
      setDirty(false)
      await onChanged()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save options")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading options…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firewall options</CardTitle>
        <CardDescription>
          Free-form provider option map (enable/input/output/logging levels). Keys{" "}
          <code className="rounded bg-muted px-1">dport</code>,{" "}
          <code className="rounded bg-muted px-1">proto</code> and{" "}
          <code className="rounded bg-muted px-1">action</code> are rejected here — they belong
          on individual rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState message="No options set." description="Add a key such as “enable” or “log_level_in”." />
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Option ${row.key}`}
                  className="w-48 font-mono"
                  value={row.key}
                  disabled // renaming an existing option would create a new one silently
                  readOnly
                />
                <Input
                  aria-label={`Value for ${row.key}`}
                  className="w-40 font-mono"
                  value={row.value}
                  onChange={(event) => {
                    setRows((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item,
                      ),
                    )
                    setDirty(true)
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title={`Remove ${row.key}`}
                  onClick={() => removeRow(row.key)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="space-y-1">
            <Label htmlFor="opt-new-key">New option</Label>
            <Input
              id="opt-new-key"
              className="w-48 font-mono"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="enable"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opt-new-value">Value</Label>
            <Input
              id="opt-new-value"
              className="w-40 font-mono"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="1"
            />
          </div>
          <Button variant="outline" onClick={addRow}>
            <PlusIcon /> Add
          </Button>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <Button onClick={() => void saveOptions()} disabled={saving || (!dirty && rows.length === 0)}>
            {saving ? <Loader2Icon className="animate-spin" /> : null} Save options
          </Button>
          {!dirty ? <span className="text-xs text-muted-foreground">No changes yet.</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

// ---- IP sets + entries ---------------------------------------------------------

function IPSetsTab({
  ipsets,
  loading,
  onChanged,
}: {
  ipsets: FirewallIPSet[]
  loading: boolean
  onChanged: () => Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()

  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    // Keep a valid selection when the list reloads.
    const t = setTimeout(() => {
      if (selected && !ipsets.some((set) => ipsetName(set) === selected)) {
        setSelected(ipsets[0] ? ipsetName(ipsets[0]) : null)
      }
      if (!selected && ipsets.length > 0) setSelected(ipsetName(ipsets[0]))
    }, 0)
    return () => clearTimeout(t)
  }, [ipsets, selected])

  return (
    <div className="grid w-full max-w-full min-w-0 gap-4 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>IP sets</CardTitle>
            <CardDescription>Named address groups reusable in rule sources.</CardDescription>
          </div>
          <CreateIPSetButton onCreated={() => void onChanged()} />
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading ip sets…</p>
          ) : ipsets.length === 0 ? (
            <EmptyState message="No IP sets yet." />
          ) : (
            ipsets.map((set) => {
              const name = ipsetName(set)
              const active = selected === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelected(name)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted ${
                    active ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="block font-mono text-sm font-medium">{name}</span>
                  {ipsetComment(set) ? (
                    <span className="min-w-0 block truncate text-xs text-muted-foreground">
                      {ipsetComment(set)}
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
          {selected ? (
            <DeleteIPSetButton
              name={selected}
              onDeleted={async () => {
                setSelected(null)
                await onChanged()
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selected ? `Entries of “${selected}”` : "Entries"}</CardTitle>
          <CardDescription>CIDR blocks allowed to be referenced by rules.</CardDescription>
        </CardHeader>
        <CardContent>
          {selected && instanceId && orgId ? (
            <EntriesPanel
              key={selected}
              setName={selected}
              onChanged={onChanged}
            />
          ) : (
            <EmptyState
              message={loading ? "Loading…" : "Select or create an IP set to manage entries."}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CreateIPSetButton({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const valid = IPSET_NAME_PATTERN.test(name.trim())

  const submit = async () => {
    if (!instanceId || !orgId || !valid) return
    setSubmitting(true)
    try {
      await apiPost(
        `/instances/${instanceId}/firewall/ipsets`,
        { name: name.trim(), comment: comment.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success(`IP set "${name.trim()}" created`)
      setOpen(false)
      setName("")
      setComment("")
      await onCreated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create IP set")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="icon" variant="outline" title="Create IP set">
            <PlusIcon />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create IP set</DialogTitle>
            <DialogDescription>
              Name must be 1–32 characters of <code>a-z 0-9 _ -</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ipset-name">Name *</Label>
              <Input
                id="ipset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="office-cidrs"
                className="font-mono"
              />
              {name && !valid ? (
                <p className="text-xs text-destructive">
                  Only lowercase letters, digits, underscore and dash (max 32).
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ipset-comment">Comment</Label>
              <Input
                id="ipset-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!valid || submitting}>
              {submitting ? <Loader2Icon className="animate-spin" /> : null} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Delete button for the selected ipset; force toggle covers non-empty sets. */
function DeleteIPSetButton({
  name,
  onDeleted,
}: {
  name: string
  onDeleted: () => void | Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [open, setOpen] = useState(false)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!instanceId || !orgId) return
    setBusy(true)
    try {
      await apiDelete(`/instances/${instanceId}/firewall/ipsets/${encodeURIComponent(name)}`, {
        headers: orgHeaders(orgId),
        query: force ? { force: 1 } : undefined,
      })
      toast.success(`IP set "${name}" deleted`)
      setOpen(false)
      await onDeleted()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete IP set")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="destructive" className="w-full" onClick={() => setOpen(true)}>
        <Trash2Icon /> Delete “{name}”…
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete IP set “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Rules referencing this set keep working but lose their address list. If the set
              still contains entries the provider refuses the delete unless you force it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex min-w-0 items-center gap-2 text-sm">
            <Checkbox checked={force} onCheckedChange={(checked) => setForce(checked === true)} />
            Force delete even when entries remain (?force=1)
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null} Delete IP set
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function EntriesPanel({
  setName,
  onChanged,
}: {
  setName: string
  onChanged: () => Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const [entries, setEntries] = useState<IPSetEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [cidr, setCidr] = useState("")
  const [entryComment, setEntryComment] = useState("")
  const [adding, setAdding] = useState(false)
  const [deleteCidr, setDeleteCidr] = useState<string | null>(null)
  const [editEntry, setEditEntry] = useState<IPSetEntry | null>(null)

  const entryCidr = (entry: IPSetEntry): string =>
    String(first(entry.CIDR, entry.cidr ?? ""))

  const load = useCallback(async () => {
    if (!instanceId || !orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<{ entries?: IPSetEntry[] }>(
        `/instances/${instanceId}/firewall/ipsets/${encodeURIComponent(setName)}/entries`,
        { headers: orgHeaders(orgId) },
      )
      setEntries(data?.entries ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [instanceId, orgId, setName])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const addEntry = async () => {
    if (!cidr.trim()) {
      toast.error("CIDR is required")
      return
    }
    setAdding(true)
    try {
      await apiPost(
        `/instances/${instanceId}/firewall/ipsets/${encodeURIComponent(setName)}/entries`,
        { cidr: cidr.trim(), comment: entryComment.trim() },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Entry added")
      setCidr("")
      setEntryComment("")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to add entry")
    } finally {
      setAdding(false)
    }
  }

  const runDelete = async () => {
    if (!deleteCidr || !instanceId || !orgId) return
    try {
      await apiDelete(
        `/instances/${instanceId}/firewall/ipsets/${encodeURIComponent(setName)}/entries`,
        { headers: orgHeaders(orgId), query: { cidr: deleteCidr } },
      )
      toast.success(`Entry ${deleteCidr} deleted`)
      setDeleteCidr(null)
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to delete entry")
    }
  }

  const columns: Array<SimpleColumn<IPSetEntry>> = [
    {
      key: "cidr",
      header: "CIDR",
      render: (row) => <span className="font-mono text-sm">{entryCidr(row)}</span>,
    },
    {
      key: "comment",
      header: "Comment",
      render: (row) => (
        <span className="text-muted-foreground">
          {String(first(row.Comment, row.comment ?? "")) || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditEntry(row)}
            title="Edit entry"
          >
            Edit
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={`Delete ${entryCidr(row)}…`}
            onClick={() => setDeleteCidr(entryCidr(row))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <SimpleDataTable
        columns={columns}
        rows={entries}
        loading={loading}
        error={error}
        skeletonRows={3}
        emptyMessage="No entries in this IP set."
        getRowKey={(row) => entryCidr(row)}
      />

      {/* Wildcard PUT keeps the CIDR in the path; slashes are URL-encoded. */}
      <EditEntryDialog
        entry={editEntry}
        setName={setName}
        onClose={() => setEditEntry(null)}
        onSaved={async () => {
          setEditEntry(null)
          await load()
          await onChanged()
        }}
      />

      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <div className="space-y-1">
          <Label htmlFor="entry-cidr">CIDR *</Label>
          <Input
            id="entry-cidr"
            className="w-56 font-mono"
            value={cidr}
            onChange={(event) => setCidr(event.target.value)}
            placeholder="203.0.113.0/24"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="entry-comment">Comment</Label>
          <Input
            id="entry-comment"
            className="w-56"
            value={entryComment}
            onChange={(event) => setEntryComment(event.target.value)}
          />
        </div>
        <Button onClick={() => void addEntry()} disabled={adding}>
          {adding ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add entry
        </Button>
      </div>

      <AlertDialog
        open={deleteCidr !== null}
        onOpenChange={(open) => !open && setDeleteCidr(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry {deleteCidr}?</AlertDialogTitle>
            <AlertDialogDescription>
              Addresses in this range stop matching rules that reference “{setName}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditEntryDialog({
  entry,
  setName,
  onClose,
  onSaved,
}: {
  entry: IPSetEntry | null
  setName: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { instanceId } = useParams()
  const { orgId } = useOrg()
  const original = entry ? String(first(entry.CIDR, entry.cidr ?? "")) : ""
  const [newCidr, setNewCidr] = useState(original)
  const [comment, setComment] = useState(
    entry ? String(first(entry.Comment, entry.comment ?? "")) : "",
  )
  const [saving, setSaving] = useState(false)

  // Re-sync local state when a different entry is opened.
  useEffect(() => {
    const t = setTimeout(() => {
      setNewCidr(entry ? String(first(entry.CIDR, entry.cidr ?? "")) : "")
      setComment(entry ? String(first(entry.Comment, entry.comment ?? "")) : "")
    }, 0)
    return () => clearTimeout(t)
  }, [entry])

  const save = async () => {
    if (!entry || !instanceId || !orgId) return
    if (!original) return
    setSaving(true)
    try {
      // The wildcard path segment carries the old CIDR (with its slash).
      await apiPut(
        `/instances/${instanceId}/firewall/ipsets/${encodeURIComponent(setName)}/entries/${encodeURIComponent(original)}`,
        {
          new_cidr: newCidr.trim() !== original ? newCidr.trim() : undefined,
          comment: comment.trim(),
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Entry updated")
      await onSaved()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update entry")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
          <DialogDescription>
            Change the CIDR and/or its comment for “{setName}”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="entry-edit-cidr">CIDR</Label>
            <Input
              id="entry-edit-cidr"
              className="font-mono"
              value={newCidr}
              onChange={(event) => setNewCidr(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-edit-comment">Comment</Label>
            <Input
              id="entry-edit-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
