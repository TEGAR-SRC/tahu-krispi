// Registry bridge: builds the Onidel adapter lazily from the providers row
// (api_base_url + AES-GCM encrypted raw api_key), so platform admins
// configure credentials at runtime via admin providers without redeploying.
package onidel

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

// RegisterFactoryFromDB registers the lazy "onidel" provider factory that
// reads its endpoint/credentials from the providers table on first Lookup.
func RegisterFactoryFromDB(db *pgxpool.Pool, encKey []byte, fallbackBaseURL, fallbackAPIKey string) {
	provider.RegisterFactory("onidel", func() (provider.ComputeProvider, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		baseURL, apiKey, enabled, err := LoadOnidelConfig(ctx, db, encKey)
		if err != nil {
			// Fallback to env-based config if row not present (backward compat)
			if fallbackAPIKey != "" {
				if baseURL == "" {
					baseURL = fallbackBaseURL
				}
				if baseURL == "" {
					baseURL = "https://api.cloud.onidel.com"
				}
				return NewAdapter(baseURL, fallbackAPIKey), nil
			}
			return nil, err
		}
		if !enabled {
			return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
				"onidel provider is disabled; enable it via admin providers")
		}
		if baseURL == "" {
			baseURL = fallbackBaseURL
			if baseURL == "" {
				baseURL = "https://api.cloud.onidel.com"
			}
		}
		return NewAdapter(baseURL, apiKey), nil
	})
}

// LoadOnidelConfig fetches endpoint + decrypted api_key + enabled.
func LoadOnidelConfig(ctx context.Context, db *pgxpool.Pool, encKey []byte) (baseURL, apiKey string, enabled bool, err error) {
	var ct []byte
	err = db.QueryRow(ctx,
		`SELECT api_base_url, credentials_ciphertext, enabled FROM providers WHERE code='onidel'`).
		Scan(&baseURL, &ct, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"onidel provider is not configured")
	}
	if err != nil {
		return "", "", false, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"load onidel provider config: %v", err)
	}
	if len(ct) == 0 {
		return "", "", enabled, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"onidel credentials not set; set api_key via admin providers")
	}
	plain, derr := crypto.Decrypt(encKey, ct)
	if derr != nil {
		return "", "", enabled, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"decrypt onidel credentials: %v", derr)
	}
	// Onidel stores raw api_key bytes (not JSON)
	return baseURL, string(plain), enabled, nil
}
