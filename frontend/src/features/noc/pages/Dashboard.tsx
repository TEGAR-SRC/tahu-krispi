import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { apiGet } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { StatCard } from "@/components/shared/StatCard"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  ActivityIcon,
  CircleCheckIcon,
  CircleXIcon,
  CloudIcon,
  LockIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react"
import {
  type InstanceRow,
  type JobRow,
  type Provider,
  StatusBadge,
  KindBadge,
} from "../lib"
import { fmtDateTime } from "../lib-utils"

const INSTANCE_STATES = [
  "active",
  "provisioning",
  "suspended",
  "failed",
  "stopped",
  "pending",
] as const

// The backend caps per_page at 100, so "up to 200 recent jobs" means two pages.
const JOBS_PER_PAGE = 100

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

const jobsChartConfig = {
  jobs: { label: "Jobs", color: "var(--chart-1)" },
} satisfies ChartConfig

/** Parses backend timestamps like `2026-08-26 13:40:22.598324+07`. */
function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Buckets the fetched jobs into the last 24 hourly slots ending now. */
function jobsPerHour(jobs: JobRow[]): Array<{ label: string; jobs: number }> {
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const hour = new Date()
    hour.setMinutes(0, 0, 0)
    hour.setHours(hour.getHours() - (23 - index))
    return { label: `${String(hour.getHours()).padStart(2, "0")}:00`, jobs: 0 }
  })
  const windowStart = new Date()
  windowStart.setMinutes(0, 0, 0)
  windowStart.setHours(windowStart.getHours() - 23)
  for (const job of jobs) {
    const created = parseApiDate(job.created_at)
    if (!created || created < windowStart) continue
    const hoursAgo = Math.floor(
      (Date.now() - created.getTime()) / (60 * 60 * 1000),
    )
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo].jobs += 1
  }
  return buckets
}

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
      apiGet<JobRow[]>("/admin/jobs", { query: { page: 1, per_page: JOBS_PER_PAGE } }),
      apiGet<JobRow[]>("/admin/jobs", { query: { page: 2, per_page: JOBS_PER_PAGE } }),
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
    const jobPages: JobRow[] = []
    for (const result of [results[2], results[3]]) {
      // A failed second page only shrinks the window; page 1 failing is the real error.
      if (result.status === "fulfilled") jobPages.push(...result.value.data)
    }
    setJobs(jobPages)
    setJobsError(results[2].status === "rejected" ? results[2].reason : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const instance of instances) {
      const state = instance.status.toLowerCase() || "unknown"
      counts.set(state, (counts.get(state) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
  }, [instances])

  const hourBuckets = useMemo(() => jobsPerHour(jobs), [jobs])

  const activeJobs = jobs.filter((j) =>
    ["queued", "running", "retry"].includes(j.status),
  ).length
  const failedJobs = jobs.filter((j) => j.status === "failed").length
  const enabledProviders = providers.filter((p) => p.enabled).length
  const healthyProviders = providers.filter(
    (p) => p.enabled && p.health_status.toLowerCase() === "ok",
  ).length

  const stateHint = INSTANCE_STATES.map(
    (s) => `${s} ${instances.filter((i) => i.status.toLowerCase() === s).length}`,
  ).join(" · ")

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
          hint={`${healthyProviders} reporting healthy`}
          icon={<CloudIcon />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Jobs per hour</CardTitle>
            <CardDescription>
              Created jobs bucketed hourly from the latest {jobs.length}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={jobsChartConfig} className="h-56 w-full">
              <BarChart data={hourBuckets} margin={{ left: -24, right: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={5}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="jobs" fill="var(--color-jobs)" radius={3} />
              </BarChart>
            </ChartContainer>
            {jobsError && !loading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Job chart unavailable:{" "}
                {jobsError instanceof Error ? jobsError.message : "request failed"}.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instances by state</CardTitle>
            <CardDescription>
              Distribution across the {instances.length} most recent of {instanceTotal}{" "}
              instances.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stateCounts.length > 0 ? (
              <div className="relative mx-auto h-56 w-full max-w-sm">
                <ChartContainer
                  config={Object.fromEntries(
                    stateCounts.map((entry, index) => [
                      entry.state,
                      { label: entry.state, color: PIE_COLORS[index % PIE_COLORS.length] },
                    ]),
                  )}
                  className="h-56 w-full"
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={stateCounts}
                      dataKey="count"
                      nameKey="state"
                      innerRadius={58}
                      outerRadius={88}
                      strokeWidth={2}
                    >
                      {stateCounts.map((entry, index) => (
                        <Cell
                          key={entry.state}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-semibold tabular-nums">{instances.length}</span>
                  <span className="text-xs text-muted-foreground">sampled instances</span>
                </div>
              </div>
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                No instances to chart yet.
              </div>
            )}
            {stateCounts.length > 0 ? (
              <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
                {stateCounts.map((entry, index) => (
                  <li key={entry.state} className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="capitalize">{entry.state}</span>
                    <span className="tabular-nums text-muted-foreground">{entry.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {instancesError && !loading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Instance stats unavailable:{" "}
                {instancesError instanceof Error ? instancesError.message : "request failed"}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Provider health</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/noc/providers">Manage providers</Link>
          </Button>
        </div>
        {providersError ? (
          <p className="text-xs text-muted-foreground">
            Provider stats unavailable:{" "}
            {providersError instanceof Error ? providersError.message : "request failed"}.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-lg" />
              ))
            ) : (
              providers.map((provider) => (
              <Link
                key={provider.id}
                to={`/noc/providers/${provider.id}`}
                className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-2 px-4 pt-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{provider.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{provider.code}</p>
                  </div>
                  <KindBadge kind={provider.kind} />
                </div>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-2 text-xs text-muted-foreground">
                  <StatusBadge status={provider.health_status} />
                  <StatusBadge status={provider.enabled ? "enabled" : "disabled"} />
                  {provider.has_credentials ? (
                    <span className="flex items-center gap-1">
                      <ShieldCheckIcon className="size-3" /> credentials configured
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <LockIcon className="size-3" /> no credentials
                    </span>
                  )}
                </div>
              </Link>
              ))
            )}
            {!loading && providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No providers registered.</p>
            ) : null}
          </div>
        )}
      </section>

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
            error={null}
            skeletonRows={5}
            emptyMessage="No jobs recorded yet."
            getRowKey={(row) => row.id}
          />
          {!providersError && !loading && providers.length > 0 ? (
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <CircleCheckIcon className="size-3" /> Snapshot from the live provider registry and
              job queue.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
