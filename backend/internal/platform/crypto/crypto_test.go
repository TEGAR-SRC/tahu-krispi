package crypto

import (
	"strings"
	"testing"
)

func TestHashPasswordFormat(t *testing.T) {
	p := DefaultArgon2Params()
	hash, err := HashPassword("supersecret123", p)
	if err != nil {
		t.Fatalf("HashPassword error: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=") {
		t.Fatalf("hash does not use argon2id PHC format: %s", hash)
	}
	if strings.Contains(hash, "supersecret123") {
		t.Fatal("hash contains plaintext password")
	}
}

func TestVerifyPassword(t *testing.T) {
	p := DefaultArgon2Params()
	hash, err := HashPassword("correct-password-1", p)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	ok, err := VerifyPassword("correct-password-1", hash)
	if err != nil || !ok {
		t.Fatalf("verify with correct password failed: ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword("wrong-password", hash)
	if err != nil {
		t.Fatalf("verify error: %v", err)
	}
	if ok {
		t.Fatal("verify with wrong password succeeded")
	}
}

func TestVerifyPasswordInvalidFormat(t *testing.T) {
	if _, err := VerifyPassword("x", "$2a$10$notargon2id"); err == nil {
		t.Fatal("expected ErrInvalidHash for non-argon2id string")
	}
}

func TestRandomTokenLengthAndUniqueness(t *testing.T) {
	a, _ := RandomToken(16)
	b, _ := RandomToken(16)
	if a == b {
		t.Fatal("random tokens must be unique")
	}
	if len(a) != 32 { // 16 bytes hex-encoded
		t.Fatalf("unexpected token length %d", len(a))
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := DeriveKey("master-secret", "totp")
	plaintext := []byte("JBSWY3DPEHPK3PXP")
	ct, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := Decrypt(key, ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("round trip mismatch: %q", got)
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	key := DeriveKey("master-secret", "totp")
	wrong := DeriveKey("other-secret", "totp")
	ct, _ := Encrypt(key, []byte("data"))
	if _, err := Decrypt(wrong, ct); err == nil {
		t.Fatal("decrypt with wrong key should fail")
	}
}

func BenchmarkArgon2id(b *testing.B) {
	p := DefaultArgon2Params()
	for i := 0; i < b.N; i++ {
		h, _ := HashPassword("benchmark-pass", p)
		VerifyPassword("benchmark-pass", h)
	}
}
