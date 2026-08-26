package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	mw "kilat.cloud/backend/pkg/middleware"
)

// instanceProvider resolves the adapter owning an instance by looking up its
// providers.code; instances without a provider mapping (provider_id NULL, row
// gone) fall back to the default Onidel provider.
func (s *Server) instanceProvider(ctx context.Context, instanceID uuid.UUID) (provider.ComputeProvider, error) {
	var code string
	err := s.db.QueryRow(ctx, `
SELECT p.code FROM instances i JOIN providers p ON p.id = i.provider_id WHERE i.id = $1`, instanceID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.prov, nil // unmapped -> Onidel fallback
	}
	if err != nil {
		return nil, err
	}
	return provider.Lookup(strings.ToLower(code)) // citext may preserve case; registry keys are lowercase
}

// handleVNCSession opens a noVNC session for an instance through the provider,
// stores the encrypted session URL for audit purposes, and returns it to the
// caller with its expiry timestamp.
func (s *Server) handleVNCSession(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	vmExt, err := instanceExternalVM(ctx, s.db, instanceID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	pv, err := s.instanceProvider(ctx, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	url, expireUnix, err := pv.VNCSession(ctx, vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}

	key := sha256.Sum256([]byte("vnc:" + s.cfg.SecretEncryptionKey))
	cipherText, cerr := crypto.Encrypt(key[:], []byte(url))
	if cerr != nil {
		return mw.WriteError(c, cerr)
	}

	var expiresAt any
	if expireUnix > 0 {
		expiresAt = expireUnix
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO vm_console_sessions(instance_id, requested_by, console_type, url_ciphertext, expires_at)
VALUES ($1,$2,'novnc',$3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint) END)`,
		instanceID, mustUserID(c), cipherText, expiresAt); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, fiber.Map{
		"vnc_url":   url,
		"expire_at": expireUnix,
	}, nil)
}
