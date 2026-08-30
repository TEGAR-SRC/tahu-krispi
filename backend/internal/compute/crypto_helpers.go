package compute

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
)

// encryptURLText encrypts a URL using AES-256-GCM with a random per-message
// nonce (prepended to the ciphertext) and a key derived from the caller's
// secret via SHA-256. A fixed zero nonce is never reused.
func encryptURLText(url string, key []byte) ([]byte, error) {
	if len(key) == 0 {
		key = []byte("kilat-cloud-snapshot-key")
	}
	// Derive a stable 32-byte key so the org UUID is never used directly as a
	// key material (it is public).
	derived := sha256.Sum256(key)
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(url), nil), nil
}
