package api

import (
	"bytes"
	"context"
	"io"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// maxMeasuredBootImageBytes caps UKI uploads at 512MB.
const maxMeasuredBootImageBytes = 512 << 20

type measuredBootImageView struct {
	ID          *uuid.UUID `json:"id,omitempty"`
	ExternalID  string     `json:"external_id,omitempty"`
	Name        string     `json:"name"`
	Filename    string     `json:"filename,omitempty"`
	Description string     `json:"description,omitempty"`
	SizeBytes   int64      `json:"size_bytes"`
	CreatedAt   string     `json:"created_at,omitempty"`
}

// listMeasuredBootRows loads this organization's non-deleted measured boot images.
func (s *Server) listMeasuredBootRows(ctx context.Context, orgID uuid.UUID) ([]measuredBootImageView, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, COALESCE(external_image_id,''), name, COALESCE(filename,''),
       COALESCE(description,''), COALESCE(size_bytes,0), created_at::text
FROM measured_boot_images
WHERE organization_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []measuredBootImageView{}
	for rows.Next() {
		var v measuredBootImageView
		id := uuid.Nil
		if err := rows.Scan(&id, &v.ExternalID, &v.Name, &v.Filename, &v.Description, &v.SizeBytes, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.ID = &id
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) handleListMeasuredBootImages(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	localRows, err := s.listMeasuredBootRows(ctx, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	provImages := []provider.MeasuredBootImage{}
	teamExt, terr := providerTeamExternalID(ctx, s.db, orgID)
	if terr != nil {
		s.log.Warn("measured boot list: team resolve failed", map[string]any{"error": terr.Error()})
	} else if plist, perr := s.prov.ListMeasuredBootImages(ctx, teamExt); perr != nil {
		s.log.Warn("measured boot list: provider call failed", map[string]any{"error": perr.Error()})
	} else {
		provImages = plist
	}

	views := make([]measuredBootImageView, 0, len(provImages)+len(localRows))
	idxByExt := make(map[string]int, len(provImages))
	for _, p := range provImages {
		views = append(views, measuredBootImageView{
			ExternalID:  p.ExternalID,
			Name:        p.Filename,
			Filename:    p.Filename,
			Description: p.Description,
			SizeBytes:   p.Size,
		})
		idxByExt[p.ExternalID] = len(views) - 1
	}
	for _, l := range localRows {
		if i, ok := idxByExt[l.ExternalID]; ok && l.ExternalID != "" {
			if views[i].Description == "" {
				views[i].Description = l.Description
			}
			if views[i].SizeBytes == 0 {
				views[i].SizeBytes = l.SizeBytes
			}
			views[i].ID = l.ID
			views[i].Name = l.Name
			views[i].CreatedAt = l.CreatedAt
			continue
		}
		views = append(views, l)
	}

	data, meta := paginateViews(c, views)
	return httputil.OK(c, 200, data, meta)
}

func (s *Server) handleUploadMeasuredBootImage(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)

	fh, err := c.FormFile("file")
	if err != nil {
		return mw.WriteError(c, errValidation("file required"))
	}
	if fh.Size <= 0 || fh.Size > maxMeasuredBootImageBytes {
		return mw.WriteError(c, vErrField("file", "image must be between 1 byte and 512MB"))
	}

	providerID, err := onidelProviderID(ctx, s.db)
	if err != nil {
		return mw.WriteError(c, err)
	}
	teamExt, err := providerTeamExternalID(ctx, s.db, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	f, err := fh.Open()
	if err != nil {
		return mw.WriteError(c, errValidation("cannot read uploaded file"))
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxMeasuredBootImageBytes+1))
	if err != nil {
		return mw.WriteError(c, errValidation("cannot read uploaded file"))
	}
	if int64(len(data)) > maxMeasuredBootImageBytes {
		return mw.WriteError(c, vErrField("file", "maximum size is 512MB"))
	}

	description := c.FormValue("description")
	img, err := s.prov.UploadMeasuredBootImage(ctx, teamExt, fh.Filename, description, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return mw.WriteError(c, err)
	}

	var extAny any
	if img.ExternalID != "" {
		extAny = img.ExternalID
	}
	var imageID uuid.UUID
	var createdAt string
	name := img.Filename
	if name == "" {
		name = fh.Filename
	}
	err = s.db.QueryRow(ctx, `
INSERT INTO measured_boot_images(organization_id, provider_id, external_image_id,
                                 name, filename, description, size_bytes)
VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7)
RETURNING id, created_at::text`,
		orgID, providerID, extAny, name, fh.Filename, description, int64(len(data))).
		Scan(&imageID, &createdAt)
	if err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 201, measuredBootImageView{
		ID:          &imageID,
		ExternalID:  img.ExternalID,
		Name:        name,
		Filename:    fh.Filename,
		Description: description,
		SizeBytes:   int64(len(data)),
		CreatedAt:   createdAt,
	}, nil)
}

func (s *Server) handleDeleteMeasuredBootImage(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	imageID, err := uuid.Parse(c.Params("image_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid image id"))
	}
	var extID string
	err = s.db.QueryRow(ctx, `
SELECT COALESCE(external_image_id,'') FROM measured_boot_images
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, imageID, orgID).Scan(&extID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "measured boot image not found"))
		}
		return mw.WriteError(c, err)
	}

	tag, err := s.db.Exec(ctx, `
UPDATE measured_boot_images SET deleted_at=now() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
		imageID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "measured boot image not found"))
	}

	if extID != "" {
		// Provider delete is best-effort: the local soft delete above stays
		// authoritative and sync jobs reconcile any drift.
		if derr := s.prov.DeleteMeasuredBootImage(ctx, extID); derr != nil {
			s.log.Warn("measured boot delete: provider call failed", map[string]any{
				"image_id": imageID.String(), "error": derr.Error()})
		}
	}

	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) handleAttachMeasuredBoot(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	vmExt, err := instanceExternalVM(ctx, s.db, instanceID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	var body struct {
		ImageID string `json:"image_id"`
	}
	if err := c.Bind().Body(&body); err != nil || body.ImageID == "" {
		return mw.WriteError(c, errValidation("image_id required"))
	}
	imageID, err := uuid.Parse(body.ImageID)
	if err != nil {
		return mw.WriteError(c, vErrField("image_id", "invalid uuid"))
	}

	var imgExt string
	err = s.db.QueryRow(ctx, `
SELECT COALESCE(external_image_id,'') FROM measured_boot_images
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, imageID, orgID).Scan(&imgExt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "measured boot image not found"))
		}
		return mw.WriteError(c, err)
	}
	if imgExt == "" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeConflict, "measured boot image has no provider mapping yet"))
	}

	if err := s.prov.AttachMeasuredBoot(ctx, vmExt, imgExt); err != nil {
		return mw.WriteError(c, err)
	}

	if _, err := s.db.Exec(ctx, `
INSERT INTO instance_measured_boot_attachments(instance_id, image_id)
VALUES ($1,$2)
ON CONFLICT (instance_id) DO UPDATE
SET image_id=EXCLUDED.image_id, attached_at=now(), detached_at=NULL`, instanceID, imageID); err != nil {
		return mw.WriteError(c, err)
	}
	if _, err := s.db.Exec(ctx, `
UPDATE instances SET measured_boot_enabled=true WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, fiber.Map{"status": "attached"}, nil)
}

func (s *Server) handleDetachMeasuredBoot(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	vmExt, err := instanceExternalVM(ctx, s.db, instanceID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	if err := s.prov.DetachMeasuredBoot(ctx, vmExt); err != nil {
		return mw.WriteError(c, err)
	}

	if _, err := s.db.Exec(ctx, `
UPDATE instance_measured_boot_attachments SET detached_at=now()
WHERE instance_id=$1 AND detached_at IS NULL`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	if _, err := s.db.Exec(ctx, `
UPDATE instances SET measured_boot_enabled=false WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, fiber.Map{"status": "detached"}, nil)
}
