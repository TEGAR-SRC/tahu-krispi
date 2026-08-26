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
