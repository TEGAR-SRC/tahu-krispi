// Shared ticket chat primitives – consistent across admin & NOC consoles.
// Keeps message bubble, scroll, attachment, progress and composer styling
// identical so staff experiences do not diverge. Mirrors the customer chat
// in console-user via the same class tokens.
import { PaperclipIcon, XIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { RefObject } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TicketChatAttachment {
  id: string
  filename: string
  size_bytes: number
  content_type?: string
}

export interface TicketChatMessage {
  id: string
  author_type: string
  author_user_id?: string
  body: string
  created_at?: string | null
  attachments?: TicketChatAttachment[]
}

// ---------------------------------------------------------------------------
// Formatting – single source of truth for chat timestamps & byte sizes
// ---------------------------------------------------------------------------
function parseApiDate(raw?: string | null): Date | null {
  if (!raw) return null
  const text = raw.trim()
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2}(?::?\d{2})?|Z)?$/.exec(
      text,
    )
  if (!match) {
    const fallback = new Date(text)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  const [, datePart, timePart, rawOffset] = match
  let offset = ""
  if (rawOffset && rawOffset !== "Z") {
    const sign = rawOffset.startsWith("-") ? "-" : "+"
    const digits = rawOffset.replace(/[+-]/g, "").replace(":", "")
    offset = `${sign}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`
  }
  const [hms, fraction] = timePart.split(".")
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : ""
  const parsed = new Date(`${datePart}T${hms}${millis}${offset || "Z"}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatChatDateTime(raw?: string | null): string {
  const parsed = parseApiDate(raw)
  if (parsed) return parsed.toLocaleString()
  if (!raw) return "—"
  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? raw : fallback.toLocaleString()
}

export function formatChatBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—"
  if (bytes <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

// ---------------------------------------------------------------------------
// Visual tokens – keep bubble / scroll / composer identical everywhere
// ---------------------------------------------------------------------------
export const CHAT_SCROLL_AREA_CLASS = "-mx-1 max-h-[52vh] px-1"
export const CHAT_THREAD_INNER_CLASS = "space-y-3 pr-2"
export const MESSAGE_BASE_CLASS = "rounded-lg border p-3"
export const ATTACHMENT_LIST_CLASS = "mt-2 space-y-1 border-t pt-2"
export const FILE_PILL_CLASS =
  "flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
export const COMPOSER_CLASS = "space-y-2 rounded-lg border p-3"
export const PROGRESS_ROW_CLASS = "flex min-w-0 items-center gap-2 text-xs"

export function messageVariantClass(authorType: string): string {
  const t = authorType.toLowerCase()
  if (t === "internal_note") return "border-amber-500/30 bg-amber-500/5"
  if (t === "staff" || t === "support") return "border-primary/20 bg-primary/5"
  if (t === "customer") return "bg-muted/50"
  return ""
}

export function authorLabel(
  authorType: string,
  opts?: { viewer?: "customer" | "staff" },
): string {
  const t = authorType.toLowerCase()
  if (t === "internal_note") return "internal note"
  if (t === "customer") return opts?.viewer === "customer" ? "You" : "customer"
  if (t === "staff") return "staff"
  if (t === "support") return "Support"
  return authorType || "—"
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------
export function TicketChatThread({
  messages,
  onDownloadAttachment,
  emptyText = "No messages yet.",
  viewer = "staff",
}: {
  messages: TicketChatMessage[]
  onDownloadAttachment: (messageId: string, attachment: TicketChatAttachment) => void
  emptyText?: string
  viewer?: "customer" | "staff"
}) {
  return (
    <ScrollArea className={CHAT_SCROLL_AREA_CLASS}>
      <div className={CHAT_THREAD_INNER_CLASS}>
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`${MESSAGE_BASE_CLASS} ${messageVariantClass(message.author_type)}`}
            >
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium capitalize text-foreground">
                  {authorLabel(message.author_type, { viewer })}
                </span>
                <span>{formatChatDateTime(message.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{message.body}</p>
              {(message.attachments?.length ?? 0) > 0 ? (
                <ul className={ATTACHMENT_LIST_CLASS}>
                  {(message.attachments ?? []).map((attachment) => (
                    <li key={attachment.id}>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-1.5 text-xs text-primary hover:underline"
                        onClick={() => onDownloadAttachment(message.id, attachment)}
                      >
                        <PaperclipIcon className="size-3 shrink-0" />
                        {attachment.filename} ({formatChatBytes(attachment.size_bytes)})
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  )
}

// ---------------------------------------------------------------------------
// File pills + progress (shared visual)
// ---------------------------------------------------------------------------
export function TicketFilePills({
  files,
  onRemove,
  disabled,
}: {
  files: File[]
  onRemove: (index: number) => void
  disabled?: boolean
}) {
  if (files.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`} className={FILE_PILL_CLASS}>
          <PaperclipIcon className="size-3 shrink-0" />
          {file.name} ({formatChatBytes(file.size)})
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(index)}
            className="rounded-full p-0.5 hover:bg-background disabled:opacity-50"
          >
            <XIcon className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function TicketUploadProgress({
  files,
  percents,
}: {
  files: File[]
  percents: number[] | null
}) {
  if (percents === null) return null
  return (
    <ul className="space-y-1">
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`} className={PROGRESS_ROW_CLASS}>
          <span className="min-w-0 w-40 truncate text-muted-foreground">{file.name}</span>
          <Progress value={percents[index] ?? 0} className="h-1 flex-1" />
          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
            {percents[index] ?? 0}%
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TicketSingleProgress({ percent }: { percent: number | null }) {
  if (percent === null) return null
  return (
    <div className={PROGRESS_ROW_CLASS}>
      <span className="text-muted-foreground">Uploading…</span>
      <Progress value={percent} className="h-1 flex-1" />
      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composer – consistent textarea + attach + send + optional internal-note
// ---------------------------------------------------------------------------
export function TicketReplyComposer({
  body,
  onBodyChange,
  files,
  onFilesChange,
  fileInputRef,
  percents,
  singlePercent,
  sending,
  onSend,
  onPickFiles,
  maxFilesHint = "≤ 10 files, 100 MB total",
  internalNote,
  onInternalNoteChange,
  showInternalNote = false,
  textareaId,
  textareaPlaceholder = "Write a reply…",
  sendLabel = "Send",
  sendingLabel = "Sending…",
}: {
  body: string
  onBodyChange: (v: string) => void
  files: File[]
  onFilesChange: (next: File[]) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  percents?: number[] | null
  singlePercent?: number | null
  sending: boolean
  onSend: () => void
  onPickFiles: (selected: File[]) => void
  maxFilesHint?: string
  internalNote?: boolean
  onInternalNoteChange?: (v: boolean) => void
  showInternalNote?: boolean
  textareaId?: string
  textareaPlaceholder?: string
  sendLabel?: string
  sendingLabel?: string
}) {
  const hasPerFile = percents !== undefined
  return (
    <div className={COMPOSER_CLASS}>
      <Textarea
        id={textareaId}
        rows={3}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder={textareaPlaceholder}
      />
      <TicketFilePills
        files={files}
        disabled={sending}
        onRemove={(index) => onFilesChange(files.filter((_, i) => i !== index))}
      />
      {hasPerFile ? (
        <TicketUploadProgress files={files} percents={percents ?? null} />
      ) : (
        <TicketSingleProgress percent={singlePercent ?? null} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {showInternalNote ? (
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <Checkbox
                checked={internalNote ?? false}
                onCheckedChange={(v) => onInternalNoteChange?.(v === true)}
              />
              Internal note
            </label>
          ) : null}
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,text/*,.pdf,.zip,.log"
            className="hidden"
            onChange={(event) => onPickFiles(Array.from(event.target.files ?? []))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon /> Attach files
          </Button>
          <span className="text-xs text-muted-foreground">{maxFilesHint}</span>
        </div>
        <Button size="sm" disabled={sending || !body.trim()} onClick={onSend}>
          {sending ? null : null}
          {sending ? sendingLabel : showInternalNote && internalNote ? "Add note" : sendLabel}
        </Button>
      </div>
    </div>
  )
}
