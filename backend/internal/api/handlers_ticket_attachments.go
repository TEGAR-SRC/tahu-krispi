package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"kilat.cloud/backend/internal/compute"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/valyala/fasthttp"

	"kilat.cloud/backend/internal/storage"
	"kilat.cloud/backend/internal/support"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Support ticket attachments ----

const (
	// MaxAttachmentBytes caps each ticket attachment file at 100 MiB.
	MaxAttachmentBytes int64 = 100 << 20
	// maxAttachmentsPerMessage bounds the number of files per reply.
	maxAttachmentsPerMessage = 10
	// attachmentFormSlackBytes covers form fields, boundaries and smaller
	// companion files beyond the largest single attachment in one request.
	attachmentFormSlackBytes int64 = 8 << 20
	// ticketAttachmentPurpose tags stored_objects rows backing ticket replies.
	ticketAttachmentPurpose = "ticket_attachment"
)

// attachmentBodyLimit is the transport- and parser-level request body budget
// for attachment uploads: one maximum-size file plus slack.
const attachmentBodyLimit = int(MaxAttachmentBytes + attachmentFormSlackBytes)

// isoUploadBodyLimit covers a maximum-size (15 GiB) custom ISO upload plus
// multipart overhead. Note: fasthttp buffers the request body in memory; very
// large ISOs should be fronted by a proxy with spooling in production.
const isoUploadBodyLimit = int(compute.MaxISOSizeBytes + attachmentFormSlackBytes)

// isTicketAttachmentUploadPath reports whether a request URI targets one of
// the multipart ticket-attachment upload endpoints.
func isTicketAttachmentUploadPath(uri []byte) bool {
	path := uri
	if i := bytes.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	if !bytes.HasSuffix(path, []byte("/attachments")) {
		return false
	}
	return bytes.HasPrefix(path, []byte("/v1/tickets/")) ||
		bytes.HasPrefix(path, []byte("/v1/admin/tickets/"))
}

// isISOUploadPath reports whether a request URI targets the custom-ISO upload
// endpoint, which needs the raised body limit as well.
func isISOUploadPath(uri []byte) bool {
	path := uri
	if i := bytes.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	return bytes.Equal(path, []byte("/v1/isos/upload"))
}

// InstallAttachmentUploadLimits raises the fasthttp per-request body limit for
// ticket-attachment upload endpoints above the app-wide BodyLimit so large
// files can reach the upload handlers; every other request keeps the default
// limit. Call once during server setup, before Listen.
func (s *Server) InstallAttachmentUploadLimits() {
	srv := s.app.Server()
	prev := srv.HeaderReceived
	srv.HeaderReceived = func(h *fasthttp.RequestHeader) fasthttp.RequestConfig {
		if prev != nil {
			if rc := prev(h); rc.MaxRequestBodySize > 0 {
				return rc
			}
		}
		rc := fasthttp.RequestConfig{}
		switch {
		case isTicketAttachmentUploadPath(h.RequestURI()):
			rc.MaxRequestBodySize = attachmentBodyLimit
		case isISOUploadPath(h.RequestURI()):
			rc.MaxRequestBodySize = isoUploadBodyLimit
		}
		return rc
	}
}

// parseTicketAttachmentForm parses the multipart form of an upload request
// with the attachment body budget instead of the app-wide limit.
func parseTicketAttachmentForm(c fiber.Ctx) (*multipart.Form, error) {
	if baseMime(c.Get(fiber.HeaderContentType)) != "multipart/form-data" {
		return nil, errValidation("multipart/form-data required")
	}
	form, err := c.Request().MultipartFormWithLimit(attachmentBodyLimit)
	if err != nil {
		if errors.Is(err, fasthttp.ErrBodyTooLarge) {
			return nil, vErrField("files", "upload exceeds the 100 MB per-file attachment cap")
		}
		return nil, errValidation("invalid multipart form")
	}
	return form, nil
}

func ticketFormValue(form *multipart.Form, key string) string {
	if vals := form.Value[key]; len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// ticketAttachmentFilename normalizes a client-provided filename into a safe
// base name for object keys and display.
func ticketAttachmentFilename(raw string) string {
	name := filepath.Base(strings.ReplaceAll(raw, "\\", "/"))
	name = strings.TrimSpace(name)
	const maxNameLen = 120
	if len(name) > maxNameLen {
		name = name[len(name)-maxNameLen:]
	}
	if name == "" || name == "." || name == ".." || name == "/" {
		return "attachment"
	}
	return name
}

func ticketObjectKey(ticketID uuid.UUID, filename string) string {
	return "tickets/" + ticketID.String() + "/" + uuid.NewString() + "-" + filename
}

// ticketContentType keeps any client-declared type (any file kind is allowed)
// and falls back to a generic binary type.
func ticketContentType(fh *multipart.FileHeader) string {
	if mt := baseMime(fh.Header.Get("Content-Type")); mt != "" {
		return mt
	}
	return "application/octet-stream"
}

// validateTicketAttachments enforces the count and per-file size caps before
// anything is uploaded.
func validateTicketAttachments(files []*multipart.FileHeader) error {
	if len(files) == 0 {
		return errValidation("at least one file required")
	}
	if len(files) > maxAttachmentsPerMessage {
		return vErrField("files", "at most 10 files per message")
	}
	for _, fh := range files {
		if fh.Size <= 0 {
			return vErrField("files", "uploaded file is empty")
		}
		if fh.Size > MaxAttachmentBytes {
			return vErrField("files", "each file may be at most 100 MB")
		}
	}
	return nil
}

// uploadTicketAttachments streams every part into object storage and registers
// the stored_objects rows. It returns the object ids plus a best-effort
// cleanup closure that removes already-uploaded objects when the caller fails
// before linking them to a message.
func (s *Server) uploadTicketAttachments(c fiber.Ctx, orgID, uploaderID, ticketID uuid.UUID, files []*multipart.FileHeader) ([]uuid.UUID, func(), error) {
	ctx := c.Context()
	cl, backendID, err := s.objClientFor(ctx, "ticket")
	if err != nil {
		return nil, nil, err // PROVIDER_UNAVAILABLE when R2 is not configured
	}

	var (
		objectIDs    []uuid.UUID
		uploadedKeys []string
		cleaned      bool
	)
	cleanup := func() {
		if cleaned {
			return
		}
		cleaned = true
		for _, key := range uploadedKeys {
			_ = cl.Remove(ctx, key)
		}
	}

	for _, fh := range files {
		filename := ticketAttachmentFilename(fh.Filename)
		key := ticketObjectKey(ticketID, filename)
		f, err := fh.Open()
		if err != nil {
			cleanup()
			return nil, nil, errValidation("cannot read uploaded file")
		}
		mimeType := ticketContentType(fh)
		sum := sha256.New()
		_, err = cl.PutObject(ctx, key, io.TeeReader(f, sum), fh.Size, mimeType)
		f.Close()
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		obj, err := s.storageSvc.RegisterStoredObject(ctx, storage.RegisterObjectInput{
			StorageBackendID: backendID,
			OrganizationID:   &orgID,
			OwnerUserID:      &uploaderID,
			ObjectKey:        key,
			Purpose:          ticketAttachmentPurpose,
			Filename:         filename,
			MimeType:         mimeType,
			SizeBytes:        fh.Size,
			SHA256:           hex.EncodeToString(sum.Sum(nil)),
		})
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		objectIDs = append(objectIDs, obj.ID)
		uploadedKeys = append(uploadedKeys, key)
	}
	return objectIDs, cleanup, nil
}

// handleCreateTicketMessageAttachments handles
// POST /v1/tickets/:ticket_id/messages/attachments (customer replies with files).
func (s *Server) handleCreateTicketMessageAttachments(c fiber.Ctx) error {
	ticketID, err := uuid.Parse(c.Params("ticket_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid ticket id"))
	}
	form, err := parseTicketAttachmentForm(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer c.Request().RemoveMultipartFormFiles()

	body := strings.TrimSpace(ticketFormValue(form, "body"))
	files := form.File["files"]
	if body == "" {
		return mw.WriteError(c, errValidation("body required"))
	}
	if err := validateTicketAttachments(files); err != nil {
		return mw.WriteError(c, err)
	}

	orgID := mustOrgID(c)
	userID := mustUserID(c)
	objectIDs, cleanup, err := s.uploadTicketAttachments(c, orgID, userID, ticketID, files)
	if err != nil {
		return mw.WriteError(c, err)
	}
	msg, err := s.supportSvc.ReplyWithAttachments(c.Context(), support.ReplyWithAttachmentsInput{
		OrganizationID: orgID,
		TicketID:       ticketID,
		AuthorUserID:   userID,
		AuthorType:     "customer",
		Body:           body,
		ObjectIDs:      objectIDs,
	})
	if err != nil {
		cleanup()
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{
		"status":      "replied",
		"message_id":  msg.ID,
		"attachments": msg.Attachments,
	}, nil)
}

// adminReplyTicketAttachments mirrors adminReplyTicket for multipart staff
// replies with attachments (POST /v1/admin/tickets/:ticket_id/reply/attachments).
func (s *Server) adminReplyTicketAttachments(c fiber.Ctx) error {
	ticketID, _, err := s.adminLoadTicket(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	var orgID uuid.UUID
	if err := s.db.QueryRow(ctx,
		`SELECT organization_id FROM support_tickets WHERE id=$1`, ticketID).Scan(&orgID); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "ticket not found"))
	}

	form, err := parseTicketAttachmentForm(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer c.Request().RemoveMultipartFormFiles()

	body := strings.TrimSpace(ticketFormValue(form, "body"))
	internalNote := ticketFormValue(form, "internal_note") == "true" || ticketFormValue(form, "internal_note") == "1"
	files := form.File["files"]
	if body == "" {
		return mw.WriteError(c, vErrField("body", "is required"))
	}
	if err := validateTicketAttachments(files); err != nil {
		return mw.WriteError(c, err)
	}

	adminID := mustUserID(c)
	objectIDs, cleanup, err := s.uploadTicketAttachments(c, orgID, adminID, ticketID, files)
	if err != nil {
		return mw.WriteError(c, err)
	}
	msg, err := s.supportSvc.ReplyWithAttachments(ctx, support.ReplyWithAttachmentsInput{
		TicketID:     ticketID,
		AuthorUserID: adminID,
		AuthorType:   "staff",
		Body:         body,
		InternalNote: internalNote,
		ObjectIDs:    objectIDs,
	})
	if err != nil {
		cleanup()
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.ticket.reply", "ticket", &ticketID, map[string]any{
		"internal_note": internalNote,
		"attachments":   len(objectIDs),
	})
	return mw.JSON(c, 201, fiber.Map{
		"status":        "replied",
		"internal_note": internalNote,
		"message_id":    msg.ID,
		"attachments":   msg.Attachments,
	}, nil)
}

// presignTicketAttachment returns a short-lived signed download URL for one
// attachment of a ticket message. With orgScoped the requester must belong to
// the ticket's organization; platform admins use orgScope=false.
func (s *Server) presignTicketAttachment(c fiber.Ctx, orgScoped bool) error {
	ticketID, err := uuid.Parse(c.Params("ticket_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid ticket id"))
	}
	messageID, err := uuid.Parse(c.Params("message_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid message id"))
	}
	attachmentID, err := uuid.Parse(c.Params("attachment_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid attachment id"))
	}

	ctx := c.Context()
	query := `
SELECT o.object_key
FROM support_message_attachments sma
JOIN support_messages m ON m.id = sma.message_id
JOIN support_tickets t ON t.id = m.ticket_id
JOIN stored_objects o ON o.id = sma.object_id AND o.deleted_at IS NULL
WHERE m.ticket_id=$1 AND sma.message_id=$2 AND sma.object_id=$3`
	args := []any{ticketID, messageID, attachmentID}
	if orgScoped {
		query += ` AND t.organization_id=$4`
		args = append(args, mustOrgID(c))
	}
	var objectKey string
	if err := s.db.QueryRow(ctx, query, args...).Scan(&objectKey); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "attachment not found"))
	}
	cl, _, err := s.objClientFor(ctx, "ticket")
	if err != nil {
		return mw.WriteError(c, err)
	}
	url, err := cl.PresignedGet(ctx, objectKey, presignTTLFor())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"url":        url,
		"expires_in": int(presignTTLFor().Seconds()),
	}, nil)
}

// handleGetTicketMessageAttachment handles
// GET /v1/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id.
func (s *Server) handleGetTicketMessageAttachment(c fiber.Ctx) error {
	return s.presignTicketAttachment(c, true)
}

// adminGetTicketMessageAttachment handles
// GET /v1/admin/tickets/:ticket_id/messages/:message_id/attachments/:attachment_id.
func (s *Server) adminGetTicketMessageAttachment(c fiber.Ctx) error {
	return s.presignTicketAttachment(c, false)
}
