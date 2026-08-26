// Package wallet implements ledger-based organization wallets.
package wallet

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Balance struct {
	WalletID        uuid.UUID `json:"wallet_id"`
	OrganizationID  uuid.UUID `json:"organization_id"`
	Currency        string    `json:"currency"`
	Balance         float64   `json:"balance"`
	ReservedBalance float64   `json:"reserved_balance"`
}

func (s *Service) GetBalance(ctx context.Context, orgID uuid.UUID, currency string) (*Balance, error) {
	if currency == "" {
		currency = "IDR"
	}
	row := s.db.QueryRow(ctx, `
SELECT id, organization_id, currency::text, balance::text, reserved_balance::text
FROM wallets WHERE organization_id=$1 AND currency=$2`, orgID, currency)
	var b Balance
	var balStr, resStr string
	err := row.Scan(&b.WalletID, &b.OrganizationID, &b.Currency, &balStr, &resStr)
	if err == pgx.ErrNoRows {
		return &Balance{OrganizationID: orgID, Currency: currency, Balance: 0}, nil
	}
	if err != nil {
		return nil, err
	}
	fmt.Sscanf(balStr, "%f", &b.Balance)
	fmt.Sscanf(resStr, "%f", &b.ReservedBalance)
	return &b, nil
}

// Transaction types per Master Prompt §48.
const (
	TypeTopup      = "topup"
	TypePayment    = "payment"
	TypeRefund     = "refund"
	TypeCredit     = "credit"
	TypeDebit      = "debit"
	TypeAdjustment = "adjustment"
	TypePromotion  = "promotion"
)

// ApplyTransaction performs an immutable, idempotent ledger entry inside a caller transaction.
func (s *Service) ApplyTransaction(ctx context.Context, tx pgx.Tx, walletID uuid.UUID,
	direction string, amount float64, referenceType string, referenceID *uuid.UUID,
	idempotencyKey string, description string) error {

	if amount <= 0 {
		return apperrors.New(apperrors.CodeValidation, "amount must be > 0")
	}
	var balanceText string
	err := tx.QueryRow(ctx, `
SELECT balance::text FROM wallets WHERE id=$1 FOR UPDATE`, walletID).Scan(&balanceText)
	if err != nil {
		return fmt.Errorf("lock wallet: %w", err)
	}
	var balanceBefore float64
	fmt.Sscanf(balanceText, "%f", &balanceBefore)
	balanceAfter := balanceBefore
	switch direction {
	case "credit":
		balanceAfter = balanceBefore + amount
	case "debit":
		balanceAfter = balanceBefore - amount
		if balanceAfter < 0 {
			return apperrors.New(apperrors.CodeInsufficientBalance, "insufficient wallet balance")
		}
	default:
		return apperrors.New(apperrors.CodeValidation, "direction must be credit or debit")
	}
	_, err = tx.Exec(ctx, `
INSERT INTO wallet_transactions(wallet_id, direction, amount, balance_before, balance_after,
                               reference_type, reference_id, idempotency_key, description)
VALUES ($1,$2::ledger_direction,$3,$4,$5,NULLIF($6,''),$7,NULLIF($8,''),NULLIF($9,''))`,
		walletID, direction, amount, balanceBefore, balanceAfter,
		referenceType, nullUUID(referenceID), idempotencyKey, description)
	if err != nil && isUnique(err, "wallet_transactions_wallet_id_key") {
		return apperrors.New(apperrors.CodeIdempotencyConflict, "idempotency key already used for this wallet")
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
UPDATE wallets SET balance=$2 WHERE id=$1`, walletID, balanceAfter)
	return err
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func isUnique(err error, constraint string) bool {
	if err == nil || constraint == "" {
		return false
	}
	s := err.Error()
	n := len(constraint)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == constraint {
			return true
		}
	}
	return false
}
