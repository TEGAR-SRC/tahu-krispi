package webhook

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Deliverer performs the HTTP half of webhook delivery: it loads a queued
// webhook_deliveries row, rebuilds the event envelope, signs it with the
// endpoint's decrypted HMAC secret and POSTs it. Failures return an error so
// the jobs queue retries with backoff; every attempt is recorded on the row.
type Deliverer struct {
	db *pgxpool.Pool
	hc *http.Client
}

// NewDeliverer builds a Deliverer with a 10 second per-request timeout.
func NewDeliverer(db *pgxpool.Pool) *Deliverer {
	return &Deliverer{db: db, hc: &http.Client{Timeout: 10 * time.Second}}
}

// maxResponseBody caps how much of the receiver's response we persist.
const maxResponseBody = 2048

// Deliver sends one delivery. Already-delivered rows short-circuit to nil so a
// retried job never double-posts a settled delivery.
func (d *Deliverer) Deliver(ctx context.Context, deliveryID uuid.UUID) error {
	var (
		orgID        uuid.UUID
		eventID      uuid.UUID
		url          string
		secretCipher []byte
		eventType    string
		delivered    bool
		attempts     int
	)
	err := d.db.QueryRow(ctx, `
SELECT w.organization_id, wd.event_id, w.url::text, w.secret_ciphertext,
       de.event_type, wd.delivered_at IS NOT NULL, wd.attempts
FROM webhook_deliveries wd
JOIN webhooks w ON w.id = wd.webhook_id
JOIN domain_events de ON de.id = wd.event_id
WHERE wd.id=$1`, deliveryID).
		Scan(&orgID, &eventID, &url, &secretCipher, &eventType, &delivered, &attempts)
	if err != nil {
		return fmt.Errorf("load webhook delivery: %w", err)
	}
	if delivered {
		return nil
	}

	secret, err := decryptSecret(secretCipher, orgID[:])
	if err != nil {
		d.recordFailure(ctx, deliveryID, err)
		return fmt.Errorf("decrypt webhook secret: %w", err)
	}

	envelope, err := d.buildEnvelope(ctx, eventID, eventType)
	if err != nil {
		return err
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		d.recordFailure(ctx, deliveryID, err)
		return fmt.Errorf("build webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Kilat-Signature", Sign(body, secret))
	req.Header.Set("X-Kilat-Event-Id", eventID.String())
	req.Header.Set("User-Agent", "KilatCloud-Webhook/1.0")

	resp, err := d.hc.Do(req)
	if err != nil {
		d.recordFailure(ctx, deliveryID, err)
		return fmt.Errorf("post webhook %s: %w", url, err)
	}
	defer resp.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBody))

	success := resp.StatusCode >= 200 && resp.StatusCode < 300
	if _, err := d.db.Exec(ctx, `
UPDATE webhook_deliveries SET attempts=attempts+1, response_status=$2,
       response_body=NULLIF($3,''),
       delivered_at=CASE WHEN $4 THEN now() ELSE NULL END,
       last_error=CASE WHEN $4 THEN NULL ELSE $5 END,
       next_retry_at=CASE WHEN $4 THEN NULL ELSE now()+($6 || ' seconds')::interval END
WHERE id=$1`,
		deliveryID, resp.StatusCode, string(snippet), success,
		failMsg(success, resp.StatusCode), nextRetrySeconds(attempts)); err != nil {
		return err
	}
	if !success {
		return fmt.Errorf("webhook %s responded %d for event %s", url, resp.StatusCode, eventType)
	}
	return nil
}

// buildEnvelope reassembles the JSON envelope posted to endpoints. It matches
// the shape stored into webhook_deliveries.request_payload by producers.
func (d *Deliverer) buildEnvelope(ctx context.Context, eventID uuid.UUID, eventType string) (map[string]any, error) {
	var (
		resType   *string
		resID     *uuid.UUID
		payload   []byte
		createdAt time.Time
	)
	err := d.db.QueryRow(ctx, `
SELECT resource_type, resource_id, payload, created_at
FROM domain_events WHERE id=$1`, eventID).
		Scan(&resType, &resID, &payload, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("load domain event: %w", err)
	}
	data := json.RawMessage(payload)
	if len(data) == 0 {
		data = json.RawMessage(`{}`)
	}
	return map[string]any{
		"id":            eventID,
		"event_type":    eventType,
		"resource_type": resType,
		"resource_id":   resID,
		"data":          data,
		"created_at":    createdAt.UTC().Format(time.RFC3339Nano),
	}, nil
}

func (d *Deliverer) recordFailure(ctx context.Context, deliveryID uuid.UUID, err error) {
	_, _ = d.db.Exec(ctx, `
UPDATE webhook_deliveries SET attempts=attempts+1, last_error=$2,
       next_retry_at=now()+($3 || ' seconds')::interval
WHERE id=$1`, deliveryID, err.Error(), "30")
}

func failMsg(success bool, status int) string {
	if success {
		return ""
	}
	return fmt.Sprintf("endpoint responded %d", status)
}

// nextRetrySeconds returns the exponential backoff window (seconds) for the
// n-th retry, capped at one hour. The value only informs the operator-facing
// next_retry_at column; authoritative retries come from the jobs queue.
func nextRetrySeconds(attempt int) string {
	backoff := 30 << minInt(attempt, 4)
	if backoff > 3600 {
		backoff = 3600
	}
	return fmt.Sprint(backoff)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// decryptSecret reverses encryptSecret from service.go: AES-256-GCM whose key
// is the seed padded with zeros to 32 bytes and a fixed all-zero nonce.
func decryptSecret(ciphertext, keySeed []byte) (string, error) {
	key := make([]byte, 32)
	copy(key, keySeed)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, make([]byte, gcm.NonceSize()), ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("webhook secret: %w", err)
	}
	return string(plain), nil
}
