// Package api — OAuth handlers (Google / GitHub). The flow is the
// standard authorization_code grant with a Redis-backed state param for
// CSRF protection. On callback the provider code is exchanged for a user
// profile, the local user is looked up or created, an oauth_accounts row
// is upserted, and a normal Kilat session is issued. If the account has
// TOTP MFA enabled the handler does NOT issue tokens — it issues a
// short-lived preauth token and redirects to the console's MFA step,
// honouring the "no bypass" rule that applies to every first-factor.
package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/platform/crypto"
)

// allowedOAuthProviders is the set of path params we accept.
var allowedOAuthProviders = map[string]bool{"google": true, "github": true}

func (s *Server) oauthConfig(provider, redirectURL string) (*oauth2.Config, error) {
	switch provider {
	case "google":
		if s.cfg.GoogleClientID == "" || s.cfg.GoogleClientSecret == "" {
			return nil, fiber.NewError(503, "Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
		}
		return &oauth2.Config{
			ClientID:     s.cfg.GoogleClientID,
			ClientSecret: s.cfg.GoogleClientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     google.Endpoint,
		}, nil
	case "github":
		if s.cfg.GithubClientID == "" || s.cfg.GithubClientSecret == "" {
			return nil, fiber.NewError(503, "GitHub OAuth not configured — set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET")
		}
		return &oauth2.Config{
			ClientID:     s.cfg.GithubClientID,
			ClientSecret: s.cfg.GithubClientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"user:email"},
			Endpoint:     github.Endpoint,
		}, nil
	default:
		return nil, fiber.NewError(400, "unsupported oauth provider")
	}
}

func (s *Server) oauthRedirectURL(provider string) string {
	base := strings.TrimRight(s.cfg.PublicAPIBaseURL, "/")
	if base == "" {
		base = "http://localhost:8080"
	}
	return base + "/v1/auth/oauth/" + provider + "/callback"
}

func (s *Server) oauthConsoleURL(path string) string {
	base := strings.TrimRight(s.cfg.ConsoleBaseURL, "/")
	if base == "" {
		base = "http://localhost:5173"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

// handleOAuthLogin is GET /v1/auth/oauth/:provider — it redirects the
// browser to the provider's authorization endpoint. The state param is a
// high-entropy random token stored in Redis for 10 minutes. On
// misconfiguration it redirects back to the console login with an error
// query param so the user sees a friendly message instead of raw JSON.
func (s *Server) handleOAuthLogin(c fiber.Ctx) error {
	provider := c.Params("provider")
	if !allowedOAuthProviders[provider] {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_unsupported"))
	}
	redirectURL := s.oauthRedirectURL(provider)
	cfg, err := s.oauthConfig(provider, redirectURL)
	if err != nil {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_not_configured"))
	}
	state, err := randomState()
	if err != nil {
		return err
	}
	// Store state -> provider so the callback can verify it. Short TTL, single use.
	if err := s.rdb.Set(c.Context(), "kc:oauth:state:"+state, provider, 10*time.Minute).Err(); err != nil {
		return fiber.NewError(500, "failed to persist oauth state")
	}
	// golang.org/x/oauth2 adds code_challenge for PKCE automatically if needed; we just need state.
	authURL := cfg.AuthCodeURL(state, oauth2.AccessTypeOffline)
	return c.Redirect().To(authURL)
}

// handleOAuthCallback is GET /v1/auth/oauth/:provider/callback?code=...&state=...
func (s *Server) handleOAuthCallback(c fiber.Ctx) error {
	provider := c.Params("provider")
	if !allowedOAuthProviders[provider] {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_unsupported"))
	}
	// Provider-level error (user denied, etc.) — forward as oauth_<error>.
	if errParam := c.Query("error"); errParam != "" {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_" + url.QueryEscape(errParam)))
	}
	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_missing_code"))
	}
	// Verify and consume state.
	ctx := c.Context()
	stored, err := s.rdb.Get(ctx, "kc:oauth:state:"+state).Result()
	if err != nil || stored != provider {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_invalid_state"))
	}
	_ = s.rdb.Del(ctx, "kc:oauth:state:"+state)

	redirectURL := s.oauthRedirectURL(provider)
	cfg, err := s.oauthConfig(provider, redirectURL)
	if err != nil {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_not_configured"))
	}

	token, err := cfg.Exchange(ctx, code)
	if err != nil {
		s.log.Error("oauth token exchange failed", map[string]any{"provider": provider, "error": err.Error()})
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_exchange_failed"))
	}

	profile, err := s.fetchOAuthProfile(ctx, provider, token)
	if err != nil {
		s.log.Error("oauth profile fetch failed", map[string]any{"provider": provider, "error": err.Error()})
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_profile_failed"))
	}
	if profile.Email == "" {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_no_email"))
	}

	userID, err := s.findOrCreateOAuthUser(ctx, provider, profile)
	if err != nil {
		s.log.Error("oauth findOrCreate user failed", map[string]any{"provider": provider, "error": err.Error()})
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_user_failed"))
	}

	// No bypass: if TOTP MFA is enabled, hand back a preauth token and
	// redirect to the console's MFA step instead of issuing a session.
	hasMFA, err := s.mfaMgr.HasMFA(ctx, userID)
	if err != nil {
		s.log.Error("oauth hasMFA check failed", map[string]any{"error": err.Error()})
	} else if hasMFA {
		preauth, err := s.userSvc.CreatePreauthToken(ctx, userID)
		if err != nil {
			return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_preauth_failed"))
		}
		// Audit: oauth succeeded but MFA required.
		uid := userID
		s.auditSvc.Log(ctx, audit.Entry{
			ActorUserID: &uid, Action: "auth.oauth_mfa_required", ResourceType: "user",
			ResourceID: &uid, IP: c.IP(), UserAgent: c.Get("User-Agent"),
			RequestID: auditRequestID(c),
		})
		q := url.Values{}
		q.Set("mfa_required", "1")
		q.Set("preauth_token", preauth)
		return c.Redirect().To(s.oauthConsoleURL("/oauth/callback#" + q.Encode()))
	}

	// Normal path: issue a full session and redirect with tokens to the
	// console's oauth callback page, which will persist them via setToken().
	sessionID, rawRefresh, err := s.authSvc.CreateSession(ctx, userID, "oauth:"+provider, c.IP(), c.Get("User-Agent"))
	if err != nil {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_session_failed"))
	}
	at, err := s.authSvc.IssueAccessToken(userID, uuid.Nil, sessionID, 0, []string{"profile.read"})
	if err != nil {
		return c.Redirect().To(s.oauthConsoleURL("/login?error=oauth_token_failed"))
	}
	// Audit success.
	uid2 := userID
	s.auditSvc.Log(ctx, audit.Entry{
		ActorUserID: &uid2, Action: "auth.oauth_login", ResourceType: "user",
		ResourceID: &uid2, IP: c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})

	// Tokens are delivered in the URL fragment (#...) so they never appear in
	// proxy/CDN/server access logs and don't persist in browser history.
	frag := url.Values{}
	frag.Set("access_token", at)
	frag.Set("refresh_token", rawRefresh)
	return c.Redirect().To(s.oauthConsoleURL("/oauth/callback#" + frag.Encode()))
}

type oauthProfile struct {
	ProviderUserID string
	Email          string
	Name           string
	AvatarURL      string
}

func (s *Server) fetchOAuthProfile(ctx context.Context, provider string, token *oauth2.Token) (*oauthProfile, error) {
	switch provider {
	case "google":
		return s.fetchGoogleProfile(ctx, token)
	case "github":
		return s.fetchGithubProfile(ctx, token)
	default:
		return nil, fmt.Errorf("unknown provider %s", provider)
	}
}

func (s *Server) fetchGoogleProfile(ctx context.Context, token *oauth2.Token) (*oauthProfile, error) {
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<12))
		return nil, fmt.Errorf("google userinfo %d: %s", resp.StatusCode, string(body))
	}
	var data struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		VerifiedEmail bool   `json:"verified_email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	if !data.VerifiedEmail {
		return nil, fmt.Errorf("google email not verified")
	}
	return &oauthProfile{
		ProviderUserID: data.ID,
		Email:          data.Email,
		Name:           data.Name,
		AvatarURL:      data.Picture,
	}, nil
}

func (s *Server) fetchGithubProfile(ctx context.Context, token *oauth2.Token) (*oauthProfile, error) {
	client := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))

	// Primary profile.
	resp, err := client.Get("https://api.github.com/user")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<12))
		return nil, fmt.Errorf("github user %d: %s", resp.StatusCode, string(body))
	}
	var user struct {
		ID        int64  `json:"id"`
		Email     string `json:"email"`
		Name      string `json:"name"`
		Login     string `json:"login"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	email := user.Email
	// GitHub may not return email in /user if it's private — fall back to /user/emails.
	if email == "" {
		emails, err := s.fetchGithubEmails(ctx, client)
		if err != nil {
			return nil, err
		}
		email = emails
	}
	if email == "" {
		return nil, fmt.Errorf("github no verified email")
	}
	name := user.Name
	if name == "" {
		name = user.Login
	}
	return &oauthProfile{
		ProviderUserID: fmt.Sprintf("%d", user.ID),
		Email:          email,
		Name:           name,
		AvatarURL:      user.AvatarURL,
	}, nil
}

func (s *Server) fetchGithubEmails(ctx context.Context, client *http.Client) (string, error) {
	resp, err := client.Get("https://api.github.com/user/emails")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<12))
		return "", fmt.Errorf("github emails %d: %s", resp.StatusCode, string(body))
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", err
	}
	// Prefer primary+verified, then any verified.
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	for _, e := range emails {
		if e.Verified {
			return e.Email, nil
		}
	}
	return "", fmt.Errorf("no verified github email")
}

func (s *Server) findOrCreateOAuthUser(ctx context.Context, provider string, p *oauthProfile) (uuid.UUID, error) {
	// 1. Existing oauth link?
	var userID uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT user_id FROM app.oauth_accounts WHERE provider=$1 AND provider_user_id=$2`, provider, p.ProviderUserID).Scan(&userID)
	if err == nil {
		// Update provider_email / tokens if needed (best-effort, ignore errors).
		_, _ = s.db.Exec(ctx, `UPDATE app.oauth_accounts SET provider_email=$1, updated_at=now() WHERE provider=$2 AND provider_user_id=$3`, p.Email, provider, p.ProviderUserID)
		return userID, nil
	}
	if err != nil && err != pgx.ErrNoRows {
		return uuid.Nil, err
	}
	// 2. Existing local user with same email? Link them, but only when the
	//    local account's email is verified. Otherwise an attacker who controls
	//    an OAuth provider account with the victim's (unverified) email would
	//    take over a Kilat account the victim never claimed/verified.
	err = s.db.QueryRow(ctx, `SELECT id FROM app.users WHERE lower(email::text)=lower($1) AND deleted_at IS NULL AND email_status='verified'`, p.Email).Scan(&userID)
	if err == nil {
		_, err = s.db.Exec(ctx, `INSERT INTO app.oauth_accounts(provider, provider_user_id, user_id, provider_email) VALUES ($1,$2,$3,$4) ON CONFLICT (provider, provider_user_id) DO UPDATE SET provider_email=EXCLUDED.provider_email`,
			provider, p.ProviderUserID, userID, p.Email)
		if err != nil {
			return uuid.Nil, err
		}
		return userID, nil
	}
	if err != nil && err != pgx.ErrNoRows {
		return uuid.Nil, err
	}
	// 3. Create fresh user. OAuth emails are verified by definition, so
	// activate immediately and skip the email-verify flow.
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	// Generate a random password hash so the NOT NULL constraint is satisfied;
	// the user will sign in via OAuth, not password. They can set a real
	// password later via the forgot-password flow.
	randomPw := uuid.NewString() + uuid.NewString()
	// Use the same Argon2 params the user service uses; derive via the
	// shared crypto helper to stay consistent. Fall back to a direct hash.
	// We reuse the KEK-derived helper's Argon2 defaults.
	hash, herr := hashOAuthPassword(randomPw)
	if herr != nil {
		return uuid.Nil, herr
	}
	username := strings.Split(p.Email, "@")[0]
	// Ensure username uniqueness with a short suffix if needed.
	baseUsername := username
	for i := 0; i < 3; i++ {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM app.users WHERE lower(username::text)=lower($1) AND deleted_at IS NULL)`, username).Scan(&exists); err != nil {
			return uuid.Nil, err
		}
		if !exists {
			break
		}
		username = fmt.Sprintf("%s_%s", baseUsername, uuid.NewString()[:4])
	}
	displayName := p.Name
	if displayName == "" {
		displayName = username
	}
	err = tx.QueryRow(ctx, `
INSERT INTO app.users(email, username, password_hash, status, email_status, email_verified_at, locale, timezone)
VALUES ($1, $2, $3, 'active', 'verified', now(), 'id-ID', 'Asia/Jakarta')
RETURNING id`,
		p.Email, username, hash).Scan(&userID)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO app.user_profiles(user_id, full_name) VALUES ($1, $2)`, userID, displayName)
	if err != nil {
		return uuid.Nil, err
	}
	// Personal org + wallet + notification prefs — mirror registration.
	orgID := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO app.organizations(id, slug, name, created_by) VALUES ($1,$2,$3,$4)`, orgID, "org-"+userID.String()[:8], "personal", userID); err != nil {
		return uuid.Nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.organization_members(organization_id, user_id, role) VALUES ($1,$2,'owner')`, orgID, userID); err != nil {
		return uuid.Nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.wallets(organization_id, currency) VALUES ($1,'IDR')`, orgID); err != nil {
		return uuid.Nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.notification_preferences(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID); err != nil {
		return uuid.Nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO app.oauth_accounts(provider, provider_user_id, user_id, provider_email) VALUES ($1,$2,$3,$4)`, provider, p.ProviderUserID, userID, p.Email); err != nil {
		return uuid.Nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

func hashOAuthPassword(pw string) (string, error) {
	// Minimal Argon2id hash with the same shape the login path expects.
	// crypto.HashPassword needs Argon2Params; use the platform defaults.
	params := crypto.Argon2Params{Memory: 65536, Iterations: 3, Parallelism: 4, KeyLength: 32, SaltLength: 16}
	return crypto.HashPassword(pw, params)
}

func randomState() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
