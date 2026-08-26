package api

import (
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Object storage ----

func (s *Server) handleListStorageServices(c fiber.Ctx) error {
	out, err := s.storageSvc.ListServices(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

type bucketInput struct {
	BucketName string `json:"bucket_name"`
	Versioning bool   `json:"versioning"`
	ObjectLock bool   `json:"object_lock"`
}

func (s *Server) handleListBuckets(c fiber.Ctx) error {
	serviceID, err := uuid.Parse(c.Params("service_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid service id"))
	}
	out, err := s.storageSvc.ListBuckets(c.Context(), mustOrgID(c), serviceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleCreateBucket(c fiber.Ctx) error {
	serviceID, err := uuid.Parse(c.Params("service_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid service id"))
	}
	var in bucketInput
	if err := c.Bind().Body(&in); err != nil || in.BucketName == "" {
		return mw.WriteError(c, errValidation("bucket_name required"))
	}
	b, err := s.storageSvc.CreateBucket(c.Context(), storageCreateBucketInput(mustOrgID(c), serviceID, in))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, b, nil)
}

func (s *Server) handleListAccessKeys(c fiber.Ctx) error {
	serviceID, err := uuid.Parse(c.Params("service_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid service id"))
	}
	keys, err := s.storageSvc.ListAccessKeys(c.Context(), mustOrgID(c), serviceID, c.Params("bucket_name"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"keys": keys}, nil)
}
