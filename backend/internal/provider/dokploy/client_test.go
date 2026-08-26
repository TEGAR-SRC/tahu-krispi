package dokploy

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// TestDoForwardsAuthPathQueryBody covers the four proxy contract points:
// the x-api-key header is forwarded, dotted operation paths survive intact,
// query strings and JSON bodies are passed through, and non-2xx upstream
// statuses are relayed verbatim (not wrapped).
func TestDoForwardsAuthPathQueryBody(t *testing.T) {
	var gotMethod, gotPath, gotKey, gotContentType, gotBody, gotQuery string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotKey = r.Header.Get("x-api-key")
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"result":{"data":{"json":{"ok":true}}}}`))
	}))
	defer upstream.Close()

	cl, err := NewClient(upstream.URL+"/", "test-key-123")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if !strings.HasSuffix(cl.base, "/api") {
		t.Fatalf("base should end with /api, got %q", cl.base)
	}

	q := url.Values{"projectId": []string{"abc"}}
	body := []byte(`{"name":"web","description":"d"}`)
	status, payload, err := cl.Do(context.Background(), http.MethodPost, "application.create", q, body)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if status != http.StatusCreated {
		t.Errorf("status = %d, want 201", status)
	}
	if !strings.Contains(string(payload), `"ok":true`) {
		t.Errorf("payload not relayed: %s", payload)
	}
	if gotKey != "test-key-123" {
		t.Errorf("x-api-key = %q, want test-key-123", gotKey)
	}
	if gotPath != "/api/application.create" {
		t.Errorf("path = %q, want /api/application.create (dots must be preserved)", gotPath)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotQuery != "projectId=abc" {
		t.Errorf("query = %q, want projectId=abc", gotQuery)
	}
	if gotBody != string(body) {
		t.Errorf("body = %q, want %q", gotBody, body)
	}
	if gotContentType != "application/json" {
		t.Errorf("content-type = %q, want application/json", gotContentType)
	}
}

// TestDoRelayNon2xx verifies upstream error bodies and statuses pass through
// unwrapped — only transport failures produce an apperrors wrapper.
func TestDoRelayNon2xx(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"FORBIDDEN"}`))
	}))
	defer upstream.Close()

	cl, err := NewClient(upstream.URL, "k")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	status, payload, err := cl.Do(context.Background(), http.MethodGet, "project.all", nil, nil)
	if err != nil {
		t.Fatalf("non-2xx must not return an error, got %v", err)
	}
	if status != http.StatusForbidden {
		t.Errorf("status = %d, want 403", status)
	}
	if !strings.Contains(string(payload), "FORBIDDEN") {
		t.Errorf("body not relayed: %s", payload)
	}
}

// TestDoNoBodyOnGet ensures GET/DELETE calls never send a request body.
func TestDoNoBodyOnGet(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if len(b) != 0 {
			t.Errorf("GET carried a body: %q", b)
		}
		w.WriteHeader(200)
	}))
	defer upstream.Close()

	cl, err := NewClient(upstream.URL, "k")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if _, _, err := cl.Do(context.Background(), http.MethodGet, "server.all", nil, []byte(`{"ignored":true}`)); err != nil {
		t.Fatalf("Do: %v", err)
	}
}

func TestNewClientValidation(t *testing.T) {
	if _, err := NewClient("", "k"); err == nil {
		t.Error("empty baseURL must fail")
	}
	if _, err := NewClient("https://dok.example.com", ""); err == nil {
		t.Error("empty apiKey must fail")
	}
	if _, err := NewClient("://bad url", "k"); err == nil {
		t.Error("invalid baseURL must fail")
	}
}

// Transport-level failures wrap into CodeProviderUnavailable (503), matching
// the proxmox/vmware convention.
func TestDoTransportErrorWrapped(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := upstream.URL
	upstream.Close() // guarantee connection refused

	cl, err := NewClient(url, "k")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	_, _, err = cl.Do(context.Background(), http.MethodGet, "project.all", nil, nil)
	if err == nil {
		t.Fatal("expected transport error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeProviderUnavailable {
		t.Fatalf("err = %v, want CodeProviderUnavailable AppError", err)
	}
}
