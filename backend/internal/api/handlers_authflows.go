// handlers_authflows.go implements the password and email flows of Master
// Prompt §11-12: forgot/reset/change password plus email verification.
package api

import (
	"github.com/gofiber/fiber/v3"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/user"
	mw "kilat.cloud/backend/pkg/middleware"
)

// auditRequestID reads the request id from Locals for audit entries.
func auditRequestID(c fiber.Ctx) string {
	reqID, _ := c.Locals("request_id").(string)
	return reqID
}

type forgotPasswordInput struct {
	Email string `json:"email"`
}

func (s *Server) handleForgotPassword(c fiber.Ctx) error {
	var in forgotPasswordInput
	if err := c.Bind().Body(&in); err != nil || in.Email == "" {
		return mw.WriteError(c, vErrField("email", "required"))
	}
	out, err := s.userSvc.ForgotPassword(c.Context(), in.Email)
	if err != nil {
		return mw.WriteError(c, err)
	}
	// No audit entry here on purpose: ForgotPassword never reveals whether the
	// address exists, and logging would leak exactly that.
	return mw.JSON(c, 200, fiber.Map{"token_sent": out.TokenSent}, nil)
}

type resetPasswordInput struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

func (s *Server) handleResetPassword(c fiber.Ctx) error {
	var in resetPasswordInput
	if err := c.Bind().Body(&in); err != nil || in.Token == "" || in.NewPassword == "" {
		return mw.WriteError(c, errValidation("token and new_password are required"))
	}
	if err := s.userSvc.ResetPassword(c.Context(), in.Token, in.NewPassword, c.IP()); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		Action: "auth.password_reset", ResourceType: "user",
		IP: c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "password_reset"}, nil)
}

type changePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (s *Server) handleChangePassword(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in changePasswordInput
	if err := c.Bind().Body(&in); err != nil || in.CurrentPassword == "" || in.NewPassword == "" {
		return mw.WriteError(c, errValidation("current_password and new_password are required"))
	}
	err := s.userSvc.ChangePassword(c.Context(), user.ChangePasswordInput{
		UserID:    userID,
		Current:   in.CurrentPassword,
		New:       in.NewPassword,
		IP:        c.IP(),
		UserAgent: c.Get("User-Agent"),
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "auth.password_changed", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "password_changed"}, nil)
}

type verifyEmailInput struct {
	Token string `json:"token"`
}

func (s *Server) handleVerifyEmail(c fiber.Ctx) error {
	var in verifyEmailInput
	if err := c.Bind().Body(&in); err != nil || in.Token == "" {
		return mw.WriteError(c, vErrField("token", "required"))
	}
	if err := s.userSvc.VerifyEmail(c.Context(), in.Token); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		Action: "auth.email_verified", ResourceType: "user",
		IP: c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "email_verified"}, nil)
}

func (s *Server) handleResendEmailVerification(c fiber.Ctx) error {
	userID := mustUserID(c)
	if err := s.userSvc.ResendEmailVerification(c.Context(), userID); err != nil {
		return mw.WriteError(c, err)
	}
	// The service records no auth event for resends; add one here.
	_ = user.LogAuthEvent(s.db, c.Context(), userID, "email_verification_resent",
		true, c.IP(), c.Get("User-Agent"))
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "auth.email_verification_resent", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "verification_sent"}, nil)
}
