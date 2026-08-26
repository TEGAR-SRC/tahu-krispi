package validation

import "testing"

func TestNormalizeEmail(t *testing.T) {
	cases := map[string]string{
		"  User@Gmail.COM ":    "user@gmail.com",
		"a.b+tag@x.co":         "a.b+tag@x.co",
		"\tUPPER@EXAMPLE.io\n": "upper@example.io",
	}
	for in, want := range cases {
		if got := NormalizeEmail(in); got != want {
			t.Errorf("NormalizeEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateEmail(t *testing.T) {
	if err := ValidateEmail("user@example.com"); err != nil {
		t.Errorf("valid email rejected: %v", err)
	}
	for _, bad := range []string{"", "nope", "@missing.com", "trailing@.com"} {
		if err := ValidateEmail(bad); err == nil {
			t.Errorf("invalid email accepted: %q", bad)
		}
	}
}

func TestNormalizePhoneE164(t *testing.T) {
	cases := map[string]string{
		"085712345678":      "+6285712345678",
		"6285712345678":     "+6285712345678",
		"+62 857 1234 5678": "+6285712345678",
		"+6285712345678":    "+6285712345678",
	}
	for in, want := range cases {
		got, err := NormalizePhoneE164(in, "")
		if err != nil {
			t.Errorf("phone %q: unexpected error %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("phone %q normalized to %q, want %q", in, got, want)
		}
	}
	got, err := NormalizePhoneE164("91234567", "SG")
	if err != nil || got != "+6591234567" {
		t.Errorf("SG phone: got %q err=%v", got, err)
	}
	if _, err := NormalizePhoneE164("12345", ""); err == nil {
		t.Error("too-short phone should fail")
	}
}

func TestValidatePhoneE164(t *testing.T) {
	if err := ValidatePhoneE164("+6285712345678"); err != nil {
		t.Errorf("valid E.164 rejected: %v", err)
	}
	for _, bad := range []string{"085712345678", "6285712345678", "+62 857 1234"} {
		if err := ValidatePhoneE164(bad); err == nil {
			t.Errorf("invalid E.164 accepted: %q", bad)
		}
	}
}

func TestValidateUsername(t *testing.T) {
	valid := []string{"abc", "a_b-c.d9", "0123456789012345678901234567890"}
	for _, u := range valid {
		if !ValidateUsername(u) {
			t.Errorf("username %q should be valid", u)
		}
	}
	invalid := []string{"ab", "_abc", "-abc", ".abc", "has space", "way-too-long-username-overflowing-limit!!"}
	for _, u := range invalid {
		if ValidateUsername(u) {
			t.Errorf("username %q should be invalid", u)
		}
	}
}

func TestValidateCIDR(t *testing.T) {
	valid := []string{"10.0.0.0/8", "192.168.1.1", "2001:db8::/32"}
	for _, c := range valid {
		if err := ValidateCIDR(c); err != nil {
			t.Errorf("cidr %q should be valid: %v", c, err)
		}
	}
	if err := ValidateCIDR("999.1.1.1"); err == nil {
		t.Error("invalid cidr accepted")
	}
}
