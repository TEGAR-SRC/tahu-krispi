package api

import (
	apperrors "kilat.cloud/backend/pkg/errors"
)

func errInvalidOrganizationID() error {
	return apperrors.WithFields(
		apperrors.New(apperrors.CodeValidation, "invalid organization id"),
		map[string]string{"organization_id": "must be a valid uuid"})
}
