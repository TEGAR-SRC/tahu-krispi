// handlers_resourcelimits.go exposes Onidel-style resource limits:
// an admin endpoint to retune a user's caps and a customer endpoint reporting
// effective limits vs current usage. Route wiring (PATCH
// /admin/users/:user_id/limits, GET /me/resource-limits) lives in server.go.
package api

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Admin: PATCH /admin/users/:user_id/limits ----

type admUserLimitsInput struct {
	MaxHourlyInstances     *int     `json:"max_hourly_instances"`
	MaxInstanceMonthlyCost *float64 `json:"max_instance_monthly_cost"`
}

func (s *Server) adminUpdateUserLimits(c fiber.Ctx) error {
	userID, err := admParseUUIDParam(c, "user_id", "user_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admUserLimitsInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.MaxHourlyInstances == nil && in.MaxInstanceMonthlyCost == nil {
		return mw.WriteError(c, vErrField("max_hourly_instances",
			"at least one of max_hourly_instances or max_instance_monthly_cost is required"))
	}
	if in.MaxHourlyInstances != nil && *in.MaxHourlyInstances <= 0 {
		return mw.WriteError(c, vErrField("max_hourly_instances", "must be greater than 0"))
	}
	if in.MaxInstanceMonthlyCost != nil && *in.MaxInstanceMonthlyCost < 0 {
		return mw.WriteError(c, vErrField("max_instance_monthly_cost", "must be >= 0"))
	}

	sets := []string{}
	args := []any{}
	if in.MaxHourlyInstances != nil {
		args = append(args, *in.MaxHourlyInstances)
		sets = append(sets, fmt.Sprintf("max_hourly_instances=$%d", len(args)))
	}
	if in.MaxInstanceMonthlyCost != nil {
		args = append(args, *in.MaxInstanceMonthlyCost)
		sets = append(sets, fmt.Sprintf("max_instance_monthly_cost=$%d", len(args)))
	}
	args = append(args, userID)
	var (
		maxInst int
		costStr string
		cur     string
	)
	err = s.db.QueryRow(c.Context(),
		fmt.Sprintf(`UPDATE users SET %s WHERE id=$%d AND deleted_at IS NULL
RETURNING max_hourly_instances, max_instance_monthly_cost::text, limit_currency::text`,
			strings.Join(sets, ", "), len(args)), args...).
		Scan(&maxInst, &costStr, &cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "user not found"))
	}
	if err != nil {
		return mw.WriteError(c, err)
	}

	meta := map[string]any{"user_id": userID}
	if in.MaxHourlyInstances != nil {
		meta["max_hourly_instances"] = *in.MaxHourlyInstances
	}
	if in.MaxInstanceMonthlyCost != nil {
		meta["max_instance_monthly_cost"] = *in.MaxInstanceMonthlyCost
	}
	s.admAuditMeta(c, "admin.user.limits_updated", "user", &userID, meta)

	resp := fiber.Map{"id": userID, "limit_currency": cur}
	if in.MaxHourlyInstances != nil {
		resp["max_hourly_instances"] = maxInst
	}
	if in.MaxInstanceMonthlyCost != nil {
		var cost float64
		fmt.Sscanf(costStr, "%f", &cost)
		resp["max_instance_monthly_cost"] = cost
	}
	return mw.JSON(c, 200, resp, nil)
}

// ---- Customer: GET /me/resource-limits ----

// handleGetResourceLimits reports the requester's effective resource limits,
// current hourly-instance usage across the scoped teams, and what remains of
// each allowance. An optional X-Organization-ID header (or organization_id
// query parameter) scopes the view to that team and applies the
// min(team owner, requester) rule; without it the user's own limits apply over
// their own teams.
func (s *Server) handleGetResourceLimits(c fiber.Ctx) error {
	userID := mustUserID(c)

	var orgID *uuid.UUID
	raw := strings.TrimSpace(c.Get("X-Organization-ID"))
	if raw == "" {
		raw = strings.TrimSpace(c.Query("organization_id"))
	}
	if raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			return mw.WriteError(c, errInvalidOrganizationID())
		}
		orgID = &id
	}
	snap, err := s.computeSvc.ResourceLimitSnapshot(c.Context(), userID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, snap, nil)
}
