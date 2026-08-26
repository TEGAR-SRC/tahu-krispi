package billing

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestEffectiveCharge(t *testing.T) {
	cases := []struct {
		name           string
		providerAmount float64
		productDefault float64
		want           float64
	}{
		{"provider price wins", 15000, 20000, 15000},
		{"no provider price falls back to product default", 0, 20000, 20000},
		{"negative provider price treated as absent", -1, 50000, 50000},
		{"both zero means not billable", 0, 0, 0},
		{"negative default means not billable", 0, -5, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectiveCharge(tc.providerAmount, tc.productDefault); got != tc.want {
				t.Fatalf("effectiveCharge(%v, %v) = %v, want %v",
					tc.providerAmount, tc.productDefault, got, tc.want)
			}
		})
	}
}

func TestNormalizeCurrency(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "IDR"},
		{"idr", "IDR"},
		{" usd ", "USD"},
		{"JPY", "JPY"},
		{"USDX", "IDR"}, // too long for char(3)
		{"U", "IDR"},    // too short
		{"US D", "IDR"}, // whitespace inside -> length mismatch after trim
	}
	for _, tc := range cases {
		if got := normalizeCurrency(tc.in); got != tc.want {
			t.Errorf("normalizeCurrency(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// fakeRow serves a single pre-set text column.
type fakeRow struct {
	val     string
	scanErr error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	// EffectiveMonthlyCharge scans (enabled *bool, default *string).
	if b, ok := dest[0].(*bool); ok {
		*b = true
	}
	if s, ok := dest[1].(*string); ok {
		*s = r.val
	}
	return nil
}

type fakeDB struct {
	row fakeRow
}

func (f fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (f fakeDB) QueryRow(context.Context, string, ...any) pgx.Row { return f.row }

func TestEffectiveMonthlyChargeProviderPriceSkipsLookup(t *testing.T) {
	// A positive provider-reported price must win without touching the DB
	// (nil handle would panic if the lookup were attempted).
	got, err := EffectiveMonthlyCharge(context.Background(), nil, ProductCodeReservedIP, 30000)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 30000 {
		t.Fatalf("charge = %v, want provider price 30000", got)
	}
}

func TestEffectiveMonthlyChargeFallsBackToProductDefault(t *testing.T) {
	db := fakeDB{row: fakeRow{val: "50000"}}
	got, err := EffectiveMonthlyCharge(context.Background(), db, ProductCodeObjectStorage, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 50000 {
		t.Fatalf("charge = %v, want product default 50000", got)
	}
}

func TestEffectiveMonthlyChargeMissingProductIsConfigError(t *testing.T) {
	db := fakeDB{row: fakeRow{scanErr: pgx.ErrNoRows}}
	if _, err := EffectiveMonthlyCharge(context.Background(), db, ProductCodeReservedIP, 0); err == nil {
		t.Fatal("expected not-seeded config error, got nil")
	}
}
