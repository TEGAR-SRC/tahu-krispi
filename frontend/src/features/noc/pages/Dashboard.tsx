import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ActivityIcon,
  CircleCheckIcon,
  CircleXIcon,
  CloudIcon,
  ServerIcon,
} from "lucide-react"
import {
  type InstanceRow,
  type JobRow,
  type Provider,
  StatusBadge,
  KindBadge,
  fmtDateTime,
} from "../lib"

const INSTANCE_STATES = [
  "active",
  "provisioning",
  "suspended",
  "failed",
  "stopped",
  "pending",
] as const

export default function NocDashboardPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersError, setProvidersError] = useState<unknown>(null)
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [instanceTotal, setInstanceTotal] = useState(0)
  const [instancesError, setInstancesError] = useState<unknown>(null)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [jobsError, setJobsError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // Independent sections: one failure must not blank the whole dashboard.
    const results = await Promise.allSettled([
      apiGet<Provider[]>("/admin/providers"),
      apiGet<InstanceRow[]>("/admin/instances", { query: { page: 1, per_page: 100 } }),
      apiGet<JobRow[]>("/admin/jobs", { query: { page: 1, per_page: 50 } }),
    ])
    if (results[0].status === "fulfilled") {
      setProviders(results[0].value.data)
      setProvidersError(null)
    } else {
      setProvidersError(results[0].reason)
    }
    if (results[1].status === "fulfilled") {
      setInstances(results[1].value.data)
      setInstanceTotal(results[1].value.meta?.total ?? results[1].value.data.length)
      setInstancesError(null)
    } else {
      setInstancesError(results[1].reason)
    }
    if (results[2].status === "fulfilled") {
      setJobs(results[2].value.data)
      setJobsError(null)
    } else {
      setJobsError(results[2].reason)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stateCount = (state: string) =>
    instances.filter((i) => i.status.toLowerCase() === state).length
  const activeJobs = jobs.filter((j) =>
    ["queued", "running", "retry"].includes(j.status),
  ).length
  const failedJobs = jobs.filter((j) => j.status === "failed").length
  const enabledProviders = providers.filter((p) => p.enabled).length

  const stateHint = INSTANCE_STATES.map((s) => `${s} ${stateCount(s)}`).join(" · ")

  const jobColumns: Array<SimpleColumn<JobRow>> = [
    { key: "job_type", header: "Job", className: "font-medium" },
    { key: "queue", header: "Queue" },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "attempts",
      header: "Attempts",
      render: (row) => `${row.attempts}/${row.max_attempts}`,
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => fmtDateTime(row.created_at),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="NOC Dashboard"
        description="Infrastructure health at a glance."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Instances"
          value={instanceTotal}
          hint={stateHint || undefined}
          icon={<ServerIcon />}
        />
        <StatCard
          label="Active jobs"
          value={activeJobs}
          hint={`queued + running + retry in latest ${jobs.length}`}
          icon={<ActivityIcon />}
        />
        <StatCard
          label="Failed jobs"
          value={failedJobs}
          hint="in latest window"
          icon={<CircleXIcon />}
        />
        <StatCard
          label="Providers enabled"
          value={`${enabledProviders}/${providers.length}`}
          hint="of registered providers"
          icon={<CloudIcon />}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent jobs</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/noc/jobs">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <SimpleDataTable
            columns={jobColumns}
            rows={jobs.slice(0, 8)}
            loading={loading}
            error={jobsError}
            skeletonRows={5}
            emptyMessage="No jobs recorded yet."
            getRowKey={(row) => row.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Provider health snapshot</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/noc/providers">Manage providers</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <SimpleDataTable
            columns={[
              {
                key: "name",
                header: "Provider",
                render: (row) => (
                  <span className="font-medium">
                    {row.name}
                    <span className="ml-2 text-xs text-muted-foreground">{row.code}</span>
                  </span>
                ),
              },
              { key: "kind", header: "Kind", render: (row) => <KindBadge kind={row.kind} /> },
              {
                key: "enabled",
                header: "Enabled",
                render: (row) => (
                  <StatusBadge status={row.enabled ? "enabled" : "disabled"} />
                ),
              },
              {
                key: "health_status",
                header: "Health",
                render: (row) => <StatusBadge status={row.health_status} />,
              },
              {
                key: "has_credentials",
                header: "Credentials",
                render: (row) => (row.has_credentials ? "configured" : "not set"),
              },
            ]}
            rows={providers}
            loading={loading}
            error={providersError}
            skeletonRows={4}
            emptyMessage="No providers registered."
            getRowKey={(row) => row.id}
          />
          {!providersError && !loading && providers.length > 0 ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CircleCheckIcon className="size-3" /> Snapshot from the live provider registry.
            </p>
          ) : null}
          {instancesError ? (
            <p className="text-xs text-muted-foreground">
              Instance stats unavailable:{" "}
              {instancesError instanceof Error ? instancesError.message : "request failed"}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
