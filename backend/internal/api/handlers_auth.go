package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/user"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// JSONError writes the standard error envelope for any error.

func errValidation(msg string) error {
	return apperrors.New(apperrors.CodeValidation, msg)
}

func vErrField(field, msg string) error {
	return apperrors.WithFields(
		apperrors.New(apperrors.CodeValidation, msg),
		map[string]string{field: msg})
}

func upper(s string) string { return strings.ToUpper(s) }

func (s *Server) handleRegister(c fiber.Ctx) error {
	var in user.RegisterInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	in.IP = c.IP()
	in.UserAgent = c.Get("User-Agent")
	// Referral attribution: ?ref= query param wins over the tracking cookie
	// dropped by POST /v1/affiliate/track/:code.
	in.ReferralCode = c.Query("ref")
	if in.ReferralCode == "" {
		in.ReferralCode = c.Cookies("ref")
	}
	out, err := s.userSvc.Register(c.Context(), in)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, out, nil)
}

func (s *Server) handleLogin(c fiber.Ctx) error {
	var in user.LoginInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	in.IP = c.IP()
	in.UserAgent = c.Get("User-Agent")
	out, err := s.userSvc.Login(c.Context(), in)
	if err != nil {
		return mw.WriteError(c, err)
	}
	// BFF: set session cookie so browser never needs to handle JWT.
	if !out.MFARequired && out.SessionID != uuid.Nil {
		s.setSessionCookie(c, out.SessionID)
		// Return minimal body — tokens remain server-side. Keep compat field
		// access_token for older SPAs, but caller should rely on cookie.
		return mw.JSON(c, 200, fiber.Map{"user_id": out.UserID, "session_id": out.SessionID, "must_change_password": out.MustChangePassword}, nil)
	}
	return mw.JSON(c, 200, out, nil)
}

type loginMFAInput struct {
	PreauthToken string `json:"preauth_token"`
	Code         string `json:"code"`
}

// handleLoginMFA completes the second factor of a login that returned
// mfa_required=true: verifies the TOTP code bound to the preauth token and,
// on success, issues the real session and tokens.
func (s *Server) handleLoginMFA(c fiber.Ctx) error {
	var in loginMFAInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	out, err := s.userSvc.CompleteLoginWithTOTP(c.Context(), in.PreauthToken, in.Code, c.IP(), c.Get("User-Agent"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	if out.SessionID != uuid.Nil {
		s.setSessionCookie(c, out.SessionID)
		return mw.JSON(c, 200, fiber.Map{"user_id": out.UserID, "session_id": out.SessionID, "must_change_password": out.MustChangePassword}, nil)
	}
	return mw.JSON(c, 200, out, nil)
}

type refreshInput struct {
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) handleRefresh(c fiber.Ctx) error {
	// Prefer cookie session refresh (no body needed).
	if sid, ok := sessionIDFromCookie(c); ok {
		// Rotate via session ID lookup
		userID, ok := s.authSvc.SessionByID(c.Context(), sid)
		if !ok {
			clearSessionCookie(c)
			return mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "session expired"))
		}
		// Refresh extends expiry
		_, err := s.authSvc.RefreshSession(c.Context(), sid)
		if err != nil {
			clearSessionCookie(c)
			return mw.WriteError(c, err)
		}
		s.setSessionCookie(c, sid)
		return mw.JSON(c, 200, fiber.Map{"user_id": userID, "session_id": sid}, nil)
	}
	var in refreshInput
	if err := c.Bind().Body(&in); err != nil || in.RefreshToken == "" {
		return mw.WriteError(c, errValidation("refresh_token required"))
	}
	userID, sessionID, newRefresh, pwVersion, err := s.authSvc.RotateRefreshToken(c.Context(), in.RefreshToken)
	if err != nil {
		return mw.WriteError(c, err)
	}
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, pwVersion, []string{"profile.read"})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"access_token": at, "refresh_token": newRefresh}, nil)
}

func (s *Server) handleLogout(c fiber.Ctx) error {
	sessionStr, _ := c.Locals("auth_session_id").(string)
	sessionID, _ := uuid.Parse(sessionStr)
	// also try cookie if locals empty (e.g. cookie-only request)
	if sessionID == uuid.Nil {
		if sid, ok := sessionIDFromCookie(c); ok {
			sessionID = sid
		}
	}
	if sessionID != uuid.Nil {
		_ = s.authSvc.RevokeSession(c.Context(), sessionID, "logout")
	}
	clearSessionCookie(c)
	return mw.JSON(c, 200, fiber.Map{"status": "logged_out"}, nil)
}

func (s *Server) handleLogoutAll(c fiber.Ctx) error {
	userStr, _ := c.Locals(auth.LocalsUserID).(string)
	userID, _ := uuid.Parse(userStr)
	if err := s.authSvc.RevokeAllSessions(c.Context(), userID, "logout_all"); err != nil {
		return mw.WriteError(c, err)
	}
	clearSessionCookie(c)
	return mw.JSON(c, 200, fiber.Map{"status": "all_sessions_revoked"}, nil)
}

// handleSession returns current session info for cookie-auth SPAs.
func (s *Server) handleSession(c fiber.Ctx) error {
	userStr, _ := c.Locals(auth.LocalsUserID).(string)
	sessionStr, _ := c.Locals(auth.LocalsSessionID).(string)
	userID, _ := uuid.Parse(userStr)
	sessionID, _ := uuid.Parse(sessionStr)
	p, _ := s.userRepo.GetProfile(c.Context(), userID)
	return mw.JSON(c, 200, fiber.Map{"user_id": userID, "session_id": sessionID, "profile": p}, nil)
}

// handleHandoffExchange exchanges a single-use handoff code for a session cookie.
func (s *Server) handleHandoffExchange(c fiber.Ctx) error {
	var in struct {
		Code string `json:"code"`
	}
	if err := c.Bind().Body(&in); err != nil || in.Code == "" {
		in.Code = c.Query("code")
	}
	if in.Code == "" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "code required"))
	}
	sid, err := s.consumeHandoffCode(c, in.Code)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "invalid or expired code"))
	}
	if _, ok := s.authSvc.SessionByID(c.Context(), sid); !ok {
		return mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "session expired"))
	}
	s.setSessionCookie(c, sid)
	return mw.JSON(c, 200, fiber.Map{"session_id": sid}, nil)
}

// handleHandoffCreate creates a single-use handoff code for the current session.
func (s *Server) handleHandoffCreate(c fiber.Ctx) error {
	sessionStr, _ := c.Locals(auth.LocalsSessionID).(string)
	sid, _ := uuid.Parse(sessionStr)
	if sid == uuid.Nil {
		if ck, ok := sessionIDFromCookie(c); ok {
			sid = ck
		}
	}
	if sid == uuid.Nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "not authenticated"))
	}
	code, err := s.newHandoffCode(c, sid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"code": code}, nil)
}

func (s *Server) handleMe(c fiber.Ctx) error {
	userStr, _ := c.Locals(auth.LocalsUserID).(string)
	userID, _ := uuid.Parse(userStr)
	p, err := s.userRepo.GetProfile(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, p, nil)
}

type updateProfileInput struct {
	FullName    string         `json:"full_name"`
	DisplayName string         `json:"display_name"`
	CompanyName string         `json:"company_name"`
	CountryCode string         `json:"country_code"`
	TaxID       string         `json:"tax_id"`
	Preferences map[string]any `json:"preferences"`
	Metadata    map[string]any `json:"metadata"`
}

func (s *Server) handleUpdateProfile(c fiber.Ctx) error {
	userStr, _ := c.Locals(auth.LocalsUserID).(string)
	userID, _ := uuid.Parse(userStr)
	var in updateProfileInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.CountryCode != "" && len(in.CountryCode) != 2 {
		return mw.WriteError(c, vErrField("country_code", "must be a 2-letter ISO code"))
	}
	p, err := s.userRepo.UpdateProfile(c.Context(), user.UpdateProfileInput{
		UserID: userID, FullName: in.FullName, DisplayName: in.DisplayName,
		CompanyName: in.CompanyName, CountryCode: upper(in.CountryCode), TaxID: in.TaxID,
		Preferences: in.Preferences, Metadata: in.Metadata,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, p, nil)
}
