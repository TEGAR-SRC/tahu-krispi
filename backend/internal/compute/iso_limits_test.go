package compute

import (
	"strings"
	"testing"

	apperrors "kilat.cloud/backend/pkg/errors"
)

const GiB = 1 << 30

// codeOf extracts the machine-readable error code for assertions.
func codeOf(t *testing.T, err error) apperrors.Code {
	t.Helper()
	var ae *apperrors.AppError
	if e, ok := err.(*apperrors.AppError); ok {
		ae = e
	} else {
		t.Fatalf("expected *apperrors.AppError, got %T: %v", err, err)
	}
	return ae.Code
}

func TestCheckISOQuotaOK(t *testing.T) {
	cases := []struct {
		name       string
		count      int
		totalBytes int64
		newSize    int64
	}{
		{"first iso", 0, 0, 5 * GiB},
		{"tenth iso", MaxISOCountPerUser - 1, 10 * GiB, 5 * GiB},
		{"exactly max per file", 0, 0, MaxISOSizeBytes},
		{"quota filled exactly", 2, MaxISOTotalQuotaBytes - GiB, GiB},
	}
	for _, tc := range cases {
		if err := CheckISOQuota(tc.count, tc.totalBytes, tc.newSize); err != nil {
			t.Fatalf("%s: expected OK, got %v", tc.name, err)
		}
	}
}

func TestCheckISOQuotaOversizeFile(t *testing.T) {
	err := CheckISOQuota(0, 0, MaxISOSizeBytes+1)
	if err == nil {
		t.Fatal("expected rejection for file above 15 GiB")
	}
	if !strings.Contains(err.Error(), "maximum size") {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := codeOf(t, err); got != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR, got %s", got)
	}
}

func TestCheckISOQuotaEleventhISORrejected(t *testing.T) {
	err := CheckISOQuota(MaxISOCountPerUser, 0, GiB)
	if err == nil {
		t.Fatal("expected rejection for the 11th ISO")
	}
	if !strings.Contains(err.Error(), "limit reached") {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := codeOf(t, err); got != apperrors.CodeLimitExceeded {
		t.Fatalf("expected RESOURCE_LIMIT_EXCEEDED, got %s", got)
	}
}

func TestCheckISOQuotaTotalQuotaBoundary(t *testing.T) {
	// One byte over the 50 GiB total quota must be rejected even though the
	// file itself is small.
	err := CheckISOQuota(1, MaxISOTotalQuotaBytes-GiB+1, GiB)
	if err == nil {
		t.Fatal("expected rejection one byte over the total quota")
	}
	if !strings.Contains(err.Error(), "quota exceeded") {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := codeOf(t, err); got != apperrors.CodeLimitExceeded {
		t.Fatalf("expected RESOURCE_LIMIT_EXCEEDED, got %s", got)
	}

	// Filling the quota exactly is allowed (covered in OK cases too).
	if err := CheckISOQuota(1, MaxISOTotalQuotaBytes-GiB, GiB); err != nil {
		t.Fatalf("exact quota fill should pass, got %v", err)
	}
}

func TestCheckISOQuotaInvalidSize(t *testing.T) {
	for _, size := range []int64{0, -1, -(15 << 30)} {
		err := CheckISOQuota(0, 0, size)
		if err == nil {
			t.Fatalf("size %d: expected rejection", size)
		}
		if !strings.Contains(err.Error(), "positive number of bytes") {
			t.Fatalf("size %d: unexpected error: %v", size, err)
		}
		if got := codeOf(t, err); got != apperrors.CodeValidation {
			t.Fatalf("size %d: expected VALIDATION_ERROR, got %s", size, got)
		}
	}
}
