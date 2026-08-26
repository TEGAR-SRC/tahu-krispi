package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/affiliate"
	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// referralLinkBase derives the public referral link origin from APP_DOMAIN
// (e.g. "kilat-cloud.com"), tolerating a scheme that operators may include.
func referralLinkBase(domain string) string {
	for _, p := range []string{"https://", "http://"} {
		domain = strings.TrimPrefix(domain, p)
	}
	domain = strings.TrimSuffix(domain, "/")
	if domain == "" {
		return ""
	}
	return "https://" + domain + "/?referral="
}

// handleEnsureAffiliateCode mints (or returns) the caller's referral code and
// the public share link https://<APP_DOMAIN>/?referral=<CODE>.
func (s *Server) handleEnsureAffiliateCode(c fiber.Ctx) error {
	userID := mustUserID(c)
	code, err := s.affiliateSvc.EnsureCode(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"referral_code": code,
		"referral_link": referralLinkBase(s.cfg.AppDomain) + code,
	}, nil)
}

// handleGetAffiliateDashboard returns Total Referrals / Current Earnings /
// Total Earned To Date / Total Unique Visitors / Available Balance. The code is
// ensured on read so the dashboard can always render the share link.
func (s *Server) handleGetAffiliateDashboard(c fiber.Ctx) error {
	userID := mustUserID(c)
	code, err := s.affiliateSvc.EnsureCode(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	d, err := s.affiliateSvc.Dashboard(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{
		"referral_code":         d.ReferralCode,
		"referral_link":         referralLinkBase(s.cfg.AppDomain) + code,
		"total_referrals":       d.TotalReferrals,
		"current_earnings":      d.CurrentEarnings,
		"total_earned":          d.TotalEarned,
		"total_unique_visitors": d.UniqueVisitors,
		"available_balance":     d.AvailableBalance,
	}, nil)
}

// handleTrackReferral is public (no auth): records one unique visitor for the
// code and drops the 30-day ref cookie so a later registration attributes to
// the referrer. Always answers 204 so invalid codes are not enumerable.
func (s *Server) handleTrackReferral(c fiber.Ctx) error {
	code := c.Params("code")
	if strings.TrimSpace(code) == "" {
		return c.SendStatus(fiber.StatusNoContent)
	}
	known, err := s.affiliateSvc.TrackClick(c.Context(), code, c.IP(), c.Get("User-Agent"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	if known {
		c.Cookie(&fiber.Cookie{
			Name:     "ref",
			Value:    code,
			Path:     "/",
			MaxAge:   30 * 24 * 60 * 60, // 30 days
			HTTPOnly: true,
			SameSite: "Lax",
		})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

type affiliateWithdrawInput struct {
	OrganizationID uuid.UUID `json:"organization_id"`
}

// handleAffiliateWithdraw moves all approved earnings of the caller to paid and
// credits the organization wallet once per currency.
func (s *Server) handleAffiliateWithdraw(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in affiliateWithdrawInput
	if err := c.Bind().Body(&in); err != nil || in.OrganizationID == uuid.Nil {
		return mw.WriteError(c, vErrField("organization_id", "must be a valid uuid"))
	}
	payouts, err := s.affiliateSvc.Withdraw(c.Context(), userID, in.OrganizationID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), auditEntry(c, in.OrganizationID, &userID,
		"affiliate.withdraw", "wallet", in.OrganizationID,
		map[string]any{"payouts": payouts}))
	return mw.JSON(c, 200, fiber.Map{"status": "paid", "payouts": payouts}, nil)
}

// ---- Admin ----

// handleAdminGetAffiliateSettings exposes commission rules.
func (s *Server) handleAdminGetAffiliateSettings(c fiber.Ctx) error {
	st, err := s.affiliateSvc.GetSettings(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, st, nil)
}

// handleAdminUpdateAffiliateSettings updates commission rules; nil fields keep
// their current value. Settings changes are audited with before/after.
func (s *Server) handleAdminUpdateAffiliateSettings(c fiber.Ctx) error {
	adminID, _ := c.Locals("user_id_uuid").(uuid.UUID)
	var in affiliate.UpdateSettingsInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, vErrField("body", "invalid json body"))
	}
	before, err := s.affiliateSvc.GetSettings(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	st, err := s.affiliateSvc.UpdateSettings(c.Context(), in)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:  &adminID,
		Action:       "affiliate.settings_update",
		ResourceType: "affiliate_settings",
		BeforeData: map[string]any{
			"commission_percent": before.CommissionPercent, "referee_bonus_percent": before.RefereeBonusPercent,
			"min_invoice_total": before.MinInvoiceTotal, "enabled": before.Enabled,
		},
		AfterData: map[string]any{
			"commission_percent": st.CommissionPercent, "referee_bonus_percent": st.RefereeBonusPercent,
			"min_invoice_total": st.MinInvoiceTotal, "enabled": st.Enabled,
		},
		Metadata: map[string]any{"program": "affiliate"},
	})
	return mw.JSON(c, 200, st, nil)
}

// handleAdminListAffiliateEarnings lists earnings (?status=&page=&per_page=).
func (s *Server) handleAdminListAffiliateEarnings(c fiber.Ctx) error {
	page, perPage := httputil.Page(c)
	items, total, err := s.affiliateSvc.AdminListEarnings(c.Context(), c.Query("status"), page, perPage)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, items, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// handleAdminReverseAffiliateEarning reverses an approved earning (fraud control).
func (s *Server) handleAdminReverseAffiliateEarning(c fiber.Ctx) error {
	adminID, _ := c.Locals("user_id_uuid").(uuid.UUID)
	earningID, err := uuid.Parse(c.Params("earning_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("earning_id", "must be a valid uuid"))
	}
	if err := s.affiliateSvc.Reverse(c.Context(), earningID); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:  &adminID,
		Action:       "affiliate.earning_reverse",
		ResourceType: "affiliate_earning",
		ResourceID:   &earningID,
	})
	return mw.JSON(c, 200, fiber.Map{"status": "reversed"}, nil)
}
