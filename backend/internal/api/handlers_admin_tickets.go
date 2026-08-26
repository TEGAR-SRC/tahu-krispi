// Admin module (§51): staff-side support tickets and global audit logs.
package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Support tickets (staff view, all organizations) ----

type admTicketRow struct {
	ID             uuid.UUID `json:"id"`
	TicketNumber   string    `json:"ticket_number"`
	OrganizationID uuid.UUID `json:"organization_id"`
	OrgSlug        string    `json:"org_slug"`
	Subject        string    `json:"subject"`
	Category       string    `json:"category"`
	Status         string    `json:"status"`
	Priority       string    `json:"priority"`
	AssignedTo     string    `json:"assigned_to"`
	CreatedAt      string    `json:"created_at"`
	LastReplyAt    string    `json:"last_reply_at"`
	ClosedAt       string    `json:"closed_at"`
}

func (s *Server) adminListTickets(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admTicketStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid ticket status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " WHERE t.status=" + admPlaceholder(len(args))
	}

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM support_tickets t`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT t.id, t.ticket_number, t.organization_id, org.slug::text, t.subject,
       COALESCE(t.category,''), t.status::text, t.priority::text,
       COALESCE(t.assigned_to::text,''), t.created_at::text,
       COALESCE(t.last_reply_at::text,''), COALESCE(t.closed_at::text,'')
FROM support_tickets t JOIN organizations org ON org.id=t.organization_id`+where+
		` ORDER BY t.updated_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	tickets := []admTicketRow{}
	for rows.Next() {
		var t admTicketRow
		if err := rows.Scan(&t.ID, &t.TicketNumber, &t.OrganizationID, &t.OrgSlug, &t.Subject,
			&t.Category, &t.Status, &t.Priority, &t.AssignedTo, &t.CreatedAt,
			&t.LastReplyAt, &t.ClosedAt); err != nil {
			return mw.WriteError(c, err)
		}
		tickets = append(tickets, t)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, tickets, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminLoadTicket(c fiber.Ctx) (uuid.UUID, string, error) {
	ticketID, err := admParseUUIDParam(c, "ticket_id", "ticket_id")
	if err != nil {
		return uuid.Nil, "", err
	}
	var status string
	err = s.db.QueryRow(c.Context(),
		`SELECT status::text FROM support_tickets WHERE id=$1`, ticketID).Scan(&status)
	if err != nil {
		return uuid.Nil, "", apperrors.New(apperrors.CodeNotFound, "ticket not found")
	}
	return ticketID, status, nil
}

type admReplyTicketInput struct {
	Body         string `json:"body"`
	InternalNote bool   `json:"internal_note"`
}

func (s *Server) adminReplyTicket(c fiber.Ctx) error {
	ticketID, ticketStatus, err := s.adminLoadTicket(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admReplyTicketInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Body) == "" {
		return mw.WriteError(c, vErrField("body", "is required"))
	}
	ctx := c.Context()
	adminID := mustUserID(c)
	if _, err := s.db.Exec(ctx, `
INSERT INTO support_messages(ticket_id, author_user_id, author_type, body, internal_note)
VALUES ($1,$2,'staff',$3,$4)`, ticketID, adminID, in.Body, in.InternalNote); err != nil {
		return mw.WriteError(c, err)
	}
	// A visible staff reply moves an open ticket to waiting_customer; internal notes
	// never change the ticket state.
	if !in.InternalNote && ticketStatus != "closed" && ticketStatus != "resolved" {
		if _, err := s.db.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now(), status='waiting_customer' WHERE id=$1`, ticketID); err != nil {
			return mw.WriteError(c, err)
		}
	} else if _, err := s.db.Exec(ctx,
		`UPDATE support_tickets SET last_reply_at=now() WHERE id=$1`, ticketID); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.ticket.reply", "ticket", &ticketID, map[string]any{
		"internal_note": in.InternalNote,
	})
	return mw.JSON(c, 201, fiber.Map{"status": "replied", "internal_note": in.InternalNote}, nil)
}

type admAssignTicketInput struct {
	AssignTo string `json:"assign_to"`
}

func (s *Server) adminAssignTicket(c fiber.Ctx) error {
	ticketID, _, err := s.adminLoadTicket(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admAssignTicketInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.AssignTo) == "" {
		return mw.WriteError(c, vErrField("assign_to", "a staff user id is required"))
	}
	assignTo, err := uuid.Parse(strings.TrimSpace(in.AssignTo))
	if err != nil {
		return mw.WriteError(c, vErrField("assign_to", "must be a valid user uuid"))
	}
	ctx := c.Context()
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL)`, assignTo).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "assignee not found"))
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE support_tickets SET assigned_to=$2 WHERE id=$1`, ticketID, assignTo)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "ticket not found"))
	}
	s.admAuditMeta(c, "admin.ticket.assign", "ticket", &ticketID, map[string]any{
		"assign_to": assignTo,
	})
	return mw.JSON(c, 200, fiber.Map{"id": ticketID, "assigned_to": assignTo}, nil)
}

func (s *Server) adminCloseTicketStaff(c fiber.Ctx) error {
	ticketID, ticketStatus, err := s.adminLoadTicket(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if ticketStatus == "closed" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "ticket is already closed"))
	}
	tag, err := s.db.Exec(c.Context(),
		`UPDATE support_tickets SET status='closed', closed_at=now() WHERE id=$1`, ticketID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "ticket not found"))
	}
	s.admAudit(c, "admin.ticket.close", "ticket", &ticketID)
	return mw.JSON(c, 200, fiber.Map{"id": ticketID, "status": "closed"}, nil)
}

// ---- Global audit logs ----

type admAuditLogRow struct {
	ID             int64  `json:"id"`
	OrganizationID string `json:"organization_id"`
	ActorUserID    string `json:"actor_user_id"`
	ActorAPIKeyID  string `json:"actor_api_key_id"`
	Action         string `json:"action"`
	ResourceType   string `json:"resource_type"`
	ResourceID     string `json:"resource_id"`
	IP             string `json:"ip"`
	RequestID      string `json:"request_id"`
	CreatedAt      string `json:"created_at"`
}

func (s *Server) adminListAuditLogs(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	where := ""
	args := []any{}
	if actorRaw := strings.TrimSpace(c.Query("actor")); actorRaw != "" {
		actorID, err := uuid.Parse(actorRaw)
		if err != nil {
			return mw.WriteError(c, vErrField("actor", "must be a valid user uuid"))
		}
		args = append(args, actorID)
		where += " AND a.actor_user_id=" + admPlaceholder(len(args))
	}
	if actionRaw := strings.TrimSpace(c.Query("action")); actionRaw != "" {
		args = append(args, "%"+lower(actionRaw)+"%")
		where += " AND a.action ILIKE " + admPlaceholder(len(args))
	}

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM audit_logs a WHERE TRUE`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT a.id, COALESCE(a.organization_id::text,''), COALESCE(a.actor_user_id::text,''),
       COALESCE(a.actor_api_key_id::text,''), a.action, COALESCE(a.resource_type,''),
       COALESCE(a.resource_id::text,''), COALESCE(a.ip::text,''),
       COALESCE(a.request_id::text,''), a.created_at::text
FROM audit_logs a WHERE TRUE`+where+
		` ORDER BY a.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	logs := []admAuditLogRow{}
	for rows.Next() {
		var entry admAuditLogRow
		if err := rows.Scan(&entry.ID, &entry.OrganizationID, &entry.ActorUserID, &entry.ActorAPIKeyID,
			&entry.Action, &entry.ResourceType, &entry.ResourceID, &entry.IP, &entry.RequestID,
			&entry.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		logs = append(logs, entry)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, logs, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}
