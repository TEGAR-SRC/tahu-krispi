// Package user implements user registration, login, profile, and password flows.
package user

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/platform/mail"
	apperrors "kilat.cloud/backend/pkg/errors"
	v "kilat.cloud/backend/pkg/validation"
)

type Service struct {
	db           *pgxpool.Pool
	rdb          *goredis.Client
	authSvc      *auth.Service
	mfaMgr       *MFAManager
	argon2Params crypto.Argon2Params
	cfg          *config.Config
	mailSender   *mail.Sender
}

func NewService(db *pgxpool.Pool, rdb *goredis.Client, authSvc *auth.Service, mfaMgr *MFAManager, cfg *config.Config) *Service {
	return &Service{
		db:      db,
		rdb:     rdb,
		authSvc: authSvc,
		mfaMgr:  mfaMgr,
		argon2Params: crypto.Argon2Params{
			Memory: cfg.Argon2Memory, Iterations: cfg.Argon2Iterations,
			Parallelism: cfg.Argon2Parallelism, KeyLength: cfg.Argon2KeyLength,
			SaltLength: cfg.Argon2SaltLength,
		},
		cfg: cfg,
	}
}

// NewServiceWithMail is the same as NewService but wires the SMTP sender for verification / reset emails.
func NewServiceWithMail(db *pgxpool.Pool, rdb *goredis.Client, authSvc *auth.Service, mfaMgr *MFAManager, cfg *config.Config, sender *mail.Sender) *Service {
	s := NewService(db, rdb, authSvc, mfaMgr, cfg)
	s.mailSender = sender
	return s
}

// SetMailSender allows wiring the mail sender after construction (useful in tests).
func (s *Service) SetMailSender(sender *mail.Sender) { s.mailSender = sender }

type RegisterInput struct {
	Email           string `json:"email"`
	Phone           string `json:"phone,omitempty"`
	Username        string `json:"username,omitempty"`
	Password        string `json:"password"`
	FullName        string `json:"full_name,omitempty"`
	Locale          string `json:"locale,omitempty"`
	Timezone        string `json:"timezone,omitempty"`
	TermsAccepted   bool   `json:"terms_accepted"`
	PrivacyAccepted bool   `json:"privacy_accepted"`
	IP              string `json:"-"`
	UserAgent       string `json:"-"` // set by handler from request context
	// ReferralCode is resolved from ?ref= or the "ref" tracking cookie by the
	// register handler; never accepted from the request body.
	ReferralCode string `json:"-"`
}

type LoginOutput struct {
	UserID             uuid.UUID `json:"user_id"`
	SessionID          uuid.UUID `json:"session_id"`
	AccessToken        string    `json:"access_token"`
	RefreshToken       string    `json:"refresh_token"`
	MustChangePassword bool      `json:"must_change_password"`
	// MFARequired is true when the account has a confirmed TOTP method and the
	// caller must complete the second-factor step before tokens are issued.
	MFARequired bool `json:"mfa_required"`
	// PreauthToken is a short-lived, single-purpose token needed to complete
	// the MFA login step. Only present when MFARequired is true.
	PreauthToken string `json:"preauth_token,omitempty"`
}

// preauthTTL bounds how long a half-finished password+MFA login may remain
// pending before the code must be supplied.
const preauthTTL = 5 * time.Minute

func (s *Service) Register(ctx context.Context, in RegisterInput) (*LoginOutput, error) {
	if !in.TermsAccepted {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "terms must be accepted"),
			map[string]string{"terms_accepted": "Anda harus menyetujui Syarat & Ketentuan"})
	}
	if !in.PrivacyAccepted {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "privacy must be accepted"),
			map[string]string{"privacy_accepted": "Anda harus menyetujui Kebijakan Privasi"})
	}
	email := v.NormalizeEmail(in.Email)
	if err := v.ValidateEmail(email); err != nil {
		// Map to Indonesian-friendly field message while keeping the original error for debugging.
		fieldMsg := err.Error()
		switch fieldMsg {
		case "email is required":
			fieldMsg = "email wajib diisi"
		case "invalid email format":
			fieldMsg = "format email tidak valid"
		}
		return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"email": fieldMsg})
	}
	var phoneE164 string
	if in.Phone != "" {
		p, err := v.NormalizePhoneE164(in.Phone, "")
		if err != nil {
			fieldMsg := err.Error()
			switch fieldMsg {
			case "phone is required":
				fieldMsg = "nomor telepon wajib diisi"
			case "invalid phone length":
				fieldMsg = "panjang nomor telepon tidak valid, gunakan format +628..."
			}
			return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"phone": fieldMsg})
		}
		phoneE164 = p
	}
	username := in.Username
	if username != "" && !v.ValidateUsername(username) {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid username"),
			map[string]string{"username": "3-32 karakter, huruf/angka/titik/garis/dash, diawali huruf/angka"})
	}
	if len(in.Password) < 10 {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "password too short"),
			map[string]string{"password": "minimal 10 karakter"})
	}
	hash, err := crypto.HashPassword(in.Password, s.argon2Params)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var userID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO users(email, phone_e164, username, password_hash, status, locale, timezone, signup_ip, signup_user_agent,
                  terms_accepted_at, privacy_accepted_at)
VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, 'pending',
        COALESCE(NULLIF($5,''),'id-ID'), COALESCE(NULLIF($6,''),'Asia/Jakarta'),
        NULLIF($7,'')::inet, NULLIF($8,''), $9::timestamptz, $10::timestamptz)
RETURNING id`,
		email, phoneE164, username, hash, in.Locale, in.Timezone, in.IP, in.UserAgent,
		boolTime(in.TermsAccepted), boolTime(in.PrivacyAccepted)).Scan(&userID)
	if err != nil {
		return nil, mapUniqueViolation(err)
	}
	// Referral attribution: resolve the code inside the registration
	// transaction so the new user and referred_by commit atomically. Unknown
	// or self-referred codes are ignored (best-effort; a DB failure surfaces
	// at commit anyway).
	if in.ReferralCode != "" {
		var referrerID uuid.UUID
		err = tx.QueryRow(ctx, `
SELECT id FROM users
WHERE referral_code=$1 AND deleted_at IS NULL
  AND lower(email::text) <> $2`, in.ReferralCode, email).Scan(&referrerID)
		if err == nil && referrerID != userID {
			if _, uerr := tx.Exec(ctx, `
UPDATE users SET referred_by=$2 WHERE id=$1 AND referred_by IS NULL`, userID, referrerID); uerr != nil {
				return nil, fmt.Errorf("apply referral: %w", uerr)
			}
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	_, err = tx.Exec(ctx, `
INSERT INTO user_profiles(user_id, full_name) VALUES ($1, NULLIF($2,''))`, userID, in.FullName)
	if err != nil {
		return nil, fmt.Errorf("insert profile: %w", err)
	}
	// Personal organization per new account.
	orgID := uuid.New()
	_, err = tx.Exec(ctx, `
INSERT INTO organizations(id, slug, name, created_by) VALUES ($1, $2, $3, $4)`,
		orgID, "org-"+userID.String()[:8], "personal", userID)
	if err != nil {
		return nil, mapUniqueViolation(err)
	}
	_, err = tx.Exec(ctx, `
INSERT INTO organization_members(organization_id, user_id, role) VALUES ($1, $2, 'owner')`, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("insert member: %w", err)
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1, 'IDR')`, orgID); err != nil {
		return nil, fmt.Errorf("insert wallet: %w", err)
	}
	_, err = tx.Exec(ctx, `
INSERT INTO notification_preferences(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID)
	if err != nil {
		return nil, fmt.Errorf("insert notification prefs: %w", err)
	}
	if s.cfg.AutoVerifyEmail {
		// Development/staging convenience when SMTP is unavailable: activate immediately.
		if _, err = tx.Exec(ctx, `
UPDATE users SET status='active', email_status='verified', email_verified_at=now() WHERE id=$1`, userID); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	_ = s.recordAuthEvent(ctx, userID, "register", true, in.IP, in.UserAgent)

	if !s.cfg.AutoVerifyEmail {
		// Best-effort: generate verification token and send email. A parked SMTP (ErrNotConfigured) is not an error.
		_ = s.sendVerificationEmail(ctx, email, userID)
	}

	sessionID, refresh, err := s.authSvc.CreateSession(ctx, userID, "", in.IP, in.UserAgent)
	if err != nil {
		return nil, err
	}
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, 1, []string{"profile.read"})
	if err != nil {
		return nil, err
	}
	return &LoginOutput{UserID: userID, SessionID: sessionID, AccessToken: at, RefreshToken: refresh}, nil
}

type LoginInput struct {
	Email     string
	Password  string
	IP        string
	UserAgent string
}

func (s *Service) Login(ctx context.Context, in LoginInput) (*LoginOutput, error) {
	email := v.NormalizeEmail(in.Email)
	var userID uuid.UUID
	var pwHash string
	var status string
	var lockedUntil *time.Time
	var emailStatus, phoneStatus string
	var failedCount int
	var pwVersion int
	var forceChange bool
	err := s.db.QueryRow(ctx, `
SELECT id, password_hash, status::text, locked_until, email_status::text, phone_status::text,
       failed_login_count, password_version, force_password_change
FROM users WHERE lower(email::text)=$1 AND deleted_at IS NULL`, email).
		Scan(&userID, &pwHash, &status, &lockedUntil, &emailStatus, &phoneStatus, &failedCount, &pwVersion, &forceChange)
	if err == pgx.ErrNoRows {
		s.recordAuthEvent(ctx, uuid.Nil, "login", false, in.IP, in.UserAgent)
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeInvalidCredentials, "email not registered"),
			map[string]string{"email": "email belum terdaftar, silakan daftar terlebih dahulu"})
	}
	if err != nil {
		return nil, err
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeAccountLocked, "account temporarily locked; try again after 15 minutes"),
			map[string]string{"email": "akun terkunci sementara, coba lagi setelah 15 menit"})
	}
	ok, err := crypto.VerifyPassword(in.Password, pwHash)
	if err != nil || !ok {
		newFailed := failedCount + 1
		lockUntil := time.Time{}
		if newFailed >= 5 {
			lockUntil = time.Now().Add(15 * time.Minute)
			// Notify the owner that the account was locked after repeated failures.
			if s.mailSender != nil {
				subject, textBody, htmlBody := mail.AccountLocked(email, in.IP, lockUntil, time.Now())
				sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
				_ = s.mailSender.Send(sendCtx, email, subject, textBody, htmlBody)
				cancel()
			}
		}
		_, _ = s.db.Exec(ctx, `
UPDATE users SET failed_login_count=$2, locked_until=$3 WHERE id=$1`,
			userID, newFailed, nullableTime(lockUntil))
		s.recordAuthEvent(ctx, userID, "login_failed", false, in.IP, in.UserAgent)
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeInvalidCredentials, "invalid credentials"),
			map[string]string{"email": "email atau password salah", "password": "email atau password salah"})
	}
	if status != "active" {
		if status == "pending" {
			// Auto-resend verification email so the user immediately gets a fresh link without manual resend.
			_ = s.sendVerificationEmail(ctx, email, userID)
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeEmailNotVerified, "email not verified; verification email sent, please check your inbox"),
				map[string]string{"email": "email belum diverifikasi; email verifikasi sudah dikirim, cek inbox & spam"})
		}
		return nil, apperrors.New(apperrors.CodeForbidden, fmt.Sprintf("account status %s does not permit login", status))
	}
	_, _ = s.db.Exec(ctx, `
UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=now(),
                 last_login_ip=NULLIF($2,'')::inet, last_login_user_agent=NULLIF($3,'')
WHERE id=$1`, userID, in.IP, in.UserAgent)
	s.recordAuthEvent(ctx, userID, "login", true, in.IP, in.UserAgent)

	// Step 1 of a two-step login: when the account has a confirmed TOTP method,
	// do NOT issue tokens yet. Instead hand back a short-lived preauth token so
	// the caller can prove the second factor on a dedicated endpoint.
	mfaEnabled, err := s.mfaMgr.HasMFA(ctx, userID)
	if err != nil {
		return nil, err
	}
	if mfaEnabled {
		preauth, err := s.newPreauthToken(ctx, userID)
		if err != nil {
			return nil, err
		}
		return &LoginOutput{UserID: userID, MFARequired: true, PreauthToken: preauth}, nil
	}

	return s.completeLogin(ctx, userID, emailStatus, phoneStatus, forceChange, in)
}

func defaultScopesFor(emailStatus, phoneStatus string) []string {
	_ = phoneStatus // reserved for future phone-verified scopes; keep param to avoid breaking callers
	scopes := []string{"profile.read"}
	if emailStatus == "verified" {
		scopes = append(scopes, "instances.read", "instances.create")
	}
	return scopes
}

// completeLogin issues the session and tokens for an account that either has
// no MFA or has just satisfied the second-factor step.
func (s *Service) completeLogin(ctx context.Context, userID uuid.UUID, emailStatus, phoneStatus string, forceChange bool, in LoginInput) (*LoginOutput, error) {
	sessionID, refresh, err := s.authSvc.CreateSession(ctx, userID, "", in.IP, in.UserAgent)
	if err != nil {
		return nil, err
	}
	scopes := defaultScopesFor(emailStatus, phoneStatus)
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, 0, scopes)
	if err != nil {
		return nil, err
	}
	return &LoginOutput{
		UserID: userID, SessionID: sessionID,
		AccessToken: at, RefreshToken: refresh, MustChangePassword: forceChange,
	}, nil
}

// CreatePreauthToken creates a short-lived, single-use token that authorises
// the holder to complete a pending MFA login (password or passkey) by
// supplying the TOTP code. The token is bound to the user in Redis and
// deleted once consumed.
func (s *Service) CreatePreauthToken(ctx context.Context, userID uuid.UUID) (string, error) {
	return s.newPreauthToken(ctx, userID)
}

// newPreauthToken creates a short-lived, single-use token that authorises the
// holder to complete a pending password login by supplying the TOTP code. The
// token is bound to the user in Redis and deleted once consumed.
func (s *Service) newPreauthToken(ctx context.Context, userID uuid.UUID) (string, error) {
	raw, err := auth.RandomHexString()
	if err != nil {
		return "", err
	}
	key := "kc:preauth:" + raw
	if err := s.rdb.Set(ctx, key, userID.String(), preauthTTL).Err(); err != nil {
		return "", fmt.Errorf("store preauth token: %w", err)
	}
	return raw, nil
}

// CompleteLoginWithTOTP finishes a pending MFA login by verifying the supplied
// TOTP code against the preauth token and, on success, issuing the session and
// tokens. The preauth token is consumed regardless of outcome.
func (s *Service) CompleteLoginWithTOTP(ctx context.Context, preauthToken, code string, ip, ua string) (*LoginOutput, error) {
	if preauthToken == "" || code == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "preauth_token and code are required")
	}
	key := "kc:preauth:" + preauthToken
	userIDStr, err := s.rdb.Get(ctx, key).Result()
	if err == goredis.Nil {
		return nil, apperrors.New(apperrors.CodeInvalidCredentials, "preauth token invalid or expired; please log in again")
	}
	if err != nil {
		return nil, err
	}
	// Consume the token so it cannot be replayed or brute-forced repeatedly.
	_ = s.rdb.Del(ctx, key)
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return nil, apperrors.New(apperrors.CodeInvalidCredentials, "preauth token invalid or expired; please log in again")
	}

	// Per-account second-factor lockout: after MFA_MAX_ATTEMPTS consecutive
	// failures the account is locked for MFA_LOCKOUT seconds, independent of
	// the per-IP limiter, so an attacker who holds the password can't brute
	// force the TOTP/recovery code by rotating IPs.
	const mfaMaxAttempts = 5
	const mfaLockout = 15 * time.Minute
	lockKey := "kc:mfa:lockout:" + userID.String()
	n, lerr := s.rdb.Get(ctx, lockKey).Int()
	if lerr == nil && n >= mfaMaxAttempts {
		return nil, apperrors.New(apperrors.CodeAccountLocked, "too many failed login attempts; try again in 15 minutes")
	}
	if lerr != nil && !errors.Is(lerr, goredis.Nil) {
		return nil, lerr
	}

	ok, err := s.mfaMgr.VerifySecondFactor(ctx, userID, code)
	if err != nil {
		return nil, err
	}
	if !ok {
		s.recordAuthEvent(ctx, userID, "login_mfa_failed", false, ip, ua)
		// Count the failure; reset on success below.
		c, cerr := s.rdb.Incr(ctx, lockKey).Result()
		if cerr != nil {
			return nil, cerr
		}
		if c == 1 {
			_ = s.rdb.Expire(ctx, lockKey, mfaLockout).Err()
		}
		return nil, apperrors.New(apperrors.CodeInvalidCredentials, "invalid TOTP code")
	}
	_ = s.rdb.Del(ctx, lockKey)
	s.recordAuthEvent(ctx, userID, "login_mfa_ok", true, ip, ua)

	var emailStatus, phoneStatus string
	if err := s.db.QueryRow(ctx, `
SELECT email_status::text, phone_status::text FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).
		Scan(&emailStatus, &phoneStatus); err != nil {
		return nil, err
	}
	return s.completeLogin(ctx, userID, emailStatus, phoneStatus, false, LoginInput{IP: ip, UserAgent: ua})
}

func (s *Service) recordAuthEvent(ctx context.Context, userID uuid.UUID, eventType string, success bool, ip, ua string) error {
	_, err := s.db.Exec(ctx, `
INSERT INTO auth_events(user_id, event_type, success, ip, user_agent) VALUES ($1,$2,$3,NULLIF($4,'')::inet,NULLIF($5,''))`,
		userID, eventType, success, ip, ua)
	return err
}

// sendVerificationEmail generates a 24h verification token, stores it in Redis, and sends the WelcomeVerification email.
// It is best-effort: a missing SMTP configuration (ErrNotConfigured) is silently ignored.
func (s *Service) sendVerificationEmail(ctx context.Context, email string, userID uuid.UUID) error {
	if s.mailSender == nil {
		return nil
	}
	token, err := crypto.RandomToken(24)
	if err != nil {
		return err
	}
	hash := crypto.HashToken(token)
	if err := s.rdb.Set(ctx, fmt.Sprintf("kc:otp:email:%s", hash), userID.String(), 24*time.Hour).Err(); err != nil {
		return err
	}
	verifyLink := strings.TrimSuffix(s.cfg.ConsoleBaseURL, "/") + "/verify-email?token=" + token
	subject, textBody, htmlBody := mail.WelcomeVerification(email, verifyLink)
	sendCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if err := s.mailSender.Send(sendCtx, email, subject, textBody, htmlBody); err != nil {
		if errors.Is(err, mail.ErrNotConfigured) {
			return nil
		}
		return err
	}
	return nil
}

// ResendVerificationByEmail is the unauthenticated variant: looks up the user by email and, if the
// account is still pending/unverified, issues a fresh token and sends the verification email.
// It never reveals whether the email exists (always returns nil on not-found to avoid enumeration).
func (s *Service) ResendVerificationByEmail(ctx context.Context, email string) error {
	normalized := v.NormalizeEmail(email)
	if err := v.ValidateEmail(normalized); err != nil {
		fieldMsg := err.Error()
		switch fieldMsg {
		case "email is required":
			fieldMsg = "email wajib diisi"
		case "invalid email format":
			fieldMsg = "format email tidak valid"
		}
		return apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"email": fieldMsg})
	}
	var userID uuid.UUID
	var emailStatus string
	err := s.db.QueryRow(ctx, `SELECT id, email_status::text FROM users WHERE lower(email::text)=$1 AND deleted_at IS NULL`, normalized).
		Scan(&userID, &emailStatus)
	if err != nil {
		// Do not leak existence: treat not-found as success (no email sent, but caller sees generic success).
		return nil
	}
	if emailStatus == "verified" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeConflict, "email already verified"),
			map[string]string{"email": "email sudah terverifikasi"})
	}
	return s.sendVerificationEmail(ctx, normalized, userID)
}

// CheckEmailStatus returns whether the email exists and whether it is verified without sending any email.
func (s *Service) CheckEmailStatus(ctx context.Context, email string) (exists bool, verified bool, err error) {
	normalized := v.NormalizeEmail(email)
	if err := v.ValidateEmail(normalized); err != nil {
		return false, false, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"email": err.Error()})
	}
	var emailStatus string
	err = s.db.QueryRow(ctx, `SELECT email_status::text FROM users WHERE lower(email::text)=$1 AND deleted_at IS NULL`, normalized).
		Scan(&emailStatus)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, false, nil
		}
		return false, false, err
	}
	return true, emailStatus == "verified", nil
}

func boolTime(b bool) any {
	if b {
		return time.Now()
	}
	return nil
}

func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func mapUniqueViolation(err error) error {
	msg := err.Error()
	switch {
	case contains(msg, "ux_users_email_live"):
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeEmailExists, "email already registered"),
			map[string]string{"email": "email sudah terdaftar"})
	case contains(msg, "ux_users_phone_live"):
		return apperrors.WithFields(
			apperrors.New(apperrors.CodePhoneExists, "phone already registered"),
			map[string]string{"phone": "nomor telepon sudah terdaftar"})
	case contains(msg, "ux_users_username_live"):
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeUsernameExists, "username already taken"),
			map[string]string{"username": "username sudah dipakai"})
	case contains(msg, "ux_organizations_slug_live"):
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeConflict, "organization slug already exists"),
			map[string]string{"organization_slug": "slug organisasi sudah dipakai"})
	default:
		return err
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
