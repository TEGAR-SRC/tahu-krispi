// Platform-admin support ticket queue: staff view across every organization.
// Conversation threads are read through the org-scoped customer endpoint using
// the ticket's organization id as X-Organization-ID (verified against the live
// API); replies/assignment/close use the dedicated /admin/tickets routes.
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import { PageHeader } from "@/components/shared/PageHeader"
import { SimpleDataTable } from "@/components/shared/SimpleDataTable"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { PagedMeta } from "@/lib/types"
import { DetailField, PaginationBar, StatusBadge, formatDateTime } from "./shared"

interface AdminTicketRow {
  id: string
  ticket_number: string
  organization_id: string
  org_slug: string
  subject: string
  category: string
  status: string
  priority: string
  assigned_to: string
  created_at: string
  last_reply_at: string
  closed_at: string
}

interface TicketMessage {
  id: string
  author_type: string
  author_user_id: string
  body: string
  created_at: string
}

interface AssignableUser {
  id: string
  email: string
}

const TICKET_STATUSES = ["open", "waiting_customer", "waiting_staff", "resolved", "closed"]
const PER_PAGE = 20

export default function AdminTicketsPage() {
  const [rows, setRows] = useState<AdminTicketRow[]>([])
  const [meta, setMeta] = useState<PagedMeta & Record<string, unknown>>()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Keep the row snapshot so the sheet header renders before messages load.
  const [selectedSnapshot, setSelectedSnapshot] = useState<AdminTicketRow | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<AdminTicketRow[]>("/admin/tickets", {
      query: {
        page,
        per_page: PER_PAGE,
        status: status === "all" ? null : status,
      },
    })
      .then((envelope) => {
        if (cancelled) return
        setRows(envelope.data)
        setMeta(envelope.meta as PagedMeta & Record<string, unknown>)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, status])

  const reloadList = useCallback(() => {
    apiGet<AdminTicketRow[]>("/admin/tickets", {
      query: { page, per_page: PER_PAGE, status: status === "all" ? null : status },
    })
      .then((envelope) => setRows(envelope.data))
      .catch(() => undefined)
  }, [page, status])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tickets"
        description="Support queue across all organizations."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[210px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {TICKET_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SimpleDataTable<AdminTicketRow>
        columns={[
          {
            key: "ticket_number",
            header: "Ticket",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{row.subject}</p>
                <p className="font-mono text-xs text-muted-foreground">{row.ticket_number}</p>
              </div>
            ),
          },
          {
            key: "org_slug",
            header: "Organization",
            className: "hidden md:table-cell",
            render: (row) => <span className="text-muted-foreground">{row.org_slug}</span>,
          },
          { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            key: "priority",
            header: "Priority",
            render: (row) => (
              <span className="text-sm capitalize">{row.priority || "—"}</span>
            ),
          },
          {
            key: "last_reply_at",
            header: "Last reply",
            className: "hidden lg:table-cell",
            render: (row) => (
              <span className="text-muted-foreground">{formatDateTime(row.last_reply_at)}</span>
            ),
          },
          {
            key: "actions",
            header: "",
            className: "w-20 text-right",
            render: (row) => (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  setSelectedSnapshot(row)
                  setSelectedId(row.id)
                }}
              >
                Open
              </Button>
            ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        getRowKey={(row) => row.id}
        emptyMessage="No tickets match this filter."
        skeletonRows={8}
      />

      <PaginationBar meta={meta} onPageChange={setPage} disabled={loading} />

      {selectedId && selectedSnapshot ? (
        <TicketDetailSheet
          snapshot={selectedSnapshot}
          onClose={() => {
            setSelectedId(null)
            setSelectedSnapshot(null)
            reloadList()
          }}
          onMutated={() => reloadList()}
        />
      ) : null}
    </div>
  )
}

function TicketDetailSheet({
  snapshot,
  onClose,
  onMutated,
}: {
  snapshot: AdminTicketRow
  onClose: () => void
  onMutated: () => void
}) {
  const [messages, setMessages] = useState<TicketMessage[] | null>(null)
  const [messagesError, setMessagesError] = useState<unknown>(null)
  const [replyBody, setReplyBody] = useState("")
  const [internalNote, setInternalNote] = useState(false)
  const [sending, setSending] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [assignees, setAssignees] = useState<AssignableUser[]>([])
  const [assignTo, setAssignTo] = useState("")

  const loadMessages = useCallback(() => {
    setMessages(null)
    setMessagesError(null)
    apiGet<TicketMessage[]>(`/tickets/${snapshot.id}/messages`, {
      headers: { "X-Organization-ID": snapshot.organization_id },
    })
      .then(({ data }) => setMessages(data))
      .catch((cause) => setMessagesError(cause))
  }, [snapshot.id, snapshot.organization_id])

  useEffect(() => {
    const t = setTimeout(() => loadMessages(), 0)
    return () => clearTimeout(t)
  }, [loadMessages])

  // Staff pickers come from the admin users endpoint; assignment takes a uuid.
  useEffect(() => {
    apiGet<AssignableUser[]>("/admin/users", { query: { per_page: 50 } })
      .then(({ data }) => setAssignees(data))
      .catch(() => setAssignees([]))
  }, [])

  const sendReply = async () => {
    if (replyBody.trim() === "") {
      toast.error("Reply text is required")
      return
    }
    setSending(true)
    try {
      await apiPost(`/admin/tickets/${snapshot.id}/reply`, {
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
    setCloseOpen(false)
    try {
      await apiPost(`/admin/tickets/${snapshot.id}/close`)
      toast.success("Ticket closed")
      onMutated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to close")
    }
  }

  const assignTicket = async () => {
    if (assignTo === "") {
      toast.error("Pick a staff member first")
      return
    }
    try {
      await apiPost(`/admin/tickets/${snapshot.id}/assign`, { assign_to: assignTo })
      toast.success("Ticket assigned")
      onMutated()
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to assign")
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{snapshot.subject}</SheetTitle>
          <SheetDescription>
            {snapshot.ticket_number} · org {snapshot.org_slug} ·{" "}
            {formatDateTime(snapshot.created_at)}
          </SheetDescription>
        </SheetHeader>

        <dl className="grid grid-cols-3 gap-3">
          <DetailField label="Status">
            <StatusBadge status={snapshot.status} />
          </DetailField>
          <DetailField label="Priority">
            <span className="capitalize">{snapshot.priority || "—"}</span>
          </DetailField>
          <DetailField label="Category">{snapshot.category || "—"}</DetailField>
        </dl>

        {/* Conversation thread */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Conversation</h3>
          {messagesError ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              Could not load messages ({messagesError instanceof ApiError ? messagesError.message : "error"})
            </p>
          ) : messages === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-4/5" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <ol className="space-y-2">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`rounded-md border p-3 ${
                    message.author_type === "staff" || message.author_type === "internal_note"
                      ? "bg-primary/5 border-primary/20"
                      : ""
                  }`}
                >
                  <p className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium capitalize">
                      {message.author_type === "staff" ? "staff" : message.author_type}
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
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Reply as staff</h3>
          <Textarea
            rows={3}
            placeholder="Write a reply…"
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={internalNote} onCheckedChange={(checked) => setInternalNote(checked === true)} />
              Internal note (doesn't change ticket state)
            </label>
            <Button size="sm" disabled={sending} onClick={() => void sendReply()}>
              {sending ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </section>

        {/* Assignment + close */}
        <section className="grid gap-3 border-t pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-assignee">Assign to</Label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger id="ticket-assignee">
                <SelectValue placeholder={snapshot.assigned_to ? "reassign…" : "pick staff…"} />
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
            {snapshot.status !== "closed" ? (
              <Button variant="destructive" size="sm" onClick={() => setCloseOpen(true)}>
                Close ticket
              </Button>
            ) : null}
          </div>
        </section>

        <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Close ticket {snapshot.ticket_number}?</AlertDialogTitle>
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
      </SheetContent>
    </Sheet>
  )
}
