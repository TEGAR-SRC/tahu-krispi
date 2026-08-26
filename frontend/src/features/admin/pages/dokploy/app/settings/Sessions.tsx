// K6 · Settings ▸ Sessions — parity with pages/dashboard/settings/sessions.tsx
// (+ sessions/show-sessions.tsx): user.listSessions table with filters and
// user.revokeSession behind a confirm (current session is never revocable).
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { LogOutIcon, SmartphoneIcon } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { dokploy, toErrorMessage, useUpstream } from "../shared"
import { ConfirmAction, K6Breadcrumbs, asDisplayError, fmtDate } from "./k6-helpers"

interface SessionRow {
  id: string
  userId: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt?: string
  expiresAt?: string
  isCurrent?: boolean
}

/** Short device label derived from the user agent (mirrors upstream parseUserAgent). */
function parseUserAgent(ua: string): string {
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome"
  if (ua.includes("Edg/")) return "Edge"
  if (ua.includes("Firefox/")) return "Firefox"
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari"
  if (ua.includes("curl/") || ua.includes("wget/")) return "CLI"
  return ua.slice(0, 40) + (ua.length > 40 ? "…" : "")
}

export default function DokploySettingsSessionsPage() {
  const { data, error, loading, reload } = useUpstream<SessionRow[]>(
    () => dokploy<SessionRow[]>("GET", "user.listSessions"),
    [],
  )
  const [revoking, setRevoking] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired">("all")

  const revoke = async (session: SessionRow) => {
    setRevoking(true)
    try {
      await dokploy("POST", "user.revokeSession", { sessionId: session.id })
      toast.success("Session revoked successfully")
      reload()
    } catch (cause: unknown) {
      toast.error(toErrorMessage(cause))
    } finally {
      setRevoking(false)
    }
  }

  const rows = useMemo(() => {
    const now = Date.now()
    let list = data ?? []
    if (statusFilter !== "all") {
      list = list.filter((s) => {
        const expired = s.expiresAt ? new Date(s.expiresAt).getTime() <= now : false
        return statusFilter === "expired" ? expired : !expired
      })
    }
    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter((s) =>
        [s.ipAddress ?? "", s.userAgent ? parseUserAgent(s.userAgent) : ""]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    }
    return list
  }, [data, statusFilter, search])

  const columns: Array<SimpleColumn<SessionRow>> = [
    {
      key: "user",
      header: "User",
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <span>
            {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
          </span>
          <span className="text-muted-foreground">({row.email})</span>
          {row.isCurrent ? <Badge variant="secondary">Current</Badge> : null}
        </span>
      ),
    },
    {
      key: "ipAddress",
      header: "IP Address",
      className: "font-mono text-sm hidden md:table-cell",
      render: (row) => row.ipAddress || "—",
    },
    {
      key: "device",
      header: "Device",
      className: "hidden lg:table-cell",
      render: (row) =>
        row.userAgent ? (
          <span className="text-muted-foreground max-w-[220px] truncate text-sm">
            {parseUserAgent(row.userAgent)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const expired = row.expiresAt ? new Date(row.expiresAt).getTime() <= Date.now() : false
        return expired ? (
          <Badge variant="outline">Expired</Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        )
      },
    },
    { key: "createdAt", header: "Active Since", render: (row) => fmtDate(row.createdAt) },
    { key: "expiresAt", header: "Expires", render: (row) => fmtDate(row.expiresAt) },
    {
      key: "actions",
      header: "",
      className: "w-16 text-right",
      render: (row) =>
        row.isCurrent ? null : (
          <ConfirmAction
            title="Revoke Session"
            description={`Force logout for ${[row.firstName, row.lastName].filter(Boolean).join(" ")} (${row.email})?`}
            confirmLabel="Revoke"
            onConfirm={() => revoke(row)}
            busy={revoking}
            trigger={
              <Button variant="ghost" size="icon" className="size-8">
                <LogOutIcon className="size-4 text-red-500" />
              </Button>
            }
          />
        ),
    },
  ]

  const total = data?.length ?? 0

  return (
    <div className="flex flex-col gap-6">
      <K6Breadcrumbs current="Sessions" />
      <PageHeader
        title="Sessions"
        description="Active login sessions on the upstream Dokploy server. Revoke to force logout."
        actions={
          <Button variant="outline" size="sm" onClick={reload}>
            Refresh
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SmartphoneIcon className="text-muted-foreground size-5" />
            Active Sessions ({total})
          </CardTitle>
          <CardDescription>
            The current session is protected and cannot be revoked from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 border-t pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by IP, device…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SimpleDataTable<SessionRow>
            columns={columns}
            rows={rows}
            loading={loading}
            error={asDisplayError(error)}
            getRowKey={(row) => row.id}
            emptyMessage={total === 0 ? "No sessions found." : "No sessions match your filters."}
          />
        </CardContent>
      </Card>
    </div>
  )
}
