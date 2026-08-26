package webhook

import (
	"crypto/aes"
	"crypto/cipher"
)

func aesNewCipher(key []byte) (cipher.Block, error) { return aes.NewCipher(key) }

func cipherNewGCM(block cipher.Block) (cipher.AEAD, error) { return cipher.NewGCM(block) }
