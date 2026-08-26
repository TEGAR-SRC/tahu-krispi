package auth

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	LocalsUserID         = "auth_user_id"
	LocalsOrganizationID = "auth_org_id"
	LocalsSessionID      = "auth_session_id"
	LocalsScopes         = "auth_scopes"
	LocalsAuthType       = "auth_type"
)

// RequireAuth validates a Bearer JWT and stores claims in Locals.
func (s *Service) RequireAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		header := c.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			return writeUnauthorized(c)
		}
		token := strings.TrimPrefix(header, "Bearer ")
		claims, err := s.VerifyAccessToken(token)
		if err != nil {
			return writeUnauthorized(c)
		}
		c.Locals(LocalsUserID, claims.UserID)
		c.Locals(LocalsSessionID, claims.SessionID)
		c.Locals(LocalsScopes, claims.Scopes)
		c.Locals(LocalsOrganizationID, claims.OrganizationID)
		return c.Next()
	}
}

func writeUnauthorized(c fiber.Ctx) error {
	err := apperrors.New(apperrors.CodeUnauthorized, "authentication required")
	reqID, _ := c.Locals("request_id").(string)
	return c.Status(401).JSON(fiber.Map{
		"error":      fiber.Map{"code": string(err.Code), "message": err.Message},
		"request_id": reqID,
	})
}
