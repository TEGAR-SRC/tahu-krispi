// handlers_contact.go implements the email/phone change flow (Master Prompt
// §13-14) and phone OTP verification.
package api

import (
	"fmt"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/user"
	mw "kilat.cloud/backend/pkg/middleware"
)

type requestContactChangeInput struct {
	Kind     string `json:"kind"` // "email" | "phone"
	NewValue string `json:"new_value"`
}

func (s *Server) handleRequestContactChange(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in requestContactChangeInput
	if err := c.Bind().Body(&in); err != nil || in.Kind == "" || in.NewValue == "" {
		return mw.WriteError(c, errValidation("kind and new_value are required"))
	}
	ip, ua := c.IP(), c.Get("User-Agent")
	if err := s.userSvc.RequestContactChange(c.Context(), userID, in.Kind, in.NewValue, ip, ua); err != nil {
		return mw.WriteError(c, err)
	}

	// The pending request row was just created; pick the newest one for this
	// user and kind so the verification token can be attached to it.
	var requestID uuid.UUID
	err := s.db.QueryRow(c.Context(), `
SELECT id FROM contact_change_requests
WHERE user_id=$1 AND kind=$2::address_change_kind AND status='pending'
ORDER BY created_at DESC LIMIT 1`, userID, in.Kind).Scan(&requestID)
	if err != nil {
		return mw.WriteError(c, fmt.Errorf("locate pending change request: %w", err))
	}
	token, err := user.IssueContactChangeToken(s.db, c.Context(), requestID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	// Queue the delivery job; the notification worker sends queued email rows.
	currentValue := s.currentContactValue(c, userID, in.Kind)
	subject, body := contactChangeMailContent(in.Kind, currentValue, in.NewValue, token)
	eventType := "email_changed"
	if in.Kind == "phone" {
		eventType = "phone_changed"
	}
	if _, err := s.db.Exec(c.Context(), `
INSERT INTO notifications(user_id, channel, event_type, subject, body, status)
VALUES ($1,'email',$2,$3,$4,'queued')`, userID, eventType, subject, body); err != nil {
		return mw.WriteError(c, fmt.Errorf("queue confirmation email: %w", err))
	}

	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "contact.change_requested", ResourceType: "user",
		ResourceID: &requestID,
		Metadata:   map[string]any{"kind": in.Kind},
		IP:         ip, UserAgent: ua,
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{
		"status":            "pending",
		"kind":              in.Kind,
		"verification_sent": true,
	}, nil)
}

// currentContactValue reads the value being replaced so the mail can show the
// old → new pair. Empty when unset.
func (s *Server) currentContactValue(c fiber.Ctx, userID uuid.UUID, kind string) string {
	q := `SELECT COALESCE(email::text,'') FROM users WHERE id=$1`
	if kind == "phone" {
		q = `SELECT COALESCE(phone_e164,'') FROM users WHERE id=$1`
	}
	var current string
	_ = s.db.QueryRow(c.Context(), q, userID).Scan(&current)
	return current
}

func contactChangeMailContent(kind, oldValue, newValue, token string) (subject, body string) {
	if kind == "phone" {
		subject = "Confirm your new phone number"
		body = fmt.Sprintf(
			"A change of the phone number on your account was requested.\n\n"+
				"Old number: %s\nNew number: %s\n\n"+
				"To confirm, call POST /v1/contact-change/confirm with {\"token\": %q} within 24 hours. "+
				"If you did not request this, ignore this message.", oldValue, newValue, token)
		return subject, body
	}
	subject = "Confirm your new email address"
	body = fmt.Sprintf(
		"A change of the email address on your account was requested.\n\n"+
			"Old email: %s\nNew email: %s\n\n"+
			"To confirm, call POST /v1/contact-change/confirm with {\"token\": %q} within 24 hours. "+
			"If you did not request this, ignore this message.", oldValue, newValue, token)
	return subject, body
}

type confirmContactChangeInput struct {
	Token string `json:"token"`
}

func (s *Server) handleConfirmContactChange(c fiber.Ctx) error {
	var in confirmContactChangeInput
	if err := c.Bind().Body(&in); err != nil || in.Token == "" {
		return mw.WriteError(c, vErrField("token", "required"))
	}
	ip, ua := c.IP(), c.Get("User-Agent")
	kind, newValue, err := user.ConfirmContactChange(s.db, c.Context(), in.Token, ip, ua)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		Action: "contact.change_confirmed", ResourceType: "user",
		Metadata: map[string]any{"kind": kind},
		IP:       ip, UserAgent: ua,
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{
		"status":    "applied",
		"kind":      kind,
		"new_value": newValue,
	}, nil)
}

func (s *Server) handleRequestPhoneOTP(c fiber.Ctx) error {
	userID := mustUserID(c)
	otpDevEcho, err := user.RequestPhoneOTP(s.rdb, s.db, c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "phone.otp_requested", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	resp := fiber.Map{"status": "otp_sent"}
	// Dev-only echo until an SMS/WhatsApp gateway is wired up.
	if s.cfg.OTPDebugEcho {
		resp["otp_dev_echo"] = otpDevEcho
	}
	return mw.JSON(c, 200, resp, nil)
}

type verifyPhoneOTPInput struct {
	OTP string `json:"otp"`
}

func (s *Server) handleVerifyPhoneOTP(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in verifyPhoneOTPInput
	if err := c.Bind().Body(&in); err != nil || in.OTP == "" {
		return mw.WriteError(c, vErrField("otp", "required"))
	}
	if err := user.VerifyPhoneOTP(s.rdb, s.db, c.Context(), userID, in.OTP); err != nil {
		return mw.WriteError(c, err)
	}
	// VerifyPhoneOTP records no auth event itself; add one here.
	_ = user.LogAuthEvent(s.db, c.Context(), userID, "phone_verified",
		true, c.IP(), c.Get("User-Agent"))
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "phone.verified", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "phone_verified"}, nil)
}
