// Package organization implements organization / team management.
// Authorization (role→permission matrix) lives in internal/iam as the single source of truth.
package organization

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/iam"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type MemberRole = iam.Role

const (
	RoleOwner     = iam.RoleOwner
	RoleAdmin     = iam.RoleAdmin
	RoleBilling   = iam.RoleBilling
	RoleOperator  = iam.RoleOperator
	RoleDeveloper = iam.RoleDeveloper
	RoleViewer    = iam.RoleViewer
)

// PermissionsFor and HasPermission delegate to the shared iam package.
func PermissionsFor(role MemberRole) []string { return iam.PermissionsFor(role) }

func HasPermission(role MemberRole, perm string) bool { return iam.Can(role, perm) }

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Organization struct {
	ID        uuid.UUID `json:"id"`
	PublicID  string    `json:"public_id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Status    string    `json:"status"`
	Country   string    `json:"country_code"`
	LegalName string    `json:"legal_name"`
	TaxID     string    `json:"tax_id"`
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID) ([]Organization, error) {
	rows, err := s.db.Query(ctx, `
SELECT o.id, o.public_id, o.name, o.slug::text, o.status::text,
       COALESCE(o.country_code,''), COALESCE(o.legal_name,''), COALESCE(o.tax_id,'')
FROM organizations o JOIN organization_members m ON m.organization_id=o.id
WHERE m.user_id=$1 AND o.deleted_at IS NULL
ORDER BY o.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Organization
	for rows.Next() {
		var o Organization
		if err := rows.Scan(&o.ID, &o.PublicID, &o.Name, &o.Slug, &o.Status, &o.Country, &o.LegalName, &o.TaxID); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Service) GetByID(ctx context.Context, orgID uuid.UUID) (*Organization, error) {
	row := s.db.QueryRow(ctx, `
SELECT id, public_id, name, slug::text, status::text,
       COALESCE(country_code,''), COALESCE(legal_name,''), COALESCE(tax_id,'')
FROM organizations WHERE id=$1 AND deleted_at IS NULL`, orgID)
	var o Organization
	err := row.Scan(&o.ID, &o.PublicID, &o.Name, &o.Slug, &o.Status, &o.Country, &o.LegalName, &o.TaxID)
	if err == pgx.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "organization not found")
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// RequireMember ensures the user belongs to the org and returns their role.
func (s *Service) RequireMember(ctx context.Context, orgID, userID uuid.UUID) (MemberRole, error) {
	var role MemberRole
	err := s.db.QueryRow(ctx, `
SELECT m.role::text FROM organization_members m
JOIN organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
WHERE m.organization_id=$1 AND m.user_id=$2`, orgID, userID).Scan(&role)
	if err == pgx.ErrNoRows {
		return "", apperrors.New(apperrors.CodeForbidden, "not a member of this organization")
	}
	if err != nil {
		return "", err
	}
	return role, nil
}

// Authorize checks the user's role in the org grants the given permission.
func (s *Service) Authorize(ctx context.Context, orgID, userID uuid.UUID, permission string) error {
	role, err := s.RequireMember(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if !HasPermission(role, permission) {
		return apperrors.Newf(apperrors.CodeForbidden, "missing permission %s", permission)
	}
	return nil
}

type CreateInput struct {
	Name        string
	Slug        string
	CountryCode string
	LegalName   string
	TaxID       string
	CreatedBy   uuid.UUID
}

func (s *Service) Create(ctx context.Context, in CreateInput) (*Organization, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var org Organization
	err = tx.QueryRow(ctx, `
INSERT INTO organizations(slug, name, country_code, legal_name, tax_id, created_by)
VALUES ($2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7)
RETURNING id, public_id, name, slug::text, status::text, COALESCE(country_code,''), COALESCE(legal_name,''), COALESCE(tax_id,'')`,
		uuid.Nil, in.Slug, in.Name, in.CountryCode, in.LegalName, in.TaxID, in.CreatedBy).
		Scan(&org.ID, &org.PublicID, &org.Name, &org.Slug, &org.Status, &org.Country, &org.LegalName, &org.TaxID)
	if err != nil {
		if isUnique(err) {
			return nil, apperrors.New(apperrors.CodeConflict, "organization slug already exists")
		}
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO organization_members(organization_id, user_id, role) VALUES ($1,$2,'owner')`, org.ID, in.CreatedBy); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO wallets(organization_id, currency) VALUES ($1, 'IDR') ON CONFLICT DO NOTHING`, org.ID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &org, nil
}

func isUnique(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	for i := 0; i+5 <= len(s); i++ {
		if s[i:i+5] == "ux_or" && len(s) >= i+len("ux_organizations_slug_live") && s[i:i+len("ux_organizations_slug_live")] == "ux_organizations_slug_live" {
			return true
		}
	}
	return false
}

type Invitation struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt string    `json:"created_at"`
	ExpiresAt string    `json:"expires_at"`
}

// Invite creates an organization invitation with a hashed token.
func (s *Service) Invite(ctx context.Context, orgID uuid.UUID, email, role string, invitedBy uuid.UUID) (*Invitation, error) {
	memberRole := MemberRole(role)
	if memberRole != RoleAdmin && memberRole != RoleBilling && memberRole != RoleOperator &&
		memberRole != RoleDeveloper && memberRole != RoleViewer {
		return nil, apperrors.New(apperrors.CodeValidation, "invalid role")
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}
	hash := hashToken(token)
	row := s.db.QueryRow(ctx, `
INSERT INTO organization_invitations(organization_id, email, role, token_hash, invited_by, expires_at)
VALUES ($1,$2,$3,$4,$5, now()+interval '7 days')
RETURNING id, email::text, role::text, CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' ELSE 'pending' END,
          created_at::text, expires_at::text`,
		orgID, email, role, hash, invitedBy)
	var inv Invitation
	if err := row.Scan(&inv.ID, &inv.Email, &inv.Role, &inv.Status, &inv.CreatedAt, &inv.ExpiresAt); err != nil {
		return nil, err
	}
	return &inv, nil
}

// AcceptInvitation applies a pending invitation for the authenticated user.
func (s *Service) AcceptInvitation(ctx context.Context, token string, userID uuid.UUID) error {
	hash := hashToken(token)
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var orgID uuid.UUID
	var role MemberRole
	err = tx.QueryRow(ctx, `
UPDATE organization_invitations SET accepted_at=now()
WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
RETURNING organization_id, role::text`, hash).Scan(&orgID, &role)
	if err == pgx.ErrNoRows {
		return apperrors.New(apperrors.CodeNotFound, "invitation invalid or expired")
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO organization_members(organization_id, user_id, role, invited_by)
VALUES ($1,$2,$3,(SELECT invited_by FROM organization_invitations WHERE token_hash=$4))
ON CONFLICT (organization_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
		orgID, userID, role, hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func randomToken() (string, error) {
	b := make([]byte, 24)
	if _, err := randRead(b); err != nil {
		return "", err
	}
	return hexEncode(b), nil
}

func randRead(b []byte) (int, error) { return cryptoRand(b) }

func hexEncode(b []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = digits[v>>4]
		out[i*2+1] = digits[v&0x0f]
	}
	return string(out)
}

func hashToken(t string) string { return sha256Hex(t) }
