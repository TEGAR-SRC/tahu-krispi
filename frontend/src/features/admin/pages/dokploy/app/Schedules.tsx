import { useEffect, useState } from "react"
import { PencilIcon, PlayIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dokploy } from "./shared"
import {
  ConfirmButton,
  FieldCard,
  K5Page,
  OperationConsole,
  RawResultCard,
  ServerSelect,
  StatusBadge,
  TextField,
  idFrom,
  mutate,
  textValue,
  type Row,
} from "./k5-common"

type ScheduleType = "dokploy-server" | "server"

interface Draft {
  scheduleId: string
  name: string
  description: string
  cronExpression: string
  command: string
  shellType: "bash" | "sh"
  scheduleType: ScheduleType
  serverId: string
  enabled: boolean
}

const emptyDraft: Draft = {
  scheduleId: "",
  name: "",
  description: "",
  cronExpression: "0 0 * * *",
  command: "",
  shellType: "bash",
  scheduleType: "dokploy-server",
  serverId: "",
  enabled: true,
}

export default function DokploySchedulesPage() {
  const [scopeType, setScopeType] = useState<ScheduleType>("dokploy-server")
  const [serverId, setServerId] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [detail, setDetail] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const id = scopeType === "server" ? serverId : "dokploy-server"

  const reload = () => setReloadKey((value) => value + 1)

  useEffect(() => {
    if (scopeType === "dokploy-server") setServerId("")
  }, [scopeType])

  const openCreate = () => setDraft({ ...emptyDraft, scheduleType: scopeType, serverId })
  const openEdit = async (row: Row) => {
    const scheduleId = idFrom(row, ["scheduleId", "id"])
    if (!scheduleId) {
      setDraft({
        ...emptyDraft,
        name: textValue(row, ["name"], ""),
        description: textValue(row, ["description"], ""),
        cronExpression: textValue(row, ["cronExpression", "cron"], "0 0 * * *"),
        command: textValue(row, ["command"], ""),
        shellType: textValue(row, ["shellType"], "bash") === "sh" ? "sh" : "bash",
        scheduleType: textValue(row, ["scheduleType"], scopeType) === "server" ? "server" : "dokploy-server",
        serverId: textValue(row, ["serverId"], serverId) === "—" ? "" : textValue(row, ["serverId"], serverId),
        enabled: row.enabled === undefined ? true : Boolean(row.enabled),
      })
      return
    }
    const full = await dokploy<Row>("GET", "schedule.one", undefined, { scheduleId })
    setDetail(full)
    setDraft({
      scheduleId,
      name: textValue(full, ["name"], textValue(row, ["name"], "")),
      description: textValue(full, ["description"], "") === "—" ? "" : textValue(full, ["description"], ""),
      cronExpression: textValue(full, ["cronExpression", "cron"], textValue(row, ["cronExpression", "cron"], "0 0 * * *")),
      command: textValue(full, ["command"], textValue(row, ["command"], "")),
      shellType: textValue(full, ["shellType"], "bash") === "sh" ? "sh" : "bash",
      scheduleType: textValue(full, ["scheduleType"], scopeType) === "server" ? "server" : "dokploy-server",
      serverId: textValue(full, ["serverId"], serverId) === "—" ? "" : textValue(full, ["serverId"], serverId),
      enabled: full.enabled === undefined ? true : Boolean(full.enabled),
    })
  }

  return (
    <K5Page title="Schedules" description="Global Dokploy schedules for the Dokploy server or a selected remote server.">
      <FieldCard title="Schedule scope" description="schedule.list requires an id and scheduleType. Application/compose schedules live on service detail pages; this page covers global server schedules.">
        <Field>
          <FieldLabel>Schedule type</FieldLabel>
          <Select value={scopeType} onValueChange={(value) => setScopeType(value as ScheduleType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="dokploy-server">Dokploy server</SelectItem>
                <SelectItem value="server">Remote server</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {scopeType === "server" ? <ServerSelect value={serverId} onChange={setServerId} /> : null}
        <Button onClick={openCreate} disabled={scopeType === "server" && !serverId}>
          <PlusIcon data-icon="inline-start" />
          Create schedule
        </Button>
      </FieldCard>
      <OperationConsole
        title="Schedules"
        description="schedule.list plus read/update/delete/runManually actions."
        reloadKey={reloadKey}
        loader={() => dokploy("GET", "schedule.list", undefined, { id, scheduleType: scopeType })}
        columns={[
          { key: "name", header: "Name", render: (row) => textValue(row, ["name"]) },
          { key: "cron", header: "Cron", render: (row) => textValue(row, ["cronExpression", "cron"]) },
          { key: "command", header: "Command", render: (row) => textValue(row, ["command"]) },
          { key: "enabled", header: "Enabled", render: (row) => <StatusBadge value={row.enabled ?? "unknown"} /> },
        ]}
        actions={(row, reloadRows) => {
          const scheduleId = idFrom(row, ["scheduleId", "id"])
          return (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void openEdit(row)}><PencilIcon data-icon="inline-start" />Edit</Button>
              <Button variant="outline" size="sm" disabled={!scheduleId} onClick={() => void mutate(() => dokploy("POST", "schedule.runManually", { scheduleId }), "Schedule run started")}><PlayIcon data-icon="inline-start" />Run</Button>
              <ConfirmButton label="Delete" title="Delete schedule?" description="This deletes the selected upstream schedule." disabled={!scheduleId} onConfirm={async () => { await mutate(() => dokploy("POST", "schedule.delete", { scheduleId }), "Schedule deleted", () => { reload(); reloadRows() }) }} />
            </div>
          )
        }}
      />
      <RawResultCard title="Schedule detail" result={detail} />
      <ScheduleDialog draft={draft} setDraft={setDraft} onSaved={reload} />
    </K5Page>
  )
}

function ScheduleDialog({ draft, setDraft, onSaved }: { draft: Draft | null; setDraft: (draft: Draft | null) => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  if (!draft) return null
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const save = async () => {
    setSaving(true)
    const body = {
      scheduleId: draft.scheduleId || undefined,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      cronExpression: draft.cronExpression.trim(),
      command: draft.command.trim(),
      shellType: draft.shellType,
      scheduleType: draft.scheduleType,
      serverId: draft.scheduleType === "server" ? draft.serverId || null : null,
      enabled: draft.enabled,
      script: null,
      applicationId: null,
      composeId: null,
      organizationId: null,
      serviceName: null,
      timezone: null,
    }
    const result = await mutate(() => dokploy("POST", draft.scheduleId ? "schedule.update" : "schedule.create", body), draft.scheduleId ? "Schedule updated" : "Schedule created", onSaved)
    if (result.ok) setDraft(null)
    setSaving(false)
  }
  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft.scheduleId ? "Edit schedule" : "Create schedule"}</DialogTitle>
          <DialogDescription>Creates or updates a real Dokploy schedule for Dokploy server or one remote server.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} />
          <TextField label="Cron expression" value={draft.cronExpression} onChange={(cronExpression) => set({ cronExpression })} />
          <Field>
            <FieldLabel>Command</FieldLabel>
            <Textarea value={draft.command} onChange={(event) => set({ command: event.target.value })} rows={5} />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Input value={draft.description} onChange={(event) => set({ description: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel>Shell</FieldLabel>
            <Select value={draft.shellType} onValueChange={(shellType) => set({ shellType: shellType === "sh" ? "sh" : "bash" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="bash">bash</SelectItem><SelectItem value="sh">sh</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Enabled</FieldLabel>
            <div className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
              <span className="text-sm text-muted-foreground">Disable honestly when upstream schedule should stay defined but not run.</span>
            </div>
          </Field>
          {draft.scheduleType === "server" ? (
            <Field>
              <FieldLabel>Server ID</FieldLabel>
              <Input value={draft.serverId} onChange={(event) => set({ serverId: event.target.value })} />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
          <Button disabled={saving || !draft.name.trim() || !draft.cronExpression.trim() || !draft.command.trim() || (draft.scheduleType === "server" && !draft.serverId.trim())} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
