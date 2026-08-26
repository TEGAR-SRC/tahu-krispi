package api

import (
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// handleGetStorageServiceDetail merges the local object_storage_services row
// (billing + transfer counters) with the provider-side service state and
// returns the enriched detail view.
func (s *Server) handleGetStorageServiceDetail(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	serviceID, err := uuid.Parse(c.Params("service_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid service id"))
	}

	var (
		hasLocal      bool
		localID       uuid.UUID
		publicID      string
		externalID    string
		name          string
		endpoint      string
		status        string
		currency      string
		billingPeriod string
		createdAt     string
		recurring     float64
		capacityKB    int64
		usedKB        int64
		uploadUsage   int64
		downloadUsage int64
	)
	var recurringText string
	err = s.db.QueryRow(ctx, `
SELECT id, public_id, COALESCE(external_service_id,''), name, COALESCE(endpoint,''),
       status::text, COALESCE(capacity_bytes,0), used_bytes,
       upload_usage_bytes, download_usage_bytes,
       recurring_amount::text, currency::text, billing_period::text, created_at::text
FROM object_storage_services
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, serviceID, orgID).
		Scan(&localID, &publicID, &externalID, &name, &endpoint, &status,
			&capacityKB, &usedKB, &uploadUsage, &downloadUsage,
			&recurringText, &currency, &billingPeriod, &createdAt)
	if err == nil {
		hasLocal = true
		fmt.Sscanf(recurringText, "%f", &recurring)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return mw.WriteError(c, err)
	}

	teamExt, err := providerTeamExternalID(ctx, s.db, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	services, perr := s.prov.ListStorageServices(ctx, teamExt)
	if perr != nil && !hasLocal {
		return mw.WriteError(c, perr)
	}
	if perr != nil {
		s.log.Warn("storage detail: provider call failed", map[string]any{"error": perr.Error()})
	}

	var match *provider.StorageServiceInfo
	for i := range services {
		sv := &services[i]
		if sv.ExternalID == externalID || (publicID != "" && sv.ExternalID == publicID) ||
			sv.ExternalID == serviceID.String() {
			match = sv
			break
		}
	}

	if !hasLocal && match == nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "storage service not found"))
	}

	service := fiber.Map{}
	if hasLocal {
		service["id"] = localID
		service["public_id"] = publicID
		service["created_at"] = createdAt
		service["currency"] = currency
		service["billing_period"] = billingPeriod
		service["external_service_id"] = externalID
	}
	if match != nil {
		service["external_service_id"] = match.ExternalID
	}
	if name == "" && match != nil {
		name = match.Name
	}
	service["name"] = name
	if endpoint == "" && match != nil {
		endpoint = match.Endpoint
	}
	service["endpoint"] = endpoint
	if status == "" && match != nil {
		status = match.Status
	}
	service["status"] = status
	if capacityKB == 0 && match != nil {
		capacityKB = match.CapacityKB
	}
	service["capacity"] = capacityKB
	if usedKB == 0 && match != nil {
		usedKB = match.UsedKB
	}
	service["used_capacity"] = usedKB

	return mw.JSON(c, 200, fiber.Map{
		"service":          service,
		"recurring_amount": recurring,
		"upload_usage":     uploadUsage,
		"download_usage":   downloadUsage,
	}, nil)
}
