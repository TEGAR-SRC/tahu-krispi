package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Audience scoping. Each frontend console talks to its own API domain, and the
// backend only serves the endpoints that domain is allowed to reach. This is
// enforced by inspecting the request Host header against the configured
// per-console API domains.
//
//   - admin   → api-admin.kilat-cloud.com   → /v1/admin/*, staff surfaces
//   - user    → api-user.kilat-cloud.com    → customer endpoints
//   - auth    → api-auth.kilat-cloud.com    → identity flows only (/v1/auth/*, /v1/me/*)
//   - landing → api-landing.kilat-cloud.com → public marketing + media
//   - docs    → api-docs.kilat-cloud.com    → public docs
//
// The generic api.kilat-cloud.com domain (and localhost during development)
// resolves to the "all" audience so nothing is accidentally locked out until
// the per-console domains are in place.
const (
	audienceAll     = "all"
	audienceAdmin   = "admin"
	audienceUser    = "user"
	audienceAuth    = "auth"
	audienceLanding = "landing"
	audienceDocs    = "docs"
)

// audienceLocalKey stores the resolved audience on the request context.
const audienceLocalKey = "api_audience"

// normalizeHost strips scheme/port and lowercases a host value.
func normalizeHost(host string) string {
	h := strings.TrimSpace(host)
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	return strings.ToLower(strings.TrimSpace(h))
}

// apiDomainHost returns the bare host of a configured API domain.
func (s *Server) apiDomainHost(domain string) string {
	return normalizeHost(domain)
}

// audienceFor resolves the audience for the request's Host header. Falls back
// to "all" for unknown/local hosts so local development keeps working.
func (s *Server) audienceFor(c fiber.Ctx) string {
	host := normalizeHost(c.Hostname())
	switch host {
	case s.apiDomainHost(s.cfg.AdminAPIDomain):
		return audienceAdmin
	case s.apiDomainHost(s.cfg.UserAPIDomain):
		return audienceUser
	case s.apiDomainHost(s.cfg.AuthAPIDomain):
		return audienceAuth
	case s.apiDomainHost(s.cfg.LandingAPIDomain):
		return audienceLanding
	case s.apiDomainHost(s.cfg.DocsAPIDomain):
		return audienceDocs
	default:
		// api.kilat-cloud.com, localhost, IPs → open to everything.
		return audienceAll
	}
}

// resolveAudience computes and stores the audience for this request.
func (s *Server) resolveAudience(c fiber.Ctx) error {
	c.Locals(audienceLocalKey, s.audienceFor(c))
	return c.Next()
}

// currentAudience returns the already-resolved audience for this request.
func currentAudience(c fiber.Ctx) string {
	if v, ok := c.Locals(audienceLocalKey).(string); ok {
		return v
	}
	return audienceAll
}

// allowAudiences returns middleware that rejects requests whose audience is not
// in the allowed set. The "all" audience passes everything (generic domain).
func (s *Server) allowAudiences(allowed ...string) fiber.Handler {
	allowedSet := map[string]bool{}
	for _, a := range allowed {
		allowedSet[a] = true
	}
	return func(c fiber.Ctx) error {
		aud := currentAudience(c)
		if aud == audienceAll || allowedSet[aud] {
			return c.Next()
		}
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden,
			"this endpoint is not available on the "+aud+" API domain"))
	}
}

// audienceAllowedPath reports whether the given audience may reach the path.
// This is the per-console route scoping: each API domain only serves the
// endpoints its console needs.
func audienceAllowedPath(aud, path string) bool {
	// Generic domain / localhost resolves to "all" → everything allowed.
	if aud == audienceAll {
		return true
	}
	switch aud {
	case audienceAdmin:
		// Staff console: admin surfaces plus the public catalog/content it
		// may need to preview. Never lock staff out of anything they manage.
		return true
	case audienceUser:
		// Customer console: everything except the staff /admin surface.
		return !strings.HasPrefix(path, "/v1/admin")
	case audienceAuth:
		// Standalone auth console: identity flows plus a read-only probe so
		// resolveRole() can detect the effective role (admin/finance/noc) without
		// switching to the generic api.kilat-cloud.com domain. Keep it minimal —
		// only the probes used by resolveRole() are allowed, not the full
		// /v1/admin/* surface.
		if strings.HasPrefix(path, "/v1/auth/") ||
			strings.HasPrefix(path, "/v1/me") ||
			strings.HasPrefix(path, "/v1/contact-change") ||
			isBaseRoute(path) {
			return true
		}
		return path == "/v1/admin/audit-logs" ||
			strings.HasPrefix(path, "/v1/admin/audit-logs?") ||
			path == "/v1/admin/finance/summary" ||
			strings.HasPrefix(path, "/v1/admin/finance/summary?") ||
			path == "/v1/admin/providers" ||
			strings.HasPrefix(path, "/v1/admin/providers?")
	case audienceLanding:
		// Marketing site: public content only.
		return publicLandingPrefix(path)
	case audienceDocs:
		// Docs site: public docs + media only.
		return strings.HasPrefix(path, "/v1/docs") ||
			strings.HasPrefix(path, "/v1/media") ||
			isBaseRoute(path)
	default:
		return true
	}
}

// publicLandingPrefix covers the marketing site's public read endpoints.
func publicLandingPrefix(path string) bool {
	return strings.HasPrefix(path, "/v1/landing") ||
		strings.HasPrefix(path, "/v1/blog") ||
		strings.HasPrefix(path, "/v1/media") ||
		isBaseRoute(path)
}

// isBaseRoute allows health/liveness/metrics on any console domain.
func isBaseRoute(path string) bool {
	return path == "/healthz" || path == "/readyz" || path == "/metrics"
}

// enforceAudienceScope is the global middleware that restricts which paths each
// API domain may reach. Run after audience resolution, before route handlers.
func (s *Server) enforceAudienceScope(c fiber.Ctx) error {
	aud := currentAudience(c)
	if !audienceAllowedPath(aud, c.Path()) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden,
			"this endpoint is not available on the "+aud+" API domain"))
	}
	return c.Next()
}
