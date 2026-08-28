// handlers_webauthn.go implements passkey (WebAuthn) enrolment and management
// endpoints (Master Prompt §21).
package api

import (
	"encoding/json"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/audit"
	mw "kilat.cloud/backend/pkg/middleware"
)

func (s *Server) handleListPasskeys(c fiber.Ctx) error {
	userID := mustUserID(c)
	passkeys, err := s.passkeyMgr.ListPasskeys(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"passkeys": passkeys}, nil)
}

func (s *Server) handleBeginPasskeyRegistration(c fiber.Ctx) error {
	userID := mustUserID(c)
	options, err := s.passkeyMgr.BeginRegistration(c.Context(), userID, "")
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.passkey_registration_started", ResourceType: "user",
		ResourceID: &userID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"options": options}, nil)
}

type passkeyRegisterInput struct {
	Credential json.RawMessage `json:"credential"`
	Label      string          `json:"label"`
}

func (s *Server) handleRegisterPasskey(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in passkeyRegisterInput
	if err := c.Bind().Body(&in); err != nil || len(in.Credential) == 0 {
		return mw.WriteError(c, vErrField("credential", "required"))
	}
	passkey, err := s.passkeyMgr.FinishRegistration(c.Context(), userID, in.Credential, in.Label)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.passkey.registered", ResourceType: "mfa_method",
		ResourceID: &passkey.ID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"passkey": passkey}, nil)
}

func (s *Server) handleRemovePasskey(c fiber.Ctx) error {
	userID := mustUserID(c)
	methodID, err := uuid.Parse(c.Params("method_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("method_id", "must be a valid uuid"))
	}
	if err := s.passkeyMgr.RemovePasskey(c.Context(), userID, methodID); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "mfa.passkey.removed", ResourceType: "mfa_method",
		ResourceID: &methodID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "removed", "id": methodID}, nil)
}

// ---- Passkey login (unauthenticated) ------------------------------------------

func (s *Server) handleBeginPasskeyLogin(c fiber.Ctx) error {
	assertion, handle, err := s.passkeyMgr.BeginAuthentication(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"options": assertion, "handle": handle}, nil)
}

type passkeyLoginInput struct {
	Credential json.RawMessage `json:"credential"`
	Handle     string          `json:"handle"`
}

func (s *Server) handlePasskeyLogin(c fiber.Ctx) error {
	var in passkeyLoginInput
	if err := c.Bind().Body(&in); err != nil || len(in.Credential) == 0 || in.Handle == "" {
		return mw.WriteError(c, vErrField("credential and handle", "required"))
	}
	userID, err := s.passkeyMgr.FinishAuthentication(c.Context(), in.Handle, in.Credential)
	if err != nil {
		return mw.WriteError(c, err)
	}

	// No bypass: if TOTP MFA is enabled the passkey ceremony is only the
	// first factor. Hand back a preauth token so the caller must still
	// supply the TOTP code on /auth/login/mfa, same as the password flow.
	hasMFA, err := s.mfaMgr.HasMFA(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if hasMFA {
		preauth, err := s.userSvc.CreatePreauthToken(c.Context(), userID)
		if err != nil {
			return mw.WriteError(c, err)
		}
		s.auditSvc.Log(c.Context(), audit.Entry{
			ActorUserID: &userID, Action: "auth.passkey_login_mfa_required", ResourceType: "user",
			ResourceID: &userID,
			IP: c.IP(), UserAgent: c.Get("User-Agent"),
			RequestID: auditRequestID(c),
		})
		return mw.JSON(c, 200, fiber.Map{
			"user_id":       userID,
			"mfa_required":  true,
			"preauth_token": preauth,
		}, nil)
	}

	// Issue tokens like normal login.
	sessionID, rawRefresh, err := s.authSvc.CreateSession(c.Context(), userID, "", c.IP(), c.Get("User-Agent"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, 0, []string{"profile.read"})
	if err != nil {
		return mw.WriteError(c, err)
	}

	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "auth.passkey_login", ResourceType: "user",
		ResourceID: &userID,
		IP: c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})

	return mw.JSON(c, 200, fiber.Map{
		"access_token":  at,
		"refresh_token": rawRefresh,
	}, nil)
}
