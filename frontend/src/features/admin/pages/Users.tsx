// Platform-admin user management: paginated/searchable directory plus a
// detail sheet with suspend/activate, platform-admin grant/revoke and
// per-user resource limits (PATCH /admin/users/:user_id/limits).
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
  formatDateTime,
} from "./shared"

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
    <div className="flex flex-col gap-6">
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
          <SelectTrigger className="w-[170px]">
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

      <SimpleDataTable<AdminUserRow>
        columns={[
          {
            key: "email",
            header: "User",
            render: (row) => (
              <div className="min-w-0">
                <Link
                  to={`/admin/users/${row.id}`}
                  className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                >
                  {row.email}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
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
        getRowKey={(row) => row.id}
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
              <div className="flex flex-col gap-6 pb-8">
                <dl className="grid grid-cols-2 gap-4">
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
    </div>
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
      <div className="grid gap-3 sm:grid-cols-2">
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
