// Scheduled vzdump backup jobs (PVE cluster/backup): list, create, edit,
// delete and run-now. The SDK serializes IntOrBool as 0/1, so enabled is
// normalized before rendering. All mutations are platform-admin-only.
import { useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiPost, apiPut, ApiError } from "@/lib/api"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
import { Badge } from "@/components/ui/badge"
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
import { StatusBadge, formatDateTime } from "../shared"
import {
  ConfirmDialog,
  ProviderShell,
  useInfraGet,
  type BackupJobRow,
  type ClusterStorage,
} from "./shared"

const MODES = ["snapshot", "suspend", "stop"]

export default function ProviderBackupJobsPage() {
  const params = useParams()
  const providerId = params.providerId ?? ""
  const base = `/admin/providers/${providerId}`

  const jobs = useInfraGet<BackupJobRow[]>(
    providerId ? `${base}/backup-jobs` : null,
  )
  const storages = useInfraGet<ClusterStorage[]>(
    providerId ? `${base}/cluster-storages` : null,
  )
  const storageNames = (storages.data ?? [])
    .map((row) => row.storage)
    .filter((name): name is string => Boolean(name))

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<BackupJobRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupJobRow | null>(null)
  const [runTarget, setRunTarget] = useState<BackupJobRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const runAction = async (
    job: BackupJobRow,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    const key = String(job.id ?? "?")
    setBusyId(key)
    try {
      await action()
      toast.success(success)
      jobs.reload()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Request failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ProviderShell
      providerId={providerId}
      title="Backup jobs"
      description="Cluster-wide vzdump schedules; run-now enqueues an immediate execution."
      actions={
        <Button size="sm" onClick={() => setEditing(null)}>
          Add job…
        </Button>
      }
    >
      <SimpleDataTable<BackupJobRow>
        columns={[
          { key: "id", header: "Job id", render: (job) => job.id || "—" },
          {
            key: "enabled",
            header: "State",
            render: (job) =>
              job.enabled === 1 || job.enabled === true ? (
                <StatusBadge status="active" />
              ) : (
                <StatusBadge status="disabled" />
              ),
          },
          {
            key: "schedule",
            header: "Schedule",
            render: (job) => <span className="font-mono text-xs">{job.schedule || "—"}</span>,
          },
          {
            key: "storage",
            header: "Storage",
            render: (job) => job.storage || "—",
          },
          {
            key: "mode",
            header: "Mode",
            render: (job) => <Badge variant="outline">{job.mode || "snapshot"}</Badge>,
          },
          {
            key: "selection",
            header: "Selection",
            className: "hidden md:table-cell",
            render: (job) =>
              job.all
                ? "all guests"
                : [job.vmid ? `vmids ${job.vmid}` : "", job.pool ? `pool ${job.pool}` : ""]
                    .filter(Boolean)
                    .join(" · ") || "—",
          },
          {
            key: "next_run",
            header: "Next run",
            className: "hidden lg:table-cell",
            render: (job) => formatDateTime(nextRunIso(job.next_run)),
          },
          {
            key: "actions",
            header: "",
            className: "w-64 text-right",
            render: (job) => (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === String(job.id ?? "?")}
                  onClick={() => setRunTarget(job)}
                >
                  Run now
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(job)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(job)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={jobs.data ?? []}
        loading={jobs.loading}
        error={jobs.error}
        getRowKey={(job) => String(job.id ?? "?")}
        emptyMessage="No scheduled backup jobs defined."
        skeletonRows={4}
      />

      <JobEditorDialog
        open={editorOpen || editing !== null}
        editing={editing}
        storages={storageNames}
        storagesLoading={storages.loading}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
          setEditorOpen(false)
        }}
        onSaved={(message) => {
          setEditorOpen(false)
          setEditing(null)
          toast.success(message)
          jobs.reload()
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete backup job "${deleteTarget?.id}"?`}
        body="The schedule stops existing immediately; existing backups on the storage are kept."
        confirmLabel="Delete job"
        busy={busyId !== null}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target?.id) return
          void runAction(
            target,
            () => apiDelete(`${base}/backup-jobs/${encodeURIComponent(target.id as string)}`),
            `Backup job ${target.id} deleted`,
          )
        }}
      />

      <ConfirmDialog
        open={runTarget !== null}
        onOpenChange={(open) => !open && setRunTarget(null)}
        title={`Run backup job "${runTarget?.id}" now?`}
        body="A vzdump execution for this schedule starts at the provider right away (202). Large guests can saturate storage IO while it runs."
        confirmLabel="Run now"
        destructive={false}
        busy={busyId !== null}
        onConfirm={() => {
          const target = runTarget
          setRunTarget(null)
          if (!target?.id) return
          void runAction(
            target,
            () => apiPost(`${base}/backup-jobs/${encodeURIComponent(target.id as string)}/run`),
            `Backup job ${target.id} started`,
          )
        }}
      />
    </ProviderShell>
  )
}

function nextRunIso(value?: number): string | undefined {
  if (!value) return undefined
  return new Date(value * 1000).toISOString()
}

interface JobEditorProps {
  open: boolean
  editing: BackupJobRow | null
  storages: string[]
  storagesLoading: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}

function JobEditorDialog({
  open,
  editing,
  storages,
  storagesLoading,
  onOpenChange,
  onSaved,
}: JobEditorProps) {
  const providerId = useParams().providerId ?? ""
  const [schedule, setSchedule] = useState(editing?.schedule ?? "02:00")
  const [storage, setStorage] = useState(editing?.storage ?? "")
  const [mode, setMode] = useState(editing?.mode ?? "snapshot")
  const [node, setNode] = useState(editing?.node ?? "")
  const [pool, setPool] = useState(editing?.pool ?? "")
  const [vmids, setVmids] = useState(editing?.vmid ?? "")
  const [all, setAll] = useState(Boolean(editing?.all))
  const [mailto, setMailto] = useState(editing?.mailto ?? "")
  const [notesTemplate, setNotesTemplate] = useState(editing?.notes_template ?? "")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const body: Record<string, unknown> = {
      schedule: schedule.trim(),
      storage: storage.trim(),
      mode,
      enabled: true,
    }
    if (!body.schedule || !body.storage) {
      toast.error("Schedule and storage are required.")
      return
    }
    if (node.trim()) body.node = node.trim()
    if (pool.trim()) body.pool = pool.trim()
    if (vmids.trim()) body.vmid = vmids.trim()
    if (all) body.all = true
    else if (vmids.trim() === "" && !pool.trim()) {
      toast.error("Select a scope: all guests, a pool or explicit VMIDs.")
      return
    }
    if (mailto.trim()) {
      body.mailto = mailto.trim()
      body.mailnotification = editing?.mailnotification || "always"
    }
    if (notesTemplate.trim()) body["notes-template"] = notesTemplate.trim()

    setSaving(true)
    const base = `/admin/providers/${providerId}`
    try {
      if (editing?.id) {
        await apiPut(`${base}/backup-jobs/${encodeURIComponent(editing.id)}`, body)
        onSaved(`Backup job ${editing.id} updated`)
      } else {
        await apiPost(`${base}/backup-jobs`, body)
        onSaved("Backup job created")
      }
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to save backup job")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit job ${editing.id}` : "Add backup job"}</DialogTitle>
          <DialogDescription>
            PVE systemd-calendar schedules like “02:00”, “sat 03:00” or “*-*-* 04:30:00”.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bj-schedule">Schedule *</Label>
              <Input
                id="bj-schedule"
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                placeholder="02:00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-storage">Storage *</Label>
              <Select value={storage} onValueChange={setStorage}>
                <SelectTrigger id="bj-storage">
                  <SelectValue placeholder={storagesLoading ? "Loading…" : "Pick a storage"} />
                </SelectTrigger>
                <SelectContent>
                  {storages.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-mode">Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="bj-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-node">Node (optional)</Label>
              <Input id="bj-node" value={node} onChange={(event) => setNode(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-pool">Pool (optional)</Label>
              <Input id="bj-pool" value={pool} onChange={(event) => setPool(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-vmids">VMIDs (comma list)</Label>
              <Input
                id="bj-vmids"
                value={vmids}
                onChange={(event) => setVmids(event.target.value.replace(/[^0-9,\s]/g, ""))}
                placeholder="100,101,102"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={all}
                  onChange={(event) => setAll(event.target.checked)}
                />
                Include all guests (overrides the VMID/pool scope)
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-mailto">Notify e-mail</Label>
              <Input
                id="bj-mailto"
                type="email"
                value={mailto}
                onChange={(event) => setMailto(event.target.value)}
                placeholder="ops@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-notes">Notes template</Label>
              <Input
                id="bj-notes"
                value={notesTemplate}
                onChange={(event) => setNotesTemplate(event.target.value)}
                placeholder="{{guestname}}"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {editing ? "Save changes" : "Create job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
