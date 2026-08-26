// Package httputil provides HTTP response helpers: the success envelope and pagination parsing.
package httputil

import (
	"strconv"

	"github.com/gofiber/fiber/v3"
)

// RequestIDKey is the Locals key holding the request id set by middleware.RequestID.
const RequestIDKey = "request_id"

const (
	defaultPage    = 1
	defaultPerPage = 20
	maxPerPage     = 100
)

// Meta carries pagination metadata for list responses.
type Meta struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
	Total   int `json:"total"`
}

// OK writes the standard success envelope {data, meta?, request_id}.
// The request id is read from c.Locals(RequestIDKey); meta is omitted when nil.
func OK(c fiber.Ctx, status int, data any, meta *Meta) error {
	reqID, _ := c.Locals(RequestIDKey).(string)
	resp := fiber.Map{"data": data, "request_id": reqID}
	if meta != nil {
		resp["meta"] = meta
	}
	return c.Status(status).JSON(resp)
}

// Page parses the page/per_page query parameters. Defaults are 1 and 20;
// invalid or non-positive values fall back to the defaults and per_page is capped at 100.
func Page(c fiber.Ctx) (page, perPage int) {
	page = parseBounded(c.Query("page"), defaultPage, defaultPage, int(^uint(0)>>1))
	perPage = parseBounded(c.Query("per_page"), defaultPerPage, defaultPage, maxPerPage)
	return page, perPage
}

// parseBounded parses v as an integer; when v is empty, unparsable, or below min
// it returns def. Otherwise the result is clamped to [min, max].
func parseBounded(v string, def, min, max int) int {
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	if n < min {
		return def
	}
	if n > max {
		return max
	}
	return n
}
