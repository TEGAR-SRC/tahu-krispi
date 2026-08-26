// Package user implements user registration, login, profile, and password flows.
package user

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/crypto"
	apperrors "kilat.cloud/backend/pkg/errors"
	v "kilat.cloud/backend/pkg/validation"
)

type Service struct {
	db           *pgxpool.Pool
	rdb          *goredis.Client
	authSvc      *auth.Service
	argon2Params crypto.Argon2Params
	cfg          *config.Config
}

func NewService(db *pgxpool.Pool, rdb *goredis.Client, authSvc *auth.Service, cfg *config.Config) *Service {
	return &Service{
		db:      db,
		rdb:     rdb,
		authSvc: authSvc,
		argon2Params: crypto.Argon2Params{
			Memory: cfg.Argon2Memory, Iterations: cfg.Argon2Iterations,
			Parallelism: cfg.Argon2Parallelism, KeyLength: cfg.Argon2KeyLength,
			SaltLength: cfg.Argon2SaltLength,
		},
		cfg: cfg,
	}
}

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
}

func (s *Service) Register(ctx context.Context, in RegisterInput) (*LoginOutput, error) {
	if !in.TermsAccepted || !in.PrivacyAccepted {
		return nil, apperrors.New(apperrors.CodeValidation, "terms and privacy must be accepted")
	}
	email := v.NormalizeEmail(in.Email)
	if err := v.ValidateEmail(email); err != nil {
		return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"email": err.Error()})
	}
	var phoneE164 string
	if in.Phone != "" {
		p, err := v.NormalizePhoneE164(in.Phone, "")
		if err != nil {
			return nil, apperrors.WithFields(apperrors.New(apperrors.CodeValidation, err.Error()), map[string]string{"phone": err.Error()})
		}
		phoneE164 = p
	}
	username := in.Username
	if username != "" && !v.ValidateUsername(username) {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid username"),
			map[string]string{"username": "3-32 chars, alphanumeric/._- starting with alnum"})
	}
	if len(in.Password) < 10 {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "password too short"),
			map[string]string{"password": "minimum 10 characters"})
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
		return nil, apperrors.New(apperrors.CodeInvalidCredentials, "invalid credentials")
	}
	if err != nil {
		return nil, err
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return nil, apperrors.New(apperrors.CodeAccountLocked, "account temporarily locked")
	}
	ok, err := crypto.VerifyPassword(in.Password, pwHash)
	if err != nil || !ok {
		newFailed := failedCount + 1
		lockUntil := time.Time{}
		if newFailed >= 5 {
			lockUntil = time.Now().Add(15 * time.Minute)
		}
		_, _ = s.db.Exec(ctx, `
UPDATE users SET failed_login_count=$2, locked_until=$3 WHERE id=$1`,
			userID, newFailed, nullableTime(lockUntil))
		s.recordAuthEvent(ctx, userID, "login_failed", false, in.IP, in.UserAgent)
		return nil, apperrors.New(apperrors.CodeInvalidCredentials, "invalid credentials")
	}
	if status != "active" {
		if status == "pending" {
			return nil, apperrors.New(apperrors.CodeEmailNotVerified, "email not verified; please verify before login")
		}
		return nil, apperrors.New(apperrors.CodeForbidden, fmt.Sprintf("account status %s does not permit login", status))
	}
	_, _ = s.db.Exec(ctx, `
UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=now(),
                 last_login_ip=NULLIF($2,'')::inet, last_login_user_agent=NULLIF($3,'')
WHERE id=$1`, userID, in.IP, in.UserAgent)
	s.recordAuthEvent(ctx, userID, "login", true, in.IP, in.UserAgent)

	sessionID, refresh, err := s.authSvc.CreateSession(ctx, userID, "", in.IP, in.UserAgent)
	if err != nil {
		return nil, err
	}
	scopes := defaultScopesFor(emailStatus, phoneStatus)
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, pwVersion, scopes)
	if err != nil {
		return nil, err
	}
	return &LoginOutput{
		UserID: userID, SessionID: sessionID,
		AccessToken: at, RefreshToken: refresh, MustChangePassword: forceChange,
	}, nil
}

func defaultScopesFor(emailStatus, phoneStatus string) []string {
	scopes := []string{"profile.read"}
	if emailStatus == "verified" {
		scopes = append(scopes, "instances.read", "instances.create")
	}
	return scopes
}

func (s *Service) recordAuthEvent(ctx context.Context, userID uuid.UUID, eventType string, success bool, ip, ua string) error {
	_, err := s.db.Exec(ctx, `
INSERT INTO auth_events(user_id, event_type, success, ip, user_agent) VALUES ($1,$2,$3,NULLIF($4,'')::inet,NULLIF($5,''))`,
		userID, eventType, success, ip, ua)
	return err
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
		return apperrors.New(apperrors.CodeEmailExists, "email already registered")
	case contains(msg, "ux_users_phone_live"):
		return apperrors.New(apperrors.CodePhoneExists, "phone already registered")
	case contains(msg, "ux_users_username_live"):
		return apperrors.New(apperrors.CodeUsernameExists, "username already taken")
	case contains(msg, "ux_organizations_slug_live"):
		return apperrors.New(apperrors.CodeConflict, "organization slug already exists")
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
