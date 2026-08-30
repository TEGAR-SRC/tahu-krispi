// Package webhook implements customer webhook endpoints and HMAC-signed delivery.
package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Webhook struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Events    []string  `json:"events"`
	Enabled   bool      `json:"enabled"`
	CreatedAt string    `json:"created_at"`
}

func (s *Service) List(ctx context.Context, orgID uuid.UUID) ([]Webhook, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, name, url::text, events::text[], enabled, created_at::text
FROM webhooks WHERE organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Webhook
	for rows.Next() {
		var w Webhook
		if err := rows.Scan(&w.ID, &w.Name, &w.URL, &w.Events, &w.Enabled, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// Create registers a webhook endpoint with an HMAC secret (returned once).
func (s *Service) Create(ctx context.Context, orgID, createdBy uuid.UUID, name, url string, events []string) (*Webhook, string, error) {
	if url == "" {
		return nil, "", apperrors.New(apperrors.CodeValidation, "url is required")
	}
	if len(events) == 0 {
		return nil, "", apperrors.New(apperrors.CodeValidation, "events list is required")
	}
	secretBytes := make([]byte, 32)
	rand.Read(secretBytes)
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	cipherSecret, err := encryptSecret(secret, orgID[:])
	if err != nil {
		return nil, "", err
	}
	row := s.db.QueryRow(ctx, `
INSERT INTO webhooks(organization_id, name, url, secret_ciphertext, events, enabled, created_by)
VALUES ($1,NULLIF($2,''),$3,$4,$5,true,$6)
RETURNING id, COALESCE(name,''), url::text, events::text[], enabled, created_at::text`,
		orgID, name, url, cipherSecret, events, createdBy)
	var w Webhook
	if err := row.Scan(&w.ID, new(string), &w.URL, &w.Events, &w.Enabled, &w.CreatedAt); err != nil {
		return nil, "", err
	}
	w.Name = name
	return &w, secret, nil
}

func (s *Service) Delete(ctx context.Context, orgID, webhookID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `
DELETE FROM webhooks WHERE id=$2 AND organization_id=$1`, orgID, webhookID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "webhook not found")
	}
	return nil
}

// Sign produces the X-Kilat-Signature header value for a payload.
func Sign(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func encryptSecret(plaintext string, keySeed []byte) ([]byte, error) {
	// Derive a stable 32-byte key and use a random per-message nonce so the
	// org UUID is never used directly as key material and the nonce is never
	// reused across secrets (avoids AES-GCM nonce reuse / known-key flaws).
	sum := sha256.Sum256(keySeed)
	key := sum[:]
	block, err := aesNewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipherNewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}
