// Registry bridge: builds the VMware adapter lazily from the providers row
// (api_base_url + AES-GCM encrypted {token_user, token_secret} credentials
// plus optional {"insecure":true} metadata), so platform admins configure
// vCenters at runtime without redeploying.
package vmware

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

// RegisterFactoryFromDB registers the lazy "vmware" provider factory that
// reads its endpoint/credentials from the providers table on first Lookup.
// Every failure is an apperrors CodeProviderUnavailable so API callers get a
// meaningful 503 (not a 500) when the vCenter is unconfigured or disabled.
func RegisterFactoryFromDB(db *pgxpool.Pool, encKey []byte) {
	provider.RegisterFactory(ProviderCode, func() (provider.ComputeProvider, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cfg, err := LoadVMwareConfig(ctx, db, encKey)
		if err != nil {
			return nil, err
		}
		if !cfg.enabled {
			return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
				"vmware provider is disabled; enable it via admin providers")
		}
		return NewAdapter(cfg.baseURL, cfg.username, cfg.password, cfg.insecure)
	})
}

type vmwareConfig struct {
	baseURL  string
	username string
	password string
	insecure bool
	enabled  bool
}

type dbCreds struct {
	TokenUser   string `json:"token_user"`
	TokenSecret string `json:"token_secret"`
}

type dbMeta struct {
	Insecure bool `json:"insecure"`
}

// LoadVMwareConfig fetches endpoint + decrypted credentials + flags from the
// providers row (code='vmware').
func LoadVMwareConfig(ctx context.Context, db *pgxpool.Pool, encKey []byte) (vmwareConfig, error) {
	var (
		cfg      vmwareConfig
		ct       []byte
		metaJSON []byte
	)
	err := db.QueryRow(ctx,
		`SELECT api_base_url, credentials_ciphertext, enabled, metadata FROM providers WHERE code='vmware'`).
		Scan(&cfg.baseURL, &ct, &cfg.enabled, &metaJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return cfg, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware provider is not configured")
	}
	if err != nil {
		return cfg, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"load vmware provider config: %v", err)
	}
	if len(ct) == 0 {
		return cfg, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware credentials not set; set api_key via admin providers")
	}
	plain, derr := crypto.Decrypt(encKey, ct)
	if derr != nil {
		return cfg, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"decrypt vmware credentials: %v", derr)
	}
	var c dbCreds
	if uerr := json.Unmarshal(plain, &c); uerr != nil || c.TokenUser == "" || c.TokenSecret == "" {
		return cfg, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware stored credentials malformed")
	}
	// metadata jsonb may carry {"insecure": true} for self-signed certs.
	if len(metaJSON) > 0 {
		var m dbMeta
		if jerr := json.Unmarshal(metaJSON, &m); jerr == nil {
			cfg.insecure = m.Insecure
		}
	}
	cfg.username = c.TokenUser
	cfg.password = c.TokenSecret
	return cfg, nil
}
