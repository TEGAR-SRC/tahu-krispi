import { useCallback, useEffect, useState } from "react"
import { apiGet, apiPost } from "@/lib/api"
import { toast } from "sonner"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable, type SimpleColumn } from "@/components/shared/SimpleDataTable"
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
import { Loader2Icon, MessagesSquareIcon, SendIcon, TicketCheckIcon, UserRoundCogIcon } from "lucide-react"
import {
  type TicketMessage,
  type TicketRow,
  StatusBadge,
  fmtDateTime,
  formatBytes,
  toastApiError,
} from "../lib"

const PER_PAGE = 20
const TICKET_STATUSES = ["open", "waiting_customer", "waiting_staff", "resolved", "closed"] as const

export default function NocTicketsPage() {
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
    void load(1)
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const columns: Array<SimpleColumn<TicketRow>> = [
    { key: "ticket_number", header: "#", className: "font-mono text-xs" },
    {
      key: "subject",
      header: "Subject",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.subject}</p>
          <p className="truncate text-xs text-muted-foreground">{row.org_slug}</p>
        </div>
      ),
    },
    { key: "priority", header: "Priority", render: (row) => row.priority || "—" },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "assigned_to",
      header: "Assignee",
      render: (row) =>
        row.assigned_to ? (
          <span className="font-mono text-xs">{row.assigned_to.slice(0, 8)}…</span>
        ) : (
          "—"
        ),
    },
    { key: "created_at", header: "Created", render: (row) => fmtDateTime(row.created_at) },
    { key: "last_reply_at", header: "Last reply", render: (row) => fmtDateTime(row.last_reply_at) },
    {
      key: "actions",
      header: "",
      className: "w-16",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open thread for ${row.ticket_number}`}
          onClick={() => setActiveTicket(row)}
        >
          <MessagesSquareIcon />
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tickets"
        description="Staff queue across all organizations."
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

      <SimpleDataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        skeletonRows={8}
        emptyMessage="No tickets match the current filter."
        getRowKey={(row) => row.id}
      />

      <div className="flex items-center justify-end gap-3">
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
    if (open) void loadMessages()
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
              {ticket.priority ? (
                <span className="text-xs font-normal text-muted-foreground">
                  priority {ticket.priority}
                </span>
              ) : null}
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
                <article
                  key={message.id}
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
              <label className="flex items-center gap-2 text-sm">
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
