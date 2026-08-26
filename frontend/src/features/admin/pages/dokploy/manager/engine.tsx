// Shared engine for the Dokploy upstream consoles. Every console talks to the
// universal proxy `{METHOD} /api/v1/dokploy/{tag.method}`, which relays to the
// live Dokploy server. Responses are NOT platform-enveloped — success payloads
// and error bodies arrive verbatim — so this engine uses raw fetch (same
// pattern as the explorer on DokployHub) instead of the api.ts helpers whose
// ApiError would discard exactly the upstream detail these consoles exist to
// surface. Consoles stay declarative: they describe their operations and
// fields; the engine renders breadcrumbs, toolbar, table, dialogs, confirms,
// response drawer and upstream-error banner around them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  UpstreamError,
  dokployCall,
  extractRows,
  isRecord,
  loadDokployDefaults,
  upstreamMessage,
  type UpstreamResult,
} from "./upstream"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/shared/EmptyState"

// ---- Types -------------------------------------------------------------------

export type DokployMethod = "GET" | "POST"

/** One row from an upstream list payload. */
export type Row = Record<string, unknown>

export interface DynOption {
  label: string
  value: string
}

export type FieldKind =
  | "text"
  | "number"
  | "password"
  | "multiline"
  | "select"
  | "switch"

export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  /** Static choices for kind="select". */
  options?: readonly string[]
  /** Lazily-loaded choices for kind="select" (e.g. environments, applications). */
  dynamicOptions?: () => Promise<DynOption[]>
  placeholder?: string
  hint?: string
  /**
   * Send the key with an empty string even when untouched. Needed for
   * upstream schemas where the property itself is nonoptional (zod reports
   * "expected nonoptional" when the key is absent).
   */
  sendEmpty?: boolean
  /** Prefill for create dialogs (applied when the loader yields a value). */
  defaultValue?: string
  /**
   * Hidden field auto-filled from the selected row on update/action ops
   * (e.g. projectId, appName) instead of rendered as an input.
   */
  fromRow?: boolean
}

export type OpRole = "list" | "create" | "update" | "action"

export interface OpSpec {
  key: string
  label: string
  method: DokployMethod
  /** Proxy operation path, e.g. "project.remove". */
  path: string
  role: OpRole
  /** Dialog inputs for create/update; hidden fromRow params for actions. */
  fields?: FieldSpec[]
  /** Ask for confirmation before sending (AlertDialog with request preview). */
  confirm?: boolean
  /** Destructive styling + stronger warning copy on the confirm step. */
  destructive?: boolean
  successMessage?: string
  /**
   * Query params the list op requires (e.g. applicationId). Rendered as
   * toolbar controls; required ones gate loading until filled.
   */
  queryFields?: FieldSpec[]
}

export interface ConsoleColumn {
  key: string
  label: string
  mono?: boolean
  /** Custom cell renderer; defaults to compact scalar/object formatting. */
  render?: (row: Row) => ReactNode
}

export interface DokployConsoleSpec {
  title: string
  description?: string
  /** Singular noun used in empty states and toasts, e.g. "project". */
  entityLabel: string
  /** Primary id key used to identify rows (projectId, sshKeyId, …). */
  rowIdKey: string
  columns: ConsoleColumn[]
  /** Keys searched by the client-side filter box. */
  searchKeys: string[]
  listOp: OpSpec
  createOp?: OpSpec
  updateOp?: OpSpec
  rowActions?: OpSpec[]
  /** Extra hint shown when the upstream list is empty. */
  emptyHint?: string
}

/**
 * Maps a relayed upstream zod validation error onto `{ field: message }` so
 * forms can highlight the offending inputs.
 */
function extractFieldErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(body)) return out

  const zod = body["zodError"]
  const nested = isRecord(zod) ? zod["fieldErrors"] : undefined
  if (isRecord(nested)) {
    for (const [key, messages] of Object.entries(nested)) {
      if (Array.isArray(messages) && messages.length > 0) {
        out[key] = messages.map(String).join("; ")
      }
    }
  }

  const issues = body["issues"]
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (!isRecord(issue)) continue
      const path = issue["path"]
      const key = Array.isArray(path) && path.length > 0 ? String(path[0]) : ""
      const message = issue["message"]
      if (key !== "" && typeof message === "string" && !(key in out)) {
        out[key] = message
      }
    }
  }
  return out
}

// ---- Cell formatting -----------------------------------------------------------

function formatCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    const json = JSON.stringify(value)
    return json.length > 60 ? `${json.slice(0, 57)}…` : json
  } catch {
    return String(value)
  }
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" || value === "") return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatCell(value)
  return date.toLocaleString()
}

/** Colored badge for upstream lifecycle statuses (idle/running/done/error…). */
export function StatusBadge({ value }: { value: unknown }) {
  const status = typeof value === "string" && value !== "" ? value : null
  if (status === null) return <span className="text-muted-foreground">—</span>
  const tone =
    status === "running" || status === "done"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "error"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground"
  return (
    <Badge variant="secondary" className={cn("font-mono text-[11px]", tone)}>
      {status}
    </Badge>
  )
}

// ---- Body building -------------------------------------------------------------

type FormValues = Record<string, string>

function initialValuesFor(op: OpSpec, mode: "create" | "update", row: Row | null): FormValues {
  const values: FormValues = {}
  for (const field of op.fields ?? []) {
    if (field.fromRow) continue
    if (mode === "update" && row !== null) {
      const raw = row[field.key]
      if (field.kind === "switch") {
        values[field.key] = raw === true || raw === "true" ? "true" : "false"
      } else if (raw !== undefined && raw !== null && typeof raw !== "object") {
        values[field.key] = String(raw)
      } else {
        values[field.key] = ""
      }
    } else {
      values[field.key] =
        field.kind === "switch"
          ? (field.defaultValue ?? "false")
          : (field.defaultValue ?? "")
    }
  }
  return values
}

function validateValues(op: OpSpec, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of op.fields ?? []) {
    if (field.fromRow) continue
    const raw = (values[field.key] ?? "").trim()
    if (field.kind === "switch") continue
    if (field.required && raw === "") {
      errors[field.key] = `${field.label} is required.`
      continue
    }
    if (field.kind === "number" && raw !== "") {
      if (!Number.isFinite(Number(raw))) {
        errors[field.key] = `${field.label} must be a number.`
      }
    }
  }
  return errors
}

function buildBody(op: OpSpec, values: FormValues, row: Row | null): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const field of op.fields ?? []) {
    if (field.fromRow) {
      const raw = row?.[field.key]
      if (raw !== undefined && raw !== null) body[field.key] = String(raw)
      continue
    }
    const value = values[field.key] ?? ""
    switch (field.kind) {
      case "switch":
        body[field.key] = value === "true"
        break
      case "number":
        if (value.trim() !== "") body[field.key] = Number(value.trim())
        break
      case "select":
        if (value !== "") body[field.key] = value
        break
      case "text":
      case "password":
      case "multiline":
        if (field.kind === "multiline") {
          if (value !== "") body[field.key] = value
        } else if (value.trim() !== "") {
          body[field.key] = value.trim()
        } else if (field.sendEmpty) {
          body[field.key] = ""
        }
        break
    }
    // Multiline keeps inner newlines; sendEmpty covers nonoptional empties.
    if (
      field.kind === "multiline" &&
      value === "" &&
      field.sendEmpty &&
      !(field.key in body)
    ) {
      body[field.key] = ""
    }
  }
  return body
}

function buildQueryString(op: OpSpec, values: FormValues, row: Row | null): Record<string, string> {
  const query: Record<string, string> = {}
  for (const field of op.fields ?? []) {
    if (!field.fromRow) continue
    const raw = row?.[field.key]
    if (raw !== undefined && raw !== null) query[field.key] = String(raw)
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== "") query[key] = value
  }
  return query
}

// ---- Small building blocks -------------------------------------------------------

function LiveChip() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-500/50 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400"
    >
      <TriangleAlertIcon />
      live upstream
    </Badge>
  )
}

function PrettyJson({ text }: { text: string }) {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    pretty = text
  }
  return (
    <pre className="max-h-full overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
      {pretty === "" ? "(empty response body)" : pretty}
    </pre>
  )
}

interface ResponseDrawerProps {
  title: string
  result: UpstreamResult | null
  onClose: () => void
}

function ResponseDrawer({ title, result, onClose }: ResponseDrawerProps) {
  return (
    <Sheet open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {result
              ? `HTTP ${result.status} · ${result.text.length.toLocaleString()} bytes · ${result.durationMs} ms — raw upstream payload`
              : ""}
          </SheetDescription>
        </SheetHeader>
        {result ? <PrettyJson text={result.text} /> : null}
      </SheetContent>
    </Sheet>
  )
}

interface UpstreamErrorBannerProps {
  title: string
  result: UpstreamResult
  onDismiss: () => void
}

function UpstreamErrorBanner({ title, result, onDismiss }: UpstreamErrorBannerProps) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <div className="flex flex-1 flex-col gap-1">
        <AlertTitle>
          {title} — HTTP {result.status}: {upstreamMessage(result.status, result.body, result.text)}
        </AlertTitle>
        <AlertDescription>
          The Dokploy server rejected or failed this request; its verbatim response is below.
        </AlertDescription>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium">Raw upstream body</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(result.text), null, 2)
              } catch {
                return result.text
              }
            })()}
          </pre>
        </details>
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={onDismiss}>
        Dismiss
      </Button>
    </Alert>
  )
}

// ---- Operation dialog ------------------------------------------------------------

interface OpDialogProps {
  op: OpSpec
  mode: "create" | "update"
  row: Row | null
  /** Toolbar values reused to seed matching fields (e.g. applicationId). */
  seeds: FormValues
  running: boolean
  fieldErrors: Record<string, string>
  onRun: (values: FormValues) => void
  onCancel: () => void
}

function OpDialog({
  op,
  mode,
  row,
  seeds,
  running,
  fieldErrors,
  onRun,
  onCancel,
}: OpDialogProps) {
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialValuesFor(op, mode, row),
    ...Object.fromEntries(
      Object.entries(seeds).filter(([key]) =>
        (op.fields ?? []).some((field) => field.key === key),
      ),
    ),
  }))
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [dynOptions, setDynOptions] = useState<Record<string, DynOption[]>>({})

  // Load dynamic select options lazily, once per dialog instance.
  const requestedRef = useRef(false)
  useEffect(() => {
    if (requestedRef.current) return
    requestedRef.current = true
    for (const field of op.fields ?? []) {
      if (!field.dynamicOptions) continue
      field
        .dynamicOptions()
        .then((options) => {
          setDynOptions((prev) => ({ ...prev, [field.key]: options }))
          // Prefill defaults (e.g. organizationId) once known.
          return loadDokployDefaults().then((defaults) => {
            setValues((prev) => {
              const next = { ...prev }
              if (
                field.key === "environmentId" &&
                prev.environmentId === "" &&
                options.length > 0
              ) {
                next.environmentId = options[0].value
              }
              if (field.key === "organizationId" && prev.organizationId === "") {
                next.organizationId = defaults.organizationId ?? ""
              }
              return next
            })
          })
        })
        .catch(() => {
          // Options stay unavailable; user can still type/pick later.
        })
    }
  }, [op])

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setLocalErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const visibleFields = (op.fields ?? []).filter((field) => !field.fromRow)

  const submit = () => {
    const errors = validateValues(op, values)
    if (Object.keys(errors).length > 0) {
      setLocalErrors(errors)
      toast.error("Please fix the highlighted fields.")
      return
    }
    onRun(values)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{op.label}</DialogTitle>
          <DialogDescription>
            {mode === "update"
              ? "Submits a POST to the live Dokploy server; omitted optional fields stay unchanged."
              : "Sends a real request to the live Dokploy server."}{" "}
            <span className="font-mono text-[11px]">{op.path}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          {visibleFields.map((field) => {
            const error = localErrors[field.key] ?? fieldErrors[field.key]
            const options = [
              ...(field.options ?? []),
              ...(dynOptions[field.key]
                ?.map((option) => option.value)
                .filter((value) => !(field.options ?? []).includes(value)) ?? []),
            ]
            const optionLabel = (value: string) =>
              dynOptions[field.key]?.find((option) => option.value === value)?.label ?? value
            return (
              <div key={field.key} className="grid gap-2">
                {field.kind === "switch" ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <Label htmlFor={`dk-field-${field.key}`} className="font-normal">
                      {field.label}
                      {field.hint ? (
                        <span className="block text-xs text-muted-foreground">{field.hint}</span>
                      ) : null}
                    </Label>
                    <Switch
                      id={`dk-field-${field.key}`}
                      checked={values[field.key] === "true"}
                      onCheckedChange={(checked) => setValue(field.key, checked ? "true" : "false")}
                    />
                  </div>
                ) : field.kind === "multiline" ? (
                  <>
                    <Label htmlFor={`dk-field-${field.key}`}>
                      {field.label}
                      {field.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Textarea
                      id={`dk-field-${field.key}`}
                      value={values[field.key] ?? ""}
                      onChange={(event) => setValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      aria-invalid={error ? true : undefined}
                      className="min-h-24 font-mono text-xs"
                    />
                  </>
                ) : field.kind === "select" ? (
                  <>
                    <Label htmlFor={`dk-field-${field.key}`}>
                      {field.label}
                      {field.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Select
                      value={values[field.key] ?? ""}
                      onValueChange={(value) => setValue(field.key, value)}
                    >
                      <SelectTrigger
                        id={`dk-field-${field.key}`}
                        aria-invalid={error ? true : undefined}
                      >
                        <SelectValue
                          placeholder={
                            dynOptions[field.key] === undefined && field.dynamicOptions
                              ? "Loading options…"
                              : (field.placeholder ?? "Pick one")
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {options.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No options found upstream.
                          </div>
                        ) : (
                          options.map((value) => (
                            <SelectItem key={value} value={value}>
                              {optionLabel(value)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`dk-field-${field.key}`}>
                      {field.label}
                      {field.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Input
                      id={`dk-field-${field.key}`}
                      type={field.kind === "number" ? "number" : field.kind === "password" ? "password" : "text"}
                      value={values[field.key] ?? ""}
                      onChange={(event) => setValue(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      aria-invalid={error ? true : undefined}
                      autoComplete="off"
                    />
                  </>
                )}
                {field.hint && field.kind !== "switch" ? (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                ) : null}
                {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={running}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={running}>
            {running ? "Sending…" : mode === "update" ? "Save upstream" : "Create upstream"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Confirm step ------------------------------------------------------------------

interface ConfirmState {
  op: OpSpec
  values: FormValues
  row: Row | null
}

function ConfirmDialog({
  state,
  entityLabel,
  running,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState
  entityLabel: string
  running: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { op, values, row } = state
  const preview =
    op.method === "POST"
      ? JSON.stringify(buildBody(op, values, row), null, 2)
      : new URLSearchParams(buildQueryString(op, values, row)).toString()

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {op.destructive ? `Delete this ${entityLabel}?` : op.label}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {op.destructive
              ? `This runs ${op.method} ${op.path} against the live Dokploy server and cannot be undone there.`
              : `This runs ${op.method} ${op.path} against the live Dokploy server.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
          {preview === "{}" ? "(no body)" : preview}
        </pre>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={running}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            className={cn(op.destructive && "bg-destructive text-white hover:bg-destructive/90")}
          >
            {running ? "Sending…" : op.destructive ? "Yes, delete" : "Run on upstream"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---- Engine -------------------------------------------------------------------------

const PAGE_SIZE = 10

export function DokployEngine({ spec }: { spec: DokployConsoleSpec }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  // Toolbar query param values (e.g. applicationId selector).
  const [queryValues, setQueryValues] = useState<FormValues>(() => {
    const initial: FormValues = {}
    for (const field of spec.listOp.queryFields ?? []) {
      initial[field.key] = field.kind === "switch" ? "false" : ""
    }
    return initial
  })
  const [queryOptions, setQueryOptions] = useState<Record<string, DynOption[]>>({})
  const [reloadTick, setReloadTick] = useState(0)

  const [dialog, setDialog] = useState<{ op: OpSpec; mode: "create" | "update"; row: Row | null } | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [running, setRunning] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<{ title: string; result: UpstreamResult } | null>(null)
  const [drawer, setDrawer] = useState<{ title: string; result: UpstreamResult } | null>(null)

  const requiredQueryMissing = (spec.listOp.queryFields ?? [])
    .filter((field) => field.required && (queryValues[field.key] ?? "") === "")
    .map((field) => field.label)

  // Resolve dynamic options for toolbar selects once per spec.
  const queryOptionsRequested = useRef(false)
  useEffect(() => {
    if (queryOptionsRequested.current) return
    queryOptionsRequested.current = true
    for (const field of spec.listOp.queryFields ?? []) {
      if (!field.dynamicOptions) continue
      field
        .dynamicOptions()
        .then((options) => {
          setQueryOptions((prev) => ({ ...prev, [field.key]: options }))
          setQueryValues((prev) => {
            if ((prev[field.key] ?? "") !== "" || options.length === 0) return prev
            return { ...prev, [field.key]: options[0].value }
          })
        })
        .catch(() => {
          // Leave the control editable-empty; the banner will explain failures.
        })
    }
  }, [spec])

  const load = useCallback(async () => {
    if (requiredQueryMissing.length > 0) {
      setRows([])
      setListError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setListError(null)
    try {
      const res = await dokployCall(spec.listOp.method, spec.listOp.path, {
        query: queryValues,
      })
      setRows(extractRows(res.body))
    } catch (cause) {
      setListError(
        cause instanceof UpstreamError
          ? `HTTP ${cause.status}: ${upstreamMessage(cause.status, cause.body, cause.text)}`
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
      setRows([])
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, queryValues])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load, reloadTick])

  // Client-side search filter.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === "") return rows
    const haystacks = spec.searchKeys
    return rows.filter((row) =>
      haystacks.some((key) => formatCell(row[key]).toLowerCase().includes(needle)),
    )
  }, [rows, search, spec.searchKeys])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    const t = setTimeout(() => setPage(1), 0)
    return () => clearTimeout(t)
  }, [search, filtered.length])

  // ---- op execution -----------------------------------------------------------------

  const executeOp = useCallback(
    async (op: OpSpec, values: FormValues, row: Row | null, refreshAfter: boolean) => {
      setRunning(true)
      try {
        const res =
          op.method === "POST"
            ? await dokployCall("POST", op.path, { body: buildBody(op, values, row) })
            : await dokployCall("GET", op.path, {
                query: buildQueryString(op, values, row),
              })
        setDrawer({ title: `${op.label} — HTTP ${res.status}`, result: res })
        toast.success(op.successMessage ?? `${op.label} succeeded`)
        if (refreshAfter) setReloadTick((tick) => tick + 1)
        return true
      } catch (cause) {
        if (cause instanceof UpstreamError) {
          setActionError({ title: `${op.label} failed`, result: { status: cause.status, ok: false, durationMs: 0, body: cause.body, text: cause.text } })
          const fieldErrors = extractFieldErrors(cause.body)
          if (Object.keys(fieldErrors).length > 0) setFormErrors(fieldErrors)
          toast.error(`HTTP ${cause.status}: ${upstreamMessage(cause.status, cause.body, cause.text)}`)
        } else {
          toast.error(cause instanceof Error ? cause.message : "Request failed before reaching the backend.")
        }
        return false
      } finally {
        setRunning(false)
      }
    },
    [],
  )

  const runDialog = async (values: FormValues) => {
    if (!dialog) return
    const ok = await executeOp(dialog.op, values, dialog.row, true)
    if (ok) {
      setDialog(null)
      setFormErrors({})
    }
  }

  const runConfirmed = async () => {
    if (!confirmState) return
    const { op, values, row } = confirmState
    const ok = await executeOp(op, values, row, true)
    if (ok) setConfirmState(null)
  }

  /** Fire a row action (with its confirm step when declared). */
  const triggerAction = (op: OpSpec, row: Row) => {
    const values = initialValuesFor(op, "update", row)
    if (op.confirm) {
      setConfirmState({ op, values, row })
      return
    }
    void executeOp(op, values, row, true)
  }

  const rowLabel = (row: Row) => {
    const id = row[spec.rowIdKey]
    return typeof id === "string" && id !== "" ? id : "selected row"
  }

  const hasActions = (spec.updateOp ?? undefined) !== undefined || (spec.rowActions ?? []).length > 0

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/dokploy">Dokploy PaaS</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{spec.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{spec.title}</h1>
          {spec.description ? (
            <p className="text-sm text-muted-foreground">{spec.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LiveChip />
          <Button variant="outline" size="sm" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
          {spec.createOp ? (
            <Button size="sm" onClick={() => { setFormErrors({}); setDialog({ op: spec.createOp!, mode: "create", row: null }) }}>
              {spec.createOp.label}
            </Button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <UpstreamErrorBanner
          title={actionError.title}
          result={actionError.result}
          onDismiss={() => setActionError(null)}
        />
      ) : null}

      {(spec.listOp.queryFields ?? []).length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          {(spec.listOp.queryFields ?? []).map((field) => {
            const options = queryOptions[field.key]
            const merged = [...(field.options ?? [])]
            if (options) {
              for (const option of options) {
                if (!merged.includes(option.value)) merged.push(option.value)
              }
            }
            const label = (value: string) =>
              options?.find((option) => option.value === value)?.label ?? value
            return (
              <div key={field.key} className="grid min-w-56 gap-1.5">
                <Label htmlFor={`dk-query-${field.key}`} className="text-xs text-muted-foreground">
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Select
                  value={queryValues[field.key] ?? ""}
                  onValueChange={(value) => setQueryValues((prev) => ({ ...prev, [field.key]: value }))}
                >
                  <SelectTrigger id={`dk-query-${field.key}`}>
                    <SelectValue
                      placeholder={options === undefined && field.dynamicOptions ? "Loading…" : "Select…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {merged.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Nothing found upstream.</div>
                    ) : (
                      merged.map((value) => (
                        <SelectItem key={value} value={value}>
                          {label(value)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      ) : null}

      {requiredQueryMissing.length > 0 ? (
        <EmptyState
          message={`Choose ${requiredQueryMissing.join(" and ").toLowerCase()} to list ${spec.entityLabel}s.`}
          description="The upstream list operation requires these parameters."
        />
      ) : listError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load {spec.entityLabel}s</AlertTitle>
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Filter ${spec.entityLabel}s…`}
                className="w-64 pl-8"
                aria-label={`Filter ${spec.entityLabel}s`}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              message={`No ${spec.entityLabel}s found upstream.`}
              description={
                rows.length > 0
                  ? "Nothing matches the current filter."
                  : (spec.emptyHint ??
                    (spec.createOp ? `Create the first one with “${spec.createOp.label}”.` : undefined))
              }
            />
          ) : (
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <table className="w-full caption-bottom text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 transition-colors hover:bg-muted/40">
                      {spec.columns.map((column) => (
                        <th
                          key={column.key}
                          className="h-10 px-3 text-left align-middle font-medium text-muted-foreground"
                        >
                          {column.label}
                        </th>
                      ))}
                      {hasActions ? (
                        <th className="h-10 w-12 px-3 text-right align-middle font-medium text-muted-foreground">
                          <span className="sr-only">Actions</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => (
                      <tr
                        key={rowLabel(row)}
                        className="border-b transition-colors last:border-b-0 hover:bg-muted/40"
                      >
                        {spec.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              "px-3 py-2 align-middle",
                              column.mono && "font-mono text-xs",
                            )}
                          >
                            {column.render
                              ? column.render(row)
                              : column.key.endsWith("At")
                                ? formatTimestamp(row[column.key])
                                : formatCell(row[column.key])}
                          </td>
                        ))}
                        {hasActions ? (
                          <td className="px-3 py-2 text-right align-middle">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="Row actions">
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel className="font-mono text-[11px]">
                                  {rowLabel(row)}
                                </DropdownMenuLabel>
                                {spec.updateOp ? (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setFormErrors({})
                                        setDialog({ op: spec.updateOp!, mode: "update", row })
                                      }}
                                    >
                                      Edit…
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                  </>
                                ) : null}
                                {(spec.rowActions ?? []).map((action, index) => (
                                  <DropdownMenuItem
                                    key={`${action.key}-${index}`}
                                    className={cn(action.destructive && "text-destructive focus:text-destructive")}
                                    onClick={() => triggerAction(action, row)}
                                  >
                                    {action.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pageCount > 1 ? (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault()
                      setPage(Math.max(1, safePage - 1))
                    }}
                    aria-disabled={safePage <= 1}
                    className={cn(safePage <= 1 && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
                {Array.from({ length: pageCount }).slice(0, 7).map((_, index) => {
                  const pageNumber = index + 1
                  return (
                    <PaginationItem key={pageNumber}>
                      <PaginationLink
                        href="#"
                        isActive={pageNumber === safePage}
                        onClick={(event) => {
                          event.preventDefault()
                          setPage(pageNumber)
                        }}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  )
                })}
                {pageCount > 7 ? (
                  <PaginationItem>
                    <span className="px-2 text-sm text-muted-foreground">
                      … of {pageCount}
                    </span>
                  </PaginationItem>
                ) : null}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault()
                      setPage(Math.min(pageCount, safePage + 1))
                    }}
                    aria-disabled={safePage >= pageCount}
                    className={cn(safePage >= pageCount && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="flex items-center gap-1 pl-2 text-sm text-muted-foreground">
                    <ChevronLeftIcon className="hidden" />
                    page {safePage}/{pageCount}
                    <ChevronRightIcon className="hidden" />
                  </span>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </>
      )}

      {dialog ? (
        <OpDialog
          key={`${dialog.op.key}-${dialog.mode}-${dialog.row ? rowLabel(dialog.row) : "new"}`}
          op={dialog.op}
          mode={dialog.mode}
          row={dialog.row}
          seeds={queryValues}
          running={running}
          fieldErrors={formErrors}
          onRun={(values) => void runDialog(values)}
          onCancel={() => {
            setDialog(null)
            setFormErrors({})
          }}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          state={confirmState}
          entityLabel={spec.entityLabel}
          running={running}
          onConfirm={() => void runConfirmed()}
          onCancel={() => setConfirmState(null)}
        />
      ) : null}

      <ResponseDrawer
        title={drawer?.title ?? ""}
        result={drawer?.result ?? null}
        onClose={() => setDrawer(null)}
      />
    </div>
  )
}
