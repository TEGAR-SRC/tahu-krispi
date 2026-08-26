// addresses.go implements CRUD over user_addresses (migration 000002).
package user

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
	v "kilat.cloud/backend/pkg/validation"
)

var addressTypes = map[string]bool{
	"home": true, "billing": true, "legal": true, "company": true, "other": true,
}

// Address mirrors one row of user_addresses.
type Address struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	Type          string     `json:"type"`
	Label         string     `json:"label"`
	RecipientName string     `json:"recipient_name"`
	CompanyName   string     `json:"company_name"`
	CountryCode   string     `json:"country_code"`
	Province      string     `json:"province"`
	CityOrRegency string     `json:"city_or_regency"`
	District      string     `json:"district"`
	Subdistrict   string     `json:"subdistrict"`
	PostalCode    string     `json:"postal_code"`
	AddressLine1  string     `json:"address_line1"`
	AddressLine2  string     `json:"address_line2"`
	RT            string     `json:"rt"`
	RW            string     `json:"rw"`
	ContactPhone  string     `json:"contact_phone_e164"`
	IsDefault     bool       `json:"is_default"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
}

const addressColumns = `
id, user_id, type::text, COALESCE(label,''), COALESCE(recipient_name,''), COALESCE(company_name,''),
COALESCE(country_code::text,''), COALESCE(province,''), COALESCE(city_or_regency,''), COALESCE(district,''),
COALESCE(subdistrict,''), COALESCE(postal_code,''), COALESCE(address_line1,''), COALESCE(address_line2,''),
COALESCE(rt,''), COALESCE(rw,''), COALESCE(contact_phone_e164,''), is_default,
verified_at, created_at, updated_at, deleted_at`

func scanAddress(row interface{ Scan(dest ...any) error }) (*Address, error) {
	var a Address
	err := row.Scan(&a.ID, &a.UserID, &a.Type, &a.Label, &a.RecipientName, &a.CompanyName,
		&a.CountryCode, &a.Province, &a.CityOrRegency, &a.District,
		&a.Subdistrict, &a.PostalCode, &a.AddressLine1, &a.AddressLine2,
		&a.RT, &a.RW, &a.ContactPhone, &a.IsDefault,
		&a.VerifiedAt, &a.CreatedAt, &a.UpdatedAt, &a.DeletedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// AddressInput carries the writable fields of an address.
type AddressInput struct {
	UserID        uuid.UUID
	Type          string
	Label         string
	RecipientName string
	CompanyName   string
	CountryCode   string
	Province      string
	CityOrRegency string
	District      string
	Subdistrict   string
	PostalCode    string
	AddressLine1  string
	AddressLine2  string
	RT            string
	RW            string
	ContactPhone  string
}

func (in *AddressInput) normalize() error {
	if !addressTypes[in.Type] {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid address type"),
			map[string]string{"type": "must be home, billing, legal, company or other"})
	}
	if strings.TrimSpace(in.AddressLine1) == "" {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "address_line1 is required"),
			map[string]string{"address_line1": "required"})
	}
	in.CountryCode = strings.ToUpper(strings.TrimSpace(in.CountryCode))
	if in.CountryCode != "" && len(in.CountryCode) != 2 {
		return apperrors.WithFields(
			apperrors.New(apperrors.CodeValidation, "invalid country_code"),
			map[string]string{"country_code": "must be a 2-letter ISO code"})
	}
	if in.ContactPhone != "" {
		p, err := v.NormalizePhoneE164(in.ContactPhone, "")
		if err != nil {
			return apperrors.WithFields(
				apperrors.New(apperrors.CodeValidation, err.Error()),
				map[string]string{"contact_phone": err.Error()})
		}
		in.ContactPhone = p
	}
	return nil
}

// addressFieldValues returns the 15 writable column values, excluding user_id.
func addressFieldValues(in AddressInput) []any {
	return []any{in.Type, nullIfEmpty(in.Label), nullIfEmpty(in.RecipientName),
		nullIfEmpty(in.CompanyName), nullIfEmpty(in.CountryCode), nullIfEmpty(in.Province),
		nullIfEmpty(in.CityOrRegency), nullIfEmpty(in.District), nullIfEmpty(in.Subdistrict),
		nullIfEmpty(in.PostalCode), nullIfEmpty(in.AddressLine1), nullIfEmpty(in.AddressLine2),
		nullIfEmpty(in.RT), nullIfEmpty(in.RW), nullIfEmpty(in.ContactPhone)}
}

func insertAddressValues(in AddressInput) []any {
	return append([]any{in.UserID}, addressFieldValues(in)...)
}

func updateAddressValues(addressID uuid.UUID, userID uuid.UUID, in AddressInput) []any {
	return append(addressFieldValues(in), addressID, userID)
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// ListAddresses returns the user's live addresses, newest first.
func ListAddresses(db *pgxpool.Pool, ctx context.Context, userID uuid.UUID) ([]*Address, error) {
	rows, err := db.Query(ctx, `
SELECT`+addressColumns+`
FROM user_addresses
WHERE user_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*Address, 0)
	for rows.Next() {
		a, err := scanAddress(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// CreateAddress inserts a new live address and returns it fully populated.
func CreateAddress(db *pgxpool.Pool, ctx context.Context, in AddressInput) (*Address, error) {
	if err := in.normalize(); err != nil {
		return nil, err
	}
	row := db.QueryRow(ctx, `
INSERT INTO user_addresses(user_id, type, label, recipient_name, company_name, country_code,
                           province, city_or_regency, district, subdistrict, postal_code,
                           address_line1, address_line2, rt, rw, contact_phone_e164)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
RETURNING`+addressColumns, insertAddressValues(in)...)
	a, err := scanAddress(row)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// UpdateAddress replaces the mutable fields of a live address owned by userID.
func UpdateAddress(db *pgxpool.Pool, ctx context.Context, userID, addressID uuid.UUID, in AddressInput) (*Address, error) {
	if err := in.normalize(); err != nil {
		return nil, err
	}
	vals := updateAddressValues(addressID, userID, in)
	row := db.QueryRow(ctx, `
UPDATE user_addresses SET type=$1, label=$2, recipient_name=$3, company_name=$4, country_code=$5,
                          province=$6, city_or_regency=$7, district=$8, subdistrict=$9,
                          postal_code=$10, address_line1=$11, address_line2=$12,
                          rt=$13, rw=$14, contact_phone_e164=$15
WHERE id=$16 AND user_id=$17 AND deleted_at IS NULL
RETURNING`+addressColumns, vals...)
	a, err := scanAddress(row)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "address not found")
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// SoftDeleteAddress marks the address deleted and clears its default flag.
func SoftDeleteAddress(db *pgxpool.Pool, ctx context.Context, userID, addressID uuid.UUID) error {
	tag, err := db.Exec(ctx, `
UPDATE user_addresses SET deleted_at=now(), is_default=false
WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, addressID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "address not found")
	}
	return nil
}

// SetDefaultAddress makes exactly one address the default for the user inside
// a transaction: every other row is unset first, then the target is set.
func SetDefaultAddress(db *pgxpool.Pool, ctx context.Context, userID, addressID uuid.UUID) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err = tx.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM user_addresses WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL)`,
		addressID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return apperrors.New(apperrors.CodeNotFound, "address not found")
	}
	if _, err = tx.Exec(ctx, `
UPDATE user_addresses SET is_default=false WHERE user_id=$1 AND is_default`, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
UPDATE user_addresses SET is_default=true WHERE id=$1`, addressID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetDefaultBillingAddress returns the user's default billing address for
// invoice snapshots, or (nil, nil) when none exists yet.
func GetDefaultBillingAddress(db *pgxpool.Pool, ctx context.Context, userID uuid.UUID) (*Address, error) {
	a, err := scanAddress(db.QueryRow(ctx, `
SELECT`+addressColumns+`
FROM user_addresses
WHERE user_id=$1 AND type='billing' AND is_default AND deleted_at IS NULL
ORDER BY updated_at DESC LIMIT 1`, userID))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}
