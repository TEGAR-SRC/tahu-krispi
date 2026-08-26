// contact_flow.go completes the email/phone change flow (Master Prompt §13-14)
// plus phone-number OTP verification.
package user

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/platform/crypto"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	phoneOTPTTL         = 10 * time.Minute
	phoneOTPMaxAttempts = 5
)

// IssueContactChangeToken stores a SHA-256 token hash on the pending contact
// change request and returns the plaintext token (48 hex chars) for delivery.
func IssueContactChangeToken(db *pgxpool.Pool, ctx context.Context, requestID uuid.UUID) (string, error) {
	token, err := crypto.RandomToken(24) // 24 bytes of entropy
	if err != nil {
		return "", err
	}
	tag, err := db.Exec(ctx, `
UPDATE contact_change_requests
SET verification_token_hash=$2, expires_at=now()+interval '24 hours'
WHERE id=$1 AND status='pending'`, requestID, crypto.HashToken(token))
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", apperrors.New(apperrors.CodeNotFound, "pending contact change request not found")
	}
	return token, nil
}

// ConfirmContactChange consumes the token and applies the verified value to
// the user inside a transaction: uniqueness is re-checked under lock, the
// user's email/phone is set with verified timestamps, and the request is
// marked applied. Returns the kind ("email"/"phone") and new value so the
// caller can send a change notification.
func ConfirmContactChange(db *pgxpool.Pool, ctx context.Context, token string, ip, ua string) (kind string, newValue string, err error) {
	hash := crypto.HashToken(token)

	var requestID, userID uuid.UUID
	err = db.QueryRow(ctx, `
SELECT id, user_id, kind::text, new_value::text
FROM contact_change_requests
WHERE verification_token_hash=$1 AND status='pending' AND expires_at > now()`, hash).
		Scan(&requestID, &userID, &kind, &newValue)
	if err == pgx.ErrNoRows {
		return "", "", apperrors.New(apperrors.CodeValidation, "verification token invalid or expired")
	}
	if err != nil {
		return "", "", err
	}

	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)

	// Re-check state under FOR UPDATE: the request may have been applied or
	// expired between the lookup and this transaction.
	err = tx.QueryRow(ctx, `
SELECT kind::text, new_value::text FROM contact_change_requests
WHERE id=$1 AND status='pending' AND expires_at > now()
FOR UPDATE`, requestID).Scan(&kind, &newValue)
	if err == pgx.ErrNoRows {
		return "", "", apperrors.New(apperrors.CodeConflict, "contact change request is no longer pending")
	}
	if err != nil {
		return "", "", err
	}

	switch kind {
	case "email":
		var taken bool
		if err = tx.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM users WHERE lower(email::text)=lower($1) AND deleted_at IS NULL AND id <> $2)`,
			newValue, userID).Scan(&taken); err != nil {
			return "", "", err
		}
		if taken {
			return "", "", apperrors.New(apperrors.CodeEmailExists, "email already registered to another user")
		}
		_, err = tx.Exec(ctx, `
UPDATE users SET email=$2, email_status='verified', email_verified_at=now() WHERE id=$1`, userID, newValue)
		if err != nil && isUniqueViolation(err, "ux_users_email_live") {
			return "", "", apperrors.New(apperrors.CodeEmailExists, "email already registered to another user")
		}
	case "phone":
		var taken bool
		if err = tx.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM users WHERE phone_e164=$1 AND deleted_at IS NULL AND id <> $2)`,
			newValue, userID).Scan(&taken); err != nil {
			return "", "", err
		}
		if taken {
			return "", "", apperrors.New(apperrors.CodePhoneExists, "phone already registered to another user")
		}
		_, err = tx.Exec(ctx, `
UPDATE users SET phone_e164=$2, phone_status='verified', phone_verified_at=now() WHERE id=$1`, userID, newValue)
		if err != nil && isUniqueViolation(err, "ux_users_phone_live") {
			return "", "", apperrors.New(apperrors.CodePhoneExists, "phone already registered to another user")
		}
	default:
		return "", "", apperrors.Newf(apperrors.CodeValidation, "unknown change kind %q", kind)
	}
	if err != nil {
		return "", "", err
	}

	if _, err = tx.Exec(ctx, `
UPDATE contact_change_requests SET status='applied', verified_at=COALESCE(verified_at, now()), applied_at=now()
WHERE id=$1`, requestID); err != nil {
		return "", "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", err
	}

	_ = LogAuthEvent(db, ctx, userID, "contact_changed_"+kind, true, ip, ua)
	return kind, newValue, nil
}

// RequestPhoneOTP issues a 6-digit OTP for the account's phone number. The OTP
// is stored as a SHA-256 hash in Redis (kc:otp:phone:{hash} -> userID, TTL 10
// minutes) and returned directly as a dev-mode echo.
func RequestPhoneOTP(rdb *goredis.Client, db *pgxpool.Pool, ctx context.Context, userID uuid.UUID) (otpDevEcho string, err error) {
	var phone *string
	err = db.QueryRow(ctx, `SELECT phone_e164 FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&phone)
	if err == pgx.ErrNoRows {
		return "", apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return "", err
	}
	if phone == nil || *phone == "" {
		return "", apperrors.New(apperrors.CodeValidation, "no phone number on account")
	}
	otp, err := randomSixDigitOTP()
	if err != nil {
		return "", err
	}
	if err = rdb.Set(ctx, fmt.Sprintf("kc:otp:phone:%s", crypto.HashToken(otp)), userID.String(), phoneOTPTTL).Err(); err != nil {
		return "", fmt.Errorf("store otp: %w", err)
	}
	if err = rdb.Set(ctx, phoneOTPAttemptsKey(userID), 0, phoneOTPTTL).Err(); err != nil {
		return "", fmt.Errorf("reset otp attempts: %w", err)
	}
	return otp, nil
}

// VerifyPhoneOTP validates the OTP against Redis, enforcing at most 5 failed
// attempts per issuance, then marks the user's phone verified.
func VerifyPhoneOTP(rdb *goredis.Client, db *pgxpool.Pool, ctx context.Context, userID uuid.UUID, otp string) error {
	attemptsKey := phoneOTPAttemptsKey(userID)
	if n, err := rdb.Get(ctx, attemptsKey).Int(); err == nil && n >= phoneOTPMaxAttempts {
		return apperrors.New(apperrors.CodeRateLimited, "too many attempts; request a new OTP")
	}

	key := fmt.Sprintf("kc:otp:phone:%s", crypto.HashToken(otp))
	val, err := rdb.Get(ctx, key).Result()
	if err != nil {
		bumpPhoneOTPAttempts(rdb, ctx, attemptsKey)
		return apperrors.New(apperrors.CodeValidation, "invalid or expired OTP")
	}
	parsed, perr := uuid.Parse(val)
	if perr != nil || parsed != userID {
		bumpPhoneOTPAttempts(rdb, ctx, attemptsKey)
		return apperrors.New(apperrors.CodeValidation, "invalid or expired OTP")
	}

	rdb.Del(ctx, key, attemptsKey)
	_, err = db.Exec(ctx, `
UPDATE users SET phone_status='verified', phone_verified_at=now() WHERE id=$1 AND deleted_at IS NULL`, userID)
	return err
}

func phoneOTPAttemptsKey(userID uuid.UUID) string {
	return fmt.Sprintf("kc:otp:phone:attempts:%s", userID)
}

func bumpPhoneOTPAttempts(rdb *goredis.Client, ctx context.Context, key string) {
	n, err := rdb.Incr(ctx, key).Result()
	if err == nil && n == 1 {
		rdb.Expire(ctx, key, phoneOTPTTL)
	}
}

// randomSixDigitOTP returns an unbiased uniformly random 6-digit code.
func randomSixDigitOTP() (string, error) {
	const mod = 1000000
	limit := uint64(1<<24) - (uint64(1)<<24)%mod // rejection bound keeps uniformity
	var b [3]byte
	for {
		if _, err := rand.Read(b[:]); err != nil {
			return "", fmt.Errorf("generate otp: %w", err)
		}
		v := uint64(b[0])<<16 | uint64(b[1])<<8 | uint64(b[2])
		if v < limit {
			return fmt.Sprintf("%06d", v%mod), nil
		}
	}
}
