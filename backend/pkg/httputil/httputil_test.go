package httputil

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestPageBounds(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		wantP  int
		wantPP int
	}{
		{name: "defaults", query: "", wantP: 1, wantPP: 20},
		{name: "page only", query: "?page=3", wantP: 3, wantPP: 20},
		{name: "per_page only", query: "?per_page=50", wantP: 1, wantPP: 50},
		{name: "both", query: "?page=2&per_page=100", wantP: 2, wantPP: 100},
		{name: "per_page capped at max", query: "?per_page=500", wantP: 1, wantPP: 100},
		{name: "zero page falls back", query: "?page=0", wantP: 1, wantPP: 20},
		{name: "negative page falls back", query: "?page=-2", wantP: 1, wantPP: 20},
		{name: "zero per_page falls back", query: "?per_page=0", wantP: 1, wantPP: 20},
		{name: "negative per_page falls back", query: "?per_page=-5", wantP: 1, wantPP: 20},
		{name: "non numeric page falls back", query: "?page=abc", wantP: 1, wantPP: 20},
		{name: "non numeric per_page falls back", query: "?per_page=x", wantP: 1, wantPP: 20},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/", func(c fiber.Ctx) error {
				p, pp := Page(c)
				return c.JSON(fiber.Map{"page": p, "per_page": pp})
			})
			req := httptest.NewRequest("GET", "/"+tc.query, nil)
			res, err := app.Test(req)
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			defer res.Body.Close()
			var body struct {
				Page    int `json:"page"`
				PerPage int `json:"per_page"`
			}
			if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body.Page != tc.wantP || body.PerPage != tc.wantPP {
				t.Errorf("Page(%q) = (%d, %d), want (%d, %d)", tc.query, body.Page, body.PerPage, tc.wantP, tc.wantPP)
			}
		})
	}
}

func TestOKEnvelope(t *testing.T) {
	app := fiber.New()
	app.Use(func(c fiber.Ctx) error {
		c.Locals(RequestIDKey, "req-123")
		return c.Next()
	})
	app.Get("/meta", func(c fiber.Ctx) error {
		return OK(c, fiber.StatusOK, fiber.Map{"id": 7}, &Meta{Page: 2, PerPage: 20, Total: 41})
	})
	app.Get("/nometa", func(c fiber.Ctx) error {
		return OK(c, fiber.StatusCreated, []string{"a"}, nil)
	})

	res, err := app.Test(httptest.NewRequest("GET", "/meta", nil))
	if err != nil {
		t.Fatalf("app.Test /meta: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != fiber.StatusOK {
		t.Errorf("status = %d, want %d (body %s)", res.StatusCode, fiber.StatusOK, raw)
	}
	var withMeta struct {
		Data      map[string]any `json:"data"`
		Meta      Meta           `json:"meta"`
		RequestID string         `json:"request_id"`
	}
	if err := json.Unmarshal(raw, &withMeta); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if withMeta.RequestID != "req-123" {
		t.Errorf("request_id = %q, want %q", withMeta.RequestID, "req-123")
	}
	if withMeta.Data["id"] != float64(7) {
		t.Errorf("data = %v, want id 7", withMeta.Data)
	}
	if withMeta.Meta != (Meta{Page: 2, PerPage: 20, Total: 41}) {
		t.Errorf("meta = %+v, want {2 20 41}", withMeta.Meta)
	}

	res2, err := app.Test(httptest.NewRequest("GET", "/nometa", nil))
	if err != nil {
		t.Fatalf("app.Test /nometa: %v", err)
	}
	defer res2.Body.Close()
	raw2, _ := io.ReadAll(res2.Body)
	var noMeta map[string]json.RawMessage
	if err := json.Unmarshal(raw2, &noMeta); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, present := noMeta["meta"]; present {
		t.Error("meta key must be omitted when meta is nil")
	}
	if _, present := noMeta["request_id"]; !present {
		t.Error("request_id key must always be present")
	}
}
