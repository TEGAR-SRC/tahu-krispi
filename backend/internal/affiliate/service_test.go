package affiliate

import (
	"strings"
	"testing"
)

func TestComputeCommission(t *testing.T) {
	tests := []struct {
		name    string
		base    float64
		percent float64
		want    float64
	}{
		{"5% of 100000", 100000, 5.00, 5000.00},
		{"5% of 33.33 rounds half-up", 33.33, 5.00, 1.67}, // 1.6665 -> 1.67
		{"7.5% of 3333", 3333, 7.50, 249.98},              // 249.975 -> 249.98
		{"zero percent", 100000, 0, 0},
		{"negative percent treated as zero", 100000, -5, 0},
		{"zero base", 0, 5.00, 0},
		{"fractional result", 10.05, 5.00, 0.50}, // 0.5025 -> 0.50
		{"exact two decimals", 199.99, 5.00, 10.00},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := computeCommission(tt.base, tt.percent)
			if got != tt.want {
				t.Fatalf("computeCommission(%v, %v) = %v, want %v", tt.base, tt.percent, got, tt.want)
			}
		})
	}
}

func TestEligibleForCommission(t *testing.T) {
	tests := []struct {
		name     string
		enabled  bool
		base     float64
		minTotal float64
		want     bool
	}{
		{"enabled above minimum", true, 150000, 100000, true},
		{"enabled at exact minimum", true, 100000, 100000, true},
		{"below minimum", true, 99999.99, 100000, false},
		{"program disabled", false, 500000, 0, false},
		{"disabled and below minimum", false, 1, 100000, false},
		{"no minimum", true, 0.01, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := eligibleForCommission(tt.enabled, tt.base, tt.minTotal)
			if got != tt.want {
				t.Fatalf("eligibleForCommission(%v, %v, %v) = %v, want %v",
					tt.enabled, tt.base, tt.minTotal, got, tt.want)
			}
		})
	}
}

func TestVisitorHashDeterministicAndDistinct(t *testing.T) {
	a1 := visitorHash("203.0.113.7", "Mozilla/5.0")
	a2 := visitorHash("203.0.113.7", "Mozilla/5.0")
	b := visitorHash("203.0.113.8", "Mozilla/5.0")
	c := visitorHash("203.0.113.7", "curl/8.4")

	if a1 != a2 {
		t.Fatal("same ip+ua must produce the same hash")
	}
	if len(a1) != 64 {
		t.Fatalf("hash must be sha256 hex (64 chars), got %d", len(a1))
	}
	if a1 == b || a1 == c {
		t.Fatal("different ip or user agent must change the hash")
	}
}

func TestReferralCodeFromBytes(t *testing.T) {
	code := referralCodeFromBytes([]byte{0, 1, 31, 32, 255, 128, 77, 99})
	if len(code) != codeLength {
		t.Fatalf("code length = %d, want %d", len(code), codeLength)
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAlphabet, r) {
			t.Fatalf("code %q contains non-base32 character %q", code, r)
		}
	}
	if code[0] != 'A' || code[1] != 'B' || code[2] != '7' { // byte%len: 0->A, 1->B, 31->'7'
		t.Fatalf("unexpected mapping for known bytes: %q", code)
	}
}
