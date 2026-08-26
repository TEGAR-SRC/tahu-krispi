// Support tickets: list + creation, threaded conversation view, replies with
// up to 10 attachments (100 MB each, upload progress), attachment download and
// ticket close. Reopen is not exposed by the API.
import { useCallback, useEffect, useRef, useState } from "react"
import {
  LifeBuoyIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { apiGet, apiPost, getToken, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { StatusBadge } from "../components"
import { formatBytes, formatDateTime } from "../format"
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

const PRIORITIES = ["low", "normal", "high", "urgent"] as const

export default function CustomerTicketsPage() {
  const { orgId } = useOrg()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiGet<TicketRow[]>("/tickets", { headers: orgHeaders(orgId) })
      setTickets(data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Support tickets"
        description="Ask us anything — attachments up to 100 MB per file."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New ticket
          </Button>
        }
      />

      <ErrorBanner error={error} />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Ticket list */}
        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
          ) : tickets.length === 0 ? (
            <Card>
              <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
                No tickets yet — open one and we will help.
              </CardContent>
            </Card>
          ) : (
            tickets.map((ticket) => (
              <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className="w-full text-left">
                <Card
                  className={`transition-colors hover:border-primary/40 ${
                    selectedId === ticket.id ? "border-primary" : ""
                  }`}
                >
                  <CardContent className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">{ticket.subject}</p>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>#{ticket.ticket_number ?? ticket.id.slice(0, 8)}</span>
                      {ticket.priority ? <span className="capitalize">{ticket.priority}</span> : null}
                      <span className="ml-auto">{formatDateTime(ticket.last_reply_at || ticket.created_at)}</span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))
          )}
        </div>

        {/* Thread */}
        <div>
          {selectedId ? (
            <TicketThread
              ticketId={selectedId}
              onClosed={() => {
                void load()
              }}
            />
          ) : (
            <Card className="h-full">
              <CardContent className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <LifeBuoyIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Select a ticket on the left to read the conversation.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false)
          void load()
          setSelectedId(id)
        }}
      />
    </div>
  )
}

// ---- Thread -------------------------------------------------------------------

function TicketThread({ ticketId, onClosed }: { ticketId: string; onClosed: () => void }) {
  const { orgId } = useOrg()
  const [ticket, setTicket] = useState<TicketRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [body, setBody] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [percent, setPercent] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const [ticketsRes, messagesRes] = await Promise.all([
        apiGet<TicketRow[]>("/tickets", { headers: orgHeaders(orgId) }),
        apiGet<MessageRow[]>(`/tickets/${ticketId}/messages`, { headers: orgHeaders(orgId) }),
      ])
      setTicket((ticketsRes.data ?? []).find((row) => row.id === ticketId) ?? null)
      setMessages(messagesRes.data ?? [])
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }, [orgId, ticketId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const send = async () => {
    if (!body.trim()) {
      toast.error("Write a reply first")
      return
    }
    if (files.length > 10) {
      toast.error("At most 10 files per message")
      return
    }
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds the 100 MB per-file cap`)
        return
      }
    }
    setPercent(0)
    try {
      if (files.length > 0) {
        const form = new FormData()
        form.append("body", body.trim())
        for (const file of files) form.append("files", file)
        await uploadMultipart(`/tickets/${ticketId}/messages/attachments`, form, setPercent)
      } else {
        await apiPost(
          `/tickets/${ticketId}/messages`,
          { body: body.trim() },
          { headers: orgHeaders(orgId) },
        )
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

  const close = async () => {
    try {
      await apiPost(`/tickets/${ticketId}/close`, {}, { headers: orgHeaders(orgId) })
      toast.success("Ticket closed")
      onClosed()
      await load()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to close ticket")
    }
  }

  const downloadAttachment = async (messageId: string, attachment: AttachmentView) => {
    try {
      const response = await fetch(
        `/api/v1/tickets/${ticketId}/messages/${messageId}/attachments/${attachment.id}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      )
      if (!response.ok) throw new Error(`Download failed (${response.status})`)
      const payload = (await response.json()) as { url?: string }
      if (!payload.url) throw new Error("No link returned")
      window.open(payload.url, "_blank", "noopener,noreferrer")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Attachment download failed")
    }
  }

  const closed = ticket?.status === "closed"

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{ticket?.subject ?? "Ticket"}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            #{ticket?.ticket_number ?? ticketId.slice(0, 8)}
            {ticket?.created_at ? ` · opened ${formatDateTime(ticket.created_at)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ticket ? <StatusBadge status={ticket.status} /> : null}
          {!closed && ticket ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Close
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close this ticket?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The conversation becomes read-only. A new ticket is needed for further issues.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void close()}>Close ticket</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <ErrorBanner error={error} />
        <ScrollArea className="-mx-1 max-h-[46vh] min-h-40 flex-1 px-1">
          <div className="space-y-3 pr-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
            ) : messages.length === 0 && !error ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-lg border p-3 ${
                    message.author_type === "customer" ? "bg-muted/50" : ""
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium capitalize text-foreground">
                      {message.author_type === "customer" ? "You" : "Support"}
                    </span>
                    <span>{formatDateTime(message.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  {(message.attachments?.length ?? 0) > 0 ? (
                    <ul className="mt-2 space-y-1 border-t pt-2">
                      {(message.attachments ?? []).map((attachment) => (
                        <li key={attachment.id}>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            onClick={() =>
                              void downloadAttachment(message.id, attachment)
                            }
                          >
                            <PaperclipIcon className="size-3" />
                            {attachment.filename} ({formatBytes(attachment.size_bytes)})
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {!closed ? (
          <div className="space-y-2 rounded-md border p-3">
            <Textarea
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a reply…"
            />
            {files.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {files.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    <PaperclipIcon className="size-3" />
                    {file.name} ({formatBytes(file.size)})
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles(files.filter((_, i) => i !== index))}
                      className="rounded-full p-0.5 hover:bg-background"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {percent !== null ? (
              <p className="text-xs tabular-nums text-muted-foreground">Uploading… {percent}%</p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div>
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,text/*,.pdf,.zip,.log"
                  className="hidden"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
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
              </div>
              <Button onClick={() => void send()} disabled={percent !== null}>
                {percent !== null ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
            This ticket is closed. Open a new ticket for further questions.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---- Create -------------------------------------------------------------------

function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const { orgId } = useOrg()
  const [subject, setSubject] = useState("")
  const [category, setCategory] = useState<string>("general")
  const [priority, setPriority] = useState<string>("normal")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!subject.trim()) {
      toast.error("Subject is required")
      return
    }
    if (!body.trim()) {
      toast.error("Describe your issue")
      return
    }
    setBusy(true)
    try {
      const { data } = await apiPost<TicketRow>(
        "/tickets",
        {
          subject: subject.trim(),
          category: category === "general" ? undefined : category,
          priority,
          body: body.trim(),
        },
        { headers: orgHeaders(orgId) },
      )
      toast.success("Ticket created")
      setSubject("")
      setBody("")
      onCreated(data?.id ?? "")
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to create ticket")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>Our staff usually replies within one business day.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tk-subject">Subject *</Label>
            <Input
              id="tk-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Instance unreachable after reboot"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="tk-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="tk-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="abuse">Abuse report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((item) => (
                    <SelectItem key={item} value={item} className="capitalize">
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tk-body">Message *</Label>
            <Textarea
              id="tk-body"
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe the problem, what you expected and any error output."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
