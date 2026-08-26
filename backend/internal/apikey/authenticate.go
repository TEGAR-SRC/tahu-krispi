package apikey

import (
	"context"
	"crypto/hmac"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// AuthKeyInfo is the identity resolved from a raw API key; handlers use it to
// authorize requests with iam.ScopesAllow.
type AuthKeyInfo struct {
	KeyID     uuid.UUID
	OwnerType string
	UserID    uuid.UUID
	OrgID     uuid.UUID
	Scopes    []string
}

// Authenticate resolves a raw "<prefix>.<secret>" key against its stored hash.
// It rejects unknown keys, revoked/expired keys, and (when an allowlist is
// configured) requests from IPs outside the allowlist, all as 401/403 app
// errors. Usage stats are updated best-effort in a detached goroutine so they
// never block or fail the request.
func (s *Service) Authenticate(ctx context.Context, rawKey, requestIP string) (*AuthKeyInfo, error) {
	prefix, secret, ok := splitRawKey(strings.TrimSpace(rawKey))
	if !ok {
		return nil, apperrors.New(apperrors.CodeUnauthorized, "invalid api key")
	}

	var (
		id         uuid.UUID
		ownerType  string
		userIDTxt  string
		orgIDTxt   string
		storedHash []byte
		scopes     []string
		allowedIPs []string
		status     string
		expiresAt  *time.Time
	)
	err := s.db.QueryRow(ctx, `
SELECT id, owner_type::text,
       COALESCE(user_id::text,''), COALESCE(organization_id::text,''),
       secret_hash, scopes,
       ARRAY(SELECT h::text FROM unnest(allowed_ips) AS h),
       status::text, expires_at
FROM api_keys WHERE key_prefix=$1`, prefix).
		Scan(&id, &ownerType, &userIDTxt, &orgIDTxt, &storedHash,
			&scopes, &allowedIPs, &status, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperrors.New(apperrors.CodeUnauthorized, "invalid api key")
		}
		return nil, err
	}
	if !hmac.Equal(hashSecret(secret), storedHash) {
		return nil, apperrors.New(apperrors.CodeUnauthorized, "invalid api key")
	}
	switch {
	case status == StatusRevoked:
		return nil, apperrors.New(apperrors.CodeUnauthorized, "api key revoked")
	case status != StatusActive:
		return nil, apperrors.New(apperrors.CodeUnauthorized, "invalid api key")
	}
	if expiresAt != nil && expiresAt.Before(time.Now()) {
		return nil, apperrors.New(apperrors.CodeUnauthorized, "api key expired")
	}
	if len(allowedIPs) > 0 && !ipAllowed(allowedIPs, requestIP) {
		return nil, apperrors.New(apperrors.CodeForbidden, "request IP not allowed")
	}
	info := &AuthKeyInfo{
		KeyID:     id,
		OwnerType: ownerType,
		UserID:    parseUUID(userIDTxt),
		OrgID:     parseUUID(orgIDTxt),
		Scopes:    scopes,
	}
	s.touchUsageAsync(id, requestIP)
	return info, nil
}

// touchUsageAsync records last_used_at/last_used_ip off-band: detached
// context with a short timeout, errors deliberately ignored.
func (s *Service) touchUsageAsync(keyID uuid.UUID, requestIP string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = s.db.Exec(ctx, `
UPDATE api_keys SET last_used_at=now(), last_used_ip=NULLIF($2,'')::inet WHERE id=$1`,
			keyID, strings.TrimSpace(requestIP))
	}()
}

// splitRawKey splits "<prefix>.<secret>" at the first dot; both halves must be
// non-empty. Any dots inside the secret survive untouched.
func splitRawKey(raw string) (prefix, secret string, ok bool) {
	i := strings.IndexByte(raw, '.')
	if i <= 0 || i == len(raw)-1 {
		return "", "", false
	}
	return raw[:i], raw[i+1:], true
}

// ipAllowed reports whether requestIP matches one allowlist entry, each of
// which is either a bare IP or a CIDR block (net.ParseCIDR). An empty
// allowlist denies everything; callers skip this check when it is empty.
func ipAllowed(allowlist []string, requestIP string) bool {
	ip := net.ParseIP(strings.TrimSpace(requestIP))
	if ip == nil {
		return false
	}
	for _, entry := range allowlist {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			if _, ipNet, err := net.ParseCIDR(entry); err == nil && ipNet.Contains(ip) {
				return true
			}
			continue
		}
		if parsed := net.ParseIP(entry); parsed != nil && parsed.Equal(ip) {
			return true
		}
	}
	return false
}

func parseUUID(s string) uuid.UUID {
	if s == "" {
		return uuid.Nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return id
}
