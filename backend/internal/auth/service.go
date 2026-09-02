// Package auth implements JWT access tokens and session management.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

type TokenType string

const (
	TokenAccess  TokenType = "access"
	TokenRefresh TokenType = "refresh"
)

type Claims struct {
	UserID          string   `json:"sub"`
	OrganizationID  string   `json:"org,omitempty"`
	SessionID       string   `json:"sid"`
	Type            string   `json:"typ"`
	PasswordVersion int      `json:"pwv"`
	Scopes          []string `json:"scopes,omitempty"`
	IssuedAt        int64    `json:"iat"`
	ExpiresAt       int64    `json:"exp"`
}

// Service issues and verifies JWTs, manages sessions in Postgres + Redis.
type Service struct {
	db         *pgxpool.Pool
	rdb        *goredis.Client
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewService(db *pgxpool.Pool, rdb *goredis.Client, secret string, accessTTL, refreshTTL time.Duration) *Service {
	return &Service{
		db: db, rdb: rdb,
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

var ErrInvalidToken = errors.New("auth: invalid token")

func (s *Service) signHS256(payload []byte) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(header + "." + body))
	return header + "." + body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Service) verifyHS256(token string) ([]byte, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return nil, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}
	return payload, nil
}

// IssueAccessToken creates a signed JWT for a user session.
func (s *Service) IssueAccessToken(userID uuid.UUID, orgID uuid.UUID, sessionID uuid.UUID, passwordVersion int, scopes []string) (string, error) {
	now := time.Now()
	c := Claims{
		UserID: userID.String(), SessionID: sessionID.String(),
		Type: string(TokenAccess), PasswordVersion: passwordVersion,
		Scopes: scopes, IssuedAt: now.Unix(), ExpiresAt: now.Add(s.accessTTL).Unix(),
	}
	if orgID != uuid.Nil {
		c.OrganizationID = orgID.String()
	}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	return s.signHS256(payload), nil
}

// VerifyAccessToken validates signature and expiry of an access token.
func (s *Service) VerifyAccessToken(token string) (*Claims, error) {
	payload, err := s.verifyHS256(token)
	if err != nil {
		return nil, err
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, ErrInvalidToken
	}
	if c.Type != string(TokenAccess) || c.ExpiresAt < time.Now().Unix() {
		return nil, ErrInvalidToken
	}
	if s.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		revoked, _ := s.rdb.Get(ctx, fmt.Sprintf("kc:session:revoked:%s", c.SessionID)).Result()
		if revoked == "1" {
			return nil, ErrInvalidToken
		}
	}
	return &c, nil
}

// VerifySessionCookie validates a session cookie's session ID against DB+Redis.
func (s *Service) VerifySessionCookie(ctx context.Context, sessionID uuid.UUID) (*Claims, error) {
	if s.db == nil {
		return nil, ErrInvalidToken
	}
	var userID uuid.UUID
	var pwv int
	err := s.db.QueryRow(ctx, `SELECT user_id, (SELECT password_version FROM users WHERE id=user_sessions.user_id AND deleted_at IS NULL) FROM user_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()`, sessionID).Scan(&userID, &pwv)
	if err != nil {
		return nil, ErrInvalidToken
	}
	// Redis revoke check
	if s.rdb != nil {
		rctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if v, _ := s.rdb.Get(rctx, fmt.Sprintf("kc:session:revoked:%s", sessionID.String())).Result(); v == "1" {
			return nil, ErrInvalidToken
		}
	}
	now := time.Now()
	return &Claims{
		UserID: userID.String(), SessionID: sessionID.String(),
		Type: string(TokenAccess), PasswordVersion: pwv,
		Scopes: []string{"profile.read", "instances.read", "instances.create"},
		IssuedAt: now.Unix(), ExpiresAt: now.Add(s.accessTTL).Unix(),
	}, nil
}

// SessionByID returns session metadata for handoff/exchange.
func (s *Service) SessionByID(ctx context.Context, sessionID uuid.UUID) (userID uuid.UUID, ok bool) {
	err := s.db.QueryRow(ctx, `SELECT user_id FROM user_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()`, sessionID).Scan(&userID)
	if err != nil {
		return uuid.Nil, false
	}
	// also check revoke set
	if s.rdb != nil {
		if v, _ := s.rdb.Get(ctx, fmt.Sprintf("kc:session:revoked:%s", sessionID.String())).Result(); v == "1" {
			return uuid.Nil, false
		}
	}
	return userID, true
}

// CreateSession persists a durable refresh-token record in Postgres and hot state in Redis.
func (s *Service) CreateSession(ctx context.Context, userID uuid.UUID, deviceName, ip, userAgent string) (sessionID uuid.UUID, refreshToken string, err error) {
	sessionID = uuid.New()
	rawRefresh, err := randomHex(32)
	if err != nil {
		return uuid.Nil, "", err
	}
	hash := sha256.Sum256([]byte(rawRefresh))
	familyID := uuid.New()
	expiresAt := time.Now().Add(s.refreshTTL)
	_, err = s.db.Exec(ctx, `
INSERT INTO user_sessions(id, user_id, session_family_id, refresh_token_hash, device_name, ip, user_agent, expires_at)
VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,'')::inet, NULLIF($7,''), $8)`,
		sessionID, userID, familyID, hash[:], deviceName, ip, userAgent, expiresAt)
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("create session: %w", err)
	}
	hotKey := fmt.Sprintf("kc:session:%s", sessionID)
	s.rdb.HSet(ctx, hotKey, map[string]any{
		"user_id": userID.String(),
		"ip":      ip, "ua": userAgent,
	})
	s.rdb.Expire(ctx, hotKey, s.refreshTTL)
	return sessionID, rawRefresh, nil
}

// RotateRefreshToken verifies the current refresh token, rotates it and returns a new pair.
func (s *Service) RotateRefreshToken(ctx context.Context, rawRefresh string) (userID, sessionID uuid.UUID, newRefresh string, passwordVersion int, err error) {
	hash := sha256.Sum256([]byte(rawRefresh))
	row := s.db.QueryRow(ctx, `
UPDATE user_sessions SET last_seen_at = now()
WHERE refresh_token_hash = $1 AND expires_at > now() AND revoked_at IS NULL
RETURNING id, user_id`,
		hash[:])
	if err := row.Scan(&sessionID, &userID); err != nil {
		return uuid.Nil, uuid.Nil, "", 0, ErrInvalidToken
	}
	err = s.db.QueryRow(ctx, `SELECT password_version FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&passwordVersion)
	if err != nil {
		return uuid.Nil, uuid.Nil, "", 0, ErrInvalidToken
	}
	newRefresh, err = randomHex(32)
	if err != nil {
		return uuid.Nil, uuid.Nil, "", 0, err
	}
	newHash := sha256.Sum256([]byte(newRefresh))
	_, err = s.db.Exec(ctx, `
UPDATE user_sessions SET refresh_token_hash = $1, expires_at = $2 WHERE id = $3`,
		newHash[:], time.Now().Add(s.refreshTTL), sessionID)
	if err != nil {
		return uuid.Nil, uuid.Nil, "", 0, fmt.Errorf("rotate refresh: %w", err)
	}
	return userID, sessionID, newRefresh, passwordVersion, nil
}

// RevokeSession revokes a single session.
func (s *Service) RevokeSession(ctx context.Context, sessionID uuid.UUID, reason string) error {
	_, err := s.db.Exec(ctx, `UPDATE user_sessions SET revoked_at=now(), revoke_reason=$2 WHERE id=$1 AND revoked_at IS NULL`, sessionID, reason)
	if err != nil {
		return err
	}
	if s.rdb != nil {
		key := fmt.Sprintf("kc:session:revoked:%s", sessionID)
		ttl := s.refreshTTL
		s.rdb.Set(ctx, key, "1", ttl)
	}
	return nil
}

// RevokeAllSessions revokes every live session for a user.
func (s *Service) RevokeAllSessions(ctx context.Context, userID uuid.UUID, reason string) error {
	rows, err := s.db.Query(ctx, `
UPDATE user_sessions SET revoked_at=now(), revoke_reason=$2
WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
RETURNING id`, userID, reason)
	if err != nil {
		return err
	}
	defer rows.Close()
	if s.rdb != nil {
		for rows.Next() {
			var sid uuid.UUID
			if err := rows.Scan(&sid); err == nil {
				s.rdb.Set(ctx, fmt.Sprintf("kc:session:revoked:%s", sid), "1", s.refreshTTL)
			}
		}
	}
	return rows.Err()
}

// RefreshSession extends expiry of a session (cookie refresh).
func (s *Service) RefreshSession(ctx context.Context, sessionID uuid.UUID) (uuid.UUID, error) {
	_, err := s.db.Exec(ctx, `UPDATE user_sessions SET expires_at = $2, last_seen_at=now() WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()`, sessionID, time.Now().Add(s.refreshTTL))
	if err != nil {
		return uuid.Nil, err
	}
	return sessionID, nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := randRead(b); err != nil {
		return "", err
	}
	return hexEncode(b), nil
}

// RandomHexString returns 32 random bytes hex-encoded for use as an opaque,
// unguessable token.
func RandomHexString() (string, error) { return randomHex(32) }
