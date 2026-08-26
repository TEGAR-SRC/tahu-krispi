package middleware

import (
	"crypto/rand"
	"encoding/hex"
)

func randRead(b []byte) (int, error) { return rand.Read(b) }

func formatUUID(b []byte) string {
	if len(b) < 16 {
		return ""
	}
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}
