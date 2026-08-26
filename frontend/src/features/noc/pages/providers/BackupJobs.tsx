// NOC scheduled backup jobs board (GET .../backup-jobs). Creating, editing,
// deleting or running jobs is platform-admin only → this page stays read-only.
import { useParams } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCwIcon } from "lucide-react"
import {
  AdminOnlyHint,
  type PveBackupJob,
  ProviderSurfaceNote,
} from "./pve"
import { flagLabel, fmtEpoch, useNocProvider, useTyped } from "./pve-utils"
import { ProviderSubBreadcrumb } from "./ProviderDetail"

export default function NocProviderBackupJobsPage() {
  const providerId = useParams().providerId ?? ""
  const { provider } = useNocProvider(providerId)
  const jobs = useTyped<PveBackupJob[]>(`/admin/providers/${providerId}/backup-jobs`)

  return (
    <div className="flex flex-col gap-6">
      <ProviderSubBreadcrumb providerId={providerId} providerName={provider?.name} page="Backup jobs" />
      <PageHeader
        title="Backup jobs"
        description="Cluster-wide scheduled vzdump/PBS jobs with their schedule and next run."
        actions={
          <Button variant="outline" size="sm" onClick={jobs.reload} disabled={jobs.loading}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      />
      <AdminOnlyHint>
        Creating, editing, deleting or manually running a job requires platform admin; the NOC
        console exposes the schedule board only.
      </AdminOnlyHint>
      <ProviderSurfaceNote
        kind={provider?.kind} />

      {jobs.error ? (
        <ErrorBanner error={jobs.error} />
      ) : (
        <SimpleDataTable<PveBackupJob>
          columns={[
            { key: "id", header: "Job", render: (row) => <span className="font-mono text-xs">{row.id ?? "—"}</span> },
            {
              key: "enabled",
              header: "Status",
              render: (row) => (
                <Badge variant={flagLabel(row.enabled) === "yes" ? "default" : "secondary"}>
                  {flagLabel(row.enabled) === "yes" ? "enabled" : "disabled"}
                </Badge>
              ),
            },
            { key: "schedule", header: "Schedule", render: (row) => <span className="font-mono text-xs">{row.schedule || "—"}</span> },
            { key: "next-run", header: "Next run", render: (row) => fmtEpoch(row["next-run"] ?? row.next_run), className: "whitespace-nowrap" },
            { key: "mode", header: "Mode", render: (row) => row.mode ?? "—" },
            { key: "storage", header: "Storage", render: (row) => row.storage ?? "—" },
            {
              key: "scope",
              header: "Scope",
              render: (row) =>
                flagLabel(row.all) === "yes"
                  ? "all guests"
                  : row.vmid
                    ? `VMIDs ${row.vmid}`
                    : row.pool
                      ? `pool ${row.pool}`
                      : row.node
                        ? `node ${row.node}`
                        : "—",
            },
            { key: "mailto", header: "Notify", render: (row) => row.mailto || "—" },
            { key: "comment", header: "Comment", render: (row) => row.comment ?? "—" },
          ]}
          rows={jobs.data ?? []}
          loading={jobs.loading}
          skeletonRows={4}
          emptyMessage="No scheduled backup jobs on this cluster."
          getRowKey={(row) => row.id ?? Math.random().toString()}
        />
      )}
    </div>
  )
}
