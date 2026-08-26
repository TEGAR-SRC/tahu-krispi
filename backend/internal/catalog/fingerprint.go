package catalog

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

func sha256HexStr(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// sshFingerprintSHA256 computes an OpenSSH SHA256 base64 fingerprint from a public key.
func sshFingerprintSHA256(pub string) string {
	fields := strings.Fields(pub)
	if len(fields) < 2 {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(fields[1])
	if err != nil {
		return ""
	}
	h := sha256.Sum256(raw)
	return "SHA256:" + base64.RawStdEncoding.EncodeToString(h[:])
}
