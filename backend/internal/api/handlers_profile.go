// handlers_profile.go implements the profile-completion score of Master
// Prompt §71.
package api

import (
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// handleProfileCompletion scores the account in a single query over users
// joined to user_profiles. Required checks (25% each): verified email, full
// name, country code, and an existing billing address. Optional checks
// (weight 0, reported only): verified phone, tax id, avatar.
func (s *Server) handleProfileCompletion(c fiber.Ctx) error {
	userID := mustUserID(c)
	var (
		emailStatus       string
		phoneStatus       string
		hasFullName       bool
		countryCode       string
		hasTaxID          bool
		hasAvatar         bool
		hasBillingAddress bool
	)
	err := s.db.QueryRow(c.Context(), `
SELECT u.email_status::text,
       u.phone_status::text,
       COALESCE(p.full_name,'') <> '',
       COALESCE(p.country_code::text,''),
       COALESCE(p.tax_id,'') <> '',
       (p.avatar_object_id IS NOT NULL),
       EXISTS(SELECT 1 FROM user_addresses a
              WHERE a.user_id=u.id AND a.type='billing' AND a.deleted_at IS NULL)
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.id
WHERE u.id=$1 AND u.deleted_at IS NULL`, userID).
		Scan(&emailStatus, &phoneStatus, &hasFullName, &countryCode,
			&hasTaxID, &hasAvatar, &hasBillingAddress)
	if errors.Is(err, pgx.ErrNoRows) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "user not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}

	emailVerified := emailStatus == "verified"
	phoneVerified := phoneStatus == "verified"
	hasCountry := countryCode != ""

	required := [4]bool{emailVerified, hasFullName, hasCountry, hasBillingAddress}
	done := 0
	for _, ok := range required {
		if ok {
			done++
		}
	}
	percent := done * 100 / len(required)

	missing := []string{}
	if !emailVerified {
		missing = append(missing, "email_verification")
	}
	if !phoneVerified {
		missing = append(missing, "phone_verification")
	}
	if !hasFullName {
		missing = append(missing, "full_name")
	}
	if !hasCountry {
		missing = append(missing, "country_code")
	}
	if !hasBillingAddress {
		missing = append(missing, "billing_address")
	}
	if !hasTaxID {
		missing = append(missing, "tax_id")
	}
	if !hasAvatar {
		missing = append(missing, "avatar")
	}

	return mw.JSON(c, 200, fiber.Map{
		"profile_completion_percent": percent,
		"missing_requirements":       missing,
	}, nil)
}
