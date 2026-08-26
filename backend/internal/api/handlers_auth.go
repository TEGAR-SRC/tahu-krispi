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
	return mw.JSON(c, 200, out, nil)
}

type refreshInput struct {
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) handleRefresh(c fiber.Ctx) error {
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
	if err := s.authSvc.RevokeSession(c.Context(), sessionID, "logout"); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "logged_out"}, nil)
}

func (s *Server) handleLogoutAll(c fiber.Ctx) error {
	userStr, _ := c.Locals(auth.LocalsUserID).(string)
	userID, _ := uuid.Parse(userStr)
	if err := s.authSvc.RevokeAllSessions(c.Context(), userID, "logout_all"); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "all_sessions_revoked"}, nil)
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
