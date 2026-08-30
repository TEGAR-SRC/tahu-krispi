package user

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/platform/mail"
	apperrors "kilat.cloud/backend/pkg/errors"
	v "kilat.cloud/backend/pkg/validation"
)

type ChangePasswordInput struct {
	UserID    uuid.UUID
	Current   string
	New       string
	IP        string
	UserAgent string
}

func (s *Service) ChangePassword(ctx context.Context, in ChangePasswordInput) error {
	var currentHash string
	var pwVersion int
	err := s.db.QueryRow(ctx, `SELECT password_hash, password_version FROM users WHERE id=$1 AND deleted_at IS NULL`, in.UserID).
		Scan(&currentHash, &pwVersion)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return err
	}
	ok, err := crypto.VerifyPassword(in.Current, currentHash)
	if err != nil || !ok {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeInvalidCredentials, "current password incorrect"),
			map[string]string{"current_password": "password saat ini tidak sesuai"})
	}
	if in.Current == in.New {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "new password must differ from current password"),
			map[string]string{"new_password": "password baru harus berbeda dari password saat ini"})
	}
	if len(in.New) < 10 {
		return apperrors.WithFields(apperrors.New(apperrors.CodeValidation, "password too short"),
			map[string]string{"new_password": "minimal 10 karakter", "password": "minimal 10 karakter"})
	}
	newHash, err := crypto.HashPassword(in.New, s.argon2Params)
	if err != nil {
		return fmt.Errorf("hash: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
INSERT INTO password_history(user_id, password_hash) VALUES ($1,$2)`, in.UserID, currentHash)
	if err != nil {
		return err
	}
	ct := ctTag()
	_, err = tx.Exec(ctx, `
UPDATE users SET password_hash=$2, password_changed_at=now(), password_version=password_version+1 WHERE id=$1`,
		in.UserID, newHash)
	if err != nil {
		return err
	}
	_ = ct
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if err = s.authSvc.RevokeAllSessions(ctx, in.UserID, "password_changed"); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	s.recordAuthEvent(ctx, in.UserID, "password_changed", true, in.IP, in.UserAgent)
	// Best-effort notification email (do not fail the request if SMTP is not configured).
	if s.mailSender != nil {
		var email string
		_ = s.db.QueryRow(ctx, `SELECT email::text FROM users WHERE id=$1`, in.UserID).Scan(&email)
		if email != "" {
			subject, textBody, htmlBody := mail.PasswordChanged(in.IP, time.Now())
			sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			_ = s.mailSender.Send(sendCtx, email, subject, textBody, htmlBody)
			cancel()
		}
	}
	return nil
}

type ForgotPasswordOutput struct{ TokenSent bool }

func (s *Service) ForgotPassword(ctx context.Context, email string) (*ForgotPasswordOutput, error) {
	normalized := v.NormalizeEmail(email)
	if err := v.ValidateEmail(normalized); err != nil {
		fieldMsg := err.Error()
		if fieldMsg == "email is required" {
			fieldMsg = "email wajib diisi"
		} else if fieldMsg == "invalid email format" {
			fieldMsg = "format email tidak valid"
		}
		return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"email": fieldMsg})
	}
	var userID uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM users WHERE lower(email::text)=$1 AND deleted_at IS NULL`, normalized).Scan(&userID)
	if err != nil {
		// Generic response; do not leak whether the email exists.
		return &ForgotPasswordOutput{TokenSent: true}, nil
	}
	token, err := crypto.RandomToken(32)
	if err != nil {
		return nil, err
	}
	hash := crypto.HashToken(token)
	ttl := 30 * time.Minute
	_, _ = s.rdb.Set(ctx, fmt.Sprintf("kc:pwreset:%s", hash), userID.String(), ttl).Result()
	if s.mailSender != nil {
		resetLink := strings.TrimSuffix(s.cfg.ConsoleBaseURL, "/") + "/reset-password?token=" + token
		subject, textBody, htmlBody := mail.ResetPassword(resetLink)
		sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		_ = s.mailSender.Send(sendCtx, normalized, subject, textBody, htmlBody)
		cancel()
		// A not-configured SMTP is not an error for the caller; the token is still stored for manual delivery.
	}
	s.recordAuthEvent(ctx, userID, "forgot_password_requested", true, "", "")
	return &ForgotPasswordOutput{TokenSent: true}, nil
}

func (s *Service) ResetPassword(ctx context.Context, token, newPassword string, ip string) error {
	if strings.TrimSpace(token) == "" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "reset token is required"),
			map[string]string{"token": "token reset wajib diisi"})
	}
	if len(newPassword) < 10 {
		return apperrors.WithFields(apperrors.New(apperrors.CodeValidation, "password too short"),
			map[string]string{"new_password": "minimal 10 karakter", "password": "minimal 10 karakter"})
	}
	hash := crypto.HashToken(token)
	key := fmt.Sprintf("kc:pwreset:%s", hash)
	val, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "reset token invalid or expired"),
			map[string]string{"token": "token tidak valid atau sudah kadaluarsa"})
	}
	userID, err := uuid.Parse(val)
	if err != nil {
		return apperrors.New(apperrors.CodeValidation, "reset token invalid or expired")
	}
	newHash, err := crypto.HashPassword(newPassword, s.argon2Params)
	if err != nil {
		return fmt.Errorf("hash: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var oldHash string
	if err := tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&oldHash); err != nil {
		return apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO password_history(user_id, password_hash) VALUES ($1,$2)`, userID, oldHash); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
UPDATE users SET password_hash=$2, password_changed_at=now(), password_version=password_version+1 WHERE id=$1`,
		userID, newHash); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.rdb.Del(ctx, key)
	if err = s.authSvc.RevokeAllSessions(ctx, userID, "password_reset"); err != nil {
		return err
	}
	s.recordAuthEvent(ctx, userID, "password_reset", true, ip, "")
	if s.mailSender != nil {
		var email string
		_ = s.db.QueryRow(ctx, `SELECT email::text FROM users WHERE id=$1`, userID).Scan(&email)
		if email != "" {
			subject, textBody, htmlBody := mail.PasswordChanged(ip, time.Now())
			sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			_ = s.mailSender.Send(sendCtx, email, subject, textBody, htmlBody)
			cancel()
		}
	}
	return nil
}

func ctTag() string { return "" }

// VerifyEmail verifies an email verification token stored in Redis.
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "verification token is required"),
			map[string]string{"token": "token verifikasi wajib diisi"})
	}
	hash := crypto.HashToken(token)
	key := fmt.Sprintf("kc:otp:email:%s", hash)
	val, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "verification token invalid or expired"),
			map[string]string{"token": "token tidak valid atau sudah kadaluarsa"})
	}
	userID, err := uuid.Parse(val)
	if err != nil {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "verification token invalid"),
			map[string]string{"token": "token verifikasi tidak valid"})
	}
	res, err := s.db.Exec(ctx, `
UPDATE users SET email_status='verified', email_verified_at=now(), status='active'
WHERE id=$1 AND email_status <> 'verified'`, userID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeConflict, "email already verified"),
			map[string]string{"email": "email sudah terverifikasi"})
	}
	s.rdb.Del(ctx, key)
	s.recordAuthEvent(ctx, userID, "email_verified", true, "", "")
	// Send a welcome notification (best-effort) after successful verification.
	if s.mailSender != nil {
		var email string
		_ = s.db.QueryRow(ctx, `SELECT email::text FROM users WHERE id=$1`, userID).Scan(&email)
		if email != "" {
			subject, textBody, htmlBody := mail.SecurityAlert("Email kamu berhasil diverifikasi. Akun sekarang aktif.")
			sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			_ = s.mailSender.Send(sendCtx, email, subject, textBody, htmlBody)
			cancel()
		}
	}
	return nil
}

// ResendEmailVerification issues a new verification token (rate-limited by caller) and sends the email.
func (s *Service) ResendEmailVerification(ctx context.Context, userID uuid.UUID) error {
	var email string
	var emailStatus string
	err := s.db.QueryRow(ctx, `SELECT email::text, email_status::text FROM users WHERE id=$1`, userID).Scan(&email, &emailStatus)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return err
	}
	if emailStatus == "verified" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeConflict, "email already verified"),
			map[string]string{"email": "email sudah terverifikasi"})
	}
	// sendVerificationEmail generates the token, stores it, and sends the email (best-effort).
	if err := s.sendVerificationEmail(ctx, email, userID); err != nil && !errors.Is(err, mail.ErrNotConfigured) {
		return err
	}
	return nil
}

// RequestContactChange creates a pending contact change request for email or phone.
func (s *Service) RequestContactChange(ctx context.Context, userID uuid.UUID, kind, newValue, ip, ua string) error {
	var normalized string
	switch kind {
	case "email":
		normalized = v.NormalizeEmail(newValue)
		if err := v.ValidateEmail(normalized); err != nil {
			return apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"new_value": err.Error()})
		}
	case "phone":
		p, err := v.NormalizePhoneE164(newValue, "")
		if err != nil {
			return apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"new_value": err.Error()})
		}
		normalized = p
	default:
		return apperrors.New(apperrors.CodeValidation, "kind must be email or phone")
	}

	uniqueIdx := "ux_pending_email_change"
	if kind == "phone" {
		uniqueIdx = "ux_pending_phone_change"
		tableIdx := "ux_users_email_live"
		if kind == "phone" {
			tableIdx = "ux_users_phone_live"
		}
		_ = tableIdx
		_ = uniqueIdx
	}

	_, err := s.db.Exec(ctx, `
INSERT INTO contact_change_requests(user_id, kind, new_value, requested_ip, requested_user_agent, expires_at)
VALUES ($1, $2, $3, NULLIF($4,'')::inet, NULLIF($5,''), now()+interval '24 hours')`,
		userID, kind, normalized, ip, ua)
	if err != nil && isUniqueViolation(err, uniqueIdx) {
		return apperrors.New(apperrors.CodeConflict, "value already reserved by another pending change")
	}
	if err != nil && isUserValueTaken(err, kind) {
		if kind == "email" {
			return apperrors.New(apperrors.CodeEmailExists, "email already registered to another user")
		}
		return apperrors.New(apperrors.CodePhoneExists, "phone already registered to another user")
	}
	if err != nil {
		return err
	}
	return nil
}

func isUniqueViolation(err error, constraint string) bool {
	return err != nil && indexOf(err.Error(), constraint) >= 0
}

func isUserValueTaken(err error, kind string) bool {
	idx := "ux_users_email_live"
	if kind == "phone" {
		idx = "ux_users_phone_live"
	}
	return err != nil && indexOf(err.Error(), idx) >= 0
}
