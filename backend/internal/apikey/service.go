// Package apikey implements user API keys per Master Prompt §19 and the
// api_keys table of schema v2: creation, listing, update, rotation, revocation,
// and raw-key authentication. The raw secret is shown exactly once on
// create/rotate; only its SHA-256 hash is persisted.
package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/iam"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	OwnerUser         = "user"
	OwnerOrganization = "organization"

	StatusActive  = "active"
	StatusRevoked = "revoked"
	StatusExpired = "expired"

	keyPrefixTag = "kcl_"
	secretBytes  = 32
)

// Key mirrors one api_keys row.
type Key struct {
	ID             uuid.UUID  `json:"id"`
	PublicID       string     `json:"public_id"`
	OwnerType      string     `json:"owner_type"`
	UserID         *uuid.UUID `json:"user_id,omitempty"`
	OrganizationID *uuid.UUID `json:"organization_id,omitempty"`
	CreatedBy      *uuid.UUID `json:"created_by,omitempty"`
	Name           string     `json:"name"`
	KeyPrefix      string     `json:"key_prefix"`
	Scopes         []string   `json:"scopes"`
	AllowedIPs     []string   `json:"allowed_ips"`
	Status         string     `json:"status"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
	LastUsedIP     string     `json:"last_used_ip,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

// Service provides API key management backed by Postgres.
type Service struct{ db *pgxpool.Pool }

// NewService builds an apikey Service on top of a connection pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// CreateInput describes a new API key. Exactly one of UserID/OrgID must be set
// according to OwnerType, mirroring api_key_owner_exactly_one.
type CreateInput struct {
	OwnerType  string
	UserID     uuid.UUID
	OrgID      uuid.UUID
	CreatedBy  uuid.UUID
	Name       string
	Scopes     []string
	AllowedIPs []string
	ExpiresAt  *time.Time
}

// Create generates a new API key and returns it plus the full raw key
// "<prefix>.<secret>". The raw key is returned only here and on Rotate; the
// database stores sha256(secret) exclusively.
func (s *Service) Create(ctx context.Context, in CreateInput) (*Key, string, error) {
	switch in.OwnerType {
	case OwnerUser:
		if in.UserID == uuid.Nil {
			return nil, "", apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, "user_id is required for owner_type=user"),
				map[string]string{"user_id": "required"})
		}
	case OwnerOrganization:
		if in.OrgID == uuid.Nil {
			return nil, "", apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, "organization_id is required for owner_type=organization"),
				map[string]string{"organization_id": "required"})
		}
	default:
		return nil, "", apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid owner_type"),
			map[string]string{"owner_type": "must be user or organization"})
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, "", apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "name is required"),
			map[string]string{"name": "required"})
	}
	if in.ExpiresAt != nil && in.ExpiresAt.Before(time.Now()) {
		return nil, "", apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "expires_at must be in the future"),
			map[string]string{"expires_at": "must be in the future"})
	}
	scopes := normalizeStrings(in.Scopes)
	if err := validateScopes(scopes); err != nil {
		return nil, "", err
	}
	ips := normalizeStrings(in.AllowedIPs)
	if err := validateIPs(ips); err != nil {
		return nil, "", err
	}

	var userID, orgID, createdBy *uuid.UUID
	if in.UserID != uuid.Nil {
		v := in.UserID
		userID = &v
	}
	if in.OrgID != uuid.Nil {
		v := in.OrgID
		orgID = &v
	}
	if in.CreatedBy != uuid.Nil {
		v := in.CreatedBy
		createdBy = &v
	}

	var (
		out    *Key
		rawKey string
		lastEr error
	)
	for attempt := 0; attempt < 3; attempt++ {
		prefix, secret, hash, err := newSecret()
		if err != nil {
			return nil, "", fmt.Errorf("generate api key: %w", err)
		}
		k := &Key{}
		err = s.db.QueryRow(ctx, `
INSERT INTO api_keys(owner_type, user_id, organization_id, created_by, name, key_prefix, secret_hash,
                     scopes, allowed_ips, status, expires_at)
VALUES ($1::api_key_owner_type, $2, $3, $4, $5, $6, $7,
        $8::text[],
        COALESCE((SELECT array_agg(v::inet) FROM unnest($9::text[]) AS v), '{}'::inet[]),
        'active', $10)
RETURNING id, public_id, created_at`,
			in.OwnerType, userID, orgID, createdBy, in.Name, prefix, hash,
			scopes, ips, in.ExpiresAt).Scan(&k.ID, &k.PublicID, &k.CreatedAt)
		if err == nil {
			k.OwnerType = in.OwnerType
			k.UserID = userID
			k.OrganizationID = orgID
			k.CreatedBy = createdBy
			k.Name = in.Name
			k.KeyPrefix = prefix
			k.Scopes = scopes
			k.AllowedIPs = ips
			k.Status = StatusActive
			k.ExpiresAt = in.ExpiresAt
			out = k
			rawKey = formatRawKey(prefix, secret)
			break
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			lastEr = err // key_prefix/public_id collision: regenerate and retry
			continue
		}
		return nil, "", err
	}
	if out == nil {
		return nil, "", fmt.Errorf("insert api key: %w", lastEr)
	}
	return out, rawKey, nil
}

// List returns all API keys of the given owner, newest first.
func (s *Service) List(ctx context.Context, ownerType string, userID, orgID uuid.UUID) ([]Key, error) {
	cond := "user_id = $2"
	arg := userID
	if ownerType == OwnerOrganization {
		cond = "organization_id = $2"
		arg = orgID
	} else if ownerType != OwnerUser {
		return nil, apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid owner_type"),
			map[string]string{"owner_type": "must be user or organization"})
	}
	rows, err := s.db.Query(ctx, selectKeyCols+" WHERE owner_type=$1::api_key_owner_type AND "+cond+
		" ORDER BY created_at DESC", ownerType, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Key
	for rows.Next() {
		k, err := scanKeyRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *k)
	}
	return out, rows.Err()
}

// Get fetches one API key by primary key.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (*Key, error) {
	k, err := scanKeyRow(s.db.QueryRow(ctx, selectKeyCols+" WHERE id=$1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.New(apperrors.CodeNotFound, "api key not found")
	}
	return k, err
}

// UpdateInput patches mutable columns. A nil field leaves the column
// unchanged; a non-nil pointer overwrites it (including ExpiresAt, which can
// thus only be moved, not cleared).
type UpdateInput struct {
	Name       *string
	Scopes     *[]string
	AllowedIPs *[]string
	ExpiresAt  *time.Time
}

// Update applies a partial patch and returns the fresh row.
func (s *Service) Update(ctx context.Context, id uuid.UUID, in UpdateInput) (*Key, error) {
	sets := make([]string, 0, 4)
	args := make([]any, 0, 5)
	args = append(args, id)
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, "name must not be empty"),
				map[string]string{"name": "must not be empty"})
		}
		args = append(args, name)
		sets = append(sets, fmt.Sprintf("name=$%d", len(args)))
	}
	if in.Scopes != nil {
		scopes := normalizeStrings(*in.Scopes)
		if err := validateScopes(scopes); err != nil {
			return nil, err
		}
		args = append(args, scopes)
		sets = append(sets, fmt.Sprintf("scopes=$%d::text[]", len(args)))
	}
	if in.AllowedIPs != nil {
		ips := normalizeStrings(*in.AllowedIPs)
		if err := validateIPs(ips); err != nil {
			return nil, err
		}
		args = append(args, ips)
		sets = append(sets, fmt.Sprintf("allowed_ips=(SELECT array_agg(v::inet) FROM unnest($%d::text[]) AS v)", len(args)))
	}
	if in.ExpiresAt != nil {
		args = append(args, *in.ExpiresAt)
		sets = append(sets, fmt.Sprintf("expires_at=$%d", len(args)))
	}
	if len(sets) == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "nothing to update")
	}
	if _, err := s.db.Exec(ctx, "UPDATE api_keys SET "+strings.Join(sets, ", ")+" WHERE id=$1", args...); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

// Revoke marks the key revoked with revoked_at=now(); revoking an already
// revoked key is a no-op returning its current state. Deleted keys are not
// supported by design: revoke instead.
func (s *Service) Revoke(ctx context.Context, id uuid.UUID) (*Key, error) {
	ct, err := s.db.Exec(ctx,
		`UPDATE api_keys SET status='revoked', revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, id)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() > 0 {
		return s.Get(ctx, id)
	}
	// Either already revoked (idempotent) or missing.
	return s.Get(ctx, id)
}

// Rotate replaces the secret of a live key and returns the new raw key, which
// is again visible only this once. Rotating a revoked key is refused.
func (s *Service) Rotate(ctx context.Context, id uuid.UUID) (*Key, string, error) {
	prefix, secret, hash, err := newSecret()
	if err != nil {
		return nil, "", fmt.Errorf("generate api key: %w", err)
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE api_keys SET key_prefix=$2, secret_hash=$3 WHERE id=$1 AND status <> $4`,
		id, prefix, hash, StatusRevoked)
	if err != nil {
		return nil, "", err
	}
	if ct.RowsAffected() == 0 {
		// Distinguish missing (Get propagates NotFound) from revoked.
		if _, getErr := s.Get(ctx, id); getErr != nil {
			return nil, "", getErr
		}
		return nil, "", apperrors.New(apperrors.CodeInvalidState, "cannot rotate a revoked api key")
	}
	k, err := s.Get(ctx, id)
	if err != nil {
		return nil, "", err
	}
	return k, formatRawKey(prefix, secret), nil
}

const selectKeyCols = `
SELECT id, public_id, owner_type::text,
       COALESCE(user_id::text,''), COALESCE(organization_id::text,''), COALESCE(created_by::text,''),
       name, key_prefix, scopes,
       ARRAY(SELECT h::text FROM unnest(allowed_ips) AS h),
       status::text, expires_at, last_used_at,
       COALESCE(host(last_used_ip),''), created_at, revoked_at
FROM api_keys`

// scanKeyRow scans one api_keys row (16 columns of selectKeyCols) into a Key.
func scanKeyRow(row pgx.Row) (*Key, error) {
	k := &Key{}
	var userIDTxt, orgIDTxt, createdByTxt, lastUsedIPTxt string
	err := row.Scan(
		&k.ID, &k.PublicID, &k.OwnerType,
		&userIDTxt, &orgIDTxt, &createdByTxt,
		&k.Name, &k.KeyPrefix, &k.Scopes, &k.AllowedIPs,
		&k.Status, &k.ExpiresAt, &k.LastUsedAt,
		&lastUsedIPTxt, &k.CreatedAt, &k.RevokedAt)
	if err != nil {
		return nil, err
	}
	k.UserID = uuidPtr(userIDTxt)
	k.OrganizationID = uuidPtr(orgIDTxt)
	k.CreatedBy = uuidPtr(createdByTxt)
	k.LastUsedIP = lastUsedIPTxt
	if k.Scopes == nil {
		k.Scopes = []string{}
	}
	if k.AllowedIPs == nil {
		k.AllowedIPs = []string{}
	}
	return k, nil
}

func uuidPtr(s string) *uuid.UUID {
	if s == "" {
		return nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

// newSecret produces fresh key material: the 64-char hex secret, its
// "kcl_" + first-8-hex prefix, and sha256(secret) for storage.
func newSecret() (prefix, secret string, hash []byte, err error) {
	buf := make([]byte, secretBytes)
	if _, err = rand.Read(buf); err != nil {
		return "", "", nil, err
	}
	secret = hex.EncodeToString(buf)
	prefix = keyPrefixTag + secret[:8]
	hash = hashSecret(secret)
	return prefix, secret, hash, nil
}

// hashSecret returns the SHA-256 digest of a raw secret; this is the only
// representation ever persisted.
func hashSecret(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// formatRawKey renders the full credential handed to the user exactly once.
func formatRawKey(prefix, secret string) string {
	return prefix + "." + secret
}

// validateScopes accepts every scope in iam.ValidScopes() plus the "*"
// wildcard.
func validateScopes(scopes []string) error {
	for _, sc := range scopes {
		if sc == "*" {
			continue
		}
		if !iam.IsValidScope(sc) {
			return apperrors.WithFields(
				apperrors.Newf(apperrors.CodeValidation, "unknown scope %q", sc),
				map[string]string{"scopes": "unknown scope " + sc})
		}
	}
	return nil
}

// parsableIPOrCIDR reports whether s is a bare IP address or an CIDR block.
func parsableIPOrCIDR(s string) bool {
	if net.ParseIP(s) != nil {
		return true
	}
	if strings.Contains(s, "/") {
		if _, _, err := net.ParseCIDR(s); err == nil {
			return true
		}
	}
	return false
}

// validateIPs ensures every allowlist entry parses as IP or CIDR.
func validateIPs(ips []string) error {
	for _, ipStr := range ips {
		if !parsableIPOrCIDR(ipStr) {
			return apperrors.WithFields(
				apperrors.Newf(apperrors.CodeValidation, "invalid ip or cidr %q", ipStr),
				map[string]string{"allowed_ips": "invalid ip or cidr " + ipStr})
		}
	}
	return nil
}

// normalizeStrings trims entries, drops empties and guarantees non-nil output.
func normalizeStrings(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
