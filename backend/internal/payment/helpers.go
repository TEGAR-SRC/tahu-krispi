package payment

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"time"
)

func aesNewCipher(key []byte) (cipher.Block, error) { return aes.NewCipher(key) }

func newGCM(block cipher.Block) (cipher.AEAD, error) { return cipher.NewGCM(block) }

func randRead(b []byte) (int, error) { return rand.Read(b) }

func deriveKey(context string) []byte {
	h := sha256.Sum256([]byte(context))
	return h[:]
}

func unixNow() int64 { return time.Now().Unix() }
