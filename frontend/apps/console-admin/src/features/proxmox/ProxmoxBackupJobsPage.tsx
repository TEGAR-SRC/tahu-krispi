import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api"
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
import { StatusBadge } from "@/features/admin/pages/shared"
import { formatDateTime } from "@/features/admin/pages/format"
import { ConfirmDialog, ProviderShell } from "@/features/admin/pages/providers/shared"
import type { BackupJobRow, ClusterStorage } from "@/features/admin/pages/providers/types"

const MODES = ["snapshot", "suspend", "stop"]

export default function ProxmoxBackupJobsPage() {
  const { providerId = "" } = useParams<{ providerId: string }>()
  const base = `/admin/proxmox/${providerId}`

  const [jobs, setJobs] = useState<BackupJobRow[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<unknown>(null)
  const [storageNames, setStorageNames] = useState<string[]>([])
  const [storagesLoading, setStoragesLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<BackupJobRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BackupJobRow | null>(null)
  const [runTarget, setRunTarget] = useState<BackupJobRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    if (!providerId) return
    setJobsLoading(true)
    setJobsError(null)
    try {
      const res = await apiGet<BackupJobRow[]>(`${base}/backup-jobs`)
      setJobs(Array.isArray(res.data) ? res.data : [])
    } catch (cause) {
      setJobsError(cause)
    } finally {
      setJobsLoading(false)
    }
  }, [base, providerId])

  const loadStorages = useCallback(async () => {
    if (!providerId) return
    setStoragesLoading(true)
    try {
      const res = await apiGet<ClusterStorage[]>(`${base}/cluster-storages`)
      const names = (res.data ?? []).map((r) => r.storage).filter((n): n is string => Boolean(n))
      setStorageNames(names)
    } catch {
      setStorageNames([])
    } finally {
      setStoragesLoading(false)
    }
  }, [base, providerId])

  useEffect(() => {
    void loadJobs()
    void loadStorages()
  }, [loadJobs, loadStorages])

  const runAction = async (job: BackupJobRow, action: () => Promise<unknown>, success: string) => {
    const key = String(job.id ?? "?")
    setBusyId(key)
    try {
      await action()
      toast.success(success)
      await loadJobs()
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
      description="Cluster-wide vzdump schedules on this Proxmox provider; run-now enqueues an immediate execution."
      actions={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          Add job…
        </Button>
      }
    >
      <SimpleDataTable<BackupJobRow>
        columns={[
          { key: "id", header: "Job id", render: (job) => <span className="font-mono text-xs">{job.id || "—"}</span> },
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
          { key: "storage", header: "Storage", render: (job) => job.storage || "—" },
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(job)
                    setEditorOpen(true)
                  }}
                >
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(job)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
        rows={jobs}
        loading={jobsLoading}
        error={jobsError}
        getRowKey={(job) => String(job.id ?? "?")}
        emptyMessage="No scheduled backup jobs defined."
        skeletonRows={4}
      />

      <JobEditorDialog
        open={editorOpen}
        editing={editing}
        storages={storageNames}
        storagesLoading={storagesLoading}
        base={base}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null)
            setEditorOpen(false)
          } else {
            setEditorOpen(open)
          }
        }}
        onSaved={async (message) => {
          setEditorOpen(false)
          setEditing(null)
          toast.success(message)
          await loadJobs()
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
            () => apiPost(`${base}/backup-jobs/${encodeURIComponent(target.id as string)}/run`, {}),
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
  base: string
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}

function JobEditorDialog({ open, editing, storages, storagesLoading, base, onOpenChange, onSaved }: JobEditorProps) {
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

  useEffect(() => {
    setSchedule(editing?.schedule ?? "02:00")
    setStorage(editing?.storage ?? "")
    setMode(editing?.mode ?? "snapshot")
    setNode(editing?.node ?? "")
    setPool(editing?.pool ?? "")
    setVmids(editing?.vmid ?? "")
    setAll(Boolean(editing?.all))
    setMailto(editing?.mailto ?? "")
    setNotesTemplate(editing?.notes_template ?? "")
  }, [editing, open])

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
    try {
      if (editing?.id) {
        await apiPut(`${base}/backup-jobs/${encodeURIComponent(editing.id as string)}`, body)
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
          <DialogDescription>PVE systemd-calendar schedules like “02:00”, “sat 03:00” or “*-*-* 04:30:00”.</DialogDescription>
        </DialogHeader>
        <div className="grid w-full max-w-full min-w-0 gap-3">
          <div className="grid w-full max-w-full min-w-0 grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bj-schedule">Schedule *</Label>
              <Input id="bj-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="02:00" />
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
              <Input id="bj-node" value={node} onChange={(e) => setNode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-pool">Pool (optional)</Label>
              <Input id="bj-pool" value={pool} onChange={(e) => setPool(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-vmids">VMIDs (comma list)</Label>
              <Input
                id="bj-vmids"
                value={vmids}
                onChange={(e) => setVmids(e.target.value.replace(/[^0-9,\s]/g, ""))}
                placeholder="100,101,102"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={all} onChange={(e) => setAll(e.target.checked)} />
                Include all guests (overrides the VMID/pool scope)
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-mailto">Notify e-mail</Label>
              <Input id="bj-mailto" type="email" value={mailto} onChange={(e) => setMailto(e.target.value)} placeholder="ops@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bj-notes">Notes template</Label>
              <Input id="bj-notes" value={notesTemplate} onChange={(e) => setNotesTemplate(e.target.value)} placeholder="{{guestname}}" />
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
