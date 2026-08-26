// Platform-admin security surface: security incidents (list + resolve),
// blocked networks (CRUD), feature flags and app settings (key lookup +
// upsert — the API exposes only per-key GET/PUT, no listing).
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { PagedMeta } from "@/lib/types"
import {
  JsonBlock,
  PaginationBar,
  StatusBadge,
  formatDateTime,
} from "./shared"

interface IncidentRow {
  id: string
  user_id: string | null
  user_email: string
  organization_id: string | null
  org_slug: string
  type: string
  severity: string
  status: string
  description: string
  created_at: string
  resolved_at: string
}

interface BlockedNetworkRow {
  id: string
  network: string
  reason: string
  expires_at: string
  created_by: string
  created_at: string
}

const INCIDENT_STATUSES = ["open", "investigating", "resolved", "dismissed"]
const PER_PAGE = 20

export default function AdminSecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Incidents, network blocklists, feature flags and app settings."
      />

      <Tabs defaultValue="incidents">
        <TabsList>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="blocked">Blocked networks</TabsTrigger>
          <TabsTrigger value="flags">Feature flags</TabsTrigger>
          <TabsTrigger value="settings">App settings</TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="pt-2">
          <IncidentsPanel />
        </TabsContent>

        <TabsContent value="blocked" className="pt-2">
          <BlockedNetworksPanel />
        </TabsContent>

        <TabsContent value="flags" className="pt-2">
          <KeyValueEditor kind="flag" />
        </TabsContent>

        <TabsContent value="settings" className="pt-2">
          <KeyValueEditor kind="setting" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function IncidentsPanel() {
  const [rows, setRows] = useState<IncidentRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<IncidentRow[]>("/admin/security-incidents", {
      query: {
        page,
        per_page: PER_PAGE,
        status: status === "all" ? null : status,
      },
    })
      .then((envelope) => {
        if (!cancelled) {
          setRows(envelope.data)
          setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
          setError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, status])

  const resolve = async (incident: IncidentRow) => {
    setBusyId(incident.id)
    try {
      await apiPost(`/admin/security-incidents/${incident.id}/resolve`)
      toast.success(`Incident ${incident.type} resolved`)
      setPage(1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to resolve")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INCIDENT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable<IncidentRow>
        columns={[
          {
            key: "type",
            header: "Type",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.type}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.description || "—"}
                </p>
              </div>
            ),
          },
          {
            key: "severity",
            header: "Severity",
            render: (row) => <span className="capitalize">{row.severity || "—"}</span>,
          },
          {
            key: "user_email",
            header: "Subject",
            className: "hidden md:table-cell",
            render: (row) =>
              row.user_email || (row.org_slug ? `org ${row.org_slug}` : "—"),
          },
          { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "created_at",
            header: "Detected",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-24 text-right",
            render: (row) =>
              row.status !== "resolved" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => void resolve(row)}
                >
                  Resolve
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(row.resolved_at)}
                </span>
              ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No security incidents recorded."
        skeletonRows={5}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </div>
  )
}

function BlockedNetworksPanel() {
  const [rows, setRows] = useState<BlockedNetworkRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [cidr, setCidr] = useState("")
  const [reason, setReason] = useState("")
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BlockedNetworkRow | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<BlockedNetworkRow[]>("/admin/blocked-networks", {
      query: { page, per_page: PER_PAGE },
    })
      .then((envelope) => {
        if (!cancelled) {
          setRows(envelope.data)
          setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
          setError(null)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, reloadTick])

  // Client-side CIDR sanity check mirroring the server's net.ParseCIDR gate.
  const looksLikeCidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/

  const addNetwork = async () => {
    if (!looksLikeCidr.test(cidr.trim())) {
      toast.error("Enter a valid CIDR network, e.g. 203.0.113.0/24")
      return
    }
    if (reason.trim() === "") {
      toast.error("Reason is required")
      return
    }
    setAdding(true)
    try {
      await apiPost("/admin/blocked-networks", { cidr: cidr.trim(), reason: reason.trim() })
      toast.success(`${cidr.trim()} blocked`)
      setCidr("")
      setReason("")
      setPage(1)
      setReloadTick((tick) => tick + 1)
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to block network")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void addNetwork()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="blocked-cidr">CIDR network</Label>
          <Input
            id="blocked-cidr"
            value={cidr}
            placeholder="203.0.113.0/24"
            className="w-56 font-mono"
            onChange={(event) => setCidr(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="blocked-reason">Reason</Label>
          <Input
            id="blocked-reason"
            value={reason}
            placeholder="abuse / compliance…"
            className="w-72"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={adding}>
          Block network
        </Button>
      </form>

      <SimpleDataTable<BlockedNetworkRow>
        columns={[
          {
            key: "network",
            header: "Network",
            render: (row) => <span className="font-mono text-sm">{row.network}</span>,
          },
          { key: "reason", header: "Reason" },
          {
            key: "expires_at",
            header: "Expires",
            className: "hidden md:table-cell",
            render: (row) => formatDateTime(row.expires_at),
          },
          {
            key: "created_by",
            header: "Created by",
            className: "hidden lg:table-cell font-mono text-xs",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {row.created_by.slice(0, 8)}…
              </span>
            ),
          },
          {
            key: "created_at",
            header: "Blocked at",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(row)}>
                Unblock
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No networks are currently blocked."
        skeletonRows={4}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {deleteTarget?.network}?</AlertDialogTitle>
            <AlertDialogDescription>
              Traffic from this range will be accepted again immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep blocking</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = deleteTarget
                setDeleteTarget(null)
                if (!target) return
                apiDelete(`/admin/blocked-networks/${target.id}`)
                  .then(() => {
                    toast.success(`${target.network} unblocked`)
                    setReloadTick((tick) => tick + 1)
                  })
                  .catch((cause) =>
                    toast.error(
                      cause instanceof ApiError ? cause.message : "Failed to unblock",
                    ),
                  )
              }}
            >
              Unblock network
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Shared editor for the per-key config endpoints:
 * - flags:   GET/PUT /admin/feature-flags/:key  ({enabled, rules})
 * - settings: GET/PUT /admin/app-settings/:key  ({value, is_secret})
 */
function KeyValueEditor({ kind }: { kind: "flag" | "setting" }) {
  const [keyInput, setKeyInput] = useState("")
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Flag draft state
  const [enabledDraft, setEnabledDraft] = useState(false)
  const [rulesDraft, setRulesDraft] = useState("{}")
  // Setting draft state
  const [valueDraft, setValueDraft] = useState("{}")
  const [isSecretDraft, setIsSecretDraft] = useState(false)
  const [saving, setSaving] = useState(false)

  const basePath =
    kind === "flag" ? "/admin/feature-flags" : "/admin/app-settings"

  useEffect(() => {
    if (!loadedKey) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    apiGet<Record<string, unknown>>(`${basePath}/${loadedKey}`)
      .then(({ data }) => {
        if (cancelled) return
        setCurrent(data)
        if (kind === "flag") {
          setEnabledDraft(data.enabled === true)
          const rules = data.rules
          setRulesDraft(
            typeof rules === "string" ? rules : JSON.stringify(rules ?? {}, null, 2),
          )
        } else {
          const value = data.value
          setValueDraft(
            typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2),
          )
          setIsSecretDraft(data.is_secret === true)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setCurrent(null)
          setLoadError(cause)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [basePath, loadedKey, kind, reloadTick])

  const save = useCallback(async () => {
    if (!loadedKey) return
    try {
      const body =
        kind === "flag"
          ? {
              enabled: enabledDraft,
              rules: JSON.parse(rulesDraft === "" ? "{}" : rulesDraft) as object,
            }
          : {
              value: JSON.parse(valueDraft === "" ? "null" : valueDraft) as unknown,
              is_secret: isSecretDraft,
            }
      setSaving(true)
      await apiPut(`${basePath}/${loadedKey}`, body)
      toast.success(kind === "flag" ? "Feature flag saved" : "App setting saved")
      setReloadTick((tick) => tick + 1)
    } catch (parseCause) {
      if (parseCause instanceof SyntaxError) {
        toast.error("Rules/value must be valid JSON")
      } else if (parseCause instanceof ApiError) {
        toast.error(parseCause.message)
      } else {
        toast.error("Save failed")
      }
    } finally {
      setSaving(false)
    }
  }, [basePath, enabledDraft, isSecretDraft, kind, loadedKey, rulesDraft, valueDraft])

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`kv-key-${kind}`}>Key</Label>
          <Input
            id={`kv-key-${kind}`}
            value={keyInput}
            placeholder={
              kind === "flag" ? "e.g. signup.v2.enabled" : "e.g. maintenance.mode"
            }
            onChange={(event) => setKeyInput(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={keyInput.trim() === "" || loading}
          onClick={() => {
            setLoadedKey(keyInput.trim())
            setCurrent(null)
          }}
        >
          Load
        </Button>
      </div>

      {!loadedKey ? (
        <p className="text-sm text-muted-foreground">
          The API only exposes per-key access for {kind === "flag" ? "feature flags" : "app settings"} — load a key to inspect or create it.
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loadError !== null ? (
        current === null && loadError instanceof ApiError && loadError.status === 404 ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            No existing record for "{loadedKey}" — saving below creates it.
          </p>
        ) : (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {loadError instanceof ApiError ? loadError.message : String(loadError)}
          </p>
        )
      ) : current ? (
        <div className="flex flex-col gap-4">
          <JsonBlock value={current} />

          {kind === "flag" ? (
            <>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={enabledDraft} onCheckedChange={setEnabledDraft} id="flag-enabled" />
                Enabled
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="flag-rules">Rules JSON</Label>
                <Textarea
                  id="flag-rules"
                  rows={6}
                  className="font-mono text-xs"
                  value={rulesDraft}
                  onChange={(event) => setRulesDraft(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="setting-value">Value JSON</Label>
                <Textarea
                  id="setting-value"
                  rows={6}
                  className="font-mono text-xs"
                  value={valueDraft}
                  onChange={(event) => setValueDraft(event.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={isSecretDraft}
                  onCheckedChange={(checked) => setIsSecretDraft(checked === true)}
                />
                Mark as secret (value is masked when read back)
              </label>
            </>
          )}

          <div>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : `Save ${kind === "flag" ? "flag" : "setting"}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
