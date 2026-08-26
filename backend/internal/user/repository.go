package user

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// Profile represents user_profiles joined with users.
type Profile struct {
	UserID         uuid.UUID       `json:"user_id"`
	Email          string          `json:"email"`
	Phone          string          `json:"phone"`
	Username       string          `json:"username"`
	Status         string          `json:"status"`
	Locale         string          `json:"locale"`
	Timezone       string          `json:"timezone"`
	FullName       string          `json:"full_name"`
	DisplayName    string          `json:"display_name"`
	CompanyName    string          `json:"company_name"`
	CountryCode    string          `json:"country_code"`
	TaxID          string          `json:"tax_id"`
	AvatarObjectID uuid.UUID       `json:"avatar_object_id"`
	Preferences    json.RawMessage `json:"preferences"`
	Metadata       json.RawMessage `json:"metadata"`
}

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func (r *Repository) GetProfile(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	row := r.db.QueryRow(ctx, `
SELECT u.id, u.email::text, COALESCE(u.phone_e164,''), COALESCE(u.username::text,''), u.status::text,
       u.locale, u.timezone, p.avatar_object_id, p.preferences, p.metadata
FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
WHERE u.id=$1 AND u.deleted_at IS NULL`, userID)
	var p Profile
	var avatar *uuid.UUID
	if err := row.Scan(&p.UserID, &p.Email, &p.Phone, &p.Username, &p.Status,
		&p.Locale, &p.Timezone, &avatar, &p.Preferences, &p.Metadata); err != nil {
		if err == pgx.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "user not found")
		}
		return nil, err
	}
	if avatar != nil {
		p.AvatarObjectID = *avatar
	}
	return &p, nil
}

type UpdateProfileInput struct {
	UserID      uuid.UUID
	FullName    string
	DisplayName string
	CompanyName string
	CountryCode string
	TaxID       string
	Preferences map[string]any
	Metadata    map[string]any
}

func (r *Repository) UpdateProfile(ctx context.Context, in UpdateProfileInput) (*Profile, error) {
	tag, err := r.db.Exec(ctx, `
INSERT INTO user_profiles(user_id, full_name, display_name, company_name, country_code, tax_id, preferences, metadata)
VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''),
        $7::jsonb, $8::jsonb)
ON CONFLICT (user_id) DO UPDATE SET
  full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), user_profiles.full_name),
  display_name = COALESCE(NULLIF(EXCLUDED.display_name,''), user_profiles.display_name),
  company_name = COALESCE(NULLIF(EXCLUDED.company_name,''), user_profiles.company_name),
  country_code = COALESCE(NULLIF(EXCLUDED.country_code,''), user_profiles.country_code),
  tax_id = COALESCE(NULLIF(EXCLUDED.tax_id,''), user_profiles.tax_id),
  preferences = CASE WHEN EXCLUDED.preferences::text <> '{}' THEN EXCLUDED.preferences ELSE user_profiles.preferences END,
  metadata = CASE WHEN EXCLUDED.metadata::text <> '{}' THEN EXCLUDED.metadata ELSE user_profiles.metadata END`,
		in.UserID, in.FullName, in.DisplayName, in.CompanyName, in.CountryCode, in.TaxID,
		mustJSON(in.Preferences), mustJSON(in.Metadata))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, apperrors.New(apperrors.CodeNotFound, "user not found")
	}
	return r.GetProfile(ctx, in.UserID)
}

func mustJSON(m map[string]any) []byte {
	if m == nil {
		return []byte(`{}`)
	}
	b, _ := json.Marshal(m)
	return b
}
