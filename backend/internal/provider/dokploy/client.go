// Package dokploy integrates a self-hosted Dokploy PaaS instance (v0.30.2)
// as a platform service.
//
// The upstream API exposes ~597 operations shaped "/tag.method" (e.g.
// POST /application.create, GET /project.all) under the server base + /api,
// authenticated with a single "x-api-key" header. Its OpenAPI spec documents
// no bodies/parameters, so this package does not model endpoints one by one:
// Client.Do is a thin universal transport (status + raw body passthrough)
// and the API layer relays every operation verbatim through
// /v1/dokploy/*, while core resources are mirrored into local tables by
// dedicated admin sync endpoints.
package dokploy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/platform/crypto"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	// apiPrefix is Dokploy's API mount point under the server base; the spec's
	// operation paths ("/project.all", ...) resolve against it.
	apiPrefix = "/api"

	// requestTimeout bounds a single upstream call. Deployments can be slow;
	// 60s covers interactive proxy traffic without pinning connections.
	requestTimeout = 60 * time.Second

	// maxResponseBytes caps how much of an upstream body we buffer in memory
	// (mirrors the API server's own BodyLimit).
	maxResponseBytes = 16 << 20
)

// dbCreds is the JSON envelope sealed in providers.credentials_ciphertext for
// code='dokploy'. Dokploy authenticates with one key only, so token_user is
// deliberately absent — adminUpsertProvider stores {"token_secret": api_key}.
type dbCreds struct {
	TokenSecret string `json:"token_secret"`
}

// Client is a thin authenticated HTTP transport against one Dokploy server.
// It carries no endpoint modeling: callers pass the dotted operation path
// ("application.create") and receive the upstream status and body verbatim.
type Client struct {
	base   string // normalized "<scheme>://<host>[:port]/api" (no trailing slash)
	apiKey string
	http   *http.Client
}

// NewClient builds a Dokploy client for baseURL + apiKey. baseURL may omit
// scheme (https assumed) or already include the /api prefix; both are
// normalized. Trailing slashes are trimmed.
func NewClient(baseURL, apiKey string) (*Client, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "dokploy: baseURL is required")
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "dokploy: apiKey is required")
	}
	raw := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.Contains(raw, "://") {
		// Self-hosted Dokploy almost always sits behind an HTTPS reverse proxy.
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, apperrors.Newf(apperrors.CodeValidation, "dokploy: invalid baseURL %q", baseURL)
	}
	if !strings.HasSuffix(u.Path, apiPrefix) {
		u.Path = strings.TrimRight(u.Path, "/") + apiPrefix
	}
	return &Client{
		base:   u.String(),
		apiKey: apiKey,
		http:   &http.Client{Timeout: requestTimeout},
	}, nil
}

// NewClientFromDB resolves the 'dokploy' providers row at request time:
// api_base_url + AES-GCM encrypted credentials + enabled flag. Every failure
// is an apperrors CodeProviderUnavailable so API callers see a meaningful
// 503 when Dokploy is unconfigured, disabled, or its ciphertext unreadable —
// matching the proxmox/vmware factory convention.
func NewClientFromDB(ctx context.Context, pool *pgxpool.Pool, encKey []byte) (*Client, error) {
	var baseURL string
	var ct []byte
	var enabled bool
	err := pool.QueryRow(ctx,
		`SELECT api_base_url, credentials_ciphertext, enabled FROM app.providers WHERE code='dokploy'`).
		Scan(&baseURL, &ct, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy provider is not configured")
	}
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"load dokploy provider config: %v", err)
	}
	if !enabled {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy provider is disabled; enable it via admin providers")
	}
	if len(ct) == 0 {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy credentials not set; set api_key via admin providers")
	}
	plain, derr := crypto.Decrypt(encKey, ct)
	if derr != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"decrypt dokploy credentials: %v", derr)
	}
	var c dbCreds
	if uerr := json.Unmarshal(plain, &c); uerr != nil || c.TokenSecret == "" {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy stored credentials malformed")
	}
	return NewClient(baseURL, c.TokenSecret)
}

// Do performs one upstream call. opPath keeps its dots ("application.create",
// optionally with a leading slash) and resolves against <base>/api. Query
// parameters ride the URL string; body is sent only for methods that carry
// one (POST/PUT/PATCH). Non-2xx statuses are NOT wrapped: the status and
// body come back untouched so the proxy can relay upstream errors verbatim —
// only transport-level failures are wrapped (CodeProviderUnavailable).
func (c *Client) Do(ctx context.Context, method, opPath string, query url.Values, body []byte) (int, []byte, error) {
	target := c.base + "/" + strings.TrimPrefix(opPath, "/")
	if len(query) > 0 {
		target += "?" + query.Encode()
	}

	hasBody := method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch
	var rdr io.Reader
	if hasBody && len(body) > 0 {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, rdr)
	if err != nil {
		return 0, nil, apperrors.Newf(apperrors.CodeValidation,
			"dokploy: build request %s %s: %v", method, opPath, err)
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	if hasBody && len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy %s %s: %v", method, opPath, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return resp.StatusCode, nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"dokploy %s %s: read response: %v", method, opPath, err)
	}
	return resp.StatusCode, data, nil
}
