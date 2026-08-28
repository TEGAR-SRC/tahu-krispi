// Audit trail for the active organization (GET /audit-logs, org scoped).
// The endpoint returns flat rows only — no before/after payload and just a
// `limit` parameter — so action/date filtering happens client-side over the
// latest 200 entries and each row expands to its raw JSON fields.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { formatDateTime } from "../../format"
import { orgHeaders, useOrg } from "../../useOrg"

interface AuditRow {
  id: number | string
  actor_user_id?: string
  action?: string
  resource_type?: string
  resource_id?: string
  created_at?: string
}

export default function MyAuditLogsPage() {
  const { orgId } = useOrg()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [actionFilter, setActionFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [expandedId, setExpandedId] = useState<string | number | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      // The API caps limit at 200; that is the whole visible window.
      const { data } = await apiGet<AuditRow[]>("/audit-logs", {
        query: { limit: 200 },
        headers: orgHeaders(orgId),
      })
      setRows(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (actionFilter && !(row.action ?? "").toLowerCase().includes(actionFilter.toLowerCase())) {
        return false
      }
      if (dateFrom) {
        const created = row.created_at ? new Date(row.created_at).getTime() : NaN
        if (!Number.isFinite(created) || created < new Date(`${dateFrom}T00:00:00`).getTime()) {
          return false
        }
      }
      if (dateTo) {
        const created = row.created_at ? new Date(row.created_at).getTime() : NaN
        if (!Number.isFinite(created) || created > new Date(`${dateTo}T23:59:59`).getTime()) {
          return false
        }
      }
      return true
    })
  }, [rows, actionFilter, dateFrom, dateTo])

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Audit logs"
        description="Actions recorded inside the active organization (latest 200)."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/profile">Back to settings</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Applied locally over the loaded window.</CardDescription>
        </CardHeader>
        <CardContent className="grid w-full max-w-full min-w-0 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="al-action" className="text-sm font-medium">
              Action contains
            </label>
            <Input
              id="al-action"
              placeholder="apikey.created"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="al-from" className="text-sm font-medium">
              From date
            </label>
            <Input
              id="al-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="al-to" className="text-sm font-medium">
              To date
            </label>
            <Input
              id="al-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <ErrorBanner error={error} />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? null : filtered.length === 0 ? (
        <EmptyState message="No audit entries match." description="Widen the filters or perform an action first." />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => {
                const key = String(row.id)
                const expanded = expandedId === row.id
                return (
                  <Fragment key={key}>
                    <TableRow>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={expanded ? "Collapse row" : "Expand row"}
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                        >
                          {expanded ? (
                            <ChevronUpIcon className="size-4" />
                          ) : (
                            <ChevronDownIcon className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.action || "—"}</TableCell>
                      <TableCell>
                        {row.resource_type ? (
                          <span className="text-xs">
                            {row.resource_type}
                            {row.resource_id ? (
                              <span className="ml-1 font-mono text-muted-foreground">
                                …{row.resource_id.slice(-8)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {row.actor_user_id ? (
                          <span className="font-mono text-xs">…{row.actor_user_id.slice(-8)}</span>
                        ) : (
                          "system"
                        )}
                      </TableCell>
                      <TableCell>{formatDateTime(row.created_at)}</TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <pre className="overflow-x-auto font-mono text-xs">
                            {JSON.stringify(
                              {
                                id: row.id,
                                action: row.action,
                                resource_type: row.resource_type,
                                resource_id: row.resource_id,
                                actor_user_id: row.actor_user_id,
                                created_at: row.created_at,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        This endpoint exposes the flat event list only; before/after payloads are not
        returned by the customer API.
      </p>
    </div>
  )
}
