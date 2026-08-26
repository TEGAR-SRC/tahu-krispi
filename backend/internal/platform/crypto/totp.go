package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// totpPeriod is the RFC 6238 time step in seconds.
const totpPeriod = 30

// GenerateTOTPSecret returns a fresh base32 (RFC 4648, no padding, 32 chars)
// shared secret for TOTP enrollment.
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, 20) // 20 bytes -> exactly 32 base32 chars without padding
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("crypto: read totp secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// TOTPCode computes the RFC 6238 6-digit TOTP for secretBase32 at time t:
// HMAC-SHA-1 over the 8-byte big-endian counter (unix seconds / 30),
// dynamic truncation, modulo 10^6.
func TOTPCode(secretBase32 string, t time.Time) (string, error) {
	key, err := decodeBase32Secret(secretBase32)
	if err != nil {
		return "", err
	}
	counter := uint64(t.Unix()) / totpPeriod
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	value := (uint64(sum[off])&0x7f)<<24 |
		uint64(sum[off+1])<<16 |
		uint64(sum[off+2])<<8 |
		uint64(sum[off+3])
	return fmt.Sprintf("%06d", value%1000000), nil
}

// VerifyTOTP reports whether code is the valid TOTP for secret at now,
// accepting a window of ±1 period (±30s) to tolerate clock drift.
func VerifyTOTP(secret, code string, now time.Time) bool {
	for _, delta := range []int{-totpPeriod, 0, totpPeriod} {
		got, err := TOTPCode(secret, now.Add(time.Duration(delta)*time.Second))
		if err != nil {
			continue
		}
		if hmac.Equal([]byte(got), []byte(code)) {
			return true
		}
	}
	return false
}

// OTPAuthURL builds the otpauth://totp provisioning URI scanned by authenticator apps.
func OTPAuthURL(issuer, accountName, secret string) string {
	label := accountName
	if issuer != "" {
		label = issuer + ":" + accountName
	}
	q := url.Values{}
	q.Set("secret", secret)
	if issuer != "" {
		q.Set("issuer", issuer)
	}
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + url.PathEscape(label) + "?" + q.Encode()
}

// decodeBase32Secret decodes a base32 (no padding) TOTP secret, tolerating
// lowercase input and stray spaces/hyphens from manual entry.
func decodeBase32Secret(secret string) ([]byte, error) {
	norm := strings.ToUpper(strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(secret)))
	if norm == "" {
		return nil, errors.New("crypto: empty totp secret")
	}
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(norm)
	if err != nil {
		return nil, fmt.Errorf("crypto: invalid base32 totp secret: %w", err)
	}
	return key, nil
}
