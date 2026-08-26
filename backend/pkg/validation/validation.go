// Package validation provides request payload validation.
package validation

import (
	"fmt"
	"net"
	"net/mail"
	"regexp"
	"strings"
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$`)

// NormalizeEmail trims whitespace and lowercases an email address.
func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// ValidateEmail checks email syntax after normalization.
func ValidateEmail(s string) error {
	if s == "" {
		return fmt.Errorf("email is required")
	}
	addr, err := mail.ParseAddress(s)
	if err != nil || addr.Address != s {
		return fmt.Errorf("invalid email format")
	}
	return nil
}

// NormalizePhoneE164 normalizes common Indonesian / international formats to +E.164.
// Accepts: 085712345678, 6285712345678, +62 857 1234 5678, +6285712345678.
func NormalizePhoneE164(raw, defaultCountry string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("phone is required")
	}
	var digits strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	switch {
	case strings.HasPrefix(d, "62"):
		d = d[2:]
	case strings.HasPrefix(d, "0"):
		d = d[1:]
	default:
		// already without prefix; assume local number
	}
	countryCode := "62"
	if defaultCountry == "SG" {
		countryCode = "65"
	}
	e164 := "+" + countryCode + d
	if len(e164) < 9 || len(e164) > 16 {
		return "", fmt.Errorf("invalid phone length")
	}
	return e164, nil
}

// ValidatePhoneE164 validates strict E.164 format.
func ValidatePhoneE164(s string) error {
	if len(s) < 9 || len(s) > 17 || !strings.HasPrefix(s, "+") {
		return fmt.Errorf("invalid E.164 format")
	}
	for _, r := range s[1:] {
		if r < '0' || r > '9' {
			return fmt.Errorf("invalid E.164 format")
		}
	}
	return nil
}

// ValidateUsername checks against the schema regex.
func ValidateUsername(s string) bool { return usernameRe.MatchString(s) }

// ValidateCIDR parses an IPv4/IPv6 CIDR or bare address.
func ValidateCIDR(s string) error {
	if strings.Contains(s, "/") {
		_, _, err := net.ParseCIDR(s)
		return err
	}
	if net.ParseIP(s) == nil {
		return fmt.Errorf("invalid IP or CIDR: %s", s)
	}
	return nil
}
