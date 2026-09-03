import { useCallback, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ApiError, apiPost } from "@/lib/api"
import { EmptyState } from "@/components/shared/EmptyState"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ProviderShell } from "@/features/admin/pages/providers/shared"
import { useInfraGet } from "@/features/admin/pages/providers/infra"
import { StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime, formatMoney } from "@/features/admin/pages/format"
import { ConfirmDialog } from "@/features/admin/pages/providers/shared"

interface InstanceJob {
  id: string
  queue: string
  job_type: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string
  created_at: string
  completed_at: string
}

interface ProviderAction {
  id: string
  action: string
  resource_type: string
  external_resource_id: string
  status: string
  attempt_count: number
  response_status_code: number
  last_error: string
  started_at: string
  completed_at: string
  created_at: string
}

interface InstanceDetailPayload {
  id: string
  public_id: string
  name: string
  hostname: string
  status: string
  power_status: string
  organization_id: string
  organization: {
    id: string
    public_id: string
    slug: string
    name: string
  }
  provider_id: string
  provider_account_id: string | null
  external_vm_id: string
  product_id: string | null
  plan_id: string | null
  subscription_id: string | null
  region_id: string | null
  instance_type_id: string | null
  os_template_id: string | null
  pricing_mode: string
  billing_period: string
  currency: string
  recurring_amount: number
  vcpu: number
  ram_mb: number
  disk_gb: number
  additional_hdd_gb: number
  bandwidth_gb: number | null
  network_rate_mbps: number | null
  primary_ipv4: string
  primary_ipv6: string
  bgp_enabled: boolean
  measured_boot_enabled: boolean
  auto_backup_enabled: boolean
  sync_status: string
  last_synced_at: string
  provision_started_at: string
  provisioned_at: string
  suspended_at: string
  termination_requested_at: string
  terminated_at: string
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string
  subscription: {
    id: string
    public_id: string
    status: string
    recurring_amount: number
    next_invoice_at: string
  } | null
  provider_actions: ProviderAction[]
  jobs: InstanceJob[]
  child_counts: { snapshots: number; backups: number }
}

function DetailField({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children ?? "—"}</dd>
    </div>
  )
}

function shortId(value: string | null | undefined) {
  if (!value) return "—"
  const v = String(value).trim()
  return v.length > 12 ? `${v.slice(0, 8)}…` : v
}

export default function OnidelInstanceDetailPage() {
  const { providerId = "", instanceId = "" } = useParams<{ providerId: string; instanceId: string }>()
  const detail = useInfraGet<InstanceDetailPayload>(
    providerId && instanceId ? `/admin/onidel/${providerId}/instances/${instanceId}` : null,
    undefined,
    { intervalMs: 5000 },
  )
  const data = detail.data
  const [pending, setPending] = useState<"suspend" | "unsuspend" | "terminate" | null>(null)
  const [busy, setBusy] = useState(false)

  const runAction = useCallback(
    async (kind: "suspend" | "unsuspend" | "terminate") => {
      if (!providerId || !instanceId) return
      setBusy(true)
      try {
        const suffix = kind === "terminate" ? "terminate" : kind
        try {
          await apiPost(`/admin/onidel/${providerId}/instances/${instanceId}/${suffix}`)
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404) {
            await apiPost(`/admin/instances/${instanceId}/${suffix}`)
          } else {
            throw cause
          }
        }
        toast.success(
          kind === "suspend"
            ? "Suspend queued (202)"
            : kind === "unsuspend"
              ? "Unsuspend queued (202)"
              : "Termination requested (202)",
        )
        detail.reload()
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Request failed")
      } finally {
        setBusy(false)
        setPending(null)
      }
    },
    [providerId, instanceId, detail],
  )

  if (!providerId || !instanceId) {
    return (
      <ProviderShell providerId={providerId || "—"} title="Onidel instance detail" description="GET /admin/onidel/:id/instances/:id · polling 5000ms — instance detail with suspend / terminate.">
        <EmptyState message="Missing provider or instance id." />
      </ProviderShell>
    )
  }

  const lifecycleCopy =
    pending === "suspend"
      ? {
          title: `Suspend "${data?.name ?? instanceId.slice(0, 8)}"?`,
          body: "The instance will be suspended at the provider and stop serving traffic. A suspend_instance job is enqueued (202).",
          confirm: "Suspend",
        }
      : pending === "terminate"
        ? {
            title: `Force-terminate "${data?.name ?? instanceId.slice(0, 8)}"?`,
            body: "Termination is requested immediately and cannot be undone once the job runs.",
            confirm: "Terminate",
          }
        : {
            title: `Unsuspend "${data?.name ?? instanceId.slice(0, 8)}"?`,
            body: "The instance will be reactivated and resume normal operation.",
            confirm: "Unsuspend",
          }

  return (
    <ProviderShell
      providerId={providerId}
      title={data?.name ? `Instance ${data.name}` : "Onidel instance detail"}
      description="GET /admin/onidel/:id/instances/:id · polling 5000ms (infra readable). Suspend / terminate are POST platform_admin (fallback to /admin/instances/:id/*)."
    >
      {detail.error ? <ErrorBanner error={detail.error} /> : null}

      {detail.loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : !data ? (
        <EmptyState message={detail.error ? "Failed to load instance." : "Instance not found."} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
                {data.name}
                <StatusBadge status={data.status} />
                {data.power_status ? <span className="text-sm text-muted-foreground">{data.power_status}</span> : null}
              </h1>
              <p className="font-mono text-sm text-muted-foreground">{data.public_id}</p>
              <p className="font-mono text-xs text-muted-foreground">provider {shortId(data.provider_id)} · {shortId(data.id)}</p>
              {data.external_vm_id ? <p className="font-mono text-xs text-muted-foreground">external {data.external_vm_id}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {data.status === "suspended" ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending("unsuspend")}>
                  Unsuspend…
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy || data.status === "deleting" || data.status === "deleted"}
                  onClick={() => setPending("suspend")}
                >
                  Suspend…
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || data.status === "deleting" || data.status === "deleted"}
                onClick={() => setPending("terminate")}
              >
                Terminate…
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/instances/${data.id}`}>Generic detail</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/onidel/${providerId}/instances`}>Back to instances</Link>
              </Button>
            </div>
          </div>

          <div className="grid w-full max-w-full min-w-0 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compute</CardTitle>
                <CardDescription>Provisioned shape, addresses and network flags.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-3">
                  <DetailField label="Specs">
                    {data.vcpu} vCPU · {data.ram_mb} MB RAM · {data.disk_gb} GB
                    {data.additional_hdd_gb > 0 ? ` +${data.additional_hdd_gb} GB HDD` : ""}
                  </DetailField>
                  <DetailField label="Hostname">{data.hostname || "—"}</DetailField>
                  <DetailField label="External ID">{data.external_vm_id || "unmapped"}</DetailField>
                  <DetailField label="IPv4">{data.primary_ipv4 || "—"}</DetailField>
                  <DetailField label="IPv6">{data.primary_ipv6 || "—"}</DetailField>
                  <DetailField label="Provider">
                    <span className="font-mono text-xs">{shortId(data.provider_id)}</span>
                  </DetailField>
                  <DetailField label="Bandwidth">{data.bandwidth_gb != null ? `${data.bandwidth_gb} GB` : "—"}</DetailField>
                  <DetailField label="Network rate">{data.network_rate_mbps != null ? `${data.network_rate_mbps} Mbps` : "—"}</DetailField>
                  <DetailField label="Flags">
                    <span className="text-xs">
                      {data.bgp_enabled ? "BGP " : ""}
                      {data.measured_boot_enabled ? "Measured-boot " : ""}
                      {data.auto_backup_enabled ? "Auto-backup" : ""}
                      {!data.bgp_enabled && !data.measured_boot_enabled && !data.auto_backup_enabled ? "—" : ""}
                    </span>
                  </DetailField>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Billing &amp; ownership</CardTitle>
                <CardDescription>Organization, pricing, subscription and catalog refs.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-3">
                  <DetailField label="Organization">
                    {data.organization ? (
                      <Link className="text-primary underline-offset-4 hover:underline" to={`/admin/organizations/${data.organization.id}`}>
                        {data.organization.name || data.organization.slug}
                      </Link>
                    ) : (
                      shortId(data.organization_id)
                    )}
                  </DetailField>
                  <DetailField label="Pricing">
                    {formatMoney(data.recurring_amount, data.currency)} / {data.billing_period}
                  </DetailField>
                  <DetailField label="Mode">{data.pricing_mode || "—"}</DetailField>
                  {data.subscription ? (
                    <>
                      <DetailField label="Subscription">
                        <span className="font-mono text-xs">{data.subscription.public_id || shortId(data.subscription.id)}</span>
                      </DetailField>
                      <DetailField label="Subscription status">
                        <StatusBadge status={data.subscription.status ?? null} />
                      </DetailField>
                      <DetailField label="Next invoice">{formatDateTime(data.subscription.next_invoice_at)}</DetailField>
                    </>
                  ) : (
                    <DetailField label="Subscription">none</DetailField>
                  )}
                  <DetailField label="Snapshots / backups">
                    {data.child_counts.snapshots} / {data.child_counts.backups}
                  </DetailField>
                  <DetailField label="Region / type">
                    <span className="font-mono text-xs">{shortId(data.region_id)} / {shortId(data.instance_type_id)}</span>
                  </DetailField>
                  <DetailField label="OS / product">
                    <span className="font-mono text-xs">{shortId(data.os_template_id)} / {shortId(data.product_id)}</span>
                  </DetailField>
                  <DetailField label="Plan">{shortId(data.plan_id)}</DetailField>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lifecycle timeline</CardTitle>
              <CardDescription>Polling 5000ms via useInfraGet — GET /admin/onidel/:id/instances/:id</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid w-full max-w-full min-w-0 grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                <DetailField label="Created">{formatDateTime(data.created_at)}</DetailField>
                <DetailField label="Provision started">{formatDateTime(data.provision_started_at)}</DetailField>
                <DetailField label="Provisioned">{formatDateTime(data.provisioned_at)}</DetailField>
                <DetailField label="Updated">{formatDateTime(data.updated_at)}</DetailField>
                <DetailField label="Sync">{data.sync_status || "—"}</DetailField>
                <DetailField label="Last synced">{formatDateTime(data.last_synced_at)}</DetailField>
                <DetailField label="Suspended at">{formatDateTime(data.suspended_at)}</DetailField>
                <DetailField label="Termination requested">{formatDateTime(data.termination_requested_at)}</DetailField>
                <DetailField label="Terminated">{formatDateTime(data.terminated_at)}</DetailField>
                <DetailField label="Deleted">{formatDateTime(data.deleted_at)}</DetailField>
                <DetailField label="Created by">{data.created_by || "—"}</DetailField>
                <DetailField label="Provider account">{shortId(data.provider_account_id)}</DetailField>
              </dl>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Recent jobs ({data.jobs.length})</h2>
            <SimpleDataTable<InstanceJob>
              columns={[
                {
                  key: "job_type",
                  header: "Type",
                  render: (job) => (
                    <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/admin/jobs/${job.id}`}>
                      {job.job_type}
                    </Link>
                  ),
                },
                { key: "queue", header: "Queue", className: "hidden md:table-cell" },
                { key: "status", header: "Status", render: (job) => <StatusBadge status={job.status} /> },
                { key: "attempts", header: "Attempts", render: (job) => `${job.attempts}/${job.max_attempts}` },
                { key: "created_at", header: "Created", render: (job) => formatDateTime(job.created_at) },
                {
                  key: "completed_at",
                  header: "Completed",
                  className: "hidden lg:table-cell",
                  render: (job) => formatDateTime(job.completed_at),
                },
                {
                  key: "last_error",
                  header: "Last error",
                  className: "hidden max-w-56 truncate xl:table-cell",
                  render: (job) => job.last_error || "—",
                },
              ]}
              rows={data.jobs}
              getRowKey={(job) => job.id}
              emptyMessage="No jobs recorded for this instance."
              skeletonRows={3}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Provider actions ({data.provider_actions.length})</h2>
            <SimpleDataTable<ProviderAction>
              columns={[
                { key: "action", header: "Action" },
                { key: "status", header: "Status", render: (action) => <StatusBadge status={action.status} /> },
                { key: "response_status_code", header: "HTTP" },
                { key: "created_at", header: "When", render: (action) => formatDateTime(action.created_at) },
                { key: "last_error", header: "Last error", className: "max-w-56 truncate", render: (action) => action.last_error || "—" },
              ]}
              rows={data.provider_actions}
              getRowKey={(action) => action.id}
              emptyMessage="No provider actions recorded."
              skeletonRows={3}
            />
          </section>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={lifecycleCopy.title}
        body={lifecycleCopy.body}
        confirmLabel={lifecycleCopy.confirm}
        busy={busy}
        onConfirm={() => {
          const action = pending
          if (!action) return
          void runAction(action)
        }}
      />
    </ProviderShell>
  )
}
