// Package affiliate implements the referral program: referral codes, click
// tracking, commission accrual on settled invoices, payouts to organization
// wallets, and admin-managed commission settings.
package affiliate

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/wallet"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// vErrField attaches a field-level detail to a validation error.
func vErrField(field, msg string) error {
	return apperrors.WithFields(
		apperrors.New(apperrors.CodeValidation, msg),
		map[string]string{field: msg})
}

// ---- Referral codes ----

// codeAlphabet is RFC 4648 base32 (A-Z, 2-7); codes are 8 chars uppercase.
const (
	codeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	codeLength   = 8
)

// newReferralCode mints a cryptographically random 8-char base32 code.
func newReferralCode() (string, error) {
	buf := make([]byte, codeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return referralCodeFromBytes(buf), nil
}

// referralCodeFromBytes maps one random byte per character onto the alphabet.
func referralCodeFromBytes(buf []byte) string {
	out := make([]byte, len(buf))
	for i, b := range buf {
		out[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	return string(out)
}

// EnsureCode returns the user's referral code, generating and persisting a
// unique one on first use. Safe under concurrency: the unique partial index
// arbitrates collisions and the loser retries.
func (s *Service) EnsureCode(ctx context.Context, userID uuid.UUID) (string, error) {
	var existing *string
	err := s.db.QueryRow(ctx, `
SELECT referral_code FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&existing)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return "", err
	}
	if existing != nil && *existing != "" {
		return *existing, nil
	}
	for attempt := 0; attempt < 5; attempt++ {
		code, err := newReferralCode()
		if err != nil {
			return "", err
		}
		tag, err := s.db.Exec(ctx, `
UPDATE users SET referral_code=$2 WHERE id=$1 AND referral_code IS NULL AND deleted_at IS NULL`,
			userID, code)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				continue // code collision; retry with a fresh one
			}
			return "", err
		}
		if tag.RowsAffected() == 1 {
			return code, nil
		}
		// A concurrent request assigned a code between the two statements.
		if err := s.db.QueryRow(ctx, `
SELECT referral_code FROM users WHERE id=$1`, userID).Scan(&existing); err != nil {
			return "", err
		}
		if existing != nil && *existing != "" {
			return *existing, nil
		}
	}
	return "", apperrors.New(apperrors.CodeInternal, "could not allocate a unique referral code")
}

// ---- Dashboard ----

type Dashboard struct {
	ReferralCode     string  `json:"referral_code"`
	TotalReferrals   int64   `json:"total_referrals"`
	CurrentEarnings  float64 `json:"current_earnings"`
	TotalEarned      float64 `json:"total_earned_to_date"`
	UniqueVisitors   int64   `json:"total_unique_visitors"`
	AvailableBalance float64 `json:"available_balance"`
}

// Dashboard aggregates the referral program numbers for one user. The
// available balance equals current earnings because payout moves approved
// earnings to paid; both fields are reported for API stability.
func (s *Service) Dashboard(ctx context.Context, userID uuid.UUID) (*Dashboard, error) {
	d := &Dashboard{}
	var code *string
	if err := s.db.QueryRow(ctx, `
SELECT referral_code FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&code); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperrors.New(apperrors.CodeNotFound, "user not found")
		}
		return nil, err
	}

	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM users WHERE referred_by=$1 AND deleted_at IS NULL`, userID).Scan(&d.TotalReferrals); err != nil {
		return nil, err
	}
	var approvedStr, earnedStr string
	if err := s.db.QueryRow(ctx, `
SELECT COALESCE(SUM(commission_amount),0)::text
FROM affiliate_earnings WHERE referrer_user_id=$1 AND status='approved'`, userID).
		Scan(&approvedStr); err != nil {
		return nil, err
	}
	fmt.Sscanf(approvedStr, "%f", &d.CurrentEarnings)
	if err := s.db.QueryRow(ctx, `
SELECT COALESCE(SUM(commission_amount),0)::text
FROM affiliate_earnings WHERE referrer_user_id=$1 AND status <> 'reversed'`, userID).
		Scan(&earnedStr); err != nil {
		return nil, err
	}
	fmt.Sscanf(earnedStr, "%f", &d.TotalEarned)
	d.AvailableBalance = d.CurrentEarnings

	if code != nil && *code != "" {
		d.ReferralCode = *code
		if err := s.db.QueryRow(ctx, `
SELECT COUNT(DISTINCT visitor_hash) FROM affiliate_clicks WHERE referral_code=$1`, *code).
			Scan(&d.UniqueVisitors); err != nil {
			return nil, err
		}
	}
	return d, nil
}

// ---- Click tracking ----

// visitorHash fingerprints a visitor without storing personal data:
// sha256(ip + '|' + user_agent), hex encoded.
func visitorHash(ip, userAgent string) string {
	sum := sha256.Sum256([]byte(ip + "|" + userAgent))
	return hex.EncodeToString(sum[:])
}

// TrackClick records one unique visitor per (code, visitor) pair. It returns
// false when the code does not belong to any live user so callers can skip
// cookie attribution for junk links.
func (s *Service) TrackClick(ctx context.Context, code, ip, userAgent string) (bool, error) {
	var known bool
	if err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM users WHERE referral_code=$1 AND deleted_at IS NULL)`, code).
		Scan(&known); err != nil {
		return false, err
	}
	if !known {
		return false, nil
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO affiliate_clicks(referral_code, visitor_hash) VALUES ($1,$2)
ON CONFLICT DO NOTHING`, code, visitorHash(ip, userAgent)); err != nil {
		return false, err
	}
	return true, nil
}

// ---- Commission accrual ----

// eligibleForCommission is the pure eligibility rule: the program must be
// enabled and the discounted invoice base must reach the configured minimum.
func eligibleForCommission(enabled bool, baseAmount, minInvoiceTotal float64) bool {
	return enabled && baseAmount >= minInvoiceTotal
}

// computeCommission applies percent to the discounted invoice base and rounds
// half-up to 2 decimals. The epsilon guards against float representation error
// just below a .xx5 cent boundary (e.g. 3333 * 7.5% = 249.975).
func computeCommission(baseAmount, percent float64) float64 {
	if percent <= 0 || baseAmount <= 0 {
		return 0
	}
	v := baseAmount * percent / 100
	return float64(math.Floor(v*100+0.5+1e-9)) / 100
}

// RecordCommissionForInvoice accrues one referral commission for a settled
// invoice. Idempotent via UNIQUE(affiliate_earnings.invoice_id): calling it
// twice for the same invoice is a no-op. Eligibility requires an enabled
// program, a payer whose referred_by is set (and not self-referred), and an
// invoice base (subtotal - discount) at or above the configured minimum.
//
// encKey is reserved for future signed attribution payloads; DB-only accrual
// does not need it, but the parameter keeps the hook signature stable for all
// settlement call sites.
func RecordCommissionForInvoice(ctx context.Context, db *pgxpool.Pool, encKey []byte, invoiceID uuid.UUID) error {
	_ = encKey
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var enabled bool
	var percentStr, bonusStr, minStr string
	err = tx.QueryRow(ctx, `
SELECT enabled, commission_percent::text, referee_bonus_percent::text, min_invoice_total::text
FROM affiliate_settings WHERE id=true`).Scan(&enabled, &percentStr, &bonusStr, &minStr)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx) // no program configured; nothing to do
	}
	if err != nil {
		return err
	}
	var percent, bonusPercent, minTotal float64
	fmt.Sscanf(percentStr, "%f", &percent)
	fmt.Sscanf(bonusStr, "%f", &bonusPercent)
	fmt.Sscanf(minStr, "%f", &minTotal)

	var orgID uuid.UUID
	var currency, subtotalStr, discountStr, invStatus string
	err = tx.QueryRow(ctx, `
SELECT organization_id, currency::text, subtotal::text, discount::text, status::text
FROM invoices WHERE id=$1`, invoiceID).
		Scan(&orgID, &currency, &subtotalStr, &discountStr, &invStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "invoice not found")
	}
	if err != nil {
		return err
	}
	if invStatus != "paid" {
		return nil // commissions accrue only on settled invoices
	}
	var subtotal, discount float64
	fmt.Sscanf(subtotalStr, "%f", &subtotal)
	fmt.Sscanf(discountStr, "%f", &discount)
	base := subtotal - discount
	if !eligibleForCommission(enabled, base, minTotal) {
		return nil
	}

	// Payer = the organization creator who spends the money.
	var payer *uuid.UUID
	if err := tx.QueryRow(ctx, `
SELECT created_by FROM organizations WHERE id=$1`, orgID).Scan(&payer); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if payer == nil {
		return nil
	}
	var referrer *uuid.UUID
	if err := tx.QueryRow(ctx, `
SELECT referred_by FROM users WHERE id=$1 AND deleted_at IS NULL`, *payer).Scan(&referrer); err != nil {
		return err
	}
	if referrer == nil || *referrer == *payer {
		return nil // unreferred or self-referral
	}

	commission := computeCommission(base, percent)
	if commission <= 0 {
		return nil
	}
	// Referrer's commission earning (idempotent per invoice + earning_type).
	if _, err := tx.Exec(ctx, `
INSERT INTO affiliate_earnings(referrer_user_id, referee_user_id, invoice_id,
                              base_amount, commission_amount, currency, status, earning_type)
VALUES ($1,$2,$3,$4,$5,$6,'approved','referrer_commission')
ON CONFLICT (invoice_id, earning_type) DO NOTHING`,
		*referrer, *payer, invoiceID, base, commission, currency); err != nil {
		return fmt.Errorf("insert affiliate earning: %w", err)
	}
	// Referee bonus: the configured referee_bonus_percent is paid to the payer
	// (the referred user) as a separate earning row, so it accrues and is
	// withdrawable just like the referrer's commission.
	if bonusPercent > 0 {
		bonus := computeCommission(base, bonusPercent)
		if bonus > 0 {
			if _, err := tx.Exec(ctx, `
INSERT INTO affiliate_earnings(referrer_user_id, referee_user_id, invoice_id,
                              base_amount, commission_amount, referee_bonus_amount,
                              currency, status, earning_type)
VALUES ($1,$2,$3,$4,$5,$6,$7,'approved','referee_bonus')
ON CONFLICT (invoice_id, earning_type) DO NOTHING`,
				*referrer, *payer, invoiceID, base, bonus, bonus, currency); err != nil {
				return fmt.Errorf("insert referee bonus earning: %w", err)
			}
		}
	}
	return tx.Commit(ctx)
}

// ---- Withdrawal ----

type Payout struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// Withdraw moves ALL approved earnings of the user to paid and credits the
// organization wallet once per currency, in a single transaction. Earnings
// rows are locked FOR UPDATE so concurrent withdrawals serialize.
func (s *Service) Withdraw(ctx context.Context, userID, orgID uuid.UUID) ([]Payout, error) {
	var member bool
	if err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2)`,
		orgID, userID).Scan(&member); err != nil {
		return nil, err
	}
	if !member {
		return nil, apperrors.New(apperrors.CodeForbidden, "not a member of this organization")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
SELECT id, currency::text, commission_amount::text
FROM affiliate_earnings
WHERE status='approved'
  AND ((earning_type='referrer_commission' AND referrer_user_id=$1)
       OR (earning_type='referee_bonus' AND referee_user_id=$1))
ORDER BY id
FOR UPDATE`, userID)
	if err != nil {
		return nil, err
	}
	totals := map[string]float64{} // currency -> running total
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		var cur, amtStr string
		if err := rows.Scan(&id, &cur, &amtStr); err != nil {
			rows.Close()
			return nil, err
		}
		var amt float64
		fmt.Sscanf(amtStr, "%f", &amt)
		totals[cur] += amt
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "no approved earnings to withdraw")
	}

	walletSvc := wallet.NewService(s.db)
	payouts := make([]Payout, 0, len(totals))
	for _, cur := range sortedCurrencies(totals) {
		amount := totals[cur]
		var walletID uuid.UUID
		if err := tx.QueryRow(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1,$2)
ON CONFLICT (organization_id, currency) DO UPDATE SET updated_at=now()
RETURNING id`, orgID, cur).Scan(&walletID); err != nil {
			return nil, fmt.Errorf("ensure %s wallet: %w", cur, err)
		}
		// Idempotency of the ledger entry is carried by the earnings status
		// transition below: once committed, those rows are no longer 'approved'.
		if err := walletSvc.ApplyTransaction(ctx, tx, walletID, "credit", amount,
			"affiliate_payout", nil, "", "affiliate commission payout"); err != nil {
			return nil, fmt.Errorf("credit %s wallet: %w", cur, err)
		}
		res, err := tx.Exec(ctx, `
UPDATE affiliate_earnings SET status='paid', paid_at=now()
WHERE status='approved' AND currency=$2
  AND ((earning_type='referrer_commission' AND referrer_user_id=$1)
       OR (earning_type='referee_bonus' AND referee_user_id=$1))`, userID, cur)
		if err != nil {
			return nil, err
		}
		if res.RowsAffected() == 0 {
			return nil, apperrors.New(apperrors.CodeConflict, "earnings changed during payout; retry")
		}
		payouts = append(payouts, Payout{Currency: cur, Amount: amount})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return payouts, nil
}

// sortedCurrencies gives deterministic payout order across currencies.
func sortedCurrencies(totals map[string]float64) []string {
	out := make([]string, 0, len(totals))
	for k := range totals {
		out = append(out, k)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// ---- Settings ----

type Settings struct {
	CommissionPercent   float64   `json:"commission_percent"`
	RefereeBonusPercent float64   `json:"referee_bonus_percent"`
	MinInvoiceTotal     float64   `json:"min_invoice_total"`
	Enabled             bool      `json:"enabled"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// UpdateSettingsInput carries optional fields; nil leaves the value unchanged.
type UpdateSettingsInput struct {
	CommissionPercent   *float64 `json:"commission_percent"`
	RefereeBonusPercent *float64 `json:"referee_bonus_percent"`
	MinInvoiceTotal     *float64 `json:"min_invoice_total"`
	Enabled             *bool    `json:"enabled"`
}

func scanSettings(row pgx.Row) (*Settings, error) {
	var st Settings
	var pctStr, bonusStr, minStr string
	if err := row.Scan(&pctStr, &bonusStr, &minStr, &st.Enabled, &st.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperrors.New(apperrors.CodeNotFound, "affiliate settings missing")
		}
		return nil, err
	}
	fmt.Sscanf(pctStr, "%f", &st.CommissionPercent)
	fmt.Sscanf(bonusStr, "%f", &st.RefereeBonusPercent)
	fmt.Sscanf(minStr, "%f", &st.MinInvoiceTotal)
	return &st, nil
}

const settingsCols = `commission_percent::text, referee_bonus_percent::text, min_invoice_total::text, enabled, updated_at`

func (s *Service) GetSettings(ctx context.Context) (*Settings, error) {
	return scanSettings(s.db.QueryRow(ctx, `
SELECT `+settingsCols+` FROM affiliate_settings WHERE id=true`))
}

func (s *Service) UpdateSettings(ctx context.Context, in UpdateSettingsInput) (*Settings, error) {
	checkPercent := func(v *float64, field string) error {
		if v == nil {
			return nil
		}
		if *v < 0 || *v > 100 {
			return vErrField(field, "must be between 0 and 100")
		}
		return nil
	}
	if err := checkPercent(in.CommissionPercent, "commission_percent"); err != nil {
		return nil, err
	}
	if err := checkPercent(in.RefereeBonusPercent, "referee_bonus_percent"); err != nil {
		return nil, err
	}
	if in.MinInvoiceTotal != nil && *in.MinInvoiceTotal < 0 {
		return nil, vErrField("min_invoice_total", "must be >= 0")
	}

	if _, err := s.db.Exec(ctx, `
INSERT INTO affiliate_settings(id) VALUES (true) ON CONFLICT DO NOTHING`); err != nil {
		return nil, err
	}
	return scanSettings(s.db.QueryRow(ctx, `
UPDATE affiliate_settings SET
  commission_percent    = COALESCE($1, commission_percent),
  referee_bonus_percent = COALESCE($2, referee_bonus_percent),
  min_invoice_total     = COALESCE($3, min_invoice_total),
  enabled               = COALESCE($4, enabled),
  updated_at            = now()
WHERE id=true
RETURNING `+settingsCols,
		in.CommissionPercent, in.RefereeBonusPercent, in.MinInvoiceTotal, in.Enabled))
}

// ---- Admin: earnings list & reversal ----

type Earning struct {
	ID               uuid.UUID  `json:"id"`
	ReferrerUserID   uuid.UUID  `json:"referrer_user_id"`
	ReferrerEmail    string     `json:"referrer_email"`
	RefereeUserID    uuid.UUID  `json:"referee_user_id"`
	RefereeEmail     string     `json:"referee_email"`
	InvoiceNumber    string     `json:"invoice_number,omitempty"`
	BaseAmount       float64    `json:"base_amount"`
	CommissionAmount float64    `json:"commission_amount"`
	Currency         string     `json:"currency"`
	Status           string     `json:"status"`
	PaidAt           *time.Time `json:"paid_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// AdminListEarnings returns one page of earnings, newest first, optionally
// filtered by status ('approved','paid','reversed'; empty = all).
func (s *Service) AdminListEarnings(ctx context.Context, status string, page, perPage int) ([]Earning, int, error) {
	switch status {
	case "", "approved", "paid", "reversed":
	default:
		return nil, 0, vErrField("status", "must be approved, paid, or reversed")
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	filter, args := "", []any{}
	if status != "" {
		filter = "WHERE e.status=$1"
		args = append(args, status)
	}
	var total int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FROM affiliate_earnings e `+filter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, perPage, (page-1)*perPage)
	limitPh := "$" + strconv.Itoa(len(args)-1)
	offsetPh := "$" + strconv.Itoa(len(args))
	rows, err := s.db.Query(ctx, `
SELECT e.id, e.referrer_user_id, COALESCE(ru.email::text,''),
       e.referee_user_id, COALESCE(eu.email::text,''),
       COALESCE(i.invoice_number,''), e.base_amount::text, e.commission_amount::text,
       e.currency::text, e.status, e.paid_at, e.created_at
FROM affiliate_earnings e
LEFT JOIN users ru ON ru.id=e.referrer_user_id
LEFT JOIN users eu ON eu.id=e.referee_user_id
LEFT JOIN invoices i ON i.id=e.invoice_id
`+filter+`
ORDER BY e.created_at DESC
LIMIT `+limitPh+` OFFSET `+offsetPh, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := []Earning{}
	for rows.Next() {
		var it Earning
		var baseStr, commStr string
		if err := rows.Scan(&it.ID, &it.ReferrerUserID, &it.ReferrerEmail,
			&it.RefereeUserID, &it.RefereeEmail,
			&it.InvoiceNumber, &baseStr, &commStr,
			&it.Currency, &it.Status, &it.PaidAt, &it.CreatedAt); err != nil {
			return nil, 0, err
		}
		fmt.Sscanf(baseStr, "%f", &it.BaseAmount)
		fmt.Sscanf(commStr, "%f", &it.CommissionAmount)
		items = append(items, it)
	}
	return items, total, rows.Err()
}

// Reverse marks an approved earning reversed (fraud control). Paid earnings
// cannot be reversed because they have already been credited to a wallet.
func (s *Service) Reverse(ctx context.Context, earningID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
UPDATE affiliate_earnings SET status='reversed' WHERE id=$1 AND status='approved'`, earningID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM affiliate_earnings WHERE id=$1)`, earningID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return apperrors.New(apperrors.CodeNotFound, "earning not found")
	}
	return apperrors.New(apperrors.CodeInvalidState, "only approved earnings can be reversed")
}
