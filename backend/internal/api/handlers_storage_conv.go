package api

import (
	"github.com/google/uuid"

	"kilat.cloud/backend/internal/storage"
)

func storageCreateBucketInput(orgID, serviceID uuid.UUID, in bucketInput) storage.CreateBucketInput {
	return storage.CreateBucketInput{
		OrganizationID: orgID,
		ServiceID:      serviceID,
		BucketName:     in.BucketName,
		Versioning:     in.Versioning,
		ObjectLock:     in.ObjectLock,
	}
}
