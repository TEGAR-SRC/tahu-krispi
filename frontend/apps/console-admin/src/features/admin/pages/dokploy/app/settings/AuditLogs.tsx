// K6 · Settings ▸ Audit Logs — parity with pages/dashboard/settings/audit-logs.tsx
// (+ proprietary audit-logs data table): auditLog.all with filters, pagination
// and a JSON metadata viewer. On CE the upstream gates this op behind an
// enterprise license — the upstream error is surfaced verbatim (honest gap).
import { useEffect, useMemo, useState } from "react"
import { ClipboardListIcon } from "lucide-react"
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
import { dokploy, useUpstream } from "../shared"
import {
  JsonViewerDialog,
  K6Breadcrumbs,
  asDisplayError,
  fmtDate,
} from "./k6-helpers"

interface AuditLogRow {
  id?: string
  createdAt?: string
  userEmail?: string | null
  userRole?: string | null
  action?: string
  resourceType?: string
  resourceName?: string | null
  metadata?: string | null
}

type AuditLogResponse = AuditLogRow[] | { logs?: AuditLogRow[]; total?: number }

const ACTION_FILTERS = ["", "create", "update", "delete", "deploy", "cancel", "redeploy", "login", "logout"]

function isEnvelope(value: AuditLogResponse): value is { logs?: AuditLogRow[]; total?: number } {
  return !Array.isArray(value)
}

export default function DokploySettingsAuditLogsPage() {
  const PAGE_SIZE = 50
  const [pageIndex, setPageIndex] = useState(0)
  const [userEmail, setUserEmail] = useState("")
  const [resourceName, setResourceName] = useState("")
  const [debounced, setDebounced] = useState({ userEmail: "", resourceName: "" })
  const [action, setAction] = useState("")
  const [resourceType, setResourceType] = useState("")

  // Debounce text filters like the upstream table does.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced({ userEmail: userEmail.trim(), resourceName: resourceName.trim() })
      setPageIndex(0)
    }, 400)
    return () => clearTimeout(timer)
  }, [userEmail, resourceName])

  const query = useMemo(
    () => ({
      userEmail: debounced.userEmail || undefined,
      resourceName: debounced.resourceName || undefined,
      action: action || undefined,
      resourceType: resourceType.trim() || undefined,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    }),
    [debounced, action, resourceType, pageIndex],
  )

  const { data, error, loading, reload } = useUpstream<AuditLogResponse>(
    () =>
      dokploy<AuditLogResponse>("GET", "auditLog.all", undefined, {
        userEmail: query.userEmail,
        resourceName: query.resourceName,
        action: query.action,
        resourceType: query.resourceType,
        from: undefined,
        to: undefined,
        limit: query.limit,
        offset: query.offset,
      }),
    [
      query.userEmail,
      query.resourceName,
      query.action,
      query.resourceType,
      query.limit,
      query.offset,
    ],
  )

  const rows = data && isEnvelope(data) ? (data.logs ?? []) : (data ?? [])
  const total = data && isEnvelope(data) ? data.total : undefined

  const columns: Array<SimpleColumn<AuditLogRow>> = [
    { key: "createdAt", header: "Time", render: (row) => fmtDate(row.createdAt) },
    { key: "userEmail", header: "User", render: (row) => row.userEmail || "—" },
    {
      key: "action",
      header: "Action",
      render: (row) => <Badge variant="secondary">{row.action}</Badge>,
    },
    { key: "resourceType", header: "Resource Type" },
    { key: "resourceName", header: "Resource Name", render: (row) => row.resourceName || "—" },
    { key: "userRole", header: "Role", render: (row) => row.userRole || "—" },
    {
      key: "metadata",
      header: "Metadata",
      className: "w-24",
      render: (row) =>
        row.metadata ? (
          <JsonViewerDialog label="JSON" title="Audit log metadata" value={row.metadata} />
        ) : (
          "—"
        ),
    },
  ]

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <K6Breadcrumbs current="Audit Logs" />
      <PageHeader
        title="Audit Logs"
        description="Actions performed by members on the upstream Dokploy organization."
        actions={
          <Button variant="outline" size="sm" onClick={reload}>
            Refresh
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2">
            <ClipboardListIcon className="text-muted-foreground size-5" />
            Log Entries
          </CardTitle>
          <CardDescription>
            Upstream requires an enterprise license for audit logs; if it is missing
            the exact upstream error is shown below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 border-t pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by user email…"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              className="max-w-55"
            />
            <Input
              placeholder="Filter by resource name…"
              value={resourceName}
              onChange={(e) => setResourceName(e.target.value)}
              className="max-w-55"
            />
            <Input
              placeholder="Resource type (project, service…)"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="max-w-60"
            />
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-37.5">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_FILTERS.map((value) => (
                  <SelectItem key={value || "all"} value={value}>
                    {value === "" ? "All actions" : value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SimpleDataTable<AuditLogRow>
            columns={columns}
            rows={rows}
            loading={loading}
            error={asDisplayError(error)}
            getRowKey={(row, index) => row.id ?? String(index)}
            emptyMessage="No audit log entries for these filters."
          />
          {!error && rows.length > 0 ? (
            <div className="flex min-w-0 items-center justify-end gap-3">
              <span className="text-muted-foreground text-sm">
                Page {pageIndex + 1}
                {typeof total === "number" ? ` of ${Math.max(Math.ceil(total / PAGE_SIZE), 1)} (${total} entries)` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => Math.max(p - 1, 0))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.length < PAGE_SIZE || (typeof total === "number" && (pageIndex + 1) * PAGE_SIZE >= total)}
                onClick={() => setPageIndex((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
