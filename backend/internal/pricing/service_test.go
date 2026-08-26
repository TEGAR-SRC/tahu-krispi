package pricing

import "testing"

func TestRound2(t *testing.T) {
	cases := map[float64]float64{
		1.004:      1.0,
		2.675:      2.68,
		100.0:      100.0,
		0.125:      0.13,
		190000.455: 190000.46,
	}
	for in, want := range cases {
		if got := round2(in); got != want {
			t.Errorf("round2(%v) = %v, want %v", in, got, want)
		}
	}
}

func TestQuoteValidation(t *testing.T) {
	// Pure validation checks that don't need a DB.
	if len(customResourcesJSON(map[string]float64{"vcpu": 2})) == 0 {
		t.Fatal("customResourcesJSON should marshal")
	}
	if customResourcesJSON(nil) == nil {
		t.Fatal("nil map should marshal to 'null' bytes")
	}
}
