package compute

import (
	"strings"
	"testing"
)

func TestEvaluateResizeUpgradeOK(t *testing.T) {
	cur := TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 80}
	tgt := TargetSpec{CPU: 12, RAMMB: 16384, DiskGB: 160}
	if err := EvaluateResize(cur, tgt, false); err != nil {
		t.Fatalf("pure upgrade should pass upgrade-only policy, got %v", err)
	}
}

func TestEvaluateResizeMixedUpgradeAndEqualOK(t *testing.T) {
	cur := TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 80}
	tgt := TargetSpec{CPU: 8, RAMMB: 8192, DiskGB: 160}
	if err := EvaluateResize(cur, tgt, false); err != nil {
		t.Fatalf("upgrade+equal should pass, got %v", err)
	}
}

func TestEvaluateResizeDowngradeRejected(t *testing.T) {
	cur := TargetSpec{CPU: 12, RAMMB: 16384, DiskGB: 160}
	cases := []struct {
		name string
		tgt  TargetSpec
	}{
		{"cpu_down", TargetSpec{CPU: 4, RAMMB: 16384, DiskGB: 160}},
		{"ram_down", TargetSpec{CPU: 12, RAMMB: 8192, DiskGB: 160}},
		{"disk_down", TargetSpec{CPU: 12, RAMMB: 16384, DiskGB: 80}},
	}
	for _, tc := range cases {
		err := EvaluateResize(cur, tc.tgt, false)
		if err == nil {
			t.Fatalf("%s: expected downgrade rejection", tc.name)
		}
		if !strings.Contains(err.Error(), "downgrade not permitted") {
			t.Fatalf("%s: unexpected error %v", tc.name, err)
		}
	}
}

func TestEvaluateResizeDowngradeAllowedWhenPolicyPermits(t *testing.T) {
	cur := TargetSpec{CPU: 12, RAMMB: 16384, DiskGB: 160}
	tgt := TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 80}
	if err := EvaluateResize(cur, tgt, true); err != nil {
		t.Fatalf("downgrade should pass when AllowDowngrade=true, got %v", err)
	}
}

func TestEvaluateResizeIdenticalRejected(t *testing.T) {
	cur := TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 80}
	if err := EvaluateResize(cur, cur, false); err == nil {
		t.Fatal("identical spec should be rejected")
	}
	if err := EvaluateResize(cur, cur, true); err == nil {
		t.Fatal("identical spec should be rejected even with AllowDowngrade=true")
	}
}

func TestEvaluateResizeInvalidValuesRejected(t *testing.T) {
	cur := TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 80}
	cases := []struct {
		name string
		tgt  TargetSpec
	}{
		{"zero_cpu", TargetSpec{CPU: 0, RAMMB: 8192, DiskGB: 80}},
		{"zero_ram", TargetSpec{CPU: 4, RAMMB: 0, DiskGB: 80}},
		{"zero_disk", TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: 0}},
		{"negative_cpu", TargetSpec{CPU: -1, RAMMB: 8192, DiskGB: 80}},
		{"negative_ram", TargetSpec{CPU: 4, RAMMB: -2048, DiskGB: 80}},
		{"negative_disk", TargetSpec{CPU: 4, RAMMB: 8192, DiskGB: -10}},
	}
	for _, tc := range cases {
		if err := EvaluateResize(cur, tc.tgt, false); err == nil {
			t.Fatalf("%s: expected rejection for non-positive value", tc.name)
		}
	}
}
