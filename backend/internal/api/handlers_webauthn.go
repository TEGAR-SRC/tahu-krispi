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
