import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  Loader2Icon,
  MessagesSquareIcon,
  SendIcon,
  TicketCheckIcon,
  UserRoundCogIcon,
} from "lucide-react"
import {
  type TicketMessage,
  type TicketRow,
  StatusBadge,
} from "../lib"
import { fmtDateTime, formatBytes, toastApiError } from "../lib-utils"

const PER_PAGE = 20
const TICKET_STATUSES = [
  "open",
  "waiting_customer",
  "waiting_staff",
  "resolved",
  "closed",
] as const

/** Parses backend timestamps like `2026-08-26 11:21:17.281941+07`. */
function parseApiDate(value?: string | null): Date | null {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Compact humanized age, e.g. `3h ago` / `2d ago`; em-dash when unparsable. */
function timeAgo(value?: string | null): string {
  const date = parseApiDate(value)
  if (!date) return "—"
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase()
  if (p === "urgent" || p === "high") {
    return <Badge variant="destructive" className="capitalize">{priority}</Badge>
  }
  if (p === "medium") {
    return <Badge variant="secondary" className="capitalize">{priority}</Badge>
  }
  if (!p) return <span className="text-sm text-muted-foreground">—</span>
  return <Badge variant="outline" className="capitalize">{priority}</Badge>
}

/**
 * SLA-ish tint for the age of tickets that are not yet closed/resolved:
 * muted under 48h, amber under 72h, red beyond.
 */
function ageTone(row: TicketRow): string {
  if (row.status === "closed" || row.status === "resolved") return ""
  const created = parseApiDate(row.created_at)
  if (!created) return ""
  const hours = (Date.now() - created.getTime()) / (60 * 60 * 1000)
  if (hours >= 72) return "font-medium text-destructive"
  if (hours >= 48) return "font-medium text-amber-600 dark:text-amber-400"
  return "text-muted-foreground"
}

export default function NocTicketsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TicketRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  // Status filtering is server-side via ?status= so pagination stays correct.
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const [activeTicket, setActiveTicket] = useState<TicketRow | null>(null)

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const envelope = await apiGet<TicketRow[]>("/admin/tickets", {
          query: {
            page: targetPage,
            per_page: PER_PAGE,
            ...(statusFilter !== "all" ? { status: statusFilter } : {}),
          },
        })
        setRows(envelope.data)
        setTotal(envelope.meta?.total ?? envelope.data.length)
        setPage(targetPage)
        setError(null)
      } catch (cause) {
        setError(cause)
      } finally {
        setLoading(false)
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(1), 0)
    return () => clearTimeout(t)
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Tickets"
        description="Staff queue across all organizations. Click a row for the thread."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(page)} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TICKET_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {rows.length} on this page · {total} total
        </span>
      </div>

      {error ? (
        <ErrorBanner error={error} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, rowIndex) => (
            <Skeleton key={rowIndex} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-4 text-center text-sm text-muted-foreground sm:p-6">
          No tickets match the current filter.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">#</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Last reply</TableHead>
                <TableHead className="w-16 text-right">Thread</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => void navigate(`/noc/tickets/${row.id}`)}
                >
                  <TableCell className="font-mono text-xs">{row.ticket_number}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="min-w-0 truncate font-medium">{row.subject}</p>
                      <p className="min-w-0 truncate text-xs text-muted-foreground">{row.org_slug}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={row.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>
                    {row.assigned_to ? (
                      <span className="font-mono text-xs">{row.assigned_to.slice(0, 8)}…</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell title={`Created ${fmtDateTime(row.created_at)}`}>
                    <span className={`text-sm ${ageTone(row)}`}>{timeAgo(row.created_at)}</span>
                  </TableCell>
                  <TableCell>{fmtDateTime(row.last_reply_at)}</TableCell>
                  <TableCell className="text-right">
                    <div
                      className="flex justify-end"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Open reply dialog for ${row.ticket_number}`}
                        onClick={() => setActiveTicket(row)}
                      >
                        <MessagesSquareIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex min-w-0 items-center justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => void load(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => void load(page + 1)}
        >
          Next
        </Button>
      </div>

      {activeTicket ? (
        <ThreadDialog
          ticket={activeTicket}
          open={activeTicket !== null}
          onOpenChange={(open) => !open && setActiveTicket(null)}
          onChanged={() => void load(page)}
        />
      ) : null}
    </div>
  )
}

/** Inline staff reply dialog; kept alongside row-click navigation to the thread page. */
function ThreadDialog({
  ticket,
  open,
  onOpenChange,
  onChanged,
}: {
  ticket: TicketRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [messagesError, setMessagesError] = useState<unknown>(null)

  const [replyBody, setReplyBody] = useState("")
  const [internalNote, setInternalNote] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [closing, setClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [assigneeId, setAssigneeId] = useState("")
  const [assigning, setAssigning] = useState(false)

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true)
    try {
      const envelope = await apiGet<TicketMessage[]>(
        `/tickets/${ticket.id}/messages`,
        // Staff read the org-scoped thread endpoint by passing the ticket's org.
        { headers: { "X-Organization-ID": ticket.organization_id } },
      )
      setMessages(envelope.data)
      setMessagesError(null)
    } catch (cause) {
      setMessagesError(cause)
    } finally {
      setLoadingMessages(false)
    }
  }, [ticket.id, ticket.organization_id])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void loadMessages(), 0)
    return () => clearTimeout(t)
  }, [open, loadMessages])

  const sendReply = useCallback(async () => {
    if (!replyBody.trim()) return
    setSendingReply(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/reply`, {
        body: replyBody.trim(),
        internal_note: internalNote,
      })
      toast.success(internalNote ? "Internal note added" : "Reply sent")
      setReplyBody("")
      setInternalNote(false)
      await loadMessages()
      onChanged()
    } catch (cause) {
      toastApiError(cause, "Could not send the reply")
    } finally {
      setSendingReply(false)
    }
  }, [replyBody, internalNote, ticket.id, loadMessages, onChanged])

  const closeTicket = useCallback(async () => {
    setClosing(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/close`)
      toast.success(`${ticket.ticket_number} closed`)
      setConfirmClose(false)
      onChanged()
    } catch (cause) {
      toastApiError(cause, "Could not close the ticket")
    } finally {
      setClosing(false)
    }
  }, [ticket.id, ticket.ticket_number, onChanged])

  const assignTicket = useCallback(async () => {
    if (!assigneeId.trim()) return
    setAssigning(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/assign`, { assign_to: assigneeId.trim() })
      toast.success("Ticket assigned")
      setAssigneeId("")
      onChanged()
    } catch (cause) {
      toastApiError(cause, "Could not assign the ticket")
    } finally {
      setAssigning(false)
    }
  }, [assigneeId, ticket.id, onChanged])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {ticket.ticket_number}
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </DialogTitle>
            <DialogDescription>
              {ticket.subject} · {ticket.org_slug}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {loadingMessages ? (
              <p className="py-4 text-sm text-muted-foreground">Loading conversation…</p>
            ) : messagesError ? (
              <p className="text-destructive text-sm">
                Failed to load messages:{" "}
                {messagesError instanceof Error ? messagesError.message : "request failed"}
              </p>
            ) : messages.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No messages in this thread.</p>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <Label htmlFor="reply-body" className="text-sm font-medium">
              Reply as staff
            </Label>
            <Textarea
              id="reply-body"
              placeholder="Write a reply… a visible reply moves an open ticket to waiting_customer."
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              rows={3}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <Checkbox checked={internalNote} onCheckedChange={(v) => setInternalNote(v === true)} />
                Internal note only
              </label>
              <Button
                size="sm"
                disabled={sendingReply || !replyBody.trim()}
                onClick={() => void sendReply()}
              >
                {sendingReply ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                Send
              </Button>
            </div>
          </div>

          <DialogFooter className="items-end gap-3 sm:justify-between">
            <div className="flex w-full max-w-xs flex-col gap-1">
              <Label htmlFor="assignee-id" className="text-xs text-muted-foreground">
                Assign to staff user id (UUID)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="assignee-id"
                  placeholder="user uuid"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Assign ticket"
                  disabled={assigning || !assigneeId.trim()}
                  onClick={() => void assignTicket()}
                >
                  {assigning ? <Loader2Icon className="animate-spin" /> : <UserRoundCogIcon />}
                </Button>
              </div>
            </div>
            <Button
              variant="destructive"
              disabled={closing || ticket.status === "closed"}
              onClick={() => setConfirmClose(true)}
            >
              {ticket.status === "closed" ? <TicketCheckIcon /> : null}
              Close ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {ticket.ticket_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will no longer be able to reopen it from their console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void closeTicket()
              }}
            >
              {closing ? <Loader2Icon className="animate-spin" /> : null}
              Close ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MessageBubble({ message }: { message: TicketMessage }): ReactNode {
  return (
    <article
      className={
        message.author_type === "staff"
          ? "rounded-md border border-primary/30 bg-primary/5 p-3"
          : "rounded-md border p-3"
      }
    >
      <header className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium capitalize">{message.author_type}</span>
        <span>{fmtDateTime(message.created_at)}</span>
      </header>
      <p className="text-sm whitespace-pre-wrap">{message.body}</p>
      {message.attachments.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {message.attachments.map((attachment) => (
            <li key={attachment.id} className="text-xs text-muted-foreground">
              Attachment: {attachment.filename} ({formatBytes(attachment.size_bytes)})
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
