// mfa.go implements TOTP enrolment, recovery codes, and second-factor checks.
package user

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/platform/crypto"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	totpIssuer   = "KilatCloud"
	totpDigits   = 6
	totpStepSecs = 30
)

// MFAManager manages TOTP enrolment and recovery codes for users.
type MFAManager struct {
	db     *pgxpool.Pool
	encKey []byte
}

func NewMFAManager(db *pgxpool.Pool, encKey []byte) *MFAManager {
	return &MFAManager{db: db, encKey: encKey}
}

// SetupTOTP generates a fresh TOTP secret, stores it encrypted (unverified),
// and returns the secret plus the otpauth:// provisioning URL.
func (m *MFAManager) SetupTOTP(ctx context.Context, userID uuid.UUID) (secret string, otpauthURL string, err error) {
	var email string
	err = m.db.QueryRow(ctx, `SELECT email::text FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&email)
	if err == pgx.ErrNoRows {
		return "", "", apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return "", "", err
	}
	secret, err = generateTOTPSecret()
	if err != nil {
		return "", "", err
	}
	ciphertext, err := crypto.Encrypt(m.encKey, []byte(secret))
	if err != nil {
		return "", "", fmt.Errorf("encrypt totp secret: %w", err)
	}

	tx, err := m.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)

	// user_mfa_methods has no unique index on (user_id, method); replace first.
	if _, err = tx.Exec(ctx, `DELETE FROM user_mfa_methods WHERE user_id=$1 AND method='totp'`, userID); err != nil {
		return "", "", err
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO user_mfa_methods(user_id, method, label, secret_ciphertext)
VALUES ($1, 'totp', $2, $3)`, userID, "Authenticator App", ciphertext); err != nil {
		return "", "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", err
	}
	otpauthURL = fmt.Sprintf(
		"otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d",
		url.PathEscape(totpIssuer), url.PathEscape(email), secret,
		url.QueryEscape(totpIssuer), totpDigits, totpStepSecs)
	return secret, otpauthURL, nil
}

// ConfirmTOTP verifies the first code against the pending secret and marks the
// method verified and enabled.
func (m *MFAManager) ConfirmTOTP(ctx context.Context, userID uuid.UUID, code string) error {
	var ciphertext []byte
	var verifiedAt *time.Time
	err := m.db.QueryRow(ctx, `
SELECT secret_ciphertext, verified_at FROM user_mfa_methods
WHERE user_id=$1 AND method='totp'`, userID).Scan(&ciphertext, &verifiedAt)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "TOTP setup not found; call setup first")
	}
	if err != nil {
		return err
	}
	if verifiedAt != nil {
		return apperrors.New(apperrors.CodeConflict, "TOTP already confirmed")
	}
	plaintext, err := crypto.Decrypt(m.encKey, ciphertext)
	if err != nil {
		return fmt.Errorf("decrypt totp secret: %w", err)
	}
	if !verifyTOTPCode(string(plaintext), code, time.Now()) {
		return apperrors.New(apperrors.CodeValidation, "invalid TOTP code")
	}
	_, err = m.db.Exec(ctx, `
UPDATE user_mfa_methods SET verified_at=now(), enabled=true WHERE user_id=$1 AND method='totp'`, userID)
	return err
}

// Disable removes the user's TOTP method and all unused recovery codes.
// Callers must verify the current password or an active session themselves.
func (m *MFAManager) Disable(ctx context.Context, userID uuid.UUID) error {
	if _, err := m.db.Exec(ctx, `DELETE FROM user_mfa_methods WHERE user_id=$1 AND method='totp'`, userID); err != nil {
		return err
	}
	_, err := m.db.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id=$1`, userID)
	return err
}

// RecoveryCodesGenerate replaces any existing recovery codes with n fresh ones.
// Plaintext codes are returned once; only SHA-256 hashes are stored.
func (m *MFAManager) RecoveryCodesGenerate(ctx context.Context, userID uuid.UUID, n int) ([]string, error) {
	if n <= 0 {
		n = 10
	}
	codes := make([]string, 0, n)
	hashes := make([]string, 0, n)
	for i := 0; i < n; i++ {
		code, err := crypto.RandomToken(8) // 16 hex chars
		if err != nil {
			return nil, err
		}
		codes = append(codes, code)
		hashes = append(hashes, crypto.HashToken(code))
	}
	tx, err := m.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return nil, err
	}
	for _, h := range hashes {
		if _, err = tx.Exec(ctx, `
INSERT INTO user_recovery_codes(user_id, code_hash) VALUES ($1,$2)`, userID, h); err != nil {
			return nil, fmt.Errorf("insert recovery code: %w", err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return codes, nil
}

// HasMFA reports whether the user has a confirmed and enabled TOTP method.
func (m *MFAManager) HasMFA(ctx context.Context, userID uuid.UUID) (bool, error) {
	var has bool
	err := m.db.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM user_mfa_methods
  WHERE user_id=$1 AND method='totp' AND enabled AND verified_at IS NOT NULL
)`, userID).Scan(&has)
	return has, err
}

// VerifySecondFactor tries the code as a TOTP value first, then as a single-use
// recovery code. It returns true only when one of them matches; a consumed
// recovery code can never be used again.
func (m *MFAManager) VerifySecondFactor(ctx context.Context, userID uuid.UUID, code string) (bool, error) {
	var ciphertext []byte
	err := m.db.QueryRow(ctx, `
SELECT secret_ciphertext FROM user_mfa_methods
WHERE user_id=$1 AND method='totp' AND enabled AND verified_at IS NOT NULL`, userID).Scan(&ciphertext)
	switch {
	case err == nil:
		plaintext, derr := crypto.Decrypt(m.encKey, ciphertext)
		if derr == nil && verifyTOTPCode(string(plaintext), code, time.Now()) {
			_, uerr := m.db.Exec(ctx, `
UPDATE user_mfa_methods SET last_used_at=now() WHERE user_id=$1 AND method='totp'`, userID)
			return true, uerr
		}
	case err != pgx.ErrNoRows:
		return false, err
	}

	tag, err := m.db.Exec(ctx, `
UPDATE user_recovery_codes SET used_at=now()
WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL`,
		userID, crypto.HashToken(strings.TrimSpace(code)))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// --- TOTP helpers delegating to the shared crypto package ---

func generateTOTPSecret() (string, error) { return crypto.GenerateTOTPSecret() }

func verifyTOTPCode(secretB32, code string, now time.Time) bool {
	return crypto.VerifyTOTP(secretB32, code, now)
}
