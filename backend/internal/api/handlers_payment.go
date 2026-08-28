package api

import (
	"encoding/json"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/payment"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

type createPaymentInput struct {
	Method string `json:"method"`
}

func (s *Server) handleCreatePayment(c fiber.Ctx) error {
	invoiceID, err := uuid.Parse(c.Params("invoice_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid invoice id"))
	}
	var in createPaymentInput
	_ = c.Bind().Body(&in)
	// Resolve the outstanding amount from the invoice; clients never set the amount.
	amount, currency, aerr := s.paymentSvc.GetInvoiceAmountDue(c.Context(), invoiceID)
	if aerr != nil {
		return mw.WriteError(c, aerr)
	}
	p, err := s.paymentSvc.CreatePayment(c.Context(), payment.CreatePaymentInput{
		InvoiceID:      invoiceID,
		OrganizationID: mustOrgID(c),
		Currency:       currency,
		Amount:         amount,
		Method:         in.Method,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, p, nil)
}

func (s *Server) handlePaymentWebhook(c fiber.Ctx) error {
	raw := c.Body()
	if len(raw) == 0 {
		return mw.WriteError(c, errValidation("empty webhook payload"))
	}

	// SumoPod path — svix triple-header or X-Webhook-Token. Try it first
	// when those headers are present; fall back to the legacy HMAC path
	// for backward compatibility with Midtrans-style webhooks.
	svixID := c.Get("svix-id")
	svixTimestamp := c.Get("svix-timestamp")
	svixSignature := c.Get("svix-signature")
	webhookToken := c.Get("X-Webhook-Token")
	if svixID != "" || svixTimestamp != "" || svixSignature != "" || webhookToken != "" {
		if !s.paymentSvc.VerifySumopodWebhook(raw, svixID, svixTimestamp, svixSignature, webhookToken) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "invalid SumoPod webhook signature"))
		}
		// SumoPod payload shape: { event_type, data: { payment_id, order_id, status, fee, ... } }
		var sp struct {
			EventType string `json:"event_type"`
			Data      struct {
				PaymentID string  `json:"payment_id"`
				OrderID   string  `json:"order_id"`
				Status    string  `json:"status"`
				Fee       float64 `json:"fee"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &sp); err != nil {
			return mw.WriteError(c, errValidation("invalid SumoPod webhook payload"))
		}
		if sp.EventType == "payment.test" {
			return mw.JSON(c, 200, fiber.Map{"status": "test ok"}, nil)
		}
		// Map SumoPod status to internal.
		status := sp.Data.Status
		switch status {
		case "completed":
			status = "paid"
		case "failed", "expired":
			// keep as is
		default:
			// Unknown status — treat as failed to avoid stuck pending.
			if status == "" {
				status = "failed"
			}
		}
		// Resolve our internal payment id via SumoPod's order_id (our public_id) or payment_id (external).
		paymentID, err := s.paymentSvc.FindPaymentIDBySumoPodOrderID(c.Context(), sp.Data.OrderID, sp.Data.PaymentID)
		if err != nil {
			return mw.WriteError(c, err)
		}
		// Synthesize an event_id from the SumoPod payment_id + event_type for idempotency.
		eventID := uuid.NewSHA1(uuid.NameSpaceURL, []byte(sp.Data.PaymentID+":"+sp.EventType))
		if err := s.paymentSvc.ProcessWebhook(c.Context(), payment.WebhookEvent{
			EventID: eventID, PaymentID: paymentID, EventType: sp.EventType, Status: status, Fee: sp.Data.Fee,
			Raw: raw,
		}); err != nil {
			return mw.WriteError(c, err)
		}
		return mw.JSON(c, 200, fiber.Map{"status": "processed"}, nil)
	}

	// Legacy path — X-Signature HMAC.
	signature := c.Get("X-Signature")
	if !s.paymentSvc.VerifyWebhook(raw, signature) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "invalid webhook signature"))
	}
	var ev struct {
		EventID   string  `json:"event_id"`
		PaymentID string  `json:"payment_id"`
		EventType string  `json:"event_type"`
		Status    string  `json:"status"`
		Fee       float64 `json:"fee"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return mw.WriteError(c, errValidation("invalid webhook payload"))
	}
	eventID, err := uuid.Parse(ev.EventID)
	if err != nil {
		return mw.WriteError(c, vErrField("event_id", "valid uuid required"))
	}
	paymentID, err := uuid.Parse(ev.PaymentID)
	if err != nil {
		return mw.WriteError(c, vErrField("payment_id", "valid uuid required"))
	}
	if err := s.paymentSvc.ProcessWebhook(c.Context(), payment.WebhookEvent{
		EventID: eventID, PaymentID: paymentID, EventType: ev.EventType, Status: ev.Status, Fee: ev.Fee,
		Raw: raw,
	}); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "processed"}, nil)
}
