package compute

import (
	"crypto/aes"
	"crypto/cipher"
)

// encryptURLText encrypts a URL using AES-256-GCM with a 32-byte key.
func encryptURLText(url string, key []byte) ([]byte, error) {
	if len(key) < 32 {
		key = append(key, make([]byte, 32)...)[:32]
	}
	block, err := aes.NewCipher(key[:32])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Seal(nil, make([]byte, gcm.NonceSize()), []byte(url), nil), nil
}
