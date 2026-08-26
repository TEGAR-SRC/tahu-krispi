// handlers_apikeys.go implements user/organization API key management over
// apikey.Service (Master Prompt §19). The raw secret is returned exactly once
// on create and rotate.
package api

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/apikey"
	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/auth"
	"kilat.cloud/backend/internal/iam"
	apperrors "kilat.cloud/backend/pkg/errors"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// apiKeyScopeDenied returns 403 when the request was authenticated with an API
// key whose scopes do not grant perm. JWT callers pass through untouched.
func (s *Server) apiKeyScopeDenied(c fiber.Ctx, perm string) error {
	authType, _ := c.Locals(auth.LocalsAuthType).(string)
	if authType != "api_key" {
		return nil
	}
	scopes, _ := c.Locals(auth.LocalsScopes).([]string)
	if len(scopes) == 1 && scopes[0] == "*" {
		return nil
	}
	if iam.ScopesAllow(scopes, perm) {
		return nil
	}
	return apperrors.Newf(apperrors.CodeForbidden, "api key missing scope %s", perm)
}

// apiKeyOrgContext resolves the organization for org-scoped API-key
// operations: X-Organization-ID header first, then query, then an API-key-bound
// organization from Locals. An API-key caller may only act within the
// organization its key is bound to.
func (s *Server) apiKeyOrgContext(c fiber.Ctx) (uuid.UUID, error) {
	orgStr := c.Get("X-Organization-ID")
	if orgStr == "" {
		orgStr = c.Query("organization_id")
	}
	if orgStr == "" {
		orgStr, _ = c.Locals("org_id").(string)
	}
	orgID, err := uuid.Parse(orgStr)
	if err != nil {
		return uuid.Nil, errInvalidOrganizationID()
	}
	authType, _ := c.Locals(auth.LocalsAuthType).(string)
	if authType == "api_key" {
		if bound := mustOrgID(c); bound != uuid.Nil && bound != orgID {
			return uuid.Nil, apperrors.New(apperrors.CodeForbidden,
				"api key is not bound to this organization")
		}
	}
	return orgID, nil
}

// authorizeAPIKeyAccess verifies the caller may read (write=false) or mutate
// (write=true) key k: personal keys only by their owner; organization keys via
// org membership permission or a matching API-key binding.
func (s *Server) authorizeAPIKeyAccess(c fiber.Ctx, k *apikey.Key, write bool) error {
	userID := mustUserID(c)
	switch k.OwnerType {
	case apikey.OwnerUser:
		if k.UserID == nil || *k.UserID != userID {
			return apperrors.New(apperrors.CodeNotFound, "api key not found")
		}
		return nil
	case apikey.OwnerOrganization:
		if k.OrganizationID == nil {
			return apperrors.New(apperrors.CodeForbidden, "api key has no organization owner")
		}
		orgID := *k.OrganizationID
		authType, _ := c.Locals(auth.LocalsAuthType).(string)
		if authType == "api_key" {
			if mustOrgID(c) != orgID {
				return apperrors.New(apperrors.CodeForbidden, "not your organization's api key")
			}
			return nil
		}
		perm := "api_keys.read"
		if write {
			perm = "api_keys.write"
		}
		return s.orgSvc.Authorize(c.Context(), orgID, userID, perm)
	default:
		return apperrors.New(apperrors.CodeForbidden, "cannot access this api key")
	}
}

// actingAPIKeyID returns the id of the API key used for this request, if any.
func actingAPIKeyID(c fiber.Ctx) *uuid.UUID {
	str, _ := c.Locals("api_key_id").(string)
	id, err := uuid.Parse(str)
	if err != nil || id == uuid.Nil {
		return nil
	}
	return &id
}

type listAPIKeysQuery struct {
	OwnerType string `query:"owner_type"`
}

func (s *Server) handleListAPIKeys(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.read"); err != nil {
		return mw.WriteError(c, err)
	}
	userID := mustUserID(c)
	var q listAPIKeysQuery
	if err := c.Bind().Query(&q); err != nil {
		return mw.WriteError(c, errValidation("invalid query parameters"))
	}
	ownerType := q.OwnerType
	if ownerType == "" {
		ownerType = apikey.OwnerUser
	}
	var orgID uuid.UUID
	if ownerType == apikey.OwnerOrganization {
		var err error
		if orgID, err = s.apiKeyOrgContext(c); err != nil {
			return mw.WriteError(c, err)
		}
		if err := s.orgSvc.Authorize(c.Context(), orgID, userID, "api_keys.read"); err != nil {
			return mw.WriteError(c, err)
		}
	} else if ownerType != apikey.OwnerUser {
		return mw.WriteError(c, vErrField("owner_type", "must be user or organization"))
	}
	keys, err := s.apikeySvc.List(c.Context(), ownerType, userID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	total := len(keys)
	page, perPage := httputil.Page(c)
	start := (page - 1) * perPage
	if start > total {
		start = total
	}
	end := start + perPage
	if end > total {
		end = total
	}
	data := keys[start:end]
	if data == nil {
		data = []apikey.Key{}
	}
	return httputil.OK(c, 200, data, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type createAPIKeyInput struct {
	OwnerType  string     `json:"owner_type"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	AllowedIPs []string   `json:"allowed_ips"`
	ExpiresAt  *time.Time `json:"expires_at"`
}

func (s *Server) handleCreateAPIKey(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.write"); err != nil {
		return mw.WriteError(c, err)
	}
	userID := mustUserID(c)
	var in createAPIKeyInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.OwnerType == "" {
		in.OwnerType = apikey.OwnerUser
	}
	for _, sc := range in.Scopes {
		if sc != "*" && !iam.IsValidScope(sc) {
			return mw.WriteError(c, vErrField("scopes", "unknown scope "+sc))
		}
	}

	in2 := apikey.CreateInput{
		OwnerType:  in.OwnerType,
		Name:       in.Name,
		Scopes:     in.Scopes,
		AllowedIPs: in.AllowedIPs,
		ExpiresAt:  in.ExpiresAt,
		CreatedBy:  userID,
	}
	switch in.OwnerType {
	case apikey.OwnerUser:
		in2.UserID = userID
	case apikey.OwnerOrganization:
		orgID, err := s.apiKeyOrgContext(c)
		if err != nil {
			return mw.WriteError(c, err)
		}
		if err := s.orgSvc.Authorize(c.Context(), orgID, userID, "api_keys.write"); err != nil {
			return mw.WriteError(c, err)
		}
		in2.OrgID = orgID
	default:
		return mw.WriteError(c, vErrField("owner_type", "must be user or organization"))
	}

	key, raw, err := s.apikeySvc.Create(c.Context(), in2)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:   &userID,
		ActorAPIKeyID: actingAPIKeyID(c),
		Action:        "apikey.created", ResourceType: "api_key",
		ResourceID: &key.ID,
		AfterData:  map[string]any{"name": key.Name, "owner_type": key.OwnerType, "scopes": key.Scopes},
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 201, fiber.Map{"key": key, "secret": raw}, nil)
}

func (s *Server) handleGetAPIKey(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.read"); err != nil {
		return mw.WriteError(c, err)
	}
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("key_id", "must be a valid uuid"))
	}
	key, err := s.apikeySvc.Get(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.authorizeAPIKeyAccess(c, key, false); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, key, nil)
}

type updateAPIKeyInput struct {
	Name       *string    `json:"name"`
	Scopes     *[]string  `json:"scopes"`
	AllowedIPs *[]string  `json:"allowed_ips"`
	ExpiresAt  *time.Time `json:"expires_at"`
}

func (s *Server) handleUpdateAPIKey(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.write"); err != nil {
		return mw.WriteError(c, err)
	}
	userID := mustUserID(c)
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("key_id", "must be a valid uuid"))
	}
	existing, err := s.apikeySvc.Get(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.authorizeAPIKeyAccess(c, existing, true); err != nil {
		return mw.WriteError(c, err)
	}
	var in updateAPIKeyInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.Scopes != nil {
		for _, sc := range *in.Scopes {
			if sc != "*" && !iam.IsValidScope(sc) {
				return mw.WriteError(c, vErrField("scopes", "unknown scope "+sc))
			}
		}
	}
	patch := apikey.UpdateInput{
		Name:       in.Name,
		Scopes:     in.Scopes,
		AllowedIPs: in.AllowedIPs,
		ExpiresAt:  in.ExpiresAt,
	}
	key, err := s.apikeySvc.Update(c.Context(), keyID, patch)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:   &userID,
		ActorAPIKeyID: actingAPIKeyID(c),
		Action:        "apikey.updated", ResourceType: "api_key",
		ResourceID: &keyID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, key, nil)
}

func (s *Server) handleRevokeAPIKey(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.write"); err != nil {
		return mw.WriteError(c, err)
	}
	userID := mustUserID(c)
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("key_id", "must be a valid uuid"))
	}
	existing, err := s.apikeySvc.Get(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.authorizeAPIKeyAccess(c, existing, true); err != nil {
		return mw.WriteError(c, err)
	}
	key, err := s.apikeySvc.Revoke(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:   &userID,
		ActorAPIKeyID: actingAPIKeyID(c),
		Action:        "apikey.revoked", ResourceType: "api_key",
		ResourceID: &keyID,
		BeforeData: map[string]any{"status": existing.Status},
		AfterData:  map[string]any{"status": key.Status},
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return c.SendStatus(204)
}

func (s *Server) handleRotateAPIKey(c fiber.Ctx) error {
	if err := s.apiKeyScopeDenied(c, "api_keys.write"); err != nil {
		return mw.WriteError(c, err)
	}
	userID := mustUserID(c)
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("key_id", "must be a valid uuid"))
	}
	existing, err := s.apikeySvc.Get(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := s.authorizeAPIKeyAccess(c, existing, true); err != nil {
		return mw.WriteError(c, err)
	}
	key, raw, err := s.apikeySvc.Rotate(c.Context(), keyID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID:   &userID,
		ActorAPIKeyID: actingAPIKeyID(c),
		Action:        "apikey.rotated", ResourceType: "api_key",
		ResourceID: &keyID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"key": key, "secret": raw}, nil)
}
