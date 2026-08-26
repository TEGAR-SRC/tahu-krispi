package apikey

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestNewSecretFormat(t *testing.T) {
	prefix, secret, hash, err := newSecret()
	if err != nil {
		t.Fatalf("newSecret: %v", err)
	}
	// 32 random bytes -> 64 hex chars.
	if len(secret) != 2*secretBytes {
		t.Fatalf("secret length = %d, want %d", len(secret), 2*secretBytes)
	}
	if _, err := hex.DecodeString(secret); err != nil {
		t.Fatalf("secret must be hex: %v", err)
	}
	if want := "kcl_" + secret[:8]; prefix != want {
		t.Fatalf("prefix = %q, want %q", prefix, want)
	}
	wantHash := sha256.Sum256([]byte(secret))
	if !hmac.Equal(hash, wantHash[:]) {
		t.Fatal("hash must be sha256(secret)")
	}
	_, secret2, _, err := newSecret()
	if err != nil {
		t.Fatalf("newSecret second call: %v", err)
	}
	if secret == secret2 {
		t.Fatal("two generated secrets must differ")
	}
}

func TestFormatAndSplitRawKey(t *testing.T) {
	raw := formatRawKey("kcl_ab12cd34", "ffee0011")
	prefix, secret, ok := splitRawKey(raw)
	if !ok || prefix != "kcl_ab12cd34" || secret != "ffee0011" {
		t.Fatalf("splitRawKey(%q) = (%q,%q,%v)", raw, prefix, secret, ok)
	}
	// Split at FIRST dot only; dots in the secret survive.
	raw = formatRawKey("kcl_aaaa1111", "aa.bb.cc")
	_, secret, ok = splitRawKey(raw)
	if !ok || secret != "aa.bb.cc" {
		t.Fatalf("first-dot split broken: secret=%q ok=%v", secret, ok)
	}
	for _, bad := range []string{"", "nodot", ".leading", "trailing."} {
		if _, _, ok := splitRawKey(bad); ok {
			t.Errorf("splitRawKey(%q) must fail", bad)
		}
	}
}

func TestHashSecretCompare(t *testing.T) {
	h1 := hashSecret("same-secret")
	if len(h1) != sha256.Size {
		t.Fatalf("hash size = %d, want %d", len(h1), sha256.Size)
	}
	if !hmac.Equal(h1, hashSecret("same-secret")) {
		t.Error("identical secrets must produce equal hashes")
	}
	if hmac.Equal(h1, hashSecret("other-secret")) {
		t.Error("different secrets must not match")
	}
}

func TestIPAllowed(t *testing.T) {
	cases := []struct {
		name string
		list []string
		ip   string
		want bool
	}{
		{"exact ip match", []string{"203.0.113.7"}, "203.0.113.7", true},
		{"exact ip mismatch", []string{"203.0.113.7"}, "203.0.113.8", false},
		{"cidr match", []string{"10.0.0.0/8"}, "10.20.30.40", true},
		{"cidr mismatch", []string{"10.0.0.0/8"}, "11.0.0.1", false},
		{"ipv6 cidr match", []string{"2001:db8::/32"}, "2001:db8::1", true},
		{"ipv6 cidr mismatch", []string{"2001:db8::/32"}, "2001:db9::1", false},
		{"second entry matches", []string{"203.0.113.9", "198.51.100.0/24"}, "198.51.100.77", true},
		{"unparsable entry denies", []string{"not-an-ip"}, "203.0.113.1", false},
		{"empty allowlist denies", nil, "203.0.113.1", false},
		{"bad request ip denies", []string{"0.0.0.0/0"}, "garbage", false},
	}
	for _, tc := range cases {
		if got := ipAllowed(tc.list, tc.ip); got != tc.want {
			t.Errorf("%s: ipAllowed(%v, %q) = %v, want %v", tc.name, tc.list, tc.ip, got, tc.want)
		}
	}
}

func TestValidateScopes(t *testing.T) {
	if err := validateScopes(nil); err != nil {
		t.Errorf("nil scopes must be valid: %v", err)
	}
	if err := validateScopes([]string{"profile.read", "instances.create"}); err != nil {
		t.Errorf("known scopes must be valid: %v", err)
	}
	if err := validateScopes([]string{"*"}); err != nil {
		t.Errorf("wildcard scope must be valid: %v", err)
	}
	if err := validateScopes([]string{"bogus.scope"}); err == nil {
		t.Error("unknown scope must be rejected")
	}
	if err := validateScopes([]string{"profile.read", "bogus.scope"}); err == nil {
		t.Error("one unknown scope must reject the whole list")
	}
}

func TestValidateIPs(t *testing.T) {
	if err := validateIPs(nil); err != nil {
		t.Errorf("nil list must be valid: %v", err)
	}
	if err := validateIPs([]string{"203.0.113.7", "10.0.0.0/8"}); err != nil {
		t.Errorf("valid ip/cidr entries accepted: %v", err)
	}
	for _, bad := range []string{"999.1.2.3", "10.0.0.0/99", "example.com"} {
		if err := validateIPs([]string{bad}); err == nil {
			t.Errorf("entry %q must be rejected", bad)
		}
	}
}

func TestNormalizeStrings(t *testing.T) {
	got := normalizeStrings([]string{"  a ", "", "b\t"})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("normalizeStrings = %v, want [a b]", got)
	}
	if empty := normalizeStrings(nil); empty == nil || len(empty) != 0 {
		t.Fatalf("normalizeStrings(nil) must return non-nil empty slice, got %#v", empty)
	}
}
