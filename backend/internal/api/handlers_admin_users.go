// Admin module (§51): users, organizations, and cloud providers management.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Shared admin helpers ----

const admMaskedValue = "********"

// admPage parses page/per_page query parameters and derives the SQL offset.
func admPage(c fiber.Ctx) (page, perPage, offset int) {
	page, perPage = httputil.Page(c)
	return page, perPage, (page - 1) * perPage
}

// admAudit records an admin mutation in the audit log under the acting admin user.
func (s *Server) admAudit(c fiber.Ctx, action, resourceType string, resourceID *uuid.UUID) {
	s.admAuditMeta(c, action, resourceType, resourceID, nil)
}

func (s *Server) admAuditMeta(c fiber.Ctx, action, resourceType string, resourceID *uuid.UUID, meta map[string]any) {
	actorID := mustUserID(c)
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:  &actorID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Metadata:     meta,
	})
}

// admEnqueueJob inserts a durable job row and returns its id.
func (s *Server) admEnqueueJob(ctx context.Context, queueName, jobType, resourceType string, resourceID uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = s.db.QueryRow(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ($1,$2,NULLIF($3,''),$4,$5::jsonb) RETURNING id`,
		queueName, jobType, resourceType, resourceID, string(b)).Scan(&id)
	return id, err
}

// admIsUnique reports whether err is a PostgreSQL unique-constraint violation.
func admIsUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// admParseUUIDParam parses a path parameter as a UUID or returns a field validation error.
func admParseUUIDParam(c fiber.Ctx, param, field string) (uuid.UUID, error) {
	id, err := uuid.Parse(c.Params(param))
	if err != nil {
		return uuid.Nil, vErrField(field, "must be a valid uuid")
	}
	return id, nil
}

func admOptionalUUID(raw, field string) (*uuid.UUID, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, vErrField(field, "must be a valid uuid")
	}
	return &id, nil
}

func admParseFloat(s string) float64 {
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

// ---- Enum choice sets (mirror docs/kilat_cloud_schema_v2.sql) ----

var (
	admAccountStatuses  = map[string]bool{"pending": true, "active": true, "suspended": true, "disabled": true, "closed": true}
	admResourceStatuses = map[string]bool{
		"draft": true, "pending": true, "provisioning": true, "active": true, "stopped": true,
		"suspended": true, "deleting": true, "deleted": true, "failed": true, "unknown": true,
	}
	admJobStatuses      = map[string]bool{"queued": true, "running": true, "retry": true, "success": true, "failed": true, "cancelled": true}
	admOrderStatuses    = map[string]bool{"draft": true, "pending_payment": true, "paid": true, "processing": true, "completed": true, "cancelled": true, "failed": true, "refunded": true}
	admInvoiceStatuses  = map[string]bool{"draft": true, "unpaid": true, "paid": true, "overdue": true, "void": true, "refunded": true, "partially_refunded": true}
	admPaymentStatuses  = map[string]bool{"pending": true, "processing": true, "paid": true, "failed": true, "expired": true, "cancelled": true, "refunded": true, "partially_refunded": true}
	admServiceKinds     = map[string]bool{"vm": true, "object_storage": true, "bare_metal": true, "block_storage": true, "database": true, "kubernetes": true, "hosting": true, "domain": true, "other": true}
	admBillingPeriods   = map[string]bool{"hourly": true, "daily": true, "monthly": true, "quarterly": true, "semiannual": true, "annual": true, "biennial": true, "triennial": true, "quinquennial": true, "one_time": true}
	admPriceModes       = map[string]bool{"fixed_plan": true, "custom_resource": true, "manual_quote": true}
	admProviderKinds    = map[string]bool{"onidel": true, "proxmox": true, "vmware": true, "xcpng": true, "hyperv": true, "custom": true, "dokploy": true}
	admTicketStatuses   = map[string]bool{"open": true, "waiting_customer": true, "waiting_staff": true, "resolved": true, "closed": true}
	admIncidentStatuses = map[string]bool{"open": true, "investigating": true, "resolved": true, "dismissed": true}
)

// admCheckChoice validates a non-empty enum value against the allowed set.
func admCheckChoice(field, value string, allowed map[string]bool) error {
	if !allowed[lower(strings.TrimSpace(value))] {
		keys := make([]string, 0, len(allowed))
		for k := range allowed {
			keys = append(keys, k)
		}
		sortStrings(keys)
		return vErrField(field, "must be one of: "+strings.Join(keys, ", "))
	}
	return nil
}

func sortStrings(v []string) {
	for i := 1; i < len(v); i++ {
		for j := i; j > 0 && v[j] < v[j-1]; j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
}

// ---- Users ----

type admUserRow struct {
	ID          uuid.UUID `json:"id"`
	PublicID    string    `json:"public_id"`
	Email       string    `json:"email"`
	Username    string    `json:"username"`
	FullName    string    `json:"full_name"`
	Status      string    `json:"status"`
	EmailStatus string    `json:"email_status"`
	IsAdmin     bool      `json:"is_platform_admin"`
	LastLoginAt string    `json:"last_login_at"`
	CreatedAt   string    `json:"created_at"`
}

func (s *Server) adminListUsers(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	search := strings.TrimSpace(c.Query("search"))
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admAccountStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid account status"))
	}

	where := " WHERE u.deleted_at IS NULL"
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND u.status=$%d", len(args))
	}
	if search != "" {
		args = append(args, "%"+lower(search)+"%")
		n := len(args)
		where += fmt.Sprintf(
			" AND (u.email::text LIKE $%d OR COALESCE(u.username::text,'') LIKE $%d OR u.public_id LIKE $%d OR COALESCE(p.full_name,'') LIKE $%d)",
			n, n, n, n)
	}

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}

	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT u.id, u.public_id, u.email::text, COALESCE(u.username::text,''), COALESCE(p.full_name,''),
       u.status::text, u.email_status::text, u.is_platform_admin,
       COALESCE(u.last_login_at::text,''), u.created_at::text
FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id`+where+
		fmt.Sprintf(" ORDER BY u.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	users := []admUserRow{}
	for rows.Next() {
		var u admUserRow
		if err := rows.Scan(&u.ID, &u.PublicID, &u.Email, &u.Username, &u.FullName,
			&u.Status, &u.EmailStatus, &u.IsAdmin, &u.LastLoginAt, &u.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, users, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminSetUserStatus(c fiber.Ctx, action, newStatus string) error {
	userID, err := admParseUUIDParam(c, "user_id", "user_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	adminID := mustUserID(c)
	if userID == adminID && newStatus != "active" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "you cannot change the status of your own account"))
	}
	tag, err := s.db.Exec(c.Context(),
		`UPDATE users SET status=$2::account_status WHERE id=$1 AND deleted_at IS NULL AND status <> $2::account_status`,
		userID, newStatus)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.db.QueryRow(c.Context(),
			`SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL)`, userID).Scan(&exists); err != nil {
			return mw.WriteError(c, err)
		}
		if !exists {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "user not found"))
		}
	}
	s.admAudit(c, action, "user", &userID)
	return mw.JSON(c, 200, fiber.Map{"id": userID, "status": newStatus}, nil)
}

func (s *Server) adminSuspendUser(c fiber.Ctx) error {
	return s.adminSetUserStatus(c, "admin.user.suspend", "suspended")
}

func (s *Server) adminActivateUser(c fiber.Ctx) error {
	return s.adminSetUserStatus(c, "admin.user.activate", "active")
}

type admGrantAdminInput struct {
	Grant *bool `json:"grant"`
}

func (s *Server) adminGrantAdmin(c fiber.Ctx) error {
	userID, err := admParseUUIDParam(c, "user_id", "user_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admGrantAdminInput
	if err := c.Bind().Body(&in); err != nil || in.Grant == nil {
		return mw.WriteError(c, errValidation("grant (boolean) is required"))
	}
	grant := *in.Grant
	if !grant && userID == mustUserID(c) {
		return mw.WriteError(c, apperrors.New(apperrors.CodeForbidden, "you cannot revoke your own admin access"))
	}
	tag, err := s.db.Exec(c.Context(),
		`UPDATE users SET is_platform_admin=$2 WHERE id=$1 AND deleted_at IS NULL`, userID, grant)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "user not found"))
	}
	s.admAuditMeta(c, "admin.user.grant_admin", "user", &userID, map[string]any{"grant": grant})
	return mw.JSON(c, 200, fiber.Map{"id": userID, "is_platform_admin": grant}, nil)
}

// ---- Organizations ----

type admOrgRow struct {
	ID           uuid.UUID `json:"id"`
	PublicID     string    `json:"public_id"`
	Slug         string    `json:"slug"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	BillingEmail string    `json:"billing_email"`
	MemberCount  int       `json:"member_count"`
	CreatedAt    string    `json:"created_at"`
}

func (s *Server) adminListOrgs(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM organizations WHERE deleted_at IS NULL`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT o.id, o.public_id, o.slug::text, o.name, o.status::text, COALESCE(o.billing_email::text,''),
       (SELECT count(*) FROM organization_members m WHERE m.organization_id=o.id),
       o.created_at::text
FROM organizations o WHERE o.deleted_at IS NULL
ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	orgs := []admOrgRow{}
	for rows.Next() {
		var o admOrgRow
		if err := rows.Scan(&o.ID, &o.PublicID, &o.Slug, &o.Name, &o.Status,
			&o.BillingEmail, &o.MemberCount, &o.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		orgs = append(orgs, o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, orgs, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminSetOrgStatus(c fiber.Ctx, action, newStatus string) error {
	orgID, err := admParseUUIDParam(c, "org_id", "org_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	tag, err := s.db.Exec(c.Context(),
		`UPDATE organizations SET status=$2::account_status WHERE id=$1 AND deleted_at IS NULL`, orgID, newStatus)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "organization not found"))
	}
	s.admAudit(c, action, "organization", &orgID)
	return mw.JSON(c, 200, fiber.Map{"id": orgID, "status": newStatus}, nil)
}

func (s *Server) adminSuspendOrg(c fiber.Ctx) error {
	return s.adminSetOrgStatus(c, "admin.org.suspend", "suspended")
}

type admUpsertProviderAccountInput struct {
	ProviderCode        string `json:"provider_code"`
	ExternalAccountID   string `json:"external_account_id"`
	ExternalAccountName string `json:"external_account_name"`
}

func (s *Server) adminUpsertProviderAccount(c fiber.Ctx) error {
	orgID, err := admParseUUIDParam(c, "org_id", "org_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admUpsertProviderAccountInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	code := lower(strings.TrimSpace(in.ProviderCode))
	if code == "" {
		code = "onidel"
	}

	ctx := c.Context()
	var orgExists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM organizations WHERE id=$1 AND deleted_at IS NULL)`, orgID).Scan(&orgExists); err != nil {
		return mw.WriteError(c, err)
	}
	if !orgExists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "organization not found"))
	}
	var providerID uuid.UUID
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM providers WHERE code=$1`, code).Scan(&providerID); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found: "+code))
	}

	var accountID uuid.UUID
	err = s.db.QueryRow(ctx, `
INSERT INTO provider_accounts(provider_id, organization_id, external_account_id, external_account_name)
VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''))
ON CONFLICT (provider_id, organization_id) DO UPDATE SET
    external_account_id=EXCLUDED.external_account_id,
    external_account_name=EXCLUDED.external_account_name
RETURNING id`,
		providerID, orgID, in.ExternalAccountID, in.ExternalAccountName).Scan(&accountID)
	if err != nil {
		if admIsUnique(err) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeConflict,
				"external account is already mapped to another organization"))
		}
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.org.provider_account_upsert", "organization", &orgID, map[string]any{
		"provider_code":       code,
		"provider_account_id": accountID,
		"external_account_id": in.ExternalAccountID,
	})
	return mw.JSON(c, 200, fiber.Map{
		"id":                    accountID,
		"provider_id":           providerID,
		"organization_id":       orgID,
		"external_account_id":   in.ExternalAccountID,
		"external_account_name": in.ExternalAccountName,
	}, nil)
}

// ---- Providers ----

type admProviderRow struct {
	ID             uuid.UUID `json:"id"`
	Code           string    `json:"code"`
	Name           string    `json:"name"`
	Kind           string    `json:"kind"`
	APIBaseURL     string    `json:"api_base_url"`
	Enabled        bool      `json:"enabled"`
	HealthStatus   string    `json:"health_status"`
	HasCredentials bool      `json:"has_credentials"`
	CreatedAt      string    `json:"created_at"`
}

func (s *Server) adminListProviders(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM providers`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT id, code::text, name, kind, COALESCE(api_base_url,''), enabled, health_status,
       (credentials_ciphertext IS NOT NULL) AS has_credentials, created_at::text
FROM providers
ORDER BY created_at ASC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	providers := []admProviderRow{}
	for rows.Next() {
		var p admProviderRow
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Kind, &p.APIBaseURL,
			&p.Enabled, &p.HealthStatus, &p.HasCredentials, &p.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		providers = append(providers, p)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, providers, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admUpsertProviderInput struct {
	TokenUser  string `json:"token_user"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	APIBaseURL string `json:"api_base_url"`
	APIKey     string `json:"api_key"`
	Enabled    *bool  `json:"enabled"`
}

// adminUpsertProvider creates a provider or updates the existing row keyed by
// its unique code (ON CONFLICT (code) DO UPDATE). That single endpoint covers
// every mutation an update would perform — name/kind/api_base_url/enabled are
// always overwritten, credentials are replaced ONLY when api_key is sent
// non-empty — so there is deliberately no separate PUT /providers endpoint.
// NOTE: credentials written before the crypto.Encrypt switch used an ad-hoc
// key that no runtime reader could decrypt; re-upserting with api_key re-seals
// them in the correct format.
func (s *Server) adminUpsertProvider(c fiber.Ctx) error {
	var in admUpsertProviderInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Name) == "" {
		return mw.WriteError(c, errValidation("code and name are required"))
	}
	kind := lower(strings.TrimSpace(in.Kind))
	if err := admCheckChoice("kind", in.Kind, admProviderKinds); err != nil {
		return mw.WriteError(c, err)
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}

	ctx := c.Context()
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM providers WHERE code=$1)`, in.Code).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}

	tokenUser := strings.TrimSpace(in.TokenUser)
	var ciphertext []byte
	if in.APIKey != "" {
		// Seal with the shared KEK-derived key so runtime readers (e.g.
		// proxmox.LoadProxmoxConfig, dokploy.NewClientFromDB) can actually
		// decrypt the payload.
		var plain []byte
		switch kind {
		case "dokploy":
			// Dokploy authenticates with a single x-api-key header; token_user
			// is accepted but ignored, credentials are {"token_secret"} only.
			plain, _ = json.Marshal(map[string]string{"token_secret": in.APIKey})
		case "proxmox", "vmware":
			// Both factories read the same {"token_user","token_secret"} JSON
			// envelope (vmware: username/password) out of the ciphertext.
			if tokenUser == "" {
				return mw.WriteError(c, vErrField("token_user", kind+" requires token_user together with api_key"))
			}
			plain, _ = json.Marshal(map[string]string{"token_user": tokenUser, "token_secret": in.APIKey})
		default:
			plain = []byte(in.APIKey)
		}
		ct, err := crypto.Encrypt(s.encKey, plain)
		if err != nil {
			return mw.WriteError(c, err)
		}
		ciphertext = ct
	} else if !exists {
		if kind == "dokploy" {
			return mw.WriteError(c, vErrField("api_key", "new dokploy providers require api_key"))
		}
		if (kind == "proxmox" || kind == "vmware") && tokenUser == "" {
			return mw.WriteError(c, vErrField("token_user", "new "+kind+" providers require token_user and api_key"))
		}
	}

	var id uuid.UUID
	var hasCreds bool
	err := s.db.QueryRow(ctx, `
INSERT INTO providers(code, name, kind, api_base_url, credentials_ciphertext, enabled)
VALUES ($1,$2,$3,NULLIF($4,''),$5,$6)
ON CONFLICT (code) DO UPDATE SET
    name=EXCLUDED.name,
    kind=EXCLUDED.kind,
    api_base_url=EXCLUDED.api_base_url,
    enabled=EXCLUDED.enabled,
    credentials_ciphertext=COALESCE(EXCLUDED.credentials_ciphertext, providers.credentials_ciphertext)
RETURNING id, (credentials_ciphertext IS NOT NULL)`,
		in.Code, in.Name, kind, in.APIBaseURL, ciphertext, enabled).Scan(&id, &hasCreds)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.provider.upsert", "provider", &id, map[string]any{
		"code": in.Code, "kind": kind, "enabled": enabled,
		"credentials_provided": in.APIKey != "",
	})
	return mw.JSON(c, 200, fiber.Map{
		"id": id, "code": in.Code, "name": in.Name, "kind": kind,
		"api_base_url": in.APIBaseURL, "enabled": enabled, "has_credentials": hasCreds,
	}, nil)
}

// adminDeleteProvider removes a provider row outright. A provider still backing
// resources must be disabled via the upsert (enabled=false) instead: regions/
// instance_types/etc. cascade on provider deletion, while instances, snapshots
// and other NOT NULL foreign keys abort it.
func (s *Server) adminDeleteProvider(c fiber.Ctx) error {
	providerID, err := admParseUUIDParam(c, "provider_id", "provider_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	ctx := c.Context()
	conflict := apperrors.New(apperrors.CodeConflict,
		"provider is still referenced by instances/regions/provider_accounts; disable it instead via POST /v1/admin/providers with enabled=false")
	var referenced bool
	if err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM instances WHERE provider_id=$1)
    OR EXISTS(SELECT 1 FROM regions WHERE provider_id=$1)
    OR EXISTS(SELECT 1 FROM provider_accounts WHERE provider_id=$1)`, providerID).
		Scan(&referenced); err != nil {
		return mw.WriteError(c, err)
	}
	if referenced {
		return mw.WriteError(c, conflict)
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM providers WHERE id=$1`, providerID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation
			return mw.WriteError(c, conflict)
		}
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	s.admAudit(c, "admin.provider.delete", "provider", &providerID)
	return c.SendStatus(204)
}

func (s *Server) adminTestProvider(c fiber.Ctx) error {
	providerID, err := admParseUUIDParam(c, "provider_id", "provider_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var code, kind string
	if err := s.db.QueryRow(c.Context(), `SELECT code, kind FROM providers WHERE id=$1`, providerID).Scan(&code, &kind); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	p, err := provider.Lookup(code)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if _, _, _, err := p.SyncCatalog(c.Context()); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"code": code, "kind": kind, "status": "ok"}, nil)
}

func (s *Server) adminTriggerProviderSync(c fiber.Ctx) error {
	providerID, err := admParseUUIDParam(c, "provider_id", "provider_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var exists bool
	if err := s.db.QueryRow(c.Context(),
		`SELECT EXISTS(SELECT 1 FROM providers WHERE id=$1)`, providerID).Scan(&exists); err != nil {
		return mw.WriteError(c, err)
	}
	if !exists {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "provider not found"))
	}
	jobID, err := s.admEnqueueJob(c.Context(), "catalog", "provider_sync", "provider", providerID,
		map[string]any{"provider_id": providerID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.provider.sync_triggered", "provider", &providerID, map[string]any{"job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"job_id": jobID, "provider_id": providerID, "status": "queued"}, nil)
}
