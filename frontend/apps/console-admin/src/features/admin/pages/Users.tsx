// Platform-admin user management: paginated/searchable directory plus a
// detail sheet with suspend/activate, platform-admin grant/revoke and
// per-user resource limits (PATCH /admin/users/:user_id/limits).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { BulkActionBar, useBulkSelection } from "@/components/shared/BulkActionBar"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PagedMeta } from "@/lib/types"
import {
  DetailField,
  PaginationBar,
  SearchFilter,
  StatusBadge,
} from "./shared"
import { formatDateTime } from "./format"

interface AdminUserRow {
  id: string
  public_id: string
  email: string
  username: string
  full_name: string
  status: string
  email_status: string
  is_platform_admin: boolean
  last_login_at: string
  created_at: string
}

const ACCOUNT_STATUSES = ["pending", "active", "suspended", "disabled", "closed"]
const PER_PAGE = 20

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const [selected, setSelected] = useState<AdminUserRow | null>(null)
  // Which destructive confirmation is currently open for the selected user.
  const [confirmAction, setConfirmAction] = useState<
    "suspend" | "activate" | "grant" | "revoke" | null
  >(null)

  const bulk = useBulkSelection<AdminUserRow>((row) => row.id)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmSuspend, setBulkConfirmSuspend] = useState(false)

  const runBulk = useCallback(
    async (action: (row: AdminUserRow) => Promise<unknown>, successLabel: string) => {
      const targets = bulk.resolve(rows)
      if (targets.length === 0) return
      setBulkBusy(true)
      try {
        await Promise.all(targets.map(action))
        toast.success(`${successLabel} ${targets.length} user${targets.length === 1 ? "" : "s"}`)
        setReloadTick((tick) => tick + 1)
        bulk.clear()
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      } finally {
        setBulkBusy(false)
      }
    },
    [bulk, rows],
  )

  useEffect(() => {
    let cancelled = false
    apiGet<AdminUserRow[]>("/admin/users", {
      query: {
        page,
        per_page: PER_PAGE,
        status: status === "all" ? null : status,
        search: search || null,
      },
    })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
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
  }, [page, status, search, reloadTick])

  const runUserAction = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      try {
        await action()
        toast.success(successMessage)
        setReloadTick((tick) => tick + 1)
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      }
    },
    [],
  )

  const confirmTarget =
    selected && confirmAction
      ? {
          title:
            confirmAction === "suspend"
              ? `Suspend ${selected.email}?`
              : confirmAction === "activate"
                ? `Activate ${selected.email}?`
                : confirmAction === "grant"
                  ? `Grant platform admin to ${selected.email}?`
                  : `Revoke platform admin from ${selected.email}?`,
          body:
            confirmAction === "suspend"
              ? "The account will no longer be able to sign in or use its resources."
              : confirmAction === "activate"
                ? "The account will regain full access."
                : confirmAction === "grant"
                  ? "This user will gain full platform-admin capabilities."
                  : "This user will lose all platform-admin capabilities.",
          confirmLabel:
            confirmAction === "suspend"
              ? "Suspend user"
              : confirmAction === "activate"
                ? "Activate user"
                : confirmAction === "grant"
                  ? "Grant admin"
                  : "Revoke admin",
          destructive: confirmAction === "suspend" || confirmAction === "revoke",
        }
      : null

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Users"
        description="All registered accounts across the platform."
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchFilter
          placeholder="Search email, name or public id…"
          value={search}
          onApply={(applied) => {
            setSearch(applied)
            setPage(1)
          }}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-42.5">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ACCOUNT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <BulkActionBar
        selectedCount={bulk.selectedKeys.size}
        busy={bulkBusy}
        actions={[
          {
            key: "activate",
            label: "Activate selected",
            onClick: () =>
              void runBulk((row) => apiPost(`/admin/users/${row.id}/activate`), "Activated"),
          },
          {
            key: "suspend",
            label: "Suspend selected",
            destructive: true,
            onClick: () => setBulkConfirmSuspend(true),
          },
        ]}
      />

      <SimpleDataTable<AdminUserRow>
        columns={[
          {
            key: "email",
            header: "User",
            render: (row) => (
              <div className="min-w-0">
                <Link
                  to={`/admin/users/${row.id}`}
                  className="min-w-0 block truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {row.email}
                </Link>
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {row.full_name || row.username || "—"}
                </p>
              </div>
            ),
          },
          {
            key: "public_id",
            header: "Public ID",
            className: "hidden md:table-cell",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {row.public_id}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "is_platform_admin",
            header: "Platform admin",
            render: (row) =>
              row.is_platform_admin ? (
                <span className="text-xs font-medium text-primary">yes</span>
              ) : (
                <span className="text-xs text-muted-foreground">no</span>
              ),
          },
          {
            key: "last_login_at",
            header: "Last login",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">
                {formatDateTime(row.last_login_at)}
              </span>
            ),
          },
          {
            key: "created_at",
            header: "Created",
            className: "hidden xl:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">
                {formatDateTime(row.created_at)}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  setSelected(row)
                }}
              >
                Manage
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={bulk.getRowKey}
        selectable
        selectedKeys={bulk.selectedKeys}
        onSelectionChange={bulk.onSelectionChange}
        emptyMessage="No users match these filters."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="break-all">{selected.email}</SheetTitle>
                <SheetDescription>User account management</SheetDescription>
              </SheetHeader>
              <div className="flex w-full max-w-full min-w-0 flex-col gap-6 pb-8">
                <dl className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-4">
                  <DetailField label="Full name">{selected.full_name || "—"}</DetailField>
                  <DetailField label="Username">{selected.username || "—"}</DetailField>
                  <DetailField label="Status">
                    <StatusBadge status={selected.status} />
                  </DetailField>
                  <DetailField label="Email status">
                    <StatusBadge status={selected.email_status} />
                  </DetailField>
                  <DetailField label="Public ID">
                    <span className="font-mono text-xs">{selected.public_id}</span>
                  </DetailField>
                  <DetailField label="Last login">
                    {formatDateTime(selected.last_login_at)}
                  </DetailField>
                </dl>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Account actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.status !== "suspended" ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmAction("suspend")}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction("activate")}
                      >
                        Activate
                      </Button>
                    )}
                    {selected.is_platform_admin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction("revoke")}
                      >
                        Revoke platform admin
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction("grant")}
                      >
                        Grant platform admin
                      </Button>
                    )}
                  </div>
                </section>

                <AttachOrgSection user={selected} />

                <LimitsEditor user={selected} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent className="sm:max-w-md">
          {confirmTarget && selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{confirmTarget.title}</DialogTitle>
                <DialogDescription>{confirmTarget.body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmAction(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirmTarget.destructive ? "destructive" : "default"}
                  onClick={() => {
                    const userId = selected.id
                    const action = confirmAction
                    setConfirmAction(null)
                    if (!action) return
                    if (action === "suspend") {
                      void runUserAction(
                        () => apiPost(`/admin/users/${userId}/suspend`),
                        "User suspended",
                      )
                    } else if (action === "activate") {
                      void runUserAction(
                        () => apiPost(`/admin/users/${userId}/activate`),
                        "User activated",
                      )
                    } else {
                      const grant = action === "grant"
                      void runUserAction(
                        () => apiPost(`/admin/users/${userId}/grant-admin`, { grant }),
                        grant ? "Platform admin granted" : "Platform admin revoked",
                      )
                    }
                  }}
                >
                  {confirmTarget.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkConfirmSuspend}
        onOpenChange={(open) => !open && setBulkConfirmSuspend(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend {bulk.selectedKeys.size} selected user{bulk.selectedKeys.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              These accounts will no longer be able to sign in or use their resources.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirmSuspend(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setBulkConfirmSuspend(false)
                void runBulk((row) => apiPost(`/admin/users/${row.id}/suspend`), "Suspended")
              }}
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const MEMBER_ROLES = ["owner", "admin", "billing", "operator", "developer", "viewer"] as const

function AttachOrgSection({ user }: { user: AdminUserRow }) {
  const [open, setOpen] = useState(false)
  const [orgId, setOrgId] = useState("")
  const [role, setRole] = useState<string>("viewer")
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([])
  const [saving, setSaving] = useState(false)

  const loadOrgs = useCallback(async () => {
    try {
      const envelope = await apiGet<{ id: string; name: string; slug: string }[]>("/admin/organizations", {
        query: { page: 1, per_page: 100 },
      })
      setOrgs(Array.isArray(envelope.data) ? envelope.data : [])
    } catch {
      // ignore
    }
  }, [])

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Attach to organization</h3>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); void loadOrgs() }}>
        Attach to org
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach {user.email} to organization</DialogTitle>
            <DialogDescription>POST /admin/users/:id/attach-org</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Organization</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || o.slug} — {o.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Or paste org UUID"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={saving || !orgId.trim()}
              onClick={() => {
                const oid = orgId.trim()
                if (!oid) return
                setSaving(true)
                apiPost(`/admin/users/${user.id}/attach-org`, { organization_id: oid, role })
                  .then(() => {
                    toast.success(`Attached to org as ${role}`)
                    setOpen(false)
                    setOrgId("")
                  })
                  .catch((cause) => {
                    toast.error(cause instanceof ApiError ? cause.message : "Attach failed")
                  })
                  .finally(() => setSaving(false))
              }}
            >
              {saving ? "Attaching…" : "Attach"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/** Sets max_hourly_instances / max_instance_monthly_cost; blank keeps current. */
function LimitsEditor({ user }: { user: AdminUserRow }) {
  const [maxInstances, setMaxInstances] = useState("")
  const [maxCost, setMaxCost] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const body: Record<string, number> = {}
    const instances = Number(maxInstances)
    const cost = Number(maxCost)
    if (maxInstances.trim() !== "") {
      if (!Number.isFinite(instances) || instances <= 0) {
        toast.error("Max hourly instances must be a positive number")
        return
      }
      body.max_hourly_instances = instances
    }
    if (maxCost.trim() !== "") {
      if (!Number.isFinite(cost) || cost < 0) {
        toast.error("Max monthly cost must be zero or greater")
        return
      }
      body.max_instance_monthly_cost = cost
    }
    if (Object.keys(body).length === 0) {
      toast.error("Fill at least one limit field")
      return
    }
    setSaving(true)
    try {
      await apiPatch(`/admin/users/${user.id}/limits`, body)
      toast.success("Limits updated")
      setMaxInstances("")
      setMaxCost("")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to update limits")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Resource limits</h3>
      <p className="text-xs text-muted-foreground">
        The API does not expose an endpoint to read a user's current limits — leave
        a field blank to keep its existing value.
      </p>
      <div className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`max-inst-${user.id}`}>Max hourly instances</Label>
          <Input
            id={`max-inst-${user.id}`}
            inputMode="numeric"
            placeholder="keep current"
            value={maxInstances}
            onChange={(event) => setMaxInstances(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`max-cost-${user.id}`}>Max instance monthly cost</Label>
          <Input
            id={`max-cost-${user.id}`}
            inputMode="decimal"
            placeholder="keep current"
            value={maxCost}
            onChange={(event) => setMaxCost(event.target.value)}
          />
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => void submit()}>
        {saving ? "Saving…" : "Save limits"}
      </Button>
    </section>
  )
}
