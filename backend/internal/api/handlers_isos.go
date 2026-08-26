package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/compute"
	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/storage"
	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
	ssrfpkg "kilat.cloud/backend/pkg/ssrf"
)

// pgxQuerier is the subset of *pgxpool.Pool used by these handlers.
type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ---- Shared provider-facing helpers ----

// providerTeamExternalID resolves the organization's provider team external id
// (provider_accounts.external_account_id). Fails with a conflict error when the
// organization is not mapped to a provider team yet.
func providerTeamExternalID(ctx context.Context, db pgxQuerier, orgID uuid.UUID) (string, error) {
	var ext string
	err := db.QueryRow(ctx, `
SELECT COALESCE(external_account_id,'') FROM provider_accounts
WHERE organization_id=$1 LIMIT 1`, orgID).Scan(&ext)
	if err != nil || ext == "" {
		return "", apperrors.New(apperrors.CodeConflict, "organization not mapped to provider team")
	}
	return ext, nil
}

// onidelProviderID returns the enabled onidel provider row id used to stamp
// provider-scoped resource rows.
func onidelProviderID(ctx context.Context, db pgxQuerier) (uuid.UUID, error) {
	var pid uuid.UUID
	err := db.QueryRow(ctx, `SELECT id FROM providers WHERE kind='onidel' AND enabled LIMIT 1`).Scan(&pid)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeProviderUnavailable, "onidel provider not configured")
	}
	return pid, nil
}

// orgISOLister resolves the adapter and team scope used to list an
// organization's provider-side ISOs: the entry the organization holds in
// provider_accounts (same single-mapping convention as
// providerTeamExternalID). ok=false for organizations without a usable
// mapping so callers keep their existing degraded (local-only) behavior.
func (s *Server) orgISOLister(ctx context.Context, orgID uuid.UUID) (pv provider.ComputeProvider, teamExt string, ok bool) {
	var code, ext string
	err := s.db.QueryRow(ctx, `
SELECT p.code::text, COALESCE(pa.external_account_id,'')
FROM provider_accounts pa JOIN providers p ON p.id = pa.provider_id
WHERE pa.organization_id=$1 LIMIT 1`, orgID).Scan(&code, &ext)
	if err != nil || ext == "" {
		return nil, "", false
	}
	pv, err = provider.Lookup(strings.ToLower(code)) // citext may preserve case; registry keys are lowercase
	if err != nil {
		return nil, "", false
	}
	return pv, ext, true
}

// isoRowProvider resolves the adapter owning a custom_isos row from its
// providers.code. Rows stamped onidel (or without a readable mapping) stay on
// the default adapter with team scoping; every other code comes from the
// registry and needs no team scope — the same rule as instanceProvider.
func isoRowProvider(def provider.ComputeProvider, code string) (pv provider.ComputeProvider, teamScoped bool, err error) {
	switch c := strings.ToLower(strings.TrimSpace(code)); c {
	case "", "onidel":
		return def, true, nil
	default:
		pv, err = provider.Lookup(c)
		return pv, false, err
	}
}

// orgProviderID returns the provider row an organization is bound to through
// its provider_accounts mapping (onidel entries win for dual-mapped orgs);
// unmapped organizations fall back to the enabled onidel provider row, the
// same default compute.Service applies to new instances.
func (s *Server) orgProviderID(ctx context.Context, orgID uuid.UUID) (uuid.UUID, error) {
	var pid uuid.UUID
	err := s.db.QueryRow(ctx, `
SELECT pa.provider_id
FROM provider_accounts pa JOIN providers p ON p.id = pa.provider_id
WHERE pa.organization_id=$1 AND p.enabled
ORDER BY (p.kind='onidel') DESC, pa.created_at
LIMIT 1`, orgID).Scan(&pid)
	if err == nil {
		return pid, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return onidelProviderID(ctx, s.db)
	}
	return uuid.Nil, err
}

// instanceExternalVM verifies the instance belongs to the organization and
// returns its external VM id. A missing row yields 404; a row without a
// provider mapping yet yields a conflict.
func instanceExternalVM(ctx context.Context, db pgxQuerier, instanceID, orgID uuid.UUID) (string, error) {
	var ext *string
	err := db.QueryRow(ctx, `
SELECT external_vm_id FROM instances
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, instanceID, orgID).Scan(&ext)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", apperrors.New(apperrors.CodeNotFound, "instance not found")
		}
		return "", err
	}
	if ext == nil || *ext == "" {
		return "", apperrors.New(apperrors.CodeConflict, "instance has no provider mapping yet")
	}
	return *ext, nil
}

// isoStatusFromProgress maps the provider ISO processing progress percent onto
// a Kilat Cloud resource status.
func isoStatusFromProgress(progress int) string {
	if progress >= 100 {
		return "active"
	}
	return "provisioning"
}

// ---- Custom ISOs ----

type createISOInput struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

type isoView struct {
	ID             *uuid.UUID `json:"id,omitempty"`
	ExternalID     string     `json:"external_id,omitempty"`
	Name           string     `json:"name"`
	Filename       string     `json:"filename,omitempty"`
	Description    string     `json:"description,omitempty"`
	SourceURL      string     `json:"source_url,omitempty"`
	SizeBytes      int64      `json:"size_bytes"`
	Status         string     `json:"status"`
	RegisterStatus string     `json:"register_status,omitempty"`
	Progress       int        `json:"progress_percent"`
	IsSystem       bool       `json:"is_system"`
	CreatedAt      string     `json:"created_at,omitempty"`
}

// isoUsageView is the per-user custom ISO footprint envelope returned by the
// list and upload endpoints: how many ISOs are in use, how much of the 50 GiB
// quota is consumed, and the per-file cap.
type isoUsageView struct {
	Count      int   `json:"count"`
	UsedBytes  int64 `json:"used_bytes"`
	QuotaBytes int64 `json:"quota_bytes"`
	MaxPerFile int64 `json:"max_per_file"`
}

// isoUsageForUser sums the user's non-deleted custom ISOs across every
// organization they own (quotas are keyed on organizations.created_by).
func (s *Server) isoUsageForUser(ctx context.Context, userID uuid.UUID) (isoUsageView, error) {
	var count int
	var used int64
	err := s.db.QueryRow(ctx, `
SELECT COUNT(*), COALESCE(SUM(COALESCE(ci.size_bytes,0)),0)
FROM custom_isos ci
JOIN organizations o ON o.id = ci.organization_id
WHERE o.created_by=$1 AND ci.deleted_at IS NULL`, userID).Scan(&count, &used)
	if err != nil {
		return isoUsageView{}, err
	}
	return isoUsageView{
		Count:      count,
		UsedBytes:  used,
		QuotaBytes: compute.MaxISOTotalQuotaBytes,
		MaxPerFile: compute.MaxISOSizeBytes,
	}, nil
}

// isoJSONResponse writes the standard {data, usage, request_id} success
// envelope used by endpoints that carry ISO quota information.
func isoJSONResponse(c fiber.Ctx, status int, data any, usage isoUsageView) error {
	reqID, _ := c.Locals(httputil.RequestIDKey).(string)
	return c.Status(status).JSON(fiber.Map{"data": data, "usage": usage, "request_id": reqID})
}

// listCustomISORows loads this organization's non-deleted custom ISO rows.
func (s *Server) listCustomISORows(ctx context.Context, orgID uuid.UUID) ([]isoView, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, COALESCE(external_iso_id,''), name, COALESCE(source_url,''),
       COALESCE(size_bytes,0), status::text, COALESCE(register_status,''), created_at::text
FROM custom_isos
WHERE organization_id=$1 AND deleted_at IS NULL
ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []isoView{}
	for rows.Next() {
		var v isoView
		id := uuid.Nil
		if err := rows.Scan(&id, &v.ExternalID, &v.Name, &v.SourceURL, &v.SizeBytes,
			&v.Status, &v.RegisterStatus, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.ID = &id
		out = append(out, v)
	}
	return out, rows.Err()
}

// mergedISOViews combines local custom_isos rows with the provider's ISO list,
// matching entries by external id. System ISOs come from the provider only.
// Provider failures are logged and degraded to local-only data.
func (s *Server) mergedISOViews(ctx context.Context, orgID uuid.UUID) ([]isoView, error) {
	localRows, err := s.listCustomISORows(ctx, orgID)
	if err != nil {
		return nil, err
	}

	provISOs := []provider.ISOImage{}
	pv, teamExt, routed := s.orgISOLister(ctx, orgID)
	if !routed {
		s.log.Warn("iso list: team resolve failed", map[string]any{
			"error": "organization not mapped to provider team"})
	} else if plist, perr := pv.ListISOs(ctx, teamExt); perr != nil {
		s.log.Warn("iso list: provider call failed", map[string]any{"error": perr.Error()})
	} else {
		provISOs = plist
	}

	views := make([]isoView, 0, len(provISOs)+len(localRows))
	idxByExt := make(map[string]int, len(provISOs))
	for _, p := range provISOs {
		views = append(views, isoView{
			ExternalID:  p.ExternalID,
			Name:        p.Name,
			Filename:    p.Filename,
			Description: p.Desc,
			SizeBytes:   p.Size,
			Status:      isoStatusFromProgress(p.ProgressPercent),
			Progress:    p.ProgressPercent,
			IsSystem:    p.IsSystem,
		})
		idxByExt[p.ExternalID] = len(views) - 1
	}
	for _, l := range localRows {
		if i, ok := idxByExt[l.ExternalID]; ok && l.ExternalID != "" {
			l.Progress = views[i].Progress
			if views[i].Filename != "" {
				l.Filename = views[i].Filename
			}
			if views[i].Description != "" {
				l.Description = views[i].Description
			}
			if l.SizeBytes == 0 {
				l.SizeBytes = views[i].SizeBytes
			}
			views[i] = l
			continue
		}
		views = append(views, l)
	}
	return views, nil
}

func paginateViews[T any](c fiber.Ctx, all []T) ([]T, *httputil.Meta) {
	page, perPage := httputil.Page(c)
	total := len(all)
	start := (page - 1) * perPage
	if start > total {
		start = total
	}
	end := start + perPage
	if end > total {
		end = total
	}
	return all[start:end], &httputil.Meta{Page: page, PerPage: perPage, Total: total}
}

func (s *Server) handleListISOs(c fiber.Ctx) error {
	ctx := c.Context()
	views, err := s.mergedISOViews(ctx, mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	usage, err := s.isoUsageForUser(ctx, mustUserID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	data, meta := paginateViews(c, views)
	reqID, _ := c.Locals(httputil.RequestIDKey).(string)
	return c.Status(200).JSON(fiber.Map{"data": data, "meta": meta, "usage": usage, "request_id": reqID})
}

// handleCreateISO registers a custom ISO from a public URL. The row goes
// straight to register_status='registering' and the provider push happens in
// an iso_register_provider job (retryable, never fatal); no internal object
// is stored for this path. The URL size is probed so the same quota checks as
// the upload path apply.
func (s *Server) handleCreateISO(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	var in createISOInput
	if err := c.Bind().Body(&in); err != nil || in.URL == "" {
		return mw.WriteError(c, errValidation("url required"))
	}
	u, verr := ssrfpkg.Validate(in.URL)
	if verr != nil {
		return mw.WriteError(c, vErrField("url", "must be a reachable public http(s) URL"))
	}
	providerID, err := s.orgProviderID(c.Context(), orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	name := in.Name
	if name == "" {
		name = path.Base(u.Path)
		if name == "" || name == "." || name == "/" {
			name = u.Hostname()
		}
	}

	ctx := c.Context()

	// Quota gate: probe the file size from the URL (Content-Length) so the
	// per-file cap and the 50 GiB total quota are enforced server-side.
	size, perr := compute.ProbeURLSize(ctx, nil, in.URL)
	if perr != nil {
		return mw.WriteError(c, errValidation("cannot determine iso size from url"))
	}
	usage, err := s.isoUsageForUser(ctx, userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := compute.CheckISOQuota(usage.Count, usage.UsedBytes, size); err != nil {
		return mw.WriteError(c, err)
	}

	var isoID uuid.UUID
	var createdAt string
	err = s.db.QueryRow(ctx, `
INSERT INTO custom_isos(organization_id, provider_id, name, source_url,
                        size_bytes, status, register_status, created_by)
VALUES ($1,$2,$3,$4,$5,'pending','registering',$6)
RETURNING id, created_at::text`, orgID, providerID, name, in.URL, size, userID).
		Scan(&isoID, &createdAt)
	if err != nil {
		return mw.WriteError(c, err)
	}

	if err := enqueueISORegisterJob(ctx, s.db, isoID); err != nil {
		// Row stays 'registering' with no live job: exactly the state the
		// retry endpoint accepts, so the registration converges either way.
		s.log.Warn("iso create: enqueue failed", map[string]any{
			"iso_id": isoID.String(), "error": err.Error()})
	}

	usage.Count++
	usage.UsedBytes += size
	return isoJSONResponse(c, 202, isoView{
		ID:             &isoID,
		Name:           name,
		SourceURL:      in.URL,
		SizeBytes:      size,
		Status:         "pending",
		RegisterStatus: "registering",
		CreatedAt:      createdAt,
	}, usage)
}

func (s *Server) handleGetISO(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	isoID, err := uuid.Parse(c.Params("iso_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid iso id"))
	}

	var v isoView
	id := uuid.Nil
	var rowProvCode string
	err = s.db.QueryRow(ctx, `
SELECT ci.id, COALESCE(ci.external_iso_id,''), ci.name, COALESCE(ci.source_url,''),
       COALESCE(ci.size_bytes,0), ci.status::text, COALESCE(ci.register_status,''),
       ci.created_at::text, COALESCE(p.code::text,'')
FROM custom_isos ci
LEFT JOIN providers p ON p.id = ci.provider_id
WHERE ci.id=$1 AND ci.organization_id=$2 AND ci.deleted_at IS NULL`, isoID, orgID).
		Scan(&id, &v.ExternalID, &v.Name, &v.SourceURL, &v.SizeBytes,
			&v.Status, &v.RegisterStatus, &v.CreatedAt, &rowProvCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "iso not found"))
		}
		return mw.WriteError(c, err)
	}
	v.ID = &id

	if v.ExternalID != "" {
		if pv, teamScoped, rerr := isoRowProvider(s.prov, rowProvCode); rerr == nil {
			var terr error
			teamExt := ""
			if teamScoped {
				teamExt, terr = providerTeamExternalID(ctx, s.db, orgID)
			}
			if terr == nil {
				if provISOs, perr := pv.ListISOs(ctx, teamExt); perr == nil {
					for _, p := range provISOs {
						if p.ExternalID == v.ExternalID {
							v.Progress = p.ProgressPercent
							v.Status = isoStatusFromProgress(p.ProgressPercent)
							if v.SizeBytes == 0 {
								v.SizeBytes = p.Size
							}
							if v.Filename == "" {
								v.Filename = p.Filename
							}
						}
					}
				}
			}
		}
	}
	return mw.JSON(c, 200, v, nil)
}

func (s *Server) handleDeleteISO(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	isoID, err := uuid.Parse(c.Params("iso_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid iso id"))
	}
	var extID, storageKey, rowProvCode string
	err = s.db.QueryRow(ctx, `
SELECT COALESCE(ci.external_iso_id,''), COALESCE(ci.storage_key,''), COALESCE(p.code::text,'')
FROM custom_isos ci
LEFT JOIN providers p ON p.id = ci.provider_id
WHERE ci.id=$1 AND ci.organization_id=$2 AND ci.deleted_at IS NULL`, isoID, orgID).
		Scan(&extID, &storageKey, &rowProvCode)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "iso not found"))
		}
		return mw.WriteError(c, err)
	}

	tag, err := s.db.Exec(ctx, `
UPDATE custom_isos SET deleted_at=now(), status='deleted', register_status='removed'
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, isoID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "iso not found"))
	}

	if extID != "" {
		// The provider delete call is best-effort: the local soft delete above
		// stays authoritative and sync jobs reconcile any drift. It routes to
		// the adapter owning the row.
		if pv, _, rerr := isoRowProvider(s.prov, rowProvCode); rerr != nil {
			s.log.Warn("iso delete: provider resolve failed", map[string]any{
				"iso_id": isoID.String(), "error": rerr.Error()})
		} else if derr := pv.DeleteISO(ctx, extID); derr != nil {
			s.log.Warn("iso delete: provider call failed", map[string]any{
				"iso_id": isoID.String(), "error": derr.Error()})
		}
	}
	if storageKey != "" {
		// Best-effort removal of the uploaded bytes; the quota is already freed
		// by the soft delete. A leftover object is harmless storage drift.
		if cl, _, cerr := s.objClientFor(ctx, "iso"); cerr == nil {
			if rerr := cl.Remove(ctx, storageKey); rerr != nil {
				s.log.Warn("iso delete: object removal failed", map[string]any{
					"iso_id": isoID.String(), "error": rerr.Error()})
			}
		}
	}

	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

// ---- Custom ISO upload flow ----

// countingReader counts the bytes consumed by PutObject so the streamed size
// can be compared against the multipart-declared size afterwards.
type countingReader struct {
	r io.Reader
	n int64
}

func (cr *countingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	cr.n += int64(n)
	return n, err
}

// sanitizeISOFilename reduces a client-supplied filename to a safe path
// segment: separators and control characters become underscores and the tail
// (extension included) is kept within a bounded length.
func sanitizeISOFilename(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "" || name == "." || name == "/" {
		return "upload.iso"
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '.', r == '-', r == '_', r == '(':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	const maxNameLen = 180
	if len(out) > maxNameLen {
		out = out[len(out)-maxNameLen:]
	}
	return out
}

// enqueueISORegisterJob inserts the durable iso_register_provider job for a
// custom ISO row. Provider pushes are never executed inline: the jobs table
// owns retries and backoff so transient failures stay recoverable.
func enqueueISORegisterJob(ctx context.Context, db *pgxpool.Pool, isoID uuid.UUID) error {
	payload, _ := json.Marshal(map[string]any{"iso_id": isoID.String()})
	_, err := db.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('provisioning','iso_register_provider','custom_iso',$1,$2::jsonb)`,
		isoID, payload)
	return err
}

// handleUploadISO accepts a multipart ISO upload, streams it into internal
// object storage and schedules the provider registration. Validation order:
// configured-storage -> count limit -> total-quota limit -> per-file 15 GiB
// (the latter three inside compute.CheckISOQuota). Uploaded bytes are never
// lost silently: every post-upload failure cleans up the partial object and
// returns an error while the client still holds the original file.
func (s *Server) handleUploadISO(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	userID := mustUserID(c)

	// Storage must be configured before anything else: a stable configuration
	// error beats accepting bytes we cannot persist.
	cl, backendID, err := s.objClientFor(ctx, "iso")
	if err != nil {
		return mw.WriteError(c, err)
	}

	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return mw.WriteError(c, errValidation("file required"))
	}
	declared := fh.Size

	fname := sanitizeISOFilename(fh.Filename)
	name := strings.TrimSpace(c.FormValue("name"))
	if name == "" {
		name = fname
	}

	usage, err := s.isoUsageForUser(ctx, userID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	// Ordered quota checks: count -> total quota -> per-file cap, all against
	// the declared part size before a single byte is moved.
	if err := compute.CheckISOQuota(usage.Count, usage.UsedBytes, declared); err != nil {
		return mw.WriteError(c, err)
	}

	providerID, err := s.orgProviderID(ctx, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	part, err := fh.Open()
	if err != nil {
		return mw.WriteError(c, errValidation("cannot read uploaded file"))
	}
	defer part.Close()

	key := "isos/" + orgID.String() + "/" + uuid.NewString() + "/" + fname
	mime := baseMime(fh.Header.Get("Content-Type"))
	if mime == "" {
		mime = "application/octet-stream"
	}
	cr := &countingReader{r: io.LimitReader(part, declared+1)}
	if _, err := cl.PutObject(ctx, key, cr, declared, mime); err != nil {
		_ = cl.Remove(ctx, key) // drop any partial object; client retries
		return mw.WriteError(c, err)
	}
	if cr.n != declared {
		// Body disagreed with its declared size: reject rather than guess.
		_ = cl.Remove(ctx, key)
		return mw.WriteError(c, vErrField("file", "uploaded bytes do not match the declared file size"))
	}

	obj, err := s.storageSvc.RegisterStoredObject(ctx, storage.RegisterObjectInput{
		StorageBackendID: backendID,
		OrganizationID:   &orgID,
		OwnerUserID:      &userID,
		ObjectKey:        key,
		Purpose:          "custom_iso",
		Filename:         fname,
		MimeType:         mime,
		SizeBytes:        declared,
	})
	if err != nil {
		_ = cl.Remove(ctx, key)
		return mw.WriteError(c, err)
	}

	var isoID uuid.UUID
	err = s.db.QueryRow(ctx, `
INSERT INTO custom_isos(organization_id, provider_id, name, source_object_id,
                        storage_key, size_bytes, status, register_status, created_by)
VALUES ($1,$2,$3,$4,$5,$6,'pending','uploaded',$7)
RETURNING id`, orgID, providerID, name, obj.ID, key, declared, userID).Scan(&isoID)
	if err != nil {
		_ = cl.Remove(ctx, key)
		return mw.WriteError(c, err)
	}

	if jerr := enqueueISORegisterJob(ctx, s.db, isoID); jerr != nil {
		// Row stays 'uploaded' with no live job: exactly the state the retry
		// endpoint accepts, so the registration converges either way.
		s.log.Warn("iso upload: enqueue failed", map[string]any{
			"iso_id": isoID.String(), "error": jerr.Error()})
	}

	usage.Count++
	usage.UsedBytes += declared
	return isoJSONResponse(c, 202, isoView{
		ID:             &isoID,
		Name:           name,
		Filename:       fname,
		SizeBytes:      declared,
		Status:         "pending",
		RegisterStatus: "uploaded",
	}, usage)
}

// handleRetryISO re-enqueues the provider registration for an ISO whose push
// failed, whose registration was never scheduled, or whose registration job
// died without finishing. The stored object is kept intact across failures,
// so retrying never loses bytes.
func (s *Server) handleRetryISO(c fiber.Ctx) error {
	ctx := c.Context()
	orgID := mustOrgID(c)
	isoID, err := uuid.Parse(c.Params("iso_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid iso id"))
	}

	var regStatus string
	err = s.db.QueryRow(ctx, `
SELECT COALESCE(register_status,'') FROM custom_isos
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, isoID, orgID).Scan(&regStatus)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "iso not found"))
		}
		return mw.WriteError(c, err)
	}
	switch regStatus {
	case "failed", "uploaded", "registering":
		// retryable: terminal failure, never scheduled, or a pipeline that
		// stopped before confirming registration.
	default:
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState,
			"iso registration can only be retried while not active or removed"))
	}

	// A queued/retrying job makes the outcome pending; a running job counts as
	// live only while fresh — the worker caps every job at 5 minutes, so an
	// older 'running' row is an abandoned execution and must stay recoverable.
	var live bool
	if err := s.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM jobs
WHERE job_type='iso_register_provider' AND resource_id=$1
  AND (status IN ('queued','retry')
       OR (status='running' AND locked_at > now() - interval '15 minutes')))`,
		isoID).Scan(&live); err != nil {
		return mw.WriteError(c, err)
	}
	if live {
		return mw.WriteError(c, apperrors.New(apperrors.CodeConflict,
			"iso registration already queued or running"))
	}

	if err := enqueueISORegisterJob(ctx, s.db, isoID); err != nil {
		return mw.WriteError(c, err)
	}
	usage, err := s.isoUsageForUser(ctx, mustUserID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return isoJSONResponse(c, 202, fiber.Map{"id": isoID, "status": "retry_queued"}, usage)
}
