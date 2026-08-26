// Admin ticket thread page (/admin/tickets/:ticketId). The API has no single
// ticket GET, so the ticket row (which carries organization_id) is resolved by
// walking GET /admin/tickets; messages are then read through the org-scoped
// GET /tickets/:id/messages with X-Organization-ID (staff tokens allowed).
// Replies/assignment/close use the dedicated /admin/tickets/:ticket_id routes.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeftIcon } from "lucide-react"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { DetailField, StatusBadge, formatDateTime } from "./shared"
import { findAdminTicket, type AdminTicketRow, type AdminUserRow } from "./identityLookup"

interface TicketMessage {
  id: string
  author_type: string
  author_user_id: string
  body: string
  created_at: string
}

export default function TicketThreadPage() {
  const ticketId = useParams().ticketId ?? ""
  const [ticket, setTicket] = useState<AdminTicketRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!ticketId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    findAdminTicket(ticketId)
      .then((row) => {
        if (cancelled) return
        setTicket(row)
        setLoading(false)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticketId, reloadTick])

  const mutated = useCallback(() => setReloadTick((tick) => tick + 1), [])

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link to="/admin/tickets">
          <ArrowLeftIcon /> Back to tickets
        </Link>
      </Button>

      {error ? <ErrorBanner error={error} /> : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-4/5" />
        </div>
      ) : ticket ? (
        <>
          <PageHeader title={ticket.subject} description={`${ticket.ticket_number} · org ${ticket.org_slug}`} />

          <dl className="grid gap-4 rounded-md border p-4 sm:grid-cols-3 lg:grid-cols-5">
            <DetailField label="Status">
              <StatusBadge status={ticket.status} />
            </DetailField>
            <DetailField label="Priority">
              <span className="capitalize">{ticket.priority || "—"}</span>
            </DetailField>
            <DetailField label="Category">{ticket.category || "—"}</DetailField>
            <DetailField label="Assigned to">
              <span className="font-mono text-xs break-all">{ticket.assigned_to || "unassigned"}</span>
            </DetailField>
            <DetailField label="Created">{formatDateTime(ticket.created_at)}</DetailField>
          </dl>

          <Conversation ticket={ticket} onMutated={mutated} key={reloadTick} />
        </>
      ) : (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          Ticket <span className="font-mono">{ticketId}</span> was not found in the staff queue — it
          may have been deleted.
        </p>
      )}
    </div>
  )
}

/** Message thread + reply form + assignment/close controls. */
function Conversation({
  ticket,
  onMutated,
}: {
  ticket: AdminTicketRow
  onMutated: () => void
}) {
  const [messages, setMessages] = useState<TicketMessage[] | null>(null)
  const [messagesError, setMessagesError] = useState<unknown>(null)
  const [replyBody, setReplyBody] = useState("")
  const [internalNote, setInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [assignees, setAssignees] = useState<AdminUserRow[]>([])
  const [assignTo, setAssignTo] = useState("")

  const loadMessages = useCallback(() => {
    setMessages(null)
    setMessagesError(null)
    apiGet<TicketMessage[]>(`/tickets/${ticket.id}/messages`, {
      headers: { "X-Organization-ID": ticket.organization_id },
    })
      .then(({ data }) => setMessages(data))
      .catch((cause) => setMessagesError(cause))
  }, [ticket.id, ticket.organization_id])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Assignee picker comes from the admin users endpoint.
  useEffect(() => {
    let cancelled = false
    apiGet<AdminUserRow[]>("/admin/users", { query: { page: 1, per_page: 50 } })
      .then(({ data }) => {
        if (!cancelled) setAssignees(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setAssignees([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sendReply = async () => {
    if (replyBody.trim() === "") {
      toast.error("Reply text is required")
      return
    }
    setSending(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/reply`, {
        body: replyBody.trim(),
        internal_note: internalNote,
      })
      toast.success(internalNote ? "Internal note added" : "Reply sent")
      setReplyBody("")
      loadMessages()
      onMutated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to send reply")
    } finally {
      setSending(false)
    }
  }

  const closeTicket = async () => {
    try {
      await apiPost(`/admin/tickets/${ticket.id}/close`)
      toast.success("Ticket closed")
      onMutated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to close ticket")
    }
  }

  const assignTicket = async () => {
    if (assignTo === "") {
      toast.error("Pick a staff member first")
      return
    }
    try {
      await apiPost(`/admin/tickets/${ticket.id}/assign`, { assign_to: assignTo })
      toast.success("Ticket assigned")
      onMutated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to assign")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Conversation thread */}
      <section className="space-y-2 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Conversation</h2>
        {messagesError ? (
          <ErrorBanner error={messagesError} />
        ) : messages === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-4/5" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ol className="space-y-2">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`rounded-md border p-3 ${
                  message.author_type === "staff"
                    ? "border-primary/20 bg-primary/5"
                    : message.author_type === "internal_note"
                      ? "border-amber-500/30 bg-amber-500/5"
                      : ""
                }`}
              >
                <p className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium capitalize">
                    {message.author_type === "internal_note"
                      ? "internal note"
                      : message.author_type}
                  </span>
                  <span>{formatDateTime(message.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap text-sm">{message.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Reply form */}
      <section className="space-y-2 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Reply as staff</h2>
        <Textarea
          rows={3}
          placeholder="Write a reply…"
          value={replyBody}
          onChange={(event) => setReplyBody(event.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={internalNote}
              onCheckedChange={(checked) => setInternalNote(checked === true)}
            />
            Internal note
          </label>
          <Button size="sm" disabled={sending} onClick={() => void sendReply()}>
            {sending ? "Sending…" : internalNote ? "Add note" : "Send reply"}
          </Button>
        </div>
      </section>

      {/* Assignment + close */}
      <section className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ticket-thread-assignee">Assign to</Label>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger id="ticket-thread-assignee">
              <SelectValue
                placeholder={ticket.assigned_to ? "reassign…" : "pick staff…"}
              />
            </SelectTrigger>
            <SelectContent>
              {assignees.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void assignTicket()}>
            Assign
          </Button>
        </div>
        <div className="space-y-1.5 sm:text-right sm:self-end">
          {ticket.status !== "closed" ? (
            <Button variant="destructive" size="sm" onClick={() => setCloseOpen(true)}>
              Close ticket
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">This ticket is closed.</p>
          )}
        </div>
      </section>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close ticket {ticket.ticket_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer can no longer reply once the ticket is closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep open</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void closeTicket()}
            >
              Close ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
