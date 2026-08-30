// Package support implements support tickets with messages and attachments.
package support

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// dbQuerier matches both the pool and a transaction so attachment helpers can
// run inside or outside a tx.
type dbQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Ticket struct {
	ID           uuid.UUID `json:"id"`
	TicketNumber string    `json:"ticket_number"`
	Subject      string    `json:"subject"`
	Category     string    `json:"category"`
	Status       string    `json:"status"`
	Priority     string    `json:"priority"`
	CreatedAt    string    `json:"created_at"`
	LastReplyAt  string    `json:"last_reply_at"`
}

const selectTicketCols = `
SELECT id, ticket_number, subject, COALESCE(category,''), status::text,
       priority::text, created_at::text, COALESCE(last_reply_at::text,'')
FROM support_tickets`

func (s *Service) ListTickets(ctx context.Context, orgID uuid.UUID) ([]Ticket, error) {
	rows, err := s.db.Query(ctx, selectTicketCols+` WHERE organization_id=$1 ORDER BY updated_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Ticket
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(&t.ID, &t.TicketNumber, &t.Subject, &t.Category,
			&t.Status, &t.Priority, &t.CreatedAt, &t.LastReplyAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type CreateTicketInput struct {
	OrganizationID uuid.UUID
	CreatedBy      uuid.UUID
	Subject        string
	Category       string
	Priority       string
	Body           string
}

func (s *Service) CreateTicket(ctx context.Context, in CreateTicketInput) (*Ticket, error) {
	if in.Subject == "" || in.Body == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "subject and body are required")
	}
	if in.Priority == "" {
		in.Priority = "normal"
	}
	switch in.Priority {
	case "low", "normal", "high", "urgent":
	default:
		return nil, apperrors.New(apperrors.CodeValidation, "invalid priority")
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var seq int64
	// Serialize ticket-number generation so two concurrent inserts can't
	// derive the same MAX+1. Advisory transaction lock held until commit.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7272301)`); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(MAX(CAST(split_part(ticket_number,'-',2) AS bigint)),0)+1 FROM support_tickets`).Scan(&seq); err != nil {
		return nil, err
	}
	number := "TKT-" + padLeft(seq, 6)
	row := tx.QueryRow(ctx, `
INSERT INTO support_tickets(ticket_number, organization_id, created_by, subject, category, priority)
VALUES ($1,$2,$3,$4,NULLIF($5,''),$6::ticket_priority)
RETURNING id, ticket_number, subject, COALESCE(category,''), 'open', priority::text, created_at::text, ''`,
		number, in.OrganizationID, in.CreatedBy, in.Subject, in.Category, in.Priority)
	var t Ticket
	if err := row.Scan(&t.ID, &t.TicketNumber, &t.Subject, &t.Category, new(string), &t.Priority, &t.CreatedAt, new(string)); err != nil {
		return nil, err
	}
	t.Status = "open"
	t.LastReplyAt = ""
	if _, err := tx.Exec(ctx, `
INSERT INTO support_messages(ticket_id, author_user_id, author_type, body)
VALUES ($1,$2,'customer',$3)`, t.ID, in.CreatedBy, in.Body); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now() WHERE id=$1`, t.ID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &t, nil
}

type Message struct {
	ID           uuid.UUID        `json:"id"`
	AuthorType   string           `json:"author_type"`
	AuthorUserID uuid.UUID        `json:"author_user_id"`
	Body         string           `json:"body"`
	CreatedAt    string           `json:"created_at"`
	Attachments  []AttachmentView `json:"attachments"`
}

// AttachmentView describes a file attached to a ticket message. ID is the
// stored_objects id backing the attachment.
type AttachmentView struct {
	ID          uuid.UUID `json:"id"`
	Filename    string    `json:"filename"`
	SizeBytes   int64     `json:"size_bytes"`
	ContentType string    `json:"content_type"`
}

func (s *Service) ListMessages(ctx context.Context, orgID, ticketID uuid.UUID) ([]Message, error) {
	if _, err := s.getTicketForOrg(ctx, orgID, ticketID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
SELECT id, author_type::text, COALESCE(author_user_id::text,''), body, created_at::text
FROM support_messages WHERE ticket_id=$1 ORDER BY created_at ASC`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	var ids []uuid.UUID
	for rows.Next() {
		var m Message
		var authorIDStr string
		if err := rows.Scan(&m.ID, &m.AuthorType, &authorIDStr, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.AuthorUserID = parseUUIDOr(authorIDStr)
		m.Attachments = []AttachmentView{}
		out = append(out, m)
		ids = append(ids, m.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	atts, err := attachmentsByMessage(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if v, ok := atts[out[i].ID]; ok {
			out[i].Attachments = v
		}
	}
	return out, nil
}

// attachmentsByMessage loads the attachment views for the given messages.
func attachmentsByMessage(ctx context.Context, q dbQuerier, messageIDs []uuid.UUID) (map[uuid.UUID][]AttachmentView, error) {
	out := make(map[uuid.UUID][]AttachmentView)
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `
SELECT sma.message_id, sma.object_id,
       COALESCE(o.original_filename,''), COALESCE(o.size_bytes,0), COALESCE(o.mime_type,'')
FROM support_message_attachments sma
JOIN stored_objects o ON o.id = sma.object_id AND o.deleted_at IS NULL
WHERE sma.message_id = ANY($1)
ORDER BY o.created_at, sma.object_id`, messageIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var messageID uuid.UUID
		var v AttachmentView
		if err := rows.Scan(&messageID, &v.ID, &v.Filename, &v.SizeBytes, &v.ContentType); err != nil {
			return nil, err
		}
		out[messageID] = append(out[messageID], v)
	}
	return out, rows.Err()
}

func (s *Service) getTicketForOrg(ctx context.Context, orgID, ticketID uuid.UUID) (*Ticket, error) {
	var t Ticket
	err := s.db.QueryRow(ctx, selectTicketCols+` WHERE id=$2 AND organization_id=$1`,
		orgID, ticketID).
		Scan(&t.ID, &t.TicketNumber, &t.Subject, &t.Category, &t.Status, &t.Priority, &t.CreatedAt, &t.LastReplyAt)
	if err != nil {
		return nil, notFoundErr("ticket not found")
	}
	return &t, nil
}

// Reply adds a customer reply to a ticket.
func (s *Service) Reply(ctx context.Context, orgID, ticketID, userID uuid.UUID, body string) error {
	if _, err := s.getTicketForOrg(ctx, orgID, ticketID); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `
INSERT INTO support_messages(ticket_id, author_user_id, author_type, body)
VALUES ($1,$2,'customer',NULLIF($3,''))`, ticketID, userID, body)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeValidation, "empty message")
	}
	_, err = s.db.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now(), status='waiting_staff', updated_at=now()
WHERE id=$1 AND status NOT IN ('closed','resolved')`, ticketID)
	return err
}

// ReplyWithAttachmentsInput describes a reply that links previously uploaded
// stored objects. A zero OrganizationID means the caller is staff/admin and no
// organization scoping is applied.
type ReplyWithAttachmentsInput struct {
	OrganizationID uuid.UUID
	TicketID       uuid.UUID
	AuthorUserID   uuid.UUID
	AuthorType     string // "customer" or "staff"
	Body           string
	InternalNote   bool
	ObjectIDs      []uuid.UUID
}

// ReplyWithAttachments inserts a reply and links the uploaded objects to it in
// one transaction, mirroring the state transitions of the plain reply paths.
func (s *Service) ReplyWithAttachments(ctx context.Context, in ReplyWithAttachmentsInput) (*Message, error) {
	if strings.TrimSpace(in.Body) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "body is required")
	}
	switch in.AuthorType {
	case "customer", "staff":
	default:
		return nil, apperrors.New(apperrors.CodeValidation, "invalid author type")
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var status string
	if in.OrganizationID != uuid.Nil {
		err = tx.QueryRow(ctx,
			`SELECT status::text FROM support_tickets WHERE id=$2 AND organization_id=$1`,
			in.OrganizationID, in.TicketID).Scan(&status)
	} else {
		err = tx.QueryRow(ctx,
			`SELECT status::text FROM support_tickets WHERE id=$1`, in.TicketID).Scan(&status)
	}
	if err != nil {
		return nil, notFoundErr("ticket not found")
	}

	var messageID uuid.UUID
	var createdAt string
	if err := tx.QueryRow(ctx, `
INSERT INTO support_messages(ticket_id, author_user_id, author_type, body, internal_note)
VALUES ($1,$2,$3,NULLIF($4,''),$5)
RETURNING id, created_at::text`,
		in.TicketID, in.AuthorUserID, in.AuthorType, in.Body, in.InternalNote).
		Scan(&messageID, &createdAt); err != nil {
		return nil, err
	}
	for _, objectID := range in.ObjectIDs {
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM stored_objects WHERE id=$1 AND deleted_at IS NULL)`, objectID).
			Scan(&exists); err != nil {
			return nil, err
		}
		if !exists {
			return nil, apperrors.New(apperrors.CodeValidation, "attachment object not found")
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO support_message_attachments(message_id, object_id) VALUES ($1,$2)
ON CONFLICT (message_id, object_id) DO NOTHING`, messageID, objectID); err != nil {
			return nil, err
		}
	}
	switch {
	case in.AuthorType == "customer":
		if _, err := tx.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now(), status='waiting_staff', updated_at=now()
WHERE id=$1 AND status NOT IN ('closed','resolved')`, in.TicketID); err != nil {
			return nil, err
		}
	case !in.InternalNote && status != "closed" && status != "resolved":
		if _, err := tx.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now(), status='waiting_customer' WHERE id=$1`, in.TicketID); err != nil {
			return nil, err
		}
	default:
		if _, err := tx.Exec(ctx, `
UPDATE support_tickets SET last_reply_at=now() WHERE id=$1`, in.TicketID); err != nil {
			return nil, err
		}
	}
	atts, err := attachmentsByMessage(ctx, tx, []uuid.UUID{messageID})
	if err != nil {
		return nil, err
	}
	views := atts[messageID]
	if views == nil {
		views = []AttachmentView{}
	}
	msg := &Message{
		ID:           messageID,
		AuthorType:   in.AuthorType,
		AuthorUserID: in.AuthorUserID,
		Body:         in.Body,
		CreatedAt:    createdAt,
		Attachments:  views,
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return msg, nil
}

func (s *Service) CloseTicket(ctx context.Context, orgID, ticketID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE support_tickets SET status='closed', closed_at=now(), updated_at=now()
WHERE id=$2 AND organization_id=$1 AND status <> 'closed'`, orgID, ticketID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFoundErr("ticket not found or already closed")
	}
	return nil
}

func padLeft(n int64, width int) string {
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	for len(digits) < width {
		digits = append([]byte{'0'}, digits...)
	}
	return string(digits)
}

func parseUUIDOr(s string) uuid.UUID { id, _ := uuid.Parse(s); return id }

func notFoundErr(msg string) error { return apperrors.New(apperrors.CodeNotFound, msg) }
