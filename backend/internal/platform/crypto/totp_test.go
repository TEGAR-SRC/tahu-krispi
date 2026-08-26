package crypto

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// referenceSecret is base32("12345678901234567890"), the RFC 6238 Appendix B
// test secret. Expected codes below are the documented SHA-1 HMAC truncation
// results for those exact timestamps, reduced to 6 digits.
const referenceSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestTOTPCodeReferenceVectors(t *testing.T) {
	tests := []struct {
		name    string
		unixSec int64
		want    string
	}{
		{"RFC vector T=59", 59, "287082"},
		{"RFC vector T=1111111109", 1111111109, "081804"},
		{"RFC vector T=1111111111", 1111111111, "050471"},
		{"RFC vector T=1234567890", 1234567890, "005924"},
		{"RFC vector T=2000000000", 2000000000, "279037"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := TOTPCode(referenceSecret, time.Unix(tc.unixSec, 0))
			if err != nil {
				t.Fatalf("TOTPCode: %v", err)
			}
			if got != tc.want {
				t.Errorf("TOTPCode at %d = %s, want %s", tc.unixSec, got, tc.want)
			}
			if len(got) != 6 {
				t.Errorf("code %q must be 6 digits", got)
			}
		})
	}
}

func TestTOTPCodeErrors(t *testing.T) {
	for _, bad := range []string{
		"",
		"   ",
		"not!base32!",
	} {
		if _, err := TOTPCode(bad, time.Unix(59, 0)); err == nil {
			t.Errorf("TOTPCode(%q) expected error, got none", bad)
		}
	}
}

func TestVerifyTOTPWindow(t *testing.T) {
	now := time.Unix(1234567890, 0)
	codeAt := func(sec int64) string {
		c, err := TOTPCode(referenceSecret, time.Unix(sec, 0))
		if err != nil {
			t.Fatalf("TOTPCode: %v", err)
		}
		return c
	}

	current := codeAt(1234567890)
	prev := codeAt(1234567890 - 30)
	next := codeAt(1234567890 + 30)

	if !VerifyTOTP(referenceSecret, current, now) {
		t.Error("current period code must verify")
	}
	if !VerifyTOTP(referenceSecret, prev, now) {
		t.Error("previous period code (window -1) must verify")
	}
	if !VerifyTOTP(referenceSecret, next, now) {
		t.Error("next period code (window +1) must verify")
	}
	farPast := codeAt(1234567890 - 60)
	if VerifyTOTP(referenceSecret, farPast, now) {
		t.Error("code from window -2 must not verify")
	}
	wrong := "000000"
	if wrong == current || wrong == prev || wrong == next {
		t.Fatal("test collision; pick another wrong code")
	}
	if VerifyTOTP(referenceSecret, wrong, now) {
		t.Error("wrong code must not verify")
	}
	if VerifyTOTP("not@base32@", current, now) {
		t.Error("invalid secret must not verify")
	}
	// Lowercase and spaced input must normalize to the same secret.
	lower := strings.ToLower(referenceSecret)
	spaced := lower[:4] + "-" + lower[4:12] + " " + lower[12:]
	if !VerifyTOTP(spaced, current, now) {
		t.Error("lowercase/spaced secret must verify after normalization")
	}
}

func TestGenerateTOTPSecret(t *testing.T) {
	s1, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret: %v", err)
	}
	s2, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret: %v", err)
	}
	if len(s1) != 32 {
		t.Errorf("secret length = %d, want 32", len(s1))
	}
	if strings.ContainsAny(s1, "=") {
		t.Error("secret must have no base32 padding")
	}
	if _, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s1); err != nil {
		t.Errorf("secret not valid unpadded base32: %v", err)
	}
	if s1 == s2 {
		t.Error("two generated secrets must differ")
	}
	// A freshly generated secret must produce verifiable codes end to end.
	now := time.Now()
	code, err := TOTPCode(s1, now)
	if err != nil {
		t.Fatalf("TOTPCode: %v", err)
	}
	if !VerifyTOTP(s1, code, now) {
		t.Error("code generated from fresh secret must verify")
	}
}

func TestOTPAuthURL(t *testing.T) {
	got := OTPAuthURL("Kilat Cloud", "budi@example.com", referenceSecret)
	const want = "otpauth://totp/Kilat%20Cloud:budi@example.com?algorithm=SHA1&digits=6&issuer=Kilat+Cloud&period=30&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if got != want {
		t.Errorf("OTPAuthURL =\n%s\nwant\n%s", got, want)
	}
	if !strings.HasPrefix(got, "otpauth://totp/") {
		t.Error("URL must start with otpauth://totp/")
	}
	if !strings.Contains(got, "secret="+referenceSecret) {
		t.Error("URL must carry the raw secret")
	}
	withoutIssuer := OTPAuthURL("", "budi@example.com", referenceSecret)
	if strings.Contains(withoutIssuer, "issuer=&") {
		t.Error("empty issuer must not render as issuer=")
	}
}
