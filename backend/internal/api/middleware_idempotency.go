package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// idempotency implements Master Prompt §34 for unsafe methods: the first
// request with an Idempotency-Key executes and caches its response; retries
// with the same key+body replay it; same key with a different body conflicts.
func (s *Server) idempotency() fiber.Handler {
	return func(c fiber.Ctx) error {
		key := stringsTrimSpace(c.Get("Idempotency-Key"))
		if key == "" {
			return c.Next()
		}
		if len(key) > 200 {
			return mw.WriteError(c, apperrors.New(apperrors.CodeValidation, "idempotency key too long"))
		}
		orgStr, _ := c.Locals("org_id").(string)
		userStr, _ := c.Locals(authLocalsUserID()).(string)
		var orgID, userID *uuid.UUID
		if id, err := uuid.Parse(orgStr); err == nil {
			orgID = &id
		}
		if id, err := uuid.Parse(userStr); err == nil {
			userID = &id
		}
		bodyHash := sha256.Sum256(c.Body())
		requestHash := hex.EncodeToString(bodyHash[:])
		scope := c.Method() + " " + c.Route().Path
		ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
		defer cancel()

		var respStatus int
		var respBody []byte
		var resourceID *uuid.UUID
		err := s.db.QueryRow(ctx, `
SELECT COALESCE(response_status,0), COALESCE(response_body::text,''), resource_id
FROM idempotency_keys WHERE scope=$1 AND key=$2 AND expires_at > now()`,
			scope, key).Scan(&respStatus, new(string), &resourceID)
		switch {
		case err == nil:
			_ = respBody
			// Fetch stored body separately to avoid scanning jsonb into []byte here.
			var stored string
			_ = s.db.QueryRow(ctx,
				`SELECT response_body::text FROM idempotency_keys WHERE scope=$1 AND key=$2`, scope, key).Scan(&stored)
			c.Status(respStatus)
			c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			replayed := []byte(stored)
			if !bytes.Equal(replayed, nil) {
				return c.Send(replayed)
			}
			return c.SendString(`{}`)
		case isNoRowsErr(err):
			// proceed below
		default:
			return mw.WriteError(c, err)
		}

		// Reserve the key atomically; a conflicting concurrent insert means a
		// different request already owns this key.
		inserted, insErr := s.db.Exec(ctx, `
INSERT INTO idempotency_keys(key, scope, organization_id, user_id, endpoint, request_hash, expires_at)
VALUES ($1,$2,$3,$4,$5,$6, now()+interval '24 hours') ON CONFLICT (scope, key) DO NOTHING`,
			key, scope, orgID, userID, c.Path(), requestHash)
		if insErr != nil {
			return mw.WriteError(c, insErr)
		}
		if inserted.RowsAffected() == 0 {
			var existingHash string
			qerr := s.db.QueryRow(ctx,
				`SELECT request_hash FROM idempotency_keys WHERE scope=$1 AND key=$2`, scope, key).Scan(&existingHash)
			if qerr == nil && existingHash != requestHash {
				return mw.WriteError(c, apperrors.New(apperrors.CodeIdempotencyConflict, "idempotency key reused with different request body"))
			}
			return mw.WriteError(c, apperrors.New(apperrors.CodeIdempotencyConflict, "request with this idempotency key is still in progress"))
		}

		if err := c.Next(); err != nil {
			return err
		}

		status := c.Response().StatusCode()
		body := append([]byte(nil), c.Response().Body()...)
		var rid *uuid.UUID
		if raw := c.Get("X-Resource-ID"); raw != "" {
			if id, perr := uuid.Parse(raw); perr == nil {
				rid = &id
			}
		}
		upCtx, upCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer upCancel()
		_, _ = s.db.Exec(upCtx, `
UPDATE idempotency_keys SET response_status=$3, response_body=$4::jsonb, resource_id=$5
WHERE scope=$1 AND key=$2`, scope, key, status, bytesOrEmpty(body), rid)
		_ = io.Discard
		return nil
	}
}

func authLocalsUserID() string { return "auth_user_id" }

func stringsTrimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func isNoRowsErr(err error) bool {
	if err == nil {
		return false
	}
	return containsSub(err.Error(), "no rows in result set")
}

func containsSub(s, sub string) bool {
	n := len(sub)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == sub {
			return true
		}
	}
	return false
}

type byteOrEmpty = []byte

func bytesOrEmpty(b byteOrEmpty) byteOrEmpty {
	if b == nil {
		return []byte("{}")
	}
	if len(b) == 0 {
		return []byte("{}")
	}
	return b
}
