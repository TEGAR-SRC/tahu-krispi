package compute

import (
	"errors"
	"strings"
	"testing"

	apperrors "kilat.cloud/backend/pkg/errors"
)

func assertLimitExceeded(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected CodeLimitExceeded rejection, got nil")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeLimitExceeded {
		t.Fatalf("expected CodeLimitExceeded, got %v", err)
	}
}

func TestEffectiveLimitsTakesMinimumPerKind(t *testing.T) {
	cases := []struct {
		name                     string
		ownerMax, requesterMax   int
		ownerCost, requesterCost float64
		wantMax                  int
		wantCost                 float64
	}{
		{"owner_stricter_both", 3, 10, 10, 50, 3, 10},
		{"requester_stricter_both", 20, 4, 100, 15, 4, 15},
		{"mixed_kinds", 5, 9, 80, 30, 5, 30},
		{"equal_values", 7, 7, 25, 25, 7, 25},
	}
	for _, tc := range cases {
		gotMax, gotCost := EffectiveLimits(tc.ownerMax, tc.requesterMax, tc.ownerCost, tc.requesterCost)
		if gotMax != tc.wantMax || gotCost != tc.wantCost {
			t.Fatalf("%s: got (%d, %v), want (%d, %v)",
				tc.name, gotMax, gotCost, tc.wantMax, tc.wantCost)
		}
	}
}

func TestCheckProvisionAllowedWithinLimitsOK(t *testing.T) {
	usage := ResourceUsage{ActiveHourlyInstances: 2, EstimatedMonthlyCost: 12.50}
	if err := CheckProvisionAllowed(5, 25, usage, 6.25); err != nil {
		t.Fatalf("well under limits should pass, got %v", err)
	}
}

func TestCheckProvisionAllowedInstanceCountReached(t *testing.T) {
	usage := ResourceUsage{ActiveHourlyInstances: 5, EstimatedMonthlyCost: 10}
	err := CheckProvisionAllowed(5, 25, usage, 1)
	assertLimitExceeded(t, err)
	if !strings.Contains(err.Error(), "instance limit reached (5/5 hourly instances)") {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestCheckProvisionAllowedMonthlyCostReached(t *testing.T) {
	usage := ResourceUsage{ActiveHourlyInstances: 1, EstimatedMonthlyCost: 24}
	err := CheckProvisionAllowed(5, 25, usage, 2.5)
	assertLimitExceeded(t, err)
	if !strings.Contains(err.Error(), "instance cost limit reached: estimated $26.50 of $25.00 monthly") {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestCheckProvisionAllowedBoundaryEqualityAllowed(t *testing.T) {
	// Count boundary: landing exactly on the cap passes.
	usage := ResourceUsage{ActiveHourlyInstances: 4, EstimatedMonthlyCost: 0}
	if err := CheckProvisionAllowed(5, 25, usage, 0); err != nil {
		t.Fatalf("count boundary equality should pass, got %v", err)
	}
	// Cost boundary: projected total exactly equal to the cap passes.
	usage = ResourceUsage{ActiveHourlyInstances: 0, EstimatedMonthlyCost: 20}
	if err := CheckProvisionAllowed(5, 25, usage, 5); err != nil {
		t.Fatalf("cost boundary equality should pass, got %v", err)
	}
}

func TestCheckProvisionAllowedUnknownCostSkipsCostCheck(t *testing.T) {
	// Over the cost cap, but the new instance could not be priced: only the
	// count limit may reject.
	usage := ResourceUsage{ActiveHourlyInstances: 1, EstimatedMonthlyCost: 30}
	if err := CheckProvisionAllowed(5, 25, usage, UnknownInstanceCost); err != nil {
		t.Fatalf("unknown cost must skip the cost check, got %v", err)
	}
	// Count still enforced even when cost is unknown.
	usage = ResourceUsage{ActiveHourlyInstances: 5, EstimatedMonthlyCost: 30}
	err := CheckProvisionAllowed(5, 25, usage, UnknownInstanceCost)
	assertLimitExceeded(t, err)
	if !strings.Contains(err.Error(), "instance limit reached") {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestCheckProvisionAllowedZeroCostCapRejectsPricedInstance(t *testing.T) {
	usage := ResourceUsage{ActiveHourlyInstances: 0, EstimatedMonthlyCost: 0}
	err := CheckProvisionAllowed(5, 0, usage, 3)
	assertLimitExceeded(t, err)
	if !strings.Contains(err.Error(), "instance cost limit reached") {
		t.Fatalf("unexpected message: %v", err)
	}
}
