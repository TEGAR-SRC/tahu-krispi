// Ticket thread page (/app/tickets/:ticketId): conversation view for one
// ticket of the active organization, reply with optional attachments (≤10
// files, 100 MB total, 100 MB per file) with upload progress, presigned
// attachment download and close-with-confirm. The ticket itself is resolved
// by matching the id in the organization's ticket list because the API has
// no single-ticket GET.
// Chat UI tokens (bubble, scroll, attachment, progress, composer) are kept
// identical to the staff consoles (admin + NOC) via the same class set and
// formatting helpers.
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  ChevronRightIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { API_BASE, apiGet, apiPost, getToken, ApiError } from "@/lib/api"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { orgHeaders, useOrg } from "../useOrg"
import { uploadMultipart } from "../upload"

interface TicketRow {
  id: string
  ticket_number?: string
  subject: string
  category?: string
  status: string
  priority?: string
  created_at?: string
  last_reply_at?: string
}

interface AttachmentView {
  id: string
  filename: string
  size_bytes: number
  content_type?: string
}

interface MessageRow {
  id: string
  author_type: string
  author_user_id?: string
  body: string
  created_at?: string
  attachments?: AttachmentView[]
}

const MAX_FILES = 10
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Chat visual tokens – MUST stay in sync with console-admin TicketChat.tsx
// ---------------------------------------------------------------------------
const MESSAGE_BASE_CLASS = "rounded-lg border p-3"
const ATTACHMENT_LIST_CLASS = "mt-2 space-y-1 border-t pt-2"
const FILE_PILL_CLASS =
  "flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
const COMPOSER_CLASS = "space-y-2 rounded-lg border p-3"

function messageVariantClass(authorType: string): string {
  const t = authorType.toLowerCase()
  if (t === "internal_note") return "border-amber-500/30 bg-amber-500/5"
  if (t === "staff" || t === "support") return "border-primary/20 bg-primary/5"
  if (t === "customer") return "bg-muted/50"
  return ""
}

function authorLabel(authorType: string): string {
  const t = authorType.toLowerCase()
  if (t === "customer") return "You"
  if (t === "staff" || t === "support") return "Support"
  if (t === "internal_note") return "internal note"
  return authorType || "—"
}

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

function formatChatDateTime(raw?: string | null): string {
  const parsed = parseApiDate(raw)
  if (parsed) return parsed.toLocaleString()
  if (!raw) return "—"
  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? raw : fallback.toLocaleString()
}

function formatChatBytes(bytes?: number | null): string {
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

export default function CustomerTicketThreadPage() {
  const { ticketId = "" } = useParams()
  const { orgId } = useOrg()
  const [ticket, setTicket] = useState<TicketRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [body, setBody] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!orgId || !ticketId) return
    try {
      // No single-ticket endpoint: find it inside the org's ticket list.
      const [ticketsRes, messagesRes] = await Promise.all([
        apiGet<TicketRow[]>("/tickets", { headers: orgHeaders(orgId) }),
        apiGet<MessageRow[]>(`/tickets/${ticketId}/messages`, {
          headers: orgHeaders(orgId),
        }),
      ])
      const matched = (ticketsRes.data ?? []).find((row) => row.id === ticketId)
      if (!matched) {
        throw new ApiError("not_found", "Ticket not found in this organization", 404)
      }
      setTicket(matched)
      setMessages(messagesRes.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, ticketId])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          await load()
        } catch {
          if (!cancelled) setError(null)
        }
      })()
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [load])

  const pickFiles = useCallback((selected: File[]) => {
    if (selected.length === 0) return
    setFiles((current) => {
      const merged = [...current, ...selected].slice(0, MAX_FILES)
      if (current.length + selected.length > MAX_FILES) {
        toast.error(`At most ${MAX_FILES} files per message`)
      }
      for (const f of merged) {
        if (f.size > MAX_FILE_BYTES) {
          toast.error(`"${f.name}" exceeds the 100 MB per-file cap`)
          return current
        }
      }
      if (merged.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
        toast.error("Attachments exceed the 100 MB total size cap")
        return current
      }
      return merged
    })
  }, [])

  const send = async () => {
    if (!body.trim()) {
      toast.error("Write a reply first")
      return
    }
    if (files.length > MAX_FILES) {
      toast.error(`At most ${MAX_FILES} files per message`)
      return
    }
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`"${file.name}" exceeds the 100 MB per-file cap`)
        return
      }
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      toast.error("Attachments exceed the 100 MB total size cap")
      return
    }
    setPercent(0)
    try {
      if (files.length > 0) {
        const form = new FormData()
        form.append("body", body.trim())
        for (const file of files) form.append("files", file)
        await uploadMultipart(
          `/tickets/${ticketId}/messages/attachments`,
          form,
          setPercent,
        )
      } else {
        await apiPost(`/tickets/${ticketId}/messages`, { body: body.trim() }, {
          headers: orgHeaders(orgId),
        })
      }
      setBody("")
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ""
      toast.success("Reply sent")
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to send reply")
    } finally {
      setPercent(null)
    }
  }

  const closeTicket = async () => {
    try {
      await apiPost(`/tickets/${ticketId}/close`, {}, { headers: orgHeaders(orgId) })
      toast.success("Ticket closed")
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to close ticket")
    }
  }

  const downloadAttachment = async (messageId: string, attachment: AttachmentView) => {
    try {
      const response = await fetch(
        `${API_BASE}/tickets/${ticketId}/messages/${messageId}/attachments/${attachment.id}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      )
      if (!response.ok) throw new Error(`Download failed (${response.status})`)
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as {
          url?: string
          data?: { url?: string }
        }
        const url = payload.data?.url ?? payload.url
        if (!url) throw new Error("No download link returned")
        window.open(url, "_blank", "noopener,noreferrer")
        return
      }
      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") ?? ""
      const match = /filename="?([^";]+)"?/.exec(disposition)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = match?.[1] ?? attachment.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Attachment download failed")
    }
  }

  const closed = ticket?.status === "closed"

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/app/tickets">Support tickets</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <ChevronRightIcon />
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>
              #{ticket?.ticket_number || ticketId.slice(0, 8)}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {loading ? (
        <>
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 w-full" />
        </>
      ) : error ? (
        <>
          <ErrorBanner error={error} />
          <Button variant="outline" asChild>
            <Link to="/app/tickets">Back to tickets</Link>
          </Button>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {ticket?.subject}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                #{ticket?.ticket_number ?? ticketId.slice(0, 8)}
                {ticket?.category ? ` · ${ticket.category}` : ""}
                {ticket?.priority ? ` · ${ticket.priority}` : ""}
                {ticket?.created_at ? ` · opened ${formatChatDateTime(ticket.created_at)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {ticket ? <StatusBadge status={ticket.status} /> : null}
              {!closed && ticket ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      Close ticket
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Close this ticket?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The conversation becomes read-only. Open a new ticket for further
                        issues.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void closeTicket()}>
                        Close ticket
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          </div>

          {/* Conversation */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <ScrollArea className="-mx-1 max-h-[52vh] px-1">
                <div className="space-y-3 pr-2">
                  {messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No messages yet.
                    </p>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`${MESSAGE_BASE_CLASS} ${messageVariantClass(message.author_type)}`}
                      >
                        <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium capitalize text-foreground">
                            {authorLabel(message.author_type)}
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
                                  onClick={() =>
                                    void downloadAttachment(message.id, attachment)
                                  }
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

              {closed ? (
                <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  This ticket is closed and read-only. Open a new ticket for further
                  questions.
                </p>
              ) : (
                <div className={COMPOSER_CLASS}>
                  <Textarea
                    rows={3}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Write a reply…"
                  />
                  {files.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {files.map((file, index) => (
                        <li
                          key={`${file.name}-${index}`}
                          className={FILE_PILL_CLASS}
                        >
                          <PaperclipIcon className="size-3 shrink-0" />
                          {file.name} ({formatChatBytes(file.size)})
                          <button
                            type="button"
                            aria-label={`Remove ${file.name}`}
                            disabled={percent !== null}
                            onClick={() => setFiles(files.filter((_, i) => i !== index))}
                            className="rounded-full p-0.5 hover:bg-background disabled:opacity-50"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {percent !== null ? (
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Uploading…</span>
                      <Progress value={percent} className="h-1 flex-1" />
                      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                        {percent}%
                      </span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,video/*,text/*,.pdf,.zip,.log"
                        className="hidden"
                        onChange={(event) => pickFiles(Array.from(event.target.files ?? []))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={percent !== null}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <PaperclipIcon /> Attach files
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        ≤ {MAX_FILES} files, 100 MB total
                      </span>
                    </div>
                    <Button size="sm" onClick={() => void send()} disabled={percent !== null || !body.trim()}>
                      {percent !== null ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <SendIcon className="size-4" />
                      )}
                      Send
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
