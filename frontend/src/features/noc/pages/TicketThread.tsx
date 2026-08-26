// NOC ticket thread: resolves the ticket through the staff queue list (the
// backend has no single-ticket GET), then renders the org-scoped message
// thread plus the staff actions the tickets area grants — reply with optional
// internal note, close, and assign to a staff user id.
import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { ErrorBanner } from "@/components/shared/ErrorBanner"
import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/ui/skeleton"
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
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Loader2Icon, SendIcon, TicketCheckIcon, UserRoundCogIcon } from "lucide-react"
import type { TicketMessage, TicketRow } from "../lib"
import { StatusBadge, fmtDateTime, formatBytes, toastApiError } from "../lib"

const RESOLVE_PAGE_SIZE = 100
const RESOLVE_MAX_PAGES = 5

export default function NocTicketThreadPage() {
  const ticketId = useParams().ticketId ?? ""

  const [ticket, setTicket] = useState<TicketRow | null>(null)
  const [resolving, setResolving] = useState(true)
  const [resolveError, setResolveError] = useState<unknown>(null)

  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messagesError, setMessagesError] = useState<unknown>(null)

  const [replyBody, setReplyBody] = useState("")
  const [internalNote, setInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [assigneeId, setAssigneeId] = useState("")
  const [assigning, setAssigning] = useState(false)

  // The staff API only exposes a paginated list; walk it until the route's
  // ticket shows up (or give up after a few pages).
  useEffect(() => {
    let cancelled = false
    async function resolve() {
      setResolving(true)
      setResolveError(null)
      try {
        for (let page = 1; page <= RESOLVE_MAX_PAGES; page += 1) {
          const envelope = await apiGet<TicketRow[]>("/admin/tickets", {
            query: { page, per_page: RESOLVE_PAGE_SIZE },
          })
          const found = envelope.data.find((row) => row.id === ticketId)
          if (found) {
            if (!cancelled) setTicket(found)
            return
          }
          if (!envelope.meta || page * RESOLVE_PAGE_SIZE >= (envelope.meta.total ?? 0)) break
        }
        if (!cancelled) setTicket(null)
      } catch (cause) {
        if (!cancelled) setResolveError(cause)
      } finally {
        if (!cancelled) setResolving(false)
      }
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [ticketId])

  const loadMessages = useCallback(async () => {
    if (!ticket) return
    setLoadingMessages(true)
    try {
      const envelope = await apiGet<TicketMessage[]>(`/tickets/${ticket.id}/messages`, {
        headers: { "X-Organization-ID": ticket.organization_id },
      })
      setMessages(envelope.data)
      setMessagesError(null)
    } catch (cause) {
      setMessagesError(cause)
    } finally {
      setLoadingMessages(false)
    }
  }, [ticket])

  useEffect(() => {
    if (ticket) void loadMessages()
  }, [ticket, loadMessages])

  const sendReply = useCallback(async () => {
    if (!ticket || !replyBody.trim()) return
    setSending(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/reply`, {
        body: replyBody.trim(),
        internal_note: internalNote,
      })
      toast.success(internalNote ? "Internal note added" : "Reply sent")
      setReplyBody("")
      setInternalNote(false)
      await loadMessages()
    } catch (cause) {
      toastApiError(cause, "Could not send the reply")
    } finally {
      setSending(false)
    }
  }, [ticket, replyBody, internalNote, loadMessages])

  const closeTicket = useCallback(async () => {
    if (!ticket) return
    setClosing(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/close`)
      toast.success(`${ticket.ticket_number} closed`)
      setConfirmClose(false)
      const refreshed = await apiGet<TicketRow[]>("/admin/tickets", {
        query: { page: 1, per_page: RESOLVE_PAGE_SIZE },
      })
      const updated = refreshed.data.find((row) => row.id === ticket.id)
      if (updated) setTicket(updated)
    } catch (cause) {
      toastApiError(cause, "Could not close the ticket")
    } finally {
      setClosing(false)
    }
  }, [ticket])

  const assignTicket = useCallback(async () => {
    if (!ticket || !assigneeId.trim()) return
    setAssigning(true)
    try {
      await apiPost(`/admin/tickets/${ticket.id}/assign`, { assign_to: assigneeId.trim() })
      toast.success("Ticket assigned")
      setAssigneeId("")
    } catch (cause) {
      toastApiError(cause, "Could not assign the ticket")
    } finally {
      setAssigning(false)
    }
  }, [ticket, assigneeId])

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/noc/tickets">Tickets</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {ticket ? <BreadcrumbPage>{ticket.ticket_number}</BreadcrumbPage> : <Skeleton className="h-4 w-24" />}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {resolveError ? (
        <ErrorBanner error={resolveError} />
      ) : resolving ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !ticket ? (
        <EmptyState
          message="Ticket not found."
          description={`No ticket matching ${ticketId} was returned by the staff queue.`}
        />
      ) : (
        <>
          <PageHeader
            title={`${ticket.ticket_number} — ${ticket.subject}`}
            description={`${ticket.org_slug} · category ${ticket.category || "—"} · created ${fmtDateTime(ticket.created_at)} · last reply ${fmtDateTime(ticket.last_reply_at)}`}
          />

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={ticket.status} />
            <span className="text-muted-foreground">priority {ticket.priority || "—"}</span>
            <span className="text-muted-foreground">
              assignee{" "}
              {ticket.assigned_to ? (
                <span className="font-mono text-xs">{ticket.assigned_to.slice(0, 8)}…</span>
              ) : (
                "—"
              )}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={closing || ticket.status === "closed"}
              onClick={() => setConfirmClose(true)}
            >
              <TicketCheckIcon /> Close ticket
            </Button>
          </div>

          <Separator />

          {/* ---- Thread ---- */}
          <section className="space-y-3">
            {loadingMessages ? (
              <p className="text-sm text-muted-foreground">Loading conversation…</p>
            ) : messagesError ? (
              <ErrorBanner error={messagesError} />
            ) : messages.length === 0 ? (
              <EmptyState message="No messages in this thread." />
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.author_type === "staff"
                      ? "rounded-md border border-primary/30 bg-primary/5 p-3"
                      : "rounded-md border p-3"
                  }
                >
                  <header className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium capitalize">{message.author_type}</span>
                    <span>{fmtDateTime(message.created_at)}</span>
                  </header>
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
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
              ))
            )}
          </section>

          {/* ---- Reply + assign ---- */}
          <section className="space-y-4 rounded-md border p-4">
            <div className="space-y-2">
              <Label htmlFor="noc-reply-body" className="text-sm font-medium">
                Reply as staff
              </Label>
              <Textarea
                id="noc-reply-body"
                rows={3}
                placeholder="Write a reply… a visible reply moves an open ticket to waiting_customer."
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={internalNote} onCheckedChange={(v) => setInternalNote(v === true)} />
                  Internal note only
                </label>
                <Button size="sm" disabled={sending || !replyBody.trim()} onClick={() => void sendReply()}>
                  {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Send
                </Button>
              </div>
            </div>

            <Separator />

            <form
              className="space-y-1"
              onSubmit={(event) => {
                event.preventDefault()
                void assignTicket()
              }}
            >
              <Label htmlFor="noc-assignee" className="text-xs text-muted-foreground">
                Assign to staff user id (UUID)
              </Label>
              <div className="flex max-w-md gap-2">
                <Input
                  id="noc-assignee"
                  placeholder="user uuid"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={assigning || !assigneeId.trim()}>
                  {assigning ? <Loader2Icon className="animate-spin" /> : <UserRoundCogIcon />}
                  Assign
                </Button>
              </div>
            </form>
          </section>
        </>
      )}

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {ticket?.ticket_number ?? "ticket"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The customer will no longer be able to reopen it from their console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={closing}
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
    </div>
  )
}
