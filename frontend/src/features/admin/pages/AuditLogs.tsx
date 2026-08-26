// Platform-admin audit trail: filter by actor uuid and action substring, then
// expand any row to inspect the raw JSON record returned by the API.
import { useEffect, useState } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import type { PagedMeta } from "@/lib/types"
import { JsonBlock, PaginationBar, SearchFilter, formatDateTime } from "./shared"

interface AuditLogRow {
  id: number
  organization_id: string
  actor_user_id: string
  actor_api_key_id: string
  action: string
  resource_type: string
  resource_id: string
  ip: string
  request_id: string
  created_at: string
}

const PER_PAGE = 20

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [actor, setActor] = useState("")
  const [action, setAction] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Invalid actor filters are surfaced by the API as a validation error; keep
  // the raw input so the user can correct it instead of losing their text.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<AuditLogRow[]>("/admin/audit-logs", {
      query: {
        page,
        per_page: PER_PAGE,
        actor: actor || null,
        action: action || null,
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
  }, [page, actor, action])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit Logs"
        description="Immutable record of every privileged action on the platform."
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchFilter
          placeholder="Actor user UUID…"
          value={actor}
          onApply={(applied) => {
            setActor(applied)
            setPage(1)
            setExpandedId(null)
          }}
        />
        <SearchFilter
          placeholder="Action contains (e.g. admin.user)…"
          value={action}
          onApply={(applied) => {
            setAction(applied)
            setPage(1)
            setExpandedId(null)
          }}
        />
      </div>

      <SimpleDataTable<AuditLogRow>
        columns={[
          {
            key: "expand",
            header: "",
            className: "w-10",
            render: (row) => (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={expandedId === row.id ? "Collapse record" : "Expand record"}
                onClick={(event) => {
                  event.stopPropagation()
                  setExpandedId(expandedId === row.id ? null : row.id)
                }}
              >
                {expandedId === row.id ? (
                  <ChevronDownIcon className="size-4" />
                ) : (
                  <ChevronRightIcon className="size-4" />
                )}
              </Button>
            ),
          },
          {
            key: "id",
            header: "#",
            render: (row) => (
              <span className="tabular-nums text-muted-foreground">{row.id}</span>
            ),
          },
          {
            key: "action",
            header: "Action",
            render: (row) => <span className="font-mono text-xs">{row.action}</span>,
          },
          {
            key: "resource_type",
            header: "Resource",
            render: (row) => (
              <div className="min-w-0">
                <p>{row.resource_type || "—"}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.resource_id}
                </p>
              </div>
            ),
          },
          {
            key: "actor_user_id",
            header: "Actor",
            className: "hidden md:table-cell",
            render: (row) => (
              <span className="font-mono text-xs text-muted-foreground">
                {row.actor_api_key_id ? `api-key ${row.actor_api_key_id.slice(0, 8)}…` : row.actor_user_id.slice(0, 8) + "…"}
              </span>
            ),
          },
          {
            key: "ip",
            header: "IP",
            className: "hidden lg:table-cell",
            render: (row) => row.ip || "—",
          },
          {
            key: "created_at",
            header: "When",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => String(row.id)}
        emptyMessage="No audit entries match these filters."
        skeletonRows={10}
      />

      {/* Raw JSON payload of the expanded entry. */}
      {expandedId !== null && !loading ? (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">
            Raw record #{expandedId}
          </h3>
          <JsonBlock value={rows.find((row) => row.id === expandedId) ?? null} />
        </section>
      ) : null}

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />
    </div>
  )
}
