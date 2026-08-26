package middleware

import (
	"testing"
)

func TestFormatUUID(t *testing.T) {
	b := make([]byte, 16)
	for i := range b {
		b[i] = byte(i)
	}
	got := formatUUID(b)
	want := "00010203-0405-0607-0809-0a0b0c0d0e0f"
	if got != want {
		t.Errorf("formatUUID = %q, want %q", got, want)
	}
	if formatUUID(make([]byte, 8)) != "" {
		t.Error("formatUUID with short slice should be empty")
	}
}

func TestSecurityHeadersHandler(t *testing.T) {
	// Compile-time check the middleware returns a non-nil handler.
	if SecurityHeaders() == nil {
		t.Fatal("SecurityHeaders must return a handler")
	}
	if RequestID() == nil {
		t.Fatal("RequestID must return a handler")
	}
}
