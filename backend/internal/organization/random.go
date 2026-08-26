package organization

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

func cryptoRand(b []byte) (int, error) { return rand.Read(b) }

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
