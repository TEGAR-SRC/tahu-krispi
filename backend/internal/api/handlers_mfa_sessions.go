// handlers_mfa_sessions.go implements session/device listing and revocation,
// the security activity feed, and TOTP multi-factor enrolment (Master Prompt
// §15-18).
package api

import (
	"errors"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/user"
	apperrors "kilat.cloud/backend/pkg/errors"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Sessions ----

func (s *Server) handleListSessions(c fiber.Ctx) error {
	userID := mustUserID(c)
	currentStr, _ := c.Locals(auth.LocalsSessionID).(string)
	currentSessionID, _ := uuid.Parse(currentStr)
	sessions, err := user.ListSessions(s.db, c.Context(), userID, currentSessionID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, sessions,
		&httputil.Meta{Page: 1, PerPage: len(sessions), Total: len(sessions)})
}

func (s *Server) handleRevokeSession(c fiber.Ctx) error {
	userID := mustUserID(c)
	sessionID, err := uuid.Parse(c.Params("session_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("session_id", "must be a valid uuid"))
	}
	var owner uuid.UUID
	err = s.db.QueryRow(c.Context(),
		`SELECT user_id FROM user_sessions WHERE id=$1`, sessionID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "session not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	if owner != userID {
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "not your session"))
	}
	if err := s.authSvc.RevokeSession(c.Context(), sessionID, "revoked_by_user"); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "auth.session_revoked", ResourceType: "user_session",
		ResourceID: &sessionID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "revoked", "session_id": sessionID}, nil)
}

func (s *Server) handleListSecurityEvents(c fiber.Ctx) error {
	userID := mustUserID(c)
	limit := 0 // ListAuthEvents applies its own default/clamp when non-positive
	if n, err := strconv.Atoi(c.Query("limit")); err == nil && n > 0 {
		limit = n
	}
	events, err := user.ListAuthEvents(s.db, c.Context(), userID, limit)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var total int
	if err := s.db.QueryRow(c.Context(),
		`SELECT count(*) FROM auth_events WHERE user_id=$1`, userID).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, events,
		&httputil.Meta{Page: 1, PerPage: len(events), Total: total})
}

// ---- MFA (TOTP + recovery codes) ----

func (s *Server) handleGetMFAStatus(c fiber.Ctx) error {
	userID := mustUserID(c)
	enabled, err := s.mfaMgr.HasMFA(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var remaining int
	if err := s.db.QueryRow(c.Context(),
		`SELECT count(*) FROM user_recovery_codes WHERE user_id=$1 AND used_at IS NULL`,
		userID).Scan(&remaining); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"enabled":                  enabled,
		"recovery_codes_remaining": remaining,
	}, nil)
}

func (s *Server) handleMFASetupTOTP(c fiber.Ctx) error {
	userID := mustUserID(c)
	secret, otpauthURL, err := s.mfaMgr.SetupTOTP(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.totp_setup_started", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{
		"secret":      secret,
		"otpauth_url": otpauthURL,
	}, nil)
}

type mfaConfirmTOTPInput struct {
	Code string `json:"code"`
}

func (s *Server) handleMFAConfirmTOTP(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in mfaConfirmTOTPInput
	if err := c.Bind().Body(&in); err != nil || in.Code == "" {
		return mw.WriteError(c, vErrField("code", "required"))
	}
	if err := s.mfaMgr.ConfirmTOTP(c.Context(), userID, in.Code); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.totp_enabled", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "mfa_enabled"}, nil)
}

func (s *Server) handleMFADisable(c fiber.Ctx) error {
	userID := mustUserID(c)
	if err := s.mfaMgr.Disable(c.Context(), userID); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.disabled", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "mfa_disabled"}, nil)
}

func (s *Server) handleRegenerateRecoveryCodes(c fiber.Ctx) error {
	userID := mustUserID(c)
	codes, err := s.mfaMgr.RecoveryCodesGenerate(c.Context(), userID, 10)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.recovery_codes_regenerated", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	// Plaintext codes are shown exactly once; only hashes are stored.
	return mw.JSON(c, 200, fiber.Map{"recovery_codes": codes}, nil)
}
