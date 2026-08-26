package user

import (
	"strings"
	"testing"
	"time"

	"kilat.cloud/backend/internal/platform/crypto"
)

func TestGenerateTOTPSecretFormat(t *testing.T) {
	s, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("generateTOTPSecret: %v", err)
	}
	if len(s) != 32 { // 20 bytes -> base32 no padding -> 32 chars
		t.Fatalf("secret length = %d, want 32", len(s))
	}
	if strings.ContainsAny(s, "0189") || strings.ToUpper(s) != s {
		t.Fatalf("secret %q is not valid base32 (RFC 4648 alphabet)", s)
	}
}

func TestTOTPRoundtrip(t *testing.T) {
	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("generateTOTPSecret: %v", err)
	}
	now := time.Now().Truncate(time.Second)

	code, err := crypto.TOTPCode(secret, now)
	if err != nil {
		t.Fatalf("totpCode: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("code length = %d, want 6", len(code))
	}
	if !verifyTOTPCode(secret, code, now) {
		t.Fatalf("current-step code %s rejected", code)
	}
	// Clock drift of one step each way must be accepted.
	if !verifyTOTPCode(secret, code, now.Add(-30*time.Second)) {
		t.Fatalf("code not accepted one step in the past")
	}
	if !verifyTOTPCode(secret, code, now.Add(30*time.Second)) {
		t.Fatalf("code not accepted one step ahead")
	}
	// A far-away step must not verify.
	future, _ := crypto.TOTPCode(secret, now.Add(10*time.Minute))
	if future == code {
		t.Fatalf("codes 10 minutes apart unexpectedly equal")
	}
	if verifyTOTPCode(secret, future, now) {
		t.Fatalf("future-step code accepted at current time")
	}
}

func TestVerifyTOTPRejectsBadInput(t *testing.T) {
	secret, _ := generateTOTPSecret()
	now := time.Now()
	cases := []string{
		"",
		"12345",   // too short
		"1234567", // too long
		"abcdef",  // non-digits
		strings.Repeat("9", 5) + "x",
	}
	for _, c := range cases {
		if verifyTOTPCode(secret, c, now) {
			t.Fatalf("malformed code %q accepted", c)
		}
	}
	if _, err := crypto.TOTPCode("not-base32!!", now); err == nil {
		t.Fatalf("invalid base32 secret accepted")
	}
}
