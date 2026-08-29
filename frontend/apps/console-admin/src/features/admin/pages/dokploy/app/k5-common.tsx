/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  EyeIcon,
  FileTextIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dokploy, toErrorMessage, useUpstream } from "./shared"

export type Row = Record<string, unknown>
export type Query = Record<string, string | number | undefined>
export type Loader<T = unknown> = () => Promise<T>

export function rowsFrom(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter(isRow)
  if (!isRow(value)) return []
  for (const key of ["data", "result", "items", "rows", "deployments", "schedules", "containers", "images", "volumes", "networks", "nodes", "services", "backups", "domains"]) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested.filter(isRow)
  }
  return [value]
}

export function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function textValue(row: Row, keys: string[], fallback = "—") {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== "") return String(value)
  }
  return fallback
}

export function boolValue(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      if (["true", "enabled", "running", "active"].includes(value.toLowerCase())) return true
      if (["false", "disabled", "stopped", "inactive"].includes(value.toLowerCase())) return false
    }
  }
  return false
}

export function idFrom(row: Row, keys: string[]) {
  return textValue(row, keys, "")
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export async function mutate(loader: Loader, success: string, onDone?: () => void) {
  try {
    const result = await loader()
    toast.success(success)
    if (onDone) onDone()
    return { ok: true, result }
  } catch (cause) {
    toast.error(toErrorMessage(cause))
    return { ok: false, result: cause }
  }
}

export function DisabledOpCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Operation absent from Dokploy v0.30.2</AlertTitle>
          <AlertDescription>This UI is intentionally disabled instead of faking data.</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

export function ServerSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const servers = useUpstream<Row[]>(() => dokploy<Row[]>("GET", "server.all"), [])
  const rows = rowsFrom(servers.data)
  return (
    <Field>
      <FieldLabel>Server</FieldLabel>
      <Select value={value || "local"} onValueChange={(next) => onChange(next === "local" ? "" : next)}>
        <SelectTrigger>
          <SelectValue placeholder="Dokploy server" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="local">Dokploy server</SelectItem>
            {rows.map((row, index) => {
              const id = idFrom(row, ["serverId", "id"])
              if (!id) return null
              return (
                <SelectItem key={id || index} value={id}>
                  {textValue(row, ["name", "ipAddress", "serverId"])}
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      {servers.error ? <FieldDescription>{toErrorMessage(servers.error)}</FieldDescription> : null}
    </Field>
  )
}

export function ResourceTable({
  title,
  description,
  loader,
  columns,
  emptyMessage,
  reloadKey = "",
}: {
  title: string
  description?: string
  loader: Loader<unknown>
  columns?: Array<SimpleColumn<Row>>
  emptyMessage?: string
  reloadKey?: string | number
}) {
  const upstream = useUpstream<unknown>(loader, [reloadKey])
  const rows = useMemo(() => rowsFrom(upstream.data), [upstream.data])
  const tableColumns = columns ?? defaultColumns(rows)
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex w-full max-w-full min-w-0 flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <Button variant="outline" size="sm" onClick={upstream.reload} disabled={upstream.loading}>
            {upstream.loading ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={tableColumns}
          rows={rows}
          loading={upstream.loading}
          error={upstream.error ? new Error(toErrorMessage(upstream.error)) : undefined}
          emptyMessage={emptyMessage ?? `No ${title.toLowerCase()} returned by upstream.`}
          getRowKey={(row, index) => textValue(row, ["id", "name", "containerId", "scheduleId", "domainId", "serverId"], String(index))}
        />
      </CardContent>
    </Card>
  )
}

export function OperationConsole({
  title,
  description,
  loader,
  serverId,
  actions,
  columns,
  emptyMessage,
  reloadKey = "",
}: {
  title: string
  description?: string
  loader: (query: Query) => Promise<unknown>
  serverId?: string
  actions?: (row: Row, reload: () => void) => React.ReactNode
  columns?: Array<SimpleColumn<Row>>
  emptyMessage?: string
  reloadKey?: string | number
}) {
  const upstream = useUpstream<unknown>(() => loader({ serverId }), [serverId, reloadKey])
  const rows = useMemo(() => rowsFrom(upstream.data), [upstream.data])
  const tableColumns = columns ?? defaultColumns(rows)
  const finalColumns = actions
    ? [
        ...tableColumns,
        { key: "actions", header: "Actions", render: (row: Row) => actions(row, upstream.reload), className: "text-right" },
      ]
    : tableColumns
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full max-w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex w-full max-w-full min-w-0 flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <Button variant="outline" size="sm" onClick={upstream.reload} disabled={upstream.loading}>
            {upstream.loading ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <SimpleDataTable
          columns={finalColumns}
          rows={rows}
          loading={upstream.loading}
          error={upstream.error ? new Error(toErrorMessage(upstream.error)) : undefined}
          emptyMessage={emptyMessage ?? `No ${title.toLowerCase()} returned by upstream.`}
          getRowKey={(row, index) => textValue(row, ["id", "ID", "Name", "name", "containerId", "scheduleId", "domainId"], String(index))}
        />
      </CardContent>
    </Card>
  )
}

export function ConfirmButton({
  label,
  title,
  description,
  variant = "destructive",
  disabled = false,
  onConfirm,
}: {
  label: string
  title: string
  description: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  disabled?: boolean
  onConfirm: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    await onConfirm()
    setBusy(false)
    setOpen(false)
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size="sm" disabled={disabled || busy} onClick={() => setOpen(true)}>
        {busy ? <Spinner /> : <Trash2Icon data-icon="inline-start" />}
        {label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void confirm() }}>
            {busy ? "Working…" : "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function RawResultCard({ title, result }: { title: string; result: unknown }) {
  if (result === null || result === undefined) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <JsonBlock value={result} />
      </CardContent>
    </Card>
  )
}

export function K5Page({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  )
}

export function InspectButton({ row }: { row: Row }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
        <EyeIcon data-icon="inline-start" />
        {open ? "Hide" : "Inspect"}
      </Button>
      {open ? <JsonBlock value={row} /> : null}
    </>
  )
}

export function StatusBadge({ value }: { value: unknown }) {
  const text = value === undefined || value === null || value === "" ? "unknown" : String(value)
  const lower = text.toLowerCase()
  const variant = lower.includes("running") || lower.includes("active") || lower.includes("healthy") || lower === "true" ? "default" : "secondary"
  return <Badge variant={variant}>{text}</Badge>
}

export function defaultColumns(rows: Row[]): Array<SimpleColumn<Row>> {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !Array.isArray(rows[0]?.[key]) && typeof rows[0]?.[key] !== "object")
    .slice(0, 6)
  const usable = keys.length ? keys : ["value"]
  return usable.map((key) => ({
    key,
    header: key,
    render: (row) => {
      if (key === "value") return <JsonBlock value={row} />
      const value = row[key]
      if (typeof value === "boolean") return <StatusBadge value={value} />
      return value === undefined || value === null || value === "" ? "—" : String(value)
    },
  }))
}

export function TextField({ label, value, onChange, placeholder, description }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; description?: string }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

export function TextAreaField({ label, value, onChange, placeholder, rows = 10 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Textarea value={value} placeholder={placeholder} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

export function ToggleField({ label, description, checked, disabled, onCheckedChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <div className="flex w-full max-w-full min-w-0 flex-col gap-1">
        <FieldLabel>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </Field>
  )
}

export function FieldCard({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <FieldGroup>{children}</FieldGroup>
      </CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  )
}

export function buttonAction(icon: "play" | "stop" | "file", label: string) {
  const Icon = icon === "play" ? PlayIcon : icon === "stop" ? SquareIcon : FileTextIcon
  return (
    <>
      <Icon data-icon="inline-start" />
      {label}
    </>
  )
}

export function ErrorCard({ error }: { error: unknown }) {
  return <ErrorBanner error={error instanceof Error ? error : new Error(toErrorMessage(error))} />
}
