package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/compute"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

type provisionInput struct {
	Name            string   `json:"name"`
	PaymentCycle    string   `json:"payment_cycle"`
	Currency        string   `json:"currency"`
	BillingPeriod   string   `json:"billing_period"`
	RecurringAmount float64  `json:"recurring_amount"`
	InstanceTypeID  string   `json:"instance_type_id"`
	RegionID        string   `json:"region_id"`
	Vcpu            int      `json:"cpu"`
	RamMB           int      `json:"ram"`
	DiskGB          int      `json:"disk"`
	SSHKeyIDs       []string `json:"ssh_keys"`
	VPCIDs          []string `json:"vpcs"`
}

func (s *Server) handleProvisionInstance(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	var in provisionInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" {
		return mw.WriteError(c, errValidation("name required"))
	}
	pin := compute.ProvisionInput{
		OrganizationID: orgID, CreatedBy: userID,
		Name: in.Name, PaymentCycle: in.PaymentCycle,
		Currency: upper(in.Currency), BillingPeriod: lower(in.BillingPeriod),
		RecurringAmount: in.RecurringAmount,
		Vcpu:            in.Vcpu, RamMB: in.RamMB, DiskGB: in.DiskGB,
	}
	if id, err := uuid.Parse(in.InstanceTypeID); err == nil {
		pin.InstanceTypeID = id
	}
	if id, err := uuid.Parse(in.RegionID); err == nil {
		pin.RegionID = &id
	}
	inst, err := s.computeSvc.Provision(c.Context(), pin)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, inst, nil)
}

func (s *Server) handleListInstances(c fiber.Ctx) error {
	out, err := s.computeSvc.ListByOrg(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

// instanceChildCounts exposes non-deleted child resource counts on the
// customer-facing instance detail response.
type instanceChildCounts struct {
	Snapshots int `json:"snapshots"`
	Backups   int `json:"backups"`
}

// instanceDetailResponse enriches compute.Instance with subscription linkage
// and child counts; the embedded pointer flattens its fields into the JSON.
type instanceDetailResponse struct {
	*compute.Instance
	SubscriptionID string              `json:"subscription_id"`
	BillingPeriod  string              `json:"billing_period"`
	ChildCounts    instanceChildCounts `json:"child_counts"`
}

func (s *Server) handleGetInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	orgID := mustOrgID(c)
	out, err := s.computeSvc.GetByIDAndOrg(c.Context(), id, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	snapshots, backups, err := s.computeSvc.CountSnapshotsForInstance(c.Context(), id, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var subID, billingPeriod string
	if err := s.db.QueryRow(c.Context(),
		`SELECT COALESCE(subscription_id::text,''), billing_period::text
		 FROM instances WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
		id, orgID).Scan(&subID, &billingPeriod); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, instanceDetailResponse{
		Instance:       out,
		SubscriptionID: subID,
		BillingPeriod:  billingPeriod,
		ChildCounts:    instanceChildCounts{Snapshots: snapshots, Backups: backups},
	}, nil)
}

type updateInstanceInput struct {
	Name string `json:"name"`
}

func (s *Server) handleUpdateInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var in updateInstanceInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" {
		return mw.WriteError(c, errValidation("name required"))
	}
	if err := s.computeSvc.Rename(c.Context(), id, mustOrgID(c), in.Name); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "renamed"}, nil)
}

func (s *Server) handleTerminateInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	if err := s.computeSvc.Terminate(c.Context(), id, mustOrgID(c), mustUserID(c)); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

func (s *Server) handleStopInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var body struct {
		Force bool `json:"force_stop"`
	}
	_ = c.Bind().Body(&body)
	if err := s.computeSvc.Action(c.Context(), id, mustOrgID(c), mustUserID(c), "stop", body.Force); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "stopping"}, nil)
}

func (s *Server) handleRebootInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var body struct {
		Force bool `json:"force_stop"`
	}
	_ = c.Bind().Body(&body)
	if err := s.computeSvc.Action(c.Context(), id, mustOrgID(c), mustUserID(c), "reboot", body.Force); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "rebooting"}, nil)
}

func (s *Server) handleStartInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	if err := s.computeSvc.Action(c.Context(), id, mustOrgID(c), mustUserID(c), "start", false); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "starting"}, nil)
}

// resizeInput follows the provisioning unit convention: cpu is vCPU count,
// ram is MB, disk is GB.
type resizeInput struct {
	CPU  int64 `json:"cpu"`
	RAM  int64 `json:"ram"`
	Disk int64 `json:"disk"`
}

func (s *Server) handleResizeInstance(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var in resizeInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid resize payload"))
	}
	orgID := mustOrgID(c)
	userID := mustUserID(c)
	inst, err := s.computeSvc.Resize(c.Context(), id, orgID, userID,
		compute.TargetSpec{CPU: in.CPU, RAMMB: in.RAM, DiskGB: in.Disk})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.auditSvc.Log(c.Context(), auditEntry(c, orgID, &userID, "instance.resize", "instance", inst.ID,
		map[string]any{"vcpu": inst.Vcpu, "ram_mb": inst.RamMB, "disk_gb": inst.DiskGB}))
	return mw.JSON(c, 200, inst, nil)
}

// ---- Snapshots & Backups ----

type snapshotInput struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
}

func (s *Server) handleCreateSnapshot(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var in snapshotInput
	if err := c.Bind().Body(&in); err != nil || in.Name == "" {
		return mw.WriteError(c, errValidation("snapshot name required"))
	}
	snap, err := s.computeSvc.CreateSnapshot(c.Context(), instanceID, mustOrgID(c), mustUserID(c), in.Name, in.Desc)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, snap, nil)
}

func (s *Server) handleListSnapshots(c fiber.Ctx) error {
	out, err := s.computeSvc.ListSnapshots(c.Context(), mustOrgID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleDeleteSnapshot(c fiber.Ctx) error {
	snapshotID, err := uuid.Parse(c.Params("snapshot_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid snapshot id"))
	}
	if err := s.computeSvc.DeleteSnapshot(c.Context(), snapshotID, mustOrgID(c)); err != nil {
		return mw.WriteError(c, err)
	}
	return c.SendStatus(204)
}

func (s *Server) handleRestoreSnapshot(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var body struct {
		SnapshotID string `json:"snapshot_id"`
	}
	if err := c.Bind().Body(&body); err != nil || body.SnapshotID == "" {
		return mw.WriteError(c, errValidation("snapshot_id required"))
	}
	snapID, err := uuid.Parse(body.SnapshotID)
	if err != nil {
		return mw.WriteError(c, vErrField("snapshot_id", "invalid uuid"))
	}
	if err := s.computeSvc.RestoreFromSnapshot(c.Context(), instanceID, snapID, mustOrgID(c)); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "restore_started"}, nil)
}

func (s *Server) handleRestoreBackup(c fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid instance id"))
	}
	var body struct {
		BackupID string `json:"backup_id"`
	}
	if err := c.Bind().Body(&body); err != nil || body.BackupID == "" {
		return mw.WriteError(c, errValidation("backup_id required"))
	}
	backupID, err := uuid.Parse(body.BackupID)
	if err != nil {
		return mw.WriteError(c, vErrField("backup_id", "invalid uuid"))
	}
	if err := s.computeSvc.RestoreFromBackup(c.Context(), instanceID, backupID, mustOrgID(c)); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "restore_started"}, nil)
}

func (s *Server) handleListBackups(c fiber.Ctx) error {
	orgID := mustOrgID(c)
	out, err := s.computeSvc.ListBackups(c.Context(), orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	// Optional ?instance_id=uuid narrows the result to one instance.
	if instStr := c.Query("instance_id"); instStr != "" {
		instID, perr := uuid.Parse(instStr)
		if perr != nil {
			return mw.WriteError(c, vErrField("instance_id", "invalid uuid"))
		}
		if _, verr := s.computeSvc.GetByIDAndOrg(c.Context(), instID, orgID); verr != nil {
			return mw.WriteError(c, verr)
		}
		filtered := make([]compute.Backup, 0, len(out))
		for _, b := range out {
			if b.InstanceID == instID {
				filtered = append(filtered, b)
			}
		}
		out = filtered
	}
	return mw.JSON(c, 200, out, nil)
}

func (s *Server) handleGenSnapshotURL(c fiber.Ctx) error {
	snapshotID, err := uuid.Parse(c.Params("snapshot_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid snapshot id"))
	}
	url, err := s.computeSvc.GenerateSnapshotDownloadLink(c.Context(), snapshotID, mustOrgID(c), mustUserID(c))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"url": url}, nil)
}

// backupProvider resolves the adapter owning a backups row together with its
// provider-side external id, enforcing the same organization ownership rule
// GenerateBackupDownloadLink applies (id + organization_id match; the backups
// table has no soft delete). The same adapter convention as instanceProvider:
// providers.code lowercased before the registry lookup.
func (s *Server) backupProvider(ctx context.Context, backupID, orgID uuid.UUID) (provider.ComputeProvider, string, error) {
	var code string
	var ext *string
	err := s.db.QueryRow(ctx, `
SELECT p.code, b.external_backup_id
FROM backups b JOIN providers p ON p.id = b.provider_id
WHERE b.id=$1 AND b.organization_id=$2`, backupID, orgID).Scan(&code, &ext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", apperrors.New(apperrors.CodeNotFound, "backup not found")
		}
		return nil, "", err
	}
	pv, err := provider.Lookup(strings.ToLower(code)) // citext may preserve case; registry keys are lowercase
	if err != nil {
		return nil, "", err
	}
	extID := ""
	if ext != nil {
		extID = *ext
	}
	return pv, extID, nil
}

// attachmentFilename derives the Content-Disposition filename from a PVE-style
// backup volid ("<storage>:backup/<file>"): the raw file name with path
// separators, quotes and control characters flattened so the header value
// stays well-formed.
func attachmentFilename(volid string) string {
	name := volid
	if _, rest, ok := strings.Cut(name, ":"); ok {
		name = rest // drop "<storage>:"
	}
	if i := strings.LastIndexByte(name, '/'); i >= 0 {
		name = name[i+1:] // drop "backup/" and any stray path prefix
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case r < 0x20, r == 0x7f, r == '"', r == '\\':
			return '_'
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." {
		return "backup"
	}
	return name
}

// loggingBackupStream surfaces the first read failure of a pumped backup
// stream to the server log. fasthttp drains the body stream only after the
// handler has returned and the status is already on the wire, so the error can
// no longer flow through WriteError — logging is the only signal left.
type loggingBackupStream struct {
	io.ReadCloser
	onErr func(error)
	done  bool
}

func (r *loggingBackupStream) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if err != nil && !r.done && !errors.Is(err, io.EOF) {
		r.done = true
		r.onErr(err)
	}
	return n, err
}

func (s *Server) handleGenBackupURL(c fiber.Ctx) error {
	backupID, err := uuid.Parse(c.Params("backup_id"))
	if err != nil {
		return mw.WriteError(c, errValidation("invalid backup id"))
	}
	orgID := mustOrgID(c)
	pv, extID, err := s.backupProvider(c.Context(), backupID, orgID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	opener, ok := pv.(provider.BackupContentOpener)
	if !ok {
		// Providers with presigned URLs keep the existing link flow untouched.
		url, err := s.computeSvc.GenerateBackupDownloadLink(c.Context(), backupID, orgID, mustUserID(c))
		if err != nil {
			return mw.WriteError(c, err)
		}
		return mw.JSON(c, 200, fiber.Map{"url": url}, nil)
	}
	// No upstream URL exists (e.g. PVE token-authenticated downloads): stream
	// the raw backup content through this backend instead of generating one.
	rc, size, err := opener.OpenBackupContent(c.Context(), extID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	// Ownership transfers here: fasthttp drains the body stream after the
	// handler returns and closes it on both success and interrupted paths
	// (writeBodyStream -> closeBodyStream), so no defer Close — a close at
	// handler return would land before serialization. Nothing fallible sits
	// between OpenBackupContent and SetBodyStream, so the reader cannot leak.
	resp := c.Response()
	bodyLen := -1
	if size >= 0 {
		bodyLen = int(size)
	}
	resp.SetBodyStream(&loggingBackupStream{
		ReadCloser: rc,
		onErr: func(serr error) {
			s.log.Error("backup download: stream interrupted", map[string]any{"error": serr.Error()})
		},
	}, bodyLen)
	resp.Header.SetContentType("application/octet-stream")
	resp.Header.Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, attachmentFilename(extID)))
	return nil
}
