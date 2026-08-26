package api

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Support tickets ----

type ticketInput struct {
	Subject  string `json:"subject"`
	Category string `json:"category"`
	Priority string `json:"priority"`
	Body     string `json:"body"`
}

func (s *Server) handleListTickets(c fiber.Ctx) error {
	out, err := s.supportSvc.ListTickets(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateTicket(c fiber.Ctx) error {
	var in ticketInput
	if err := c.Bind().Body(&in); err != nil || in.Subject == "" || in.Body == "" {
		return mw.WriteError(c, errValidation("subject and body required"))
	}
	t, err := s.supportSvc.CreateTicket(c.Context(), supportCreateTicketInput(mustOrgID(c), mustUserID(c), in))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, t, nil)
}

func (s *Server) handleListTicketMessages(c fiber.Ctx) error {
	ticketID, err := uuid.Parse(c.Params("ticket_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid ticket id"))
	}
	out, err := s.supportSvc.ListMessages(c.Context(), mustOrgID(c), ticketID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleReplyTicket(c fiber.Ctx) error {
	ticketID, err := uuid.Parse(c.Params("ticket_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid ticket id"))
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := c.Bind().Body(&body); err != nil || body.Body == "" {
		return mw.WriteError(c, errValidation("body required"))
	}
	if err := s.supportSvc.Reply(c.Context(), mustOrgID(c), ticketID, mustUserID(c), body.Body); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "replied"}, nil)
}

func (s *Server) handleCloseTicket(c fiber.Ctx) error {
	ticketID, err := uuid.Parse(c.Params("ticket_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid ticket id"))
	}
	if err := s.supportSvc.CloseTicket(c.Context(), mustOrgID(c), ticketID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "closed"}, nil)
}

// ---- Notifications ----

func (s *Server) handleListNotifications(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	out, err := s.notifSvc.ListForUser(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleMarkNotificationRead(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	notifID, err := uuid.Parse(c.Params("notification_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid notification id"))
	}
	if err := s.notifSvc.MarkRead(c.Context(), userID, notifID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "read"}, nil)
}

func (s *Server) handleGetNotificationPrefs(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	p, err := s.notifSvc.GetPreferences(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, p, nil)
}

func (s *Server) handleUpdateNotificationPrefs(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	var p struct {
		EmailEnabled    *bool `json:"email_enabled"`
		WebEnabled      *bool `json:"web_enabled"`
		SmsEnabled      *bool `json:"sms_enabled"`
		BillingEvents   *bool `json:"billing_events"`
		SecurityEvents  *bool `json:"security_events"`
		ProductEvents   *bool `json:"product_events"`
		MarketingEvents *bool `json:"marketing_events"`
	}
	if err := c.Bind().Body(&p); err != nil {
		return mw.WriteError(c, errValidation("invalid body"))
	}
	current, err := s.notifSvc.GetPreferences(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if p.EmailEnabled != nil {
		current.EmailEnabled = *p.EmailEnabled
	}
	if p.WebEnabled != nil {
		current.WebEnabled = *p.WebEnabled
	}
	if p.SmsEnabled != nil {
		current.SmsEnabled = *p.SmsEnabled
	}
	if p.BillingEvents != nil {
		current.BillingEvents = *p.BillingEvents
	}
	if p.SecurityEvents != nil {
		current.SecurityEvents = *p.SecurityEvents
	}
	if p.ProductEvents != nil {
		current.ProductEvents = *p.ProductEvents
	}
	if p.MarketingEvents != nil {
		current.MarketingEvents = *p.MarketingEvents
	}
	if err := s.notifSvc.UpdatePreferences(c.Context(), userID, current); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, current, nil)
}

// ---- Webhooks ----

type webhookInput struct {
	Name   string   `json:"name"`
	URL    string   `json:"url"`
	Events []string `json:"events"`
}

func (s *Server) handleListWebhooks(c fiber.Ctx) error {
	out, err := s.webhookSvc.List(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateWebhook(c fiber.Ctx) error {
	var in webhookInput
	if err := c.Bind().Body(&in); err != nil || in.URL == "" || len(in.Events) == 0 {
		return mw.WriteError(c, errValidation("url and events required"))
	}
	w, secret, err := s.webhookSvc.Create(c.Context(), mustOrgID(c), mustUserID(c), in.Name, in.URL, in.Events)
	if err != nil {
		return mw.WriteError(c, err)
	}
	resp := fiber.Map{"webhook": w}
	if secret != "" {
		resp["secret"] = secret
	}
	return mw.JSON(c, 201, resp, nil)
}

func (s *Server) handleDeleteWebhook(c fiber.Ctx) error {
	webhookID, err := uuid.Parse(c.Params("webhook_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid webhook id"))
	}
	if err := s.webhookSvc.Delete(c.Context(), mustOrgID(c), webhookID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

// ---- Audit logs ----

func (s *Server) handleListAuditLogs(c fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	out, err := s.auditSvc.List(c.Context(), mustOrgID(c), limit)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// ---- Notifications: mark all read ----

func (s *Server) handleMarkAllNotificationsRead(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	if err := s.notifSvc.MarkAllRead(c.Context(), userID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "read"}, nil)
}

// ---- Webhook deliveries ----

type webhookDeliveryView struct {
	ID             uuid.UUID `json:"id"`
	WebhookID      uuid.UUID `json:"webhook_id"`
	WebhookName    string    `json:"webhook_name"`
	EventID        uuid.UUID `json:"event_id"`
	ResponseStatus int       `json:"response_status"`
	Attempts       int       `json:"attempts"`
	DeliveredAt    string    `json:"delivered_at,omitempty"`
	LastError      string    `json:"last_error,omitempty"`
	CreatedAt      string    `json:"created_at"`
}

// handleListWebhookDeliveries returns the organization's most recent webhook
// delivery attempts across all of its webhooks (latest 100).
func (s *Server) handleListWebhookDeliveries(c fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
SELECT wd.id, wd.webhook_id, w.name, wd.event_id,
       COALESCE(wd.response_status,0), wd.attempts,
       CASE WHEN wd.delivered_at IS NULL THEN '' ELSE wd.delivered_at::text END,
       COALESCE(wd.last_error,''), wd.created_at::text
FROM webhook_deliveries wd
JOIN webhooks w ON w.id = wd.webhook_id
WHERE w.organization_id=$1
ORDER BY wd.created_at DESC
LIMIT 100`, mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	deliveries := []webhookDeliveryView{}
	for rows.Next() {
		var d webhookDeliveryView
		if err := rows.Scan(&d.ID, &d.WebhookID, &d.WebhookName, &d.EventID,
			&d.ResponseStatus, &d.Attempts, &d.DeliveredAt, &d.LastError, &d.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		deliveries = append(deliveries, d)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	const perPage = 100
	return httputil.OK(c, 200, deliveries, &httputil.Meta{
		Page: 1, PerPage: perPage, Total: len(deliveries),
	})
}
