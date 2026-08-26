package api

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	mw "kilat.cloud/backend/pkg/middleware"
)

type dashboardOutstanding struct {
	Count    int64   `json:"count"`
	TotalDue float64 `json:"total_due"`
}

type dashboardWalletBalance struct {
	Currency        string  `json:"currency"`
	Balance         float64 `json:"balance"`
	ReservedBalance float64 `json:"reserved_balance"`
}

type dashboardActivity struct {
	Action       string     `json:"action"`
	ResourceType string     `json:"resource_type,omitempty"`
	ResourceID   *uuid.UUID `json:"resource_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

type dashboardSummaryOut struct {
	ActiveInstances      int64                    `json:"active_instances"`
	PendingInstances     int64                    `json:"pending_instances"`
	MonthlySpend         float64                  `json:"monthly_spend"`
	MonthlySpendCurrency string                   `json:"monthly_spend_currency"`
	OutstandingInvoices  dashboardOutstanding     `json:"outstanding_invoices"`
	WalletBalances       []dashboardWalletBalance `json:"wallet_balances"`
	RecentActivity       []dashboardActivity      `json:"recent_activity"`
}

// handleDashboardSummary assembles the organization overview (Master Prompt
// §72) with a handful of aggregate queries: instance counts, month-to-date
// spend, outstanding invoices, per-currency wallet balances and the last audit
// trail entries.
func (s *Server) handleDashboardSummary(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	ctx := c.Context()

	var out dashboardSummaryOut

	// Instance counts in one pass: active vs pending/provisioning.
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FILTER (WHERE status='active'),
       COUNT(*) FILTER (WHERE status IN ('pending','provisioning'))
FROM instances WHERE organization_id=$1 AND deleted_at IS NULL`, orgID).
		Scan(&out.ActiveInstances, &out.PendingInstances); err != nil {
		return mw.WriteError(c, err)
	}

	// Month-to-date spend over paid invoices.
	var spendStr string
	if err := s.db.QueryRow(ctx, `
SELECT COALESCE(SUM(total),0)::text FROM invoices
WHERE organization_id=$1 AND status='paid' AND paid_at >= date_trunc('month', now())`, orgID).
		Scan(&spendStr); err != nil {
		return mw.WriteError(c, err)
	}
	fmt.Sscanf(spendStr, "%f", &out.MonthlySpend)
	out.MonthlySpendCurrency = "IDR"

	// Outstanding (unpaid) invoices: count + total due.
	var dueStr string
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*), COALESCE(SUM(amount_due),0)::text FROM invoices
WHERE organization_id=$1 AND status='unpaid'`, orgID).
		Scan(&out.OutstandingInvoices.Count, &dueStr); err != nil {
		return mw.WriteError(c, err)
	}
	fmt.Sscanf(dueStr, "%f", &out.OutstandingInvoices.TotalDue)

	// Wallet balances for every funded currency.
	wrows, err := s.db.Query(ctx, `
SELECT currency::text, balance::text, reserved_balance::text
FROM wallets WHERE organization_id=$1 ORDER BY currency`, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	out.WalletBalances = []dashboardWalletBalance{}
	for wrows.Next() {
		var wb dashboardWalletBalance
		var balStr, resStr string
		if err := wrows.Scan(&wb.Currency, &balStr, &resStr); err != nil {
			wrows.Close()
			return mw.WriteError(c, err)
		}
		fmt.Sscanf(balStr, "%f", &wb.Balance)
		fmt.Sscanf(resStr, "%f", &wb.ReservedBalance)
		out.WalletBalances = append(out.WalletBalances, wb)
	}
	if err := wrows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	wrows.Close()

	// Recent activity: last 10 audit trail entries of the organization.
	arows, err := s.db.Query(ctx, `
SELECT action, COALESCE(resource_type,''), resource_id, created_at
FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 10`, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer arows.Close()
	out.RecentActivity = []dashboardActivity{}
	for arows.Next() {
		var a dashboardActivity
		if err := arows.Scan(&a.Action, &a.ResourceType, &a.ResourceID, &a.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		out.RecentActivity = append(out.RecentActivity, a)
	}
	if err := arows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, out, nil)
}
