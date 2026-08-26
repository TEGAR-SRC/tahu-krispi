// handlers_addresses.go implements CRUD over the user's address book
// (Master Prompt §71 profile data).
package api

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/user"
	"kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// addressBody mirrors user.AddressInput with JSON snake_case tags; the domain
// struct itself is bound from service-layer calls only.
type addressBody struct {
	Type          string `json:"type"`
	Label         string `json:"label"`
	RecipientName string `json:"recipient_name"`
	CompanyName   string `json:"company_name"`
	CountryCode   string `json:"country_code"`
	Province      string `json:"province"`
	CityOrRegency string `json:"city_or_regency"`
	District      string `json:"district"`
	Subdistrict   string `json:"subdistrict"`
	PostalCode    string `json:"postal_code"`
	AddressLine1  string `json:"address_line1"`
	AddressLine2  string `json:"address_line2"`
	RT            string `json:"rt"`
	RW            string `json:"rw"`
	ContactPhone  string `json:"contact_phone_e164"`
}

func (b addressBody) toInput(userID uuid.UUID) user.AddressInput {
	return user.AddressInput{
		UserID:        userID,
		Type:          b.Type,
		Label:         b.Label,
		RecipientName: b.RecipientName,
		CompanyName:   b.CompanyName,
		CountryCode:   b.CountryCode,
		Province:      b.Province,
		CityOrRegency: b.CityOrRegency,
		District:      b.District,
		Subdistrict:   b.Subdistrict,
		PostalCode:    b.PostalCode,
		AddressLine1:  b.AddressLine1,
		AddressLine2:  b.AddressLine2,
		RT:            b.RT,
		RW:            b.RW,
		ContactPhone:  b.ContactPhone,
	}
}

func (s *Server) handleListAddresses(c fiber.Ctx) error {
	userID := mustUserID(c)
	list, err := user.ListAddresses(s.db, c.Context(), userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	total := len(list)
	page, perPage := httputil.Page(c)
	start := (page - 1) * perPage
	if start > total {
		start = total
	}
	end := start + perPage
	if end > total {
		end = total
	}
	data := list[start:end]
	if data == nil {
		data = []*user.Address{}
	}
	return httputil.OK(c, 200, data, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) handleCreateAddress(c fiber.Ctx) error {
	userID := mustUserID(c)
	var in addressBody
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	addr, err := user.CreateAddress(s.db, c.Context(), in.toInput(userID))
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "address.created", ResourceType: "user_address",
		ResourceID: &addr.ID,
		AfterData:  map[string]any{"type": addr.Type, "is_default": addr.IsDefault},
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 201, addr, nil)
}

func (s *Server) handleUpdateAddress(c fiber.Ctx) error {
	userID := mustUserID(c)
	addressID, err := uuid.Parse(c.Params("address_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("address_id", "must be a valid uuid"))
	}
	var in addressBody
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	addr, err := user.UpdateAddress(s.db, c.Context(), userID, addressID, in.toInput(userID))
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "address.updated", ResourceType: "user_address",
		ResourceID: &addr.ID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, addr, nil)
}

func (s *Server) handleDeleteAddress(c fiber.Ctx) error {
	userID := mustUserID(c)
	addressID, err := uuid.Parse(c.Params("address_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("address_id", "must be a valid uuid"))
	}
	if err := user.SoftDeleteAddress(s.db, c.Context(), userID, addressID); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "address.deleted", ResourceType: "user_address",
		ResourceID: &addressID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "address_id": addressID}, nil)
}

func (s *Server) handleSetDefaultAddress(c fiber.Ctx) error {
	userID := mustUserID(c)
	addressID, err := uuid.Parse(c.Params("address_id"))
	if err != nil {
		return mw.WriteError(c, vErrField("address_id", "must be a valid uuid"))
	}
	if err := user.SetDefaultAddress(s.db, c.Context(), userID, addressID); err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), audit.Entry{
		ActorUserID: &userID, Action: "address.default_set", ResourceType: "user_address",
		ResourceID: &addressID,
		IP:         c.IP(), UserAgent: c.Get("User-Agent"),
		RequestID: auditRequestID(c),
	})
	return mw.JSON(c, 200, fiber.Map{"status": "default_set", "address_id": addressID}, nil)
}
