// Package api — session cookie helpers (BFF).
//
// The app uses a server-issued session ID (opaque, stored server-side) that
// is only ever delivered via a Secure HttpOnly cookie. No access/refresh
// token is ever placed in URL query, fragment, response body (post-migration),
// localStorage or any JS-readable storage.
//
// Cookie name: __Host-kc_session (or kc_session when not HTTPS) — the __Host-
// prefix requires Secure + Path=/ + no Domain, enforced here. Domain
// .kilat-cloud.com is intentionally not set so the cookie is host-only; the
// cross-console handoff uses a short-lived single-use code exchanged via a
// dedicated endpoint rather than sharing a cookie across hosts.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

const (
	// CookieSession is the session cookie name. __Host- prefix requires:
	// Secure, Path=/, no Domain. Fallback to kc_session on localhost/HTTP.
	CookieSession       = "__Host-kc_session"
	CookieSessionLegacy = "kc_session"
	// CookieCSRF is the double-submit CSRF cookie (JS readable).
	CookieCSRF = "kc_csrf"
)

// sessionCookieName returns the appropriate session cookie name for the
// current request. On HTTPS use __Host- (strictest); on plain HTTP fall
// back to kc_session so local dev keeps working.
func sessionCookieName(c fiber.Ctx) string {
	if c.Secure() || c.Protocol() == "https" || c.Get("X-Forwarded-Proto") == "https" {
		return CookieSession
	}
	return CookieSessionLegacy
}

// wantsSecure returns true when the request is over HTTPS (or behind a
// trusted HTTPS-terminating proxy). Only then should Secure be set.
func wantsSecure(c fiber.Ctx) bool {
	if c.Secure() || c.Protocol() == "https" {
		return true
	}
	if strings.EqualFold(c.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return false
}

// setSessionCookie issues the HttpOnly session cookie.
func (s *Server) setSessionCookie(c fiber.Ctx, sessionID uuid.UUID) {
	name := sessionCookieName(c)
	secure := wantsSecure(c)
	ck := &fiber.Cookie{
		Name:     name,
		Value:    sessionID.String(),
		Path:     "/",
		MaxAge:   int(s.cfg.RefreshTokenTTL.Seconds()),
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Lax",
	}
	c.Cookie(ck)
	setCSRFCookie(c, secure)
}

// clearSessionCookie expires the session cookie (both names for safety).
func clearSessionCookie(c fiber.Ctx) {
	for _, name := range []string{CookieSession, CookieSessionLegacy} {
		c.Cookie(&fiber.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HTTPOnly: true,
			Secure:   false,
			SameSite: "Lax",
		})
	}
	// also clear CSRF
	c.Cookie(&fiber.Cookie{Name: CookieCSRF, Value: "", Path: "/", MaxAge: -1, SameSite: "Lax"})
}

// sessionIDFromCookie returns the session ID from the cookie, if present.
func sessionIDFromCookie(c fiber.Ctx) (uuid.UUID, bool) {
	for _, name := range []string{CookieSession, CookieSessionLegacy} {
		raw := c.Cookies(name)
		if raw == "" {
			continue
		}
		id, err := uuid.Parse(strings.TrimSpace(raw))
		if err == nil && id != uuid.Nil {
			return id, true
		}
	}
	return uuid.Nil, false
}

// setCSRFCookie sets a non-HttpOnly CSRF cookie so JS can read it.
func setCSRFCookie(c fiber.Ctx, secure bool) {
	// Reuse existing token if present to avoid churn.
	if existing := c.Cookies(CookieCSRF); existing != "" && len(existing) >= 32 {
		return
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return
	}
	token := hex.EncodeToString(b)
	c.Cookie(&fiber.Cookie{
		Name:     CookieCSRF,
		Value:    token,
		Path:     "/",
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
		HTTPOnly: false,
		Secure:   secure,
		SameSite: "Lax",
	})
}

// csrfMiddleware enforces double-submit: cookie kc_csrf must equal header
// X-CSRF-Token on state-changing methods (POST/PUT/PATCH/DELETE). Safe
// methods (GET/HEAD/OPTIONS) are allowed through. Also validates Origin when
// present against CORS allowlist.
func (s *Server) csrfMiddleware(c fiber.Ctx) error {
	method := c.Method()
	if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
		return c.Next()
	}
	// Only enforce CSRF for cookie-auth requests (session cookie present).
	if _, ok := sessionIDFromCookie(c); !ok {
		return c.Next()
	}
	cookieVal := c.Cookies(CookieCSRF)
	headerVal := c.Get("X-CSRF-Token")
	if headerVal == "" {
		headerVal = c.Get("X-CSRFToken")
	}
	if cookieVal == "" || headerVal == "" || !hmacEqual(cookieVal, headerVal) {
		return c.Status(403).JSON(fiber.Map{
			"error": fiber.Map{"code": "CSRF_FAILED", "message": "csrf token missing or invalid"},
		})
	}
	// Optional Origin check: if Origin header present, must be allowlisted.
	if origin := c.Get("Origin"); origin != "" {
		if !s.isAllowedOrigin(origin) {
			return c.Status(403).JSON(fiber.Map{
				"error": fiber.Map{"code": "CSRF_FAILED", "message": "origin not allowed"},
			})
		}
	}
	return c.Next()
}

// hmacEqual is constant-time string comparison to avoid timing leak.
func hmacEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	// constant-time compare without importing crypto/hmac for strings
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

// isAllowedOrigin checks against the configured CORS allowlist.
func (s *Server) isAllowedOrigin(origin string) bool {
	allowed := strings.Split(s.cfg.CORSOrigins(), ",")
	origin = strings.TrimSpace(origin)
	for _, a := range allowed {
		if strings.TrimSpace(a) == origin {
			return true
		}
	}
	// Also allow exact console origins via explicit check
	return false
}

// newHandoffCode creates a short-lived single-use code that maps to a
// session ID in Redis, enabling secure cross-host handoff without placing
// any token in the URL fragment. The code is exchanged by the target
// console via POST /v1/auth/handoff/exchange -> sets cookie.
func (s *Server) newHandoffCode(c fiber.Ctx, sessionID uuid.UUID) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	code := hex.EncodeToString(b) // 64 hex chars
	key := "kc:handoff:" + code
	// 60s TTL, single-use
	if err := s.rdb.Set(c.Context(), key, sessionID.String(), 60*time.Second).Err(); err != nil {
		return "", err
	}
	return code, nil
}

// consumeHandoffCode verifies and deletes the handoff code, returning sessionID.
func (s *Server) consumeHandoffCode(c fiber.Ctx, code string) (uuid.UUID, error) {
	code = strings.TrimSpace(code)
	if len(code) < 32 {
		return uuid.Nil, fmt.Errorf("invalid code")
	}
	key := "kc:handoff:" + code
	val, err := s.rdb.GetDel(c.Context(), key).Result()
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid or expired code")
	}
	id, err := uuid.Parse(strings.TrimSpace(val))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, fmt.Errorf("invalid code")
	}
	return id, nil
}
