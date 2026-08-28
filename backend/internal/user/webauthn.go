// webauthn.go implements passkey (WebAuthn) enrolment and management on top of
// the user_mfa_methods table (Master Prompt §21).
package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/platform/crypto"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	passkeySessionTTL     = 5 * time.Minute
	passkeySessionPrefix  = "kc:webauthn:reg:"
	passkeyAuthnPrefix    = "kc:webauthn:authn:"
	passkeyRPDisplayName  = "Kilat Cloud"
)

// PasskeyManager manages WebAuthn/passkey enrolment. Registration is a
// two-step ceremony; the pending SessionData lives in Redis between the
// begin-registration and register calls.
type PasskeyManager struct {
	db     *pgxpool.Pool
	rdb    *goredis.Client
	encKey []byte
	w      *webauthn.WebAuthn
}

// NewPasskeyManager builds the manager from an existing pool, Redis client,
// secret-encryption key, Relying Party ID (bare domain) and the list of
// origins where navigator.credentials.create() runs.
func NewPasskeyManager(db *pgxpool.Pool, rdb *goredis.Client, encKey []byte, rpID string, rpOrigins []string) (*PasskeyManager, error) {
	w, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: passkeyRPDisplayName,
		RPOrigins:     rpOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("create webauthn: %w", err)
	}
	return &PasskeyManager{db: db, rdb: rdb, encKey: encKey, w: w}, nil
}

// PasskeyInfo is one row of a user's registered passkeys.
type PasskeyInfo struct {
	ID         uuid.UUID  `json:"id"`
	Label      string     `json:"label"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
	Enabled    bool       `json:"enabled"`
}

// ListPasskeys returns all passkeys registered by a user, oldest first.
func (m *PasskeyManager) ListPasskeys(ctx context.Context, userID uuid.UUID) ([]PasskeyInfo, error) {
	rows, err := m.db.Query(ctx, `
SELECT id, COALESCE(label,''), created_at, last_used_at, enabled
FROM user_mfa_methods
WHERE user_id=$1 AND method='webauthn'
ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []PasskeyInfo
	for rows.Next() {
		var k PasskeyInfo
		if err := rows.Scan(&k.ID, &k.Label, &k.CreatedAt, &k.LastUsedAt, &k.Enabled); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// BeginRegistration starts a passkey enrolment ceremony for the user and
// returns the CredentialCreation options to hand to
// navigator.credentials.create(). The pending SessionData is stored in Redis
// keyed by user with a short TTL. userName overrides the account email as the
// WebAuthn user name when non-empty.
func (m *PasskeyManager) BeginRegistration(ctx context.Context, userID uuid.UUID, userName string) (*protocol.CredentialCreation, error) {
	u, err := m.loadWebauthnUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if userName != "" {
		u.name = userName
	}
	opts := []webauthn.RegistrationOption{
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			UserVerification: protocol.VerificationPreferred,
		}),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(webauthn.Credentials(u.credentials).CredentialDescriptors()),
	}
	creation, session, err := m.w.BeginRegistration(u, opts...)
	if err != nil {
		return nil, fmt.Errorf("begin passkey registration: %w", err)
	}
	blob, err := json.Marshal(session)
	if err != nil {
		return nil, fmt.Errorf("encode webauthn session: %w", err)
	}
	if err := m.rdb.Set(ctx, passkeySessionKey(userID), blob, passkeySessionTTL).Err(); err != nil {
		return nil, fmt.Errorf("store webauthn session: %w", err)
	}
	return creation, nil
}

// FinishRegistration validates the attestation response against the pending
// session, enforces credential-id uniqueness and persists the passkey as a
// verified user_mfa_methods row. The full webauthn.Credential record is
// encrypted at rest in secret_ciphertext as recommended by the library
// (everything except the lookup ID); the columns carry the fields needed for
// future assertion ceremonies.
func (m *PasskeyManager) FinishRegistration(ctx context.Context, userID uuid.UUID, attestationResponse json.RawMessage, label string) (PasskeyInfo, error) {
	var info PasskeyInfo
	if len(attestationResponse) == 0 {
		return info, apperrors.New(apperrors.CodeValidation, "credential is required")
	}
	if label == "" {
		label = "Passkey"
	}

	raw, err := m.rdb.GetDel(ctx, passkeySessionKey(userID)).Bytes()
	switch {
	case errors.Is(err, goredis.Nil):
		return info, apperrors.New(apperrors.CodeValidation, "no pending passkey registration; call begin-registration first")
	case err != nil:
		return info, fmt.Errorf("load webauthn session: %w", err)
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(raw, &session); err != nil {
		return info, fmt.Errorf("decode webauthn session: %w", err)
	}

	u, err := m.loadWebauthnUser(ctx, userID)
	if err != nil {
		return info, err
	}
	parsedResponse, perr := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(attestationResponse))
	if perr != nil {
		return info, apperrors.New(apperrors.CodeValidation, "invalid attestation response: "+perr.Error())
	}
	cred, cerr := m.w.CreateCredential(u, session, parsedResponse)
	if cerr != nil {
		return info, apperrors.New(apperrors.CodeValidation, "passkey verification failed: "+cerr.Error())
	}

	var exists bool
	if err := m.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM user_mfa_methods WHERE method='webauthn' AND credential_id=$1)`,
		cred.ID).Scan(&exists); err != nil {
		return info, err
	}
	if exists {
		return info, apperrors.New(apperrors.CodeConflict, "this passkey is already registered")
	}

	credJSON, err := json.Marshal(cred)
	if err != nil {
		return info, fmt.Errorf("encode credential: %w", err)
	}
	ciphertext, err := crypto.Encrypt(m.encKey, credJSON)
	if err != nil {
		return info, fmt.Errorf("encrypt credential: %w", err)
	}
	transports := make([]string, len(cred.Transport))
	for i, t := range cred.Transport {
		transports[i] = string(t)
	}

	err = m.db.QueryRow(ctx, `
INSERT INTO user_mfa_methods(user_id, method, label, secret_ciphertext, credential_id,
                             credential_public_key, sign_count, transports, enabled, verified_at)
VALUES ($1, 'webauthn', $2, $3, $4, $5, $6, $7, true, now())
RETURNING id, label, created_at`,
		userID, label, ciphertext, cred.ID, cred.PublicKey, cred.Authenticator.SignCount, transports,
	).Scan(&info.ID, &info.Label, &info.CreatedAt)
	if err != nil {
		return info, fmt.Errorf("insert passkey: %w", err)
	}
	info.LastUsedAt = nil
	info.Enabled = true
	return info, nil
}

// RemovePasskey deletes one passkey scoped to the user; it reports not-found
// when the id does not reference one of the user's own passkeys.
func (m *PasskeyManager) RemovePasskey(ctx context.Context, userID, methodID uuid.UUID) error {
	tag, err := m.db.Exec(ctx, `
DELETE FROM user_mfa_methods WHERE id=$1 AND user_id=$2 AND method='webauthn'`, methodID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "passkey not found")
	}
	return nil
}

// BeginAuthentication starts a passkey login ceremony. The browser calls
// navigator.credentials.get() with the returned options. The pending
// SessionData is stored in Redis keyed by a random handle so it survives the
// round-trip without requiring an authenticated session.
func (m *PasskeyManager) BeginAuthentication(ctx context.Context) (*protocol.CredentialAssertion, string, error) {
	assertion, session, err := m.w.BeginDiscoverableLogin()
	if err != nil {
		return nil, "", fmt.Errorf("begin passkey authn: %w", err)
	}
	blob, err := json.Marshal(session)
	if err != nil {
		return nil, "", fmt.Errorf("encode webauthn session: %w", err)
	}
	handle := uuid.New().String()
	if err := m.rdb.Set(ctx, passkeyAuthnKey(handle), blob, passkeySessionTTL).Err(); err != nil {
		return nil, "", fmt.Errorf("store webauthn session: %w", err)
	}
	return assertion, handle, nil
}

// FinishAuthentication validates the assertion response against the pending
// session, looks up the user by credential, and returns the user ID on success.
func (m *PasskeyManager) FinishAuthentication(ctx context.Context, handle string, assertionResponse json.RawMessage) (uuid.UUID, error) {
	if handle == "" {
		return uuid.Nil, apperrors.New(apperrors.CodeValidation, "session handle is required")
	}
	raw, err := m.rdb.GetDel(ctx, passkeyAuthnKey(handle)).Bytes()
	switch {
	case errors.Is(err, goredis.Nil):
		return uuid.Nil, apperrors.New(apperrors.CodeValidation, "no pending passkey authn; call begin-authentication first")
	case err != nil:
		return uuid.Nil, fmt.Errorf("load webauthn session: %w", err)
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(raw, &session); err != nil {
		return uuid.Nil, fmt.Errorf("decode webauthn session: %w", err)
	}

	parsedResponse, perr := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(assertionResponse))
	if perr != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeValidation, "invalid assertion response: "+perr.Error())
	}

	// The discoverable login handler receives the raw user ID from the
	// authenticator; we look it up to load the stored credential.
	userID, err := uuid.FromBytes(parsedResponse.Response.UserHandle)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeValidation, "invalid user handle in passkey response")
	}

	u, err := m.loadWebauthnUser(ctx, userID)
	if err != nil {
		return uuid.Nil, err
	}

	cred, err := m.w.ValidateLogin(u, session, parsedResponse)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeValidation, "passkey verification failed: "+err.Error())
	}

	// Update the sign count to prevent cloning.
	_, err = m.db.Exec(ctx, `
UPDATE user_mfa_methods
SET sign_count=$1, last_used_at=now()
WHERE method='webauthn' AND credential_id=$2 AND user_id=$3`,
		cred.Authenticator.SignCount, cred.ID, userID)
	if err != nil {
		// Non-fatal: login still succeeds but sign count won't be tracked.
		_ = err
	}

	return userID, nil
}

func passkeyAuthnKey(handle string) string { return passkeyAuthnPrefix + handle }

// loadWebauthnUser resolves the account email plus every existing passkey so
// BeginRegistration can exclude already-registered authenticators.
func (m *PasskeyManager) loadWebauthnUser(ctx context.Context, userID uuid.UUID) (*webauthnUser, error) {
	var email string
	err := m.db.QueryRow(ctx, `SELECT email::text FROM users WHERE id=$1 AND deleted_at IS NULL`, userID).Scan(&email)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	if err != nil {
		return nil, err
	}
	u := &webauthnUser{id: userID, name: email}
	rows, err := m.db.Query(ctx, `
SELECT credential_id, credential_public_key, sign_count, COALESCE(transports,'{}')
FROM user_mfa_methods
WHERE user_id=$1 AND method='webauthn'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c webauthn.Credential
		var transports []string
		if err := rows.Scan(&c.ID, &c.PublicKey, &c.Authenticator.SignCount, &transports); err != nil {
			return nil, err
		}
		for _, t := range transports {
			c.Transport = append(c.Transport, protocol.AuthenticatorTransport(t))
		}
		u.credentials = append(u.credentials, c)
	}
	return u, rows.Err()
}

// webauthnUser adapts a users row to the webauthn.User interface. The UUID is
// used as the user handle: stable, unique and within the 64-byte limit.
type webauthnUser struct {
	id          uuid.UUID
	name        string
	credentials []webauthn.Credential
}

func (u *webauthnUser) WebAuthnID() []byte                         { return u.id[:] }
func (u *webauthnUser) WebAuthnName() string                       { return u.name }
func (u *webauthnUser) WebAuthnDisplayName() string                { return u.name }
func (u *webauthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func passkeySessionKey(userID uuid.UUID) string { return passkeySessionPrefix + userID.String() }
