package api

import (
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/iam"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// jwtAuth verifies a Bearer token and materializes request locals BEFORE the
// handler chain runs (RequireAuth advances the chain itself, so it cannot be wrapped).
func (s *Server) jwtAuth(c fiber.Ctx) bool {
	header := c.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "authentication required"))
		return false
	}
	claims, err := s.authSvc.VerifyAccessToken(strings.TrimPrefix(header, "Bearer "))
	if err != nil {
		mw.WriteError(c, apperrors.New(apperrors.CodeUnauthorized, "authentication required"))
		return false
	}
	c.Locals(auth.LocalsUserID, claims.UserID)
	c.Locals(auth.LocalsSessionID, claims.SessionID)
	c.Locals(auth.LocalsScopes, claims.Scopes)
	c.Locals(auth.LocalsOrganizationID, claims.OrganizationID)
	c.Locals("auth_type", "jwt")
	if id, perr := uuid.Parse(claims.UserID); perr == nil {
		c.Locals("user_id_uuid", id)
	}
	if claims.OrganizationID != "" {
		c.Locals("org_id", claims.OrganizationID)
	}
	return true
}

// authJWT requires a Bearer JWT.
func (s *Server) authJWT() fiber.Handler {
	return func(c fiber.Ctx) error {
		if !s.jwtAuth(c) {
			return nil // 401 already written; stop the chain
		}
		return c.Next()
	}
}

// authAny accepts either a Bearer JWT or an X-API-Key header.
// For API keys the scopes are stored in locals for per-endpoint enforcement.
func (s *Server) authAny() fiber.Handler {
	return func(c fiber.Ctx) error {
		if raw := strings.TrimSpace(c.Get("X-API-Key")); raw != "" {
			info, err := s.apikeySvc.Authenticate(c.Context(), raw, c.IP())
			if err != nil {
				mw.WriteError(c, err)
				return nil // stop the chain
			}
			c.Locals("auth_type", "api_key")
			c.Locals("api_key_id", info.KeyID.String())
			if info.UserID != uuid.Nil {
				c.Locals("auth_user_id", info.UserID.String())
				c.Locals("user_id_uuid", info.UserID)
			}
			if info.OrgID != uuid.Nil {
				c.Locals("org_id", info.OrgID.String())
			}
			c.Locals("auth_scopes", info.Scopes)
			return c.Next()
		}
		if !s.jwtAuth(c) {
			return nil // stop the chain
		}
		return c.Next()
	}
}

// staffAreaFor resolves the admin-console area a route belongs to; empty
// means platform_admin only.
func staffAreaFor(method, path string) string {
	// Dokploy PaaS surface stays platform_admin-only by default: the universal
	// proxy (/v1/dokploy/*) can reach every upstream operation including
	// server-level ones, so no staff area may touch it until per-org scoping
	// lands. Opening it to customers is a deliberate later change.
	if strings.HasPrefix(path, "/dokploy") || strings.HasPrefix(path, "/v1/dokploy/") {
		return ""
	}
	// Provider CRUD is platform-admin only ("admin yang bisa tambahkan");
	// NOC keeps GET listing and POST .../sync.
	if strings.HasPrefix(path, "/providers") {
		if method == http.MethodGet {
			return "infra"
		}
		if method == http.MethodPost && strings.HasSuffix(path, "/sync") {
			return "infra"
		}
		return ""
	}
	switch {
	case strings.HasPrefix(path, "/orders"), strings.HasPrefix(path, "/invoices"),
		strings.HasPrefix(path, "/payments"), strings.HasPrefix(path, "/wallets"),
		strings.HasPrefix(path, "/coupons"), strings.HasPrefix(path, "/products"),
		strings.HasPrefix(path, "/plans"), strings.HasPrefix(path, "/custom-rates"),
		strings.HasPrefix(path, "/regions"), strings.HasPrefix(path, "/affiliate"),
		strings.HasPrefix(path, "/finance"):
		return "billing"
	case strings.HasPrefix(path, "/instances"), strings.HasPrefix(path, "/jobs"),
		strings.HasPrefix(path, "/orphans"), strings.HasPrefix(path, "/security-incidents"),
		strings.HasPrefix(path, "/blocked-networks"),
		strings.HasPrefix(path, "/organizations/") && strings.HasSuffix(path, "/provider-account"),
		strings.HasPrefix(path, "/storage-backends"):
		return "infra"
	case strings.HasPrefix(path, "/tickets"):
		return "tickets"
	case strings.HasPrefix(path, "/users"):
		// Staff may view customer accounts; mutations stay admin-only.
		if !strings.Contains(path, "/users/:") {
			return "users"
		}
		return ""
	default:
		return ""
	}
}

// requireStaff restricts an admin route to platform admins or staff roles
// granted the given console area ("", i.e. empty, is platform_admin only).
// The user row is read fresh from the DB on every request so role changes
// take effect without re-login.
func (s *Server) requireStaff(area string) fiber.Handler {
	return func(c fiber.Ctx) error {
		if area == "auto" {
			area = staffAreaFor(string(c.Method()), strings.TrimPrefix(c.Path(), "/v1/admin"))
		}
		userStr, _ := c.Locals(auth.LocalsUserID).(string)
		userID, err := uuid.Parse(userStr)
		if err != nil {
			return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "staff access required"))
		}
		var (
			isAdmin   bool
			staffRole string
		)
		err = s.db.QueryRow(c.Context(),
			`SELECT is_platform_admin, staff_role FROM users WHERE id=$1 AND deleted_at IS NULL`,
			userID).Scan(&isAdmin, &staffRole)
		if err != nil || (!isAdmin && !iam.StaffCan(iam.StaffRole(staffRole), area)) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "staff access required"))
		}
		c.Locals("user_id_uuid", userID)
		return c.Next()
	}
}
