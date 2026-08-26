package api

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// handleListSubscriptions returns the organization's subscriptions, newest
// first, paginated over the service result.
func (s *Server) handleListSubscriptions(c fiber.Ctx) error {
	all, err := s.subSvc.ListByOrg(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	page, perPage := httputil.Page(c)
	start := (page - 1) * perPage
	if start > len(all) {
		start = len(all)
	}
	end := start + perPage
	if end > len(all) {
		end = len(all)
	}
	return httputil.OK(c, 200, all[start:end],
		&httputil.Meta{Page: page, PerPage: perPage, Total: len(all)})
}

// handleGetSubscription returns one subscription after verifying it belongs to
// the caller's organization.
func (s *Server) handleGetSubscription(c fiber.Ctx) error {
	subID, err := uuid.Parse(c.Params("subscription_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid subscription id"))
	}
	sub, err := s.subSvc.Get(c.Context(), subID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if sub.OrganizationID != mustOrgID(c) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "subscription not found"))
	}
	return mw.JSON(c, 200, sub, nil)
}

type cancelSubscriptionInput struct {
	AtPeriodEnd bool `json:"at_period_end"`
}

// handleCancelSubscription cancels a subscription either at the end of the
// current period (cancel_at_period_end=true) or immediately, and writes an
// audit entry.
func (s *Server) handleCancelSubscription(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	subID, err := uuid.Parse(c.Params("subscription_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid subscription id"))
	}
	var in cancelSubscriptionInput
	_ = c.Bind().Body(&in)

	sub, err := s.subSvc.Get(c.Context(), subID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if sub.OrganizationID != orgID {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "subscription not found"))
	}
	if err := s.subSvc.Cancel(c.Context(), subID, in.AtPeriodEnd); err != nil {
		return mw.WriteError(c, err)
	}

	s.auditSvc.Log(c.Context(), auditEntry(c, orgID, &userID, "subscription.cancel",
		"subscription", subID, map[string]any{"at_period_end": in.AtPeriodEnd}))

	updated, err := s.subSvc.Get(c.Context(), subID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, updated, nil)
}
