package api

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/storage"
	mw "kilat.cloud/backend/pkg/middleware"
)

// Object-storage service lifecycle handlers. The service is the billable unit;
// creating it also creates the monthly subscription (billing is attached
// inside storage.Service.CreateService) and deleting it cancels that
// subscription in the same transaction.
//
// Routes for coordinator wiring in internal/api/server.go (file is off-limits
// for this change):
//
//	v1.Post("/object-storage", idem, s.authAny(), s.withOrg(s.handleCreateStorageService))
//	v1.Delete("/object-storage/:service_id", s.authAny(), s.withOrg(s.handleDeleteStorageService))

type storageServiceInput struct {
	Name   string `json:"name"`
	Region string `json:"region_id"`
}

func (s *Server) handleCreateStorageService(c fiber.Ctx) error {
	var in storageServiceInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" {
		return mw.WriteError(c, errValidation("name required"))
	}
	sin := storage.CreateServiceInput{OrganizationID: mustOrgID(c), Name: in.Name}
	if id, err := uuid.Parse(in.Region); err == nil {
		sin.RegionID = &id
	}
	svc, err := s.storageSvc.CreateService(c.Context(), sin)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, svc, nil)
}

func (s *Server) handleDeleteStorageService(c fiber.Ctx) error {
	serviceID, err := uuid.Parse(c.Params("service_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid service id"))
	}
	if err := s.storageSvc.DeleteService(c.Context(), mustOrgID(c), serviceID); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}
