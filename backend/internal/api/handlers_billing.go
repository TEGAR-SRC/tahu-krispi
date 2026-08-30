package api

import (
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/billing"
	"kilat.cloud/backend/internal/catalog"
	"kilat.cloud/backend/internal/organization"
	"kilat.cloud/backend/internal/pricing"
	mw "kilat.cloud/backend/pkg/middleware"
)

func lower(s string) string { return strings.ToLower(s) }

func (s *Server) handleListRegions(c fiber.Ctx) error {
	out, err := s.catalogSvc.ListRegions(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleListPlans(c fiber.Ctx) error {
	out, err := s.catalogSvc.ListPlans(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleListInstanceTypes(c fiber.Ctx) error {
	out, err := s.catalogSvc.ListInstanceTypes(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleListOSTemplates(c fiber.Ctx) error {
	out, err := s.catalogSvc.ListOSTemplates(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleListOrganizations(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	out, err := s.orgSvc.ListForUser(c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

type createOrgInput struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	CountryCode string `json:"country_code"`
	LegalName   string `json:"legal_name"`
	TaxID       string `json:"tax_id"`
}

func (s *Server) handleCreateOrganization(c fiber.Ctx) error {
	var in createOrgInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" || in.Slug == "" {
		return mw.WriteError(c, errValidation("name and slug required"))
	}
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	org, err := s.orgSvc.Create(c.Context(), organization.CreateInput{
		Name: in.Name, Slug: in.Slug, CountryCode: upper(in.CountryCode),
		LegalName: in.LegalName, TaxID: in.TaxID, CreatedBy: userID,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, org, nil)
}

type inviteInput struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Server) handleInviteMember(c fiber.Ctx) error {
	orgID, err := uuid.Parse(c.Params("org_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid org id"))
	}
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	var in inviteInput
	if err := c.Bind().Body(&in); err != nil || in.Email == "" {
		return mw.WriteError(c, errValidation("email required"))
	}
	if err := s.orgSvc.Authorize(c.Context(), orgID, userID, "members.write"); err != nil {
		return mw.WriteError(c, err)
	}
	inv, err := s.orgSvc.Invite(c.Context(), orgID, upper(in.Email), in.Role, userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, inv, nil)
}

type acceptInviteInput struct {
	Token string `json:"token"`
}

func (s *Server) handleAcceptInvitation(c fiber.Ctx) error {
	var in acceptInviteInput
	if err := c.Bind().Body(&in); err != nil || in.Token == "" {
		return mw.WriteError(c, errValidation("token required"))
	}
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	if err := s.orgSvc.AcceptInvitation(c.Context(), in.Token, userID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "accepted"}, nil)
}

// ---- SSH keys / startup scripts ----

type sshKeyInput struct {
	Name      string `json:"name"`
	PublicKey string `json:"public_key"`
}

func (s *Server) handleListSSHKeys(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	keys, err := s.catalogSvc.ListSSHKeys(c.Context(), orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, keys, nil)
}

func (s *Server) handleCreateSSHKey(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	var in sshKeyInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" || in.PublicKey == "" {
		return mw.WriteError(c, errValidation("name and public_key required"))
	}
	key, err := s.catalogSvc.CreateSSHKey(c.Context(), catalog.CreateSSHKeyInput{
		OrganizationID: orgID, CreatedBy: userID, Name: in.Name, PublicKey: in.PublicKey,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, key, nil)
}

func (s *Server) handleUpdateSSHKey(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid key id"))
	}
	var in sshKeyInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" || in.PublicKey == "" {
		return mw.WriteError(c, errValidation("name and public_key required"))
	}
	if err := s.catalogSvc.UpdateSSHKey(c.Context(), orgID, keyID, in.Name, in.PublicKey); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteSSHKey(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	keyID, err := uuid.Parse(c.Params("key_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid key id"))
	}
	if err := s.catalogSvc.DeleteSSHKey(c.Context(), orgID, keyID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

type scriptInput struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (s *Server) handleListStartupScripts(c fiber.Ctx) error {
	scripts, err := s.catalogSvc.ListStartupScripts(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, scripts, nil)
}

func (s *Server) handleCreateStartupScript(c fiber.Ctx) error {
	var in scriptInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" || in.Content == "" {
		return mw.WriteError(c, errValidation("name and content required"))
	}
	sc, err := s.catalogSvc.CreateStartupScript(c.Context(), catalog.CreateStartupScriptInput{
		OrganizationID: mustOrgID(c), CreatedBy: mustUserID(c), Name: in.Name, Content: in.Content,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, sc, nil)
}

func (s *Server) handleUpdateStartupScript(c fiber.Ctx) error {
	scriptID, err := uuid.Parse(c.Params("script_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid script id"))
	}
	var in scriptInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid body"))
	}
	if err := s.catalogSvc.UpdateStartupScript(c.Context(), mustOrgID(c), scriptID, in.Name, in.Content); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) handleDeleteStartupScript(c fiber.Ctx) error {
	scriptID, err := uuid.Parse(c.Params("script_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid script id"))
	}
	if err := s.catalogSvc.DeleteStartupScript(c.Context(), mustOrgID(c), scriptID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

// ---- Pricing ----

type quoteInput struct {
	ProductID       string             `json:"product_id"`
	PlanID          string             `json:"plan_id"`
	RegionID        string             `json:"region_id"`
	Currency        string             `json:"currency"`
	BillingPeriod   string             `json:"billing_period"`
	CustomResources map[string]float64 `json:"custom_resources"`
}

func (s *Server) handleQuote(c fiber.Ctx) error {
	userStr, _ := c.Locals("auth_user_id").(string)
	userID, _ := uuid.Parse(userStr)
	var in quoteInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	req := pricing.QuoteRequest{
		UserID: userID, Currency: upper(in.Currency), BillingPeriod: lower(in.BillingPeriod),
		CustomResources: in.CustomResources,
	}
	if orgID := mustOrgID(c); orgID != uuid.Nil {
		req.OrganizationID = &orgID
	}
	if in.PlanID != "" {
		id, err := uuid.Parse(in.PlanID)
		if err != nil {
			return mw.WriteError(c, vErrField("plan_id", "invalid uuid"))
		}
		req.PlanID = &id
	}
	if in.ProductID != "" {
		id, err := uuid.Parse(in.ProductID)
		if err != nil {
			return mw.WriteError(c, vErrField("product_id", "invalid uuid"))
		}
		req.ProductID = &id
	}
	if in.RegionID != "" {
		id, err := uuid.Parse(in.RegionID)
		if err != nil {
			return mw.WriteError(c, vErrField("region_id", "invalid uuid"))
		}
		req.RegionID = &id
	}
	res, err := s.pricingSvc.Quote(c.Context(), req)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, res, nil)
}

// ---- Orders / invoices ----

type createOrderInput struct {
	CouponCode     string `json:"coupon_code"`
	QuoteID        string `json:"quote_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// handleCreateOrder prices orders strictly from a stored quote snapshot:
// clients may never supply amounts (Master Prompt §31).
func (s *Server) handleCreateOrder(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	var in createOrderInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	if in.QuoteID == "" {
		return mw.WriteError(c, vErrField("quote_id", "quote_id required; obtain one via POST /v1/pricing/quote"))
	}
	quoteID, err := uuid.Parse(in.QuoteID)
	if err != nil {
		return mw.WriteError(c, vErrField("quote_id", "invalid uuid"))
	}
	snap, err := s.pricingSvc.LoadSnapshot(c.Context(), quoteID, orgID, userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	items := make([]billing.OrderItemInput, 0, len(snap.Breakdown)+1)
	for _, line := range snap.Breakdown {
		if line.Amount <= 0 {
			continue
		}
		items = append(items, billing.OrderItemInput{
			ServiceKind:   "vm",
			Description:   line.Description,
			Quantity:      line.BillableQty,
			UnitPrice:     line.UnitPrice,
			BillingPeriod: snap.BillingPeriod,
			ResourceConfig: map[string]any{
				"dimension_code": line.DimensionCode,
				"quantity":       line.Quantity,
			},
		})
	}
	if snap.SetupFee > 0 {
		items = append(items, billing.OrderItemInput{
			ServiceKind: "vm", Description: "Setup fee",
			Quantity: 1, UnitPrice: snap.SetupFee, BillingPeriod: snap.BillingPeriod,
		})
	}
	order, err := s.billingSvc.CreateOrder(c.Context(), billing.CreateOrderInput{
		OrganizationID: orgID, CreatedBy: userID, QuoteID: &quoteID,
		CouponCode: in.CouponCode, Currency: snap.Currency, IdempotencyKey: in.IdempotencyKey,
		Items: items,
	})
	if err != nil {
		return mw.WriteError(c, err)
	}
	inv, err := s.billingSvc.CreateInvoiceFromOrder(c.Context(), order.ID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"order": order, "invoice": inv}, nil)
}

func (s *Server) handlePayInvoiceWithWallet(c fiber.Ctx) error {
	invoiceID, err := uuid.Parse(c.Params("invoice_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid invoice id"))
	}
	userID := mustUserID(c)
	if err := s.billingSvc.PayInvoiceWithWallet(c.Context(), invoiceID, mustOrgID(c), userID); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "paid"}, nil)
}

func mustOrgID(c fiber.Ctx) uuid.UUID {
	str, _ := c.Locals("org_id").(string)
	id, _ := uuid.Parse(str)
	return id
}

func mustUserID(c fiber.Ctx) uuid.UUID {
	str, _ := c.Locals("user_id_uuid").(uuid.UUID)
	return str
}
