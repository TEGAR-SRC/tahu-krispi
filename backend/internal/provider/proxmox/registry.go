// Registry bridge: builds the Proxmox adapter lazily from the providers row
// (api_base_url + AES-GCM encrypted {token_user, token_secret} credentials),
// so platform admins configure clusters at runtime without redeploying.
package proxmox

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

// RegisterFactoryFromDB registers the lazy "proxmox" provider factory that
// reads its endpoint/credentials from the providers table on first Lookup.
// Every failure is an apperrors CodeProviderUnavailable so API callers get a
// meaningful 503 (not a 500) when the cluster is unconfigured or disabled.
func RegisterFactoryFromDB(db *pgxpool.Pool, encKey []byte) {
	provider.RegisterFactory("proxmox", func() (provider.ComputeProvider, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		baseURL, tokenUser, tokenSecret, enabled, err := LoadProxmoxConfig(ctx, db, encKey)
		if err != nil {
			return nil, err
		}
		if !enabled {
			return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
				"proxmox provider is disabled; enable it via admin providers")
		}
		return NewAdapter(baseURL, tokenUser, tokenSecret)
	})
}

type dbCreds struct {
	TokenUser   string `json:"token_user"`
	TokenSecret string `json:"token_secret"`
}

// LoadProxmoxConfig fetches endpoint + decrypted token credentials + enabled.
func LoadProxmoxConfig(ctx context.Context, db *pgxpool.Pool, encKey []byte) (baseURL, tokenUser, tokenSecret string, enabled bool, err error) {
	var ct []byte
	err = db.QueryRow(ctx,
		`SELECT api_base_url, credentials_ciphertext, enabled FROM providers WHERE code='proxmox'`).
		Scan(&baseURL, &ct, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", false, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"proxmox provider is not configured")
	}
	if err != nil {
		return "", "", "", false, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"load proxmox provider config: %v", err)
	}
	if len(ct) == 0 {
		return "", "", "", enabled, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"proxmox credentials not set; set api_key via admin providers")
	}
	plain, derr := crypto.Decrypt(encKey, ct)
	if derr != nil {
		return "", "", "", enabled, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"decrypt proxmox credentials: %v", derr)
	}
	var c dbCreds
	if uerr := json.Unmarshal(plain, &c); uerr != nil || c.TokenUser == "" || c.TokenSecret == "" {
		return "", "", "", enabled, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"proxmox stored credentials malformed")
	}
	return baseURL, c.TokenUser, c.TokenSecret, enabled, nil
}
