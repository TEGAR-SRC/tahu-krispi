// Platform-admin dashboard: live aggregates from the admin list endpoints
// (meta.total counts), the 1-day finance summary and the latest audit trail.
import { useEffect, useState } from "react"
import {
  ActivityIcon,
  CoinsIcon,
  ServerIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import type { PagedMeta } from "@/lib/types"
import { formatDateTime, formatMoney } from "./format"

interface ListEnvelopeMeta {
  meta?: PagedMeta & Record<string, unknown>
}

interface FinanceSummary {
  period_days: number
  invoices: { paid_count: number; paid_total: number }
  outstanding: { count: number; total: number }
  topups: { paid_count: number; paid_total: number }
  wallet_balance_total: number
  mrr_active: number
}

interface AuditRow {
  id: number
  actor_user_id: string
  action: string
  resource_type: string
  resource_id: string
  ip: string
  created_at: string
}

function useTotalCount(
  path: string,
  query: Record<string, string | number>,
): { total: number | null; error: unknown } {
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    let cancelled = false
    apiGet<unknown[]>(path, { query })
      .then((envelope) => {
        if (cancelled) return
        const meta = envelope.meta as ListEnvelopeMeta["meta"] | undefined
        const value = meta && typeof meta.total === "number" ? meta.total : null
        setTotal(value)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, JSON.stringify(query)])
  return { total, error }
}

const AUDIT_LIMIT = 8

export default function AdminDashboardPage() {
  const users = useTotalCount("/admin/users", { limit: 1 })
  const instances = useTotalCount("/admin/instances", { limit: 1 })
  const jobsQueued = useTotalCount("/admin/jobs", { status: "queued", limit: 1 })
  const jobsRunning = useTotalCount("/admin/jobs", { status: "running", limit: 1 })

  const [finance, setFinance] = useState<FinanceSummary | null>(null)
  const [financeError, setFinanceError] = useState<unknown>(null)

  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<FinanceSummary>("/admin/finance/summary", { query: { days: 1 } })
      .then(({ data }) => {
        if (!cancelled) setFinance(data)
      })
      .catch((cause) => {
        if (!cancelled) setFinanceError(cause)
      })
    apiGet<AuditRow[]>("/admin/audit-logs", { query: { limit: AUDIT_LIMIT } })
      .then(({ data }) => {
        if (!cancelled) setAuditRows(data)
      })
      .catch((cause) => {
        if (!cancelled) setAuditError(cause)
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Platform-wide users, infrastructure and finance at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Users"
          value={users.total ?? "…"}
          hint={users.error ? "failed to load" : "registered accounts"}
          icon={<UsersIcon />}
        />
        <StatCard
          label="Instances"
          value={instances.total ?? "…"}
          hint={instances.error ? "failed to load" : "all organizations"}
          icon={<ServerIcon />}
        />
        <StatCard
          label="Jobs queued"
          value={jobsQueued.total ?? "…"}
          hint={jobsQueued.error ? "failed to load" : "waiting in queue"}
          icon={<ActivityIcon />}
        />
        <StatCard
          label="Jobs running"
          value={jobsRunning.total ?? "…"}
          hint={jobsRunning.error ? "failed to load" : "executing now"}
          icon={<ActivityIcon />}
        />
      </div>

      {financeError ? (
        <ErrorBanner error={financeError} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Outstanding invoices"
            value={finance ? formatMoney(finance.outstanding.total) : "…"}
            hint={
              finance
                ? `${finance.outstanding.count} unpaid · last ${finance.period_days}d`
                : "loading…"
            }
            icon={<CoinsIcon />}
          />
          <StatCard
            label="Top-ups paid"
            value={finance ? formatMoney(finance.topups.paid_total) : "…"}
            hint={
              finance
                ? `${finance.topups.paid_count} top-ups · last ${finance.period_days}d`
                : "loading…"
            }
            icon={<WalletIcon />}
          />
          <StatCard
            label="Invoices paid"
            value={finance ? formatMoney(finance.invoices.paid_total) : "…"}
            hint={
              finance
                ? `${finance.invoices.paid_count} invoices · last ${finance.period_days}d`
                : "loading…"
            }
            icon={<CoinsIcon />}
          />
          <StatCard
            label="Wallet balance total"
            value={finance ? formatMoney(finance.wallet_balance_total) : "…"}
            hint={finance ? `MRR active ${formatMoney(finance.mrr_active)}` : "loading…"}
            icon={<WalletIcon />}
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Recent audit activity
        </h2>
        <SimpleDataTable<AuditRow>
          columns={[
            { key: "action", header: "Action" },
            { key: "actor_user_id", header: "Actor" },
            { key: "resource_type", header: "Resource" },
            {
              key: "created_at",
              header: "When",
              render: (row) => (
                <span className="text-muted-foreground">
                  {formatDateTime(row.created_at)}
                </span>
              ),
            },
          ]}
          rows={auditRows}
          loading={auditLoading}
          error={auditError}
          skeletonRows={AUDIT_LIMIT}
          getRowKey={(row) => String(row.id)}
          emptyMessage="No audit entries recorded yet."
        />
      </section>
    </div>
  )
}
