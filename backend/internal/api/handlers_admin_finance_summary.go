// Admin module (§51): platform-wide finance summary for the console dashboard.
package api

import (
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	mw "kilat.cloud/backend/pkg/middleware"
)

// admFinancePaidTotals is the count/sum pair for money collected in a period.
type admFinancePaidTotals struct {
	PaidCount int     `json:"paid_count"`
	PaidTotal float64 `json:"paid_total"`
}

// admFinanceOutstandingTotals is the count/sum pair for unpaid invoices.
type admFinanceOutstandingTotals struct {
	Count int     `json:"count"`
	Total float64 `json:"total"`
}

// admFinanceSummaryOut mirrors every other admin money field's rendering:
// SQL numeric -> ::text -> float64 (see admParseFloat).
type admFinanceSummaryOut struct {
	PeriodDays         int                         `json:"period_days"`
	Invoices           admFinancePaidTotals        `json:"invoices"`
	Outstanding        admFinanceOutstandingTotals `json:"outstanding"`
	Topups             admFinancePaidTotals        `json:"topups"`
	WalletBalanceTotal float64                     `json:"wallet_balance_total"`
	MRRActive          float64                     `json:"mrr_active"`
}

// adminFinanceSummary aggregates platform-wide finance numbers over a lookback
// window: paid invoices, outstanding (unpaid/overdue) invoices all-time, paid
// wallet topups, total wallet balance and monthly-recurring revenue of active
// subscriptions.
func (s *Server) adminFinanceSummary(c fiber.Ctx) error {
	days := 30
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return mw.WriteError(c, vErrField("days", "must be a positive integer"))
		}
		if n > 365 {
			n = 365 // clamp per API contract
		}
		days = n
	}
	since := time.Now().AddDate(0, 0, -days)
	ctx := c.Context()

	var out admFinanceSummaryOut
	out.PeriodDays = days

	// Invoices actually collected in the window; same status='paid' +
	// paid_at convention as the month-to-date spend on handleDashboardSummary.
	var paidStr string
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*), COALESCE(SUM(amount_paid),0)::text FROM invoices
WHERE status='paid' AND paid_at >= $1`, since).
		Scan(&out.Invoices.PaidCount, &paidStr); err != nil {
		return mw.WriteError(c, err)
	}
	out.Invoices.PaidTotal = admParseFloat(paidStr)

	// Outstanding is all-time: every invoice not yet settled.
	var dueStr string
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*), COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)),0)::text FROM invoices
WHERE status IN ('unpaid','overdue')`).
		Scan(&out.Outstanding.Count, &dueStr); err != nil {
		return mw.WriteError(c, err)
	}
	out.Outstanding.Total = admParseFloat(dueStr)

	// Topups are payments without an invoice flagged purpose=wallet_topup
	// (there is no dedicated topups table; see handleWalletTopup).
	var topupStr string
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*), COALESCE(SUM(amount),0)::text FROM payments
WHERE invoice_id IS NULL AND provider_payload->>'purpose'='wallet_topup'
  AND status='paid' AND paid_at >= $1`, since).
		Scan(&out.Topups.PaidCount, &topupStr); err != nil {
		return mw.WriteError(c, err)
	}
	out.Topups.PaidTotal = admParseFloat(topupStr)

	var walletStr string
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(balance),0)::text FROM wallets`).
		Scan(&walletStr); err != nil {
		return mw.WriteError(c, err)
	}
	out.WalletBalanceTotal = admParseFloat(walletStr)

	// MRR normalizes each active subscription's recurring_amount to its
	// monthly equivalent. hourly/daily periods here denote rolling 24h usage
	// windows and one_time never recurs (see subscription.computePeriodEnd),
	// so none of them has a monthly equivalent and contributes 0.
	var mrrStr string
	if err := s.db.QueryRow(ctx, `
SELECT COALESCE(SUM(recurring_amount * CASE billing_period
	WHEN 'monthly' THEN 1.0
	WHEN 'quarterly' THEN 1.0/3
	WHEN 'semiannual' THEN 1.0/6
	WHEN 'annual' THEN 1.0/12
	WHEN 'biennial' THEN 1.0/24
	WHEN 'triennial' THEN 1.0/36
	WHEN 'quinquennial' THEN 1.0/60
	ELSE 0 END), 0)::text
FROM subscriptions WHERE status='active'`).
		Scan(&mrrStr); err != nil {
		return mw.WriteError(c, err)
	}
	out.MRRActive = admParseFloat(mrrStr)

	return mw.JSON(c, 200, out, nil)
}
