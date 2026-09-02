// Package middleware provides HTTP middleware: request-id, rate limit, security headers.
package middleware

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// JSONErrorWrapper is the exported error envelope writer for handlers.
func JSONErrorWrapper(c fiber.Ctx, err error) error {
	return WriteError(c, err)
}

const RequestIDKey = "request_id"

// RequestID ensures every request has an X-Request-ID.
func RequestID() fiber.Handler {
	return func(c fiber.Ctx) error {
		id := c.Get("X-Request-ID")
		if id == "" {
			b := make([]byte, 16)
			if _, err := randRead(b); err == nil {
				id = formatUUID(b)
			} else {
				id = strconv.FormatInt(time.Now().UnixNano(), 36)
			}
		}
		c.Locals(RequestIDKey, id)
		c.Set("X-Request-ID", id)
		return c.Next()
	}
}

// SecurityHeaders sets common hardening headers.
func SecurityHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'")
		c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// Never cache auth/session pages
		path := c.Path()
		if path == "/oauth/callback" || path == "/handoff" || isAuthPath(path) {
			c.Set("Cache-Control", "no-store, private, max-age=0")
			c.Set("Pragma", "no-cache")
		}
		return c.Next()
	}
}

func isAuthPath(p string) bool {
	return len(p) >= 5 && p[:5] == "/v1/a" && (p == "/v1/auth/register" || p == "/v1/auth/login" || p == "/v1/auth/login/mfa" || p == "/v1/auth/refresh" || p == "/v1/auth/session" || p == "/v1/auth/handoff/exchange" || p == "/v1/auth/logout" || p == "/v1/auth/logout-all" || p[:5] == "/v1/m" /* /v1/me */)
}

// RateLimit implements a sliding-window limiter backed by Redis (or in-memory fallback).
func RateLimit(rdb *redis.Client, key string, max int, window time.Duration) fiber.Handler {
	var mu sync.Mutex
	memCounts = map[string][]time.Time{}
	return func(c fiber.Ctx) error {
		ip := c.IP()
		fullKey := "kc:ratelimit:" + key + ":" + ip
		if rdb != nil {
			ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
			defer cancel()
			n, err := rdb.Incr(ctx, fullKey).Result()
			if err == nil {
				if n == 1 {
					rdb.Expire(ctx, fullKey, window)
				}
				if n > int64(max) {
					return respondRateLimited(c)
				}
				return c.Next()
			}
		}
		mu.Lock()
		now := time.Now()
		windowStart := now.Add(-window)
		filtered := memCounts[fullKey][:0]
		for _, t := range memCounts[fullKey] {
			if t.After(windowStart) {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= max {
			memCounts[fullKey] = filtered
			mu.Unlock()
			return respondRateLimited(c)
		}
		memCounts[fullKey] = append(filtered, now)
		mu.Unlock()
		return c.Next()
	}
}

var memCounts map[string][]time.Time

func respondRateLimited(c fiber.Ctx) error {
	return WriteError(c, apperrors.New(apperrors.CodeRateLimited, "rate limit exceeded"))
}

// ErrorBody is the standard error envelope.
type ErrorBody struct {
	Error     ErrorDetail `json:"error"`
	RequestID string      `json:"request_id"`
}

type ErrorDetail struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

// ServerErrorLogger, when set by the host, receives every >=500 response detail.
var ServerErrorLogger func(code, msg string)

// WriteError writes the standard error envelope for any error.
func WriteError(c fiber.Ctx, err error) error {
	status := 500
	code := "INTERNAL_ERROR"
	msg := "internal server error"
	var fields map[string]string
	if ae, ok := err.(*apperrors.AppError); ok {
		status = ae.HTTPStatus
		code = string(ae.Code)
		msg = ae.Message
		fields = ae.Fields
	} else if fe, ok := err.(*fiber.Error); ok {
		status = fe.Code
		code = "HTTP_ERROR"
		msg = fe.Message
	}
	if status >= 500 && ServerErrorLogger != nil {
		ServerErrorLogger(code+": "+msg, err.Error())
	}
	reqID, _ := c.Locals(RequestIDKey).(string)
	return c.Status(status).JSON(ErrorBody{
		Error:     ErrorDetail{Code: code, Message: msg, Fields: fields},
		RequestID: reqID,
	})
}

// JSON writes a success envelope {data, meta?, request_id}.
func JSON(c fiber.Ctx, status int, data any, meta any) error {
	reqID, _ := c.Locals(RequestIDKey).(string)
	resp := fiber.Map{"data": data, "request_id": reqID}
	if meta != nil {
		resp["meta"] = meta
	}
	return c.Status(status).JSON(resp)
}

func init() { _ = json.Marshal }
