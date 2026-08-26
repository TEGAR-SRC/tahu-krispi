// Package compute implements VM instance lifecycle management.
package compute

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"kilat.cloud/backend/internal/pricing"
	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

type Service struct {
	db       *pgxpool.Pool
	provider provider.ComputeProvider
	// pricing reprices the linked custom subscription after a spec change
	// (see Resize); the worker passes its own instance, resize is never run
	// from background jobs.
	pricing *pricing.Service
	// baseURL is the public download host used for generated snapshot/backup
	// links; defaults to DownloadBaseURL default when constructed via NewService.
	baseURL string
}

// NewService accepts the provider abstraction so future providers (Proxmox,
// XCP-ng, VMware) plug in without touching this business layer.
func NewService(db *pgxpool.Pool, prov provider.ComputeProvider, ps *pricing.Service) *Service {
	return &Service{db: db, provider: prov, pricing: ps, baseURL: "https://dl.kilat-cloud.com"}
}

// ProviderRecord resolves the enabled Onidel provider row from DB.
func (s *Service) resolveProvider(ctx context.Context) (providerID uuid.UUID, err error) {
	err = s.db.QueryRow(ctx, `
SELECT id FROM providers WHERE kind='onidel' AND enabled LIMIT 1`).Scan(&providerID)
	if err != nil {
		return uuid.Nil, apperrors.New(apperrors.CodeProviderUnavailable, "onidel provider not configured")
	}
	return providerID, nil
}

// providerFor resolves the enabled ComputeProvider bound to a providers row id
// (multi-provider routing; instances carry their own provider_id).
func (s *Service) providerFor(ctx context.Context, provID uuid.UUID) (provider.ComputeProvider, error) {
	var code string
	err := s.db.QueryRow(ctx,
		`SELECT code::text FROM providers WHERE id=$1 AND enabled`, provID).Scan(&code)
	if err != nil {
		return nil, apperrors.New(apperrors.CodeProviderUnavailable, "provider not available for this instance")
	}
	return provider.Lookup(code)
}

// resolveExternalTeamID maps an organization to its Onidel team.
func (s *Service) resolveExternalTeamID(ctx context.Context, orgID, providerID uuid.UUID) (string, error) {
	var ext string
	err := s.db.QueryRow(ctx, `
SELECT external_account_id FROM provider_accounts
WHERE organization_id=$1 AND provider_id=$2 AND external_account_id IS NOT NULL`, orgID, providerID).Scan(&ext)
	if err != nil {
		return "", apperrors.New(apperrors.CodeConflict, "organization not mapped to onidel team; contact admin")
	}
	return ext, nil
}

type ProvisionInput struct {
	OrganizationID  uuid.UUID
	CreatedBy       uuid.UUID
	OrderItemID     *uuid.UUID
	SubscriptionID  *uuid.UUID
	Name            string
	PaymentCycle    string
	Currency        string
	RecurringAmount float64
	BillingPeriod   string

	InstanceTypeID  uuid.UUID
	RegionID        *uuid.UUID
	LocationCode    string
	Vcpu            int
	RamMB           int
	DiskGB          int
	OSTemplateID    *uuid.UUID // internal os_templates.id, resolved to the provider external id by the worker
	OSTemplateExtID *int64     // Onidel numeric OS ID (shortcut when already known)
	SnapshotID      *uuid.UUID
	IsoID           *uuid.UUID
	SSHKeyIDs       []uuid.UUID
	VPCIDs          []uuid.UUID
	FirewallGroupID *uuid.UUID
	StartupScriptID *uuid.UUID
	IPv6            bool

	// ServiceKind selects the provisioned guest class: 'vm' (default) or
	// 'container' (LXC, executed by the worker via ProvisionContainer).
	ServiceKind string
}

// Provision records a new pending instance in Kilat Cloud and enqueues the actual Onidel call via jobs table.
func (s *Service) Provision(ctx context.Context, in ProvisionInput) (*Instance, error) {
	if in.Vcpu <= 0 || in.RamMB <= 0 || in.DiskGB <= 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "vcpu/ram/disk must be positive")
	}
	// Resource limits gate hourly (on-demand) provisioning before any provider
	// call or instances row is written; see resource_limits.go.
	if err := s.enforceHourlyLimits(ctx, in); err != nil {
		return nil, err
	}
	var providerID uuid.UUID
	if in.RegionID != nil {
		// DB-driven routing: the chosen region belongs to exactly one provider
		// (Onidel region -> onidel, Proxmox region/node -> proxmox cluster).
		err := s.db.QueryRow(ctx,
			`SELECT r.provider_id FROM regions r WHERE r.id=$1 AND r.enabled`, *in.RegionID).Scan(&providerID)
		if err != nil {
			return nil, apperrors.New(apperrors.CodeRegionUnavailable, "region not found or disabled")
		}
	} else {
		var derr error
		providerID, derr = s.resolveProvider(ctx)
		if derr != nil {
			return nil, derr
		}
	}
	pv, err := s.providerFor(ctx, providerID)
	if err != nil {
		return nil, err
	}
	_ = pv // job executor re-resolves via providerFor(instance.provider_id); VMs and
	// containers alike are executed there (ProvisionVM / ProvisionContainer)
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	inst := Instance{}
	err = tx.QueryRow(ctx, `
INSERT INTO instances(organization_id, provider_id, subscription_id,
                      region_id, instance_type_id, os_template_id,
                      name, status, pricing_mode, billing_period, currency, recurring_amount,
                      vcpu, ram_mb, disk_gb,
                      primary_ipv4, primary_ipv6,
                      provider_payload, created_by, service_kind)
VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','custom_resource',NULLIF($8,'')::billing_period,$9,$10,$11,$12,$13,
        NULL,NULL,$14::jsonb,$15,NULLIF($16,'')::service_kind)
RETURNING id, public_id`,
		in.OrganizationID, providerID, nullUUID(in.SubscriptionID),
		nullUUID(in.RegionID), nullUUIDPtr(&in.InstanceTypeID), nullUUID(in.OSTemplateID), in.Name,
		in.BillingPeriod, orDefault(in.Currency, "IDR"), in.RecurringAmount,
		in.Vcpu, in.RamMB, in.DiskGB, provisionSpecPayload(in), in.CreatedBy,
		orDefault(in.ServiceKind, "vm")).
		Scan(&inst.ID, &inst.PublicID)
	if err != nil {
		return nil, fmt.Errorf("insert instance: %w", err)
	}
	payload, _ := json.Marshal(map[string]any{
		"instance_id": inst.ID.String(),
	})
	if _, err = tx.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload)
VALUES ('provisioning','provision_instance','instance',$1,$2::jsonb)`, inst.ID, payload); err != nil {
		return nil, fmt.Errorf("enqueue provision job: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	// Return the fully hydrated row (name/spec/status), not just the two
	// columns returned by the INSERT.
	if out, gerr := s.GetByIDAndOrg(ctx, inst.ID, in.OrganizationID); gerr == nil {
		return out, nil
	}
	return &inst, nil
}

func nullUUID(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func nullUUIDPtr(u *uuid.UUID) any {
	if u == nil || *u == uuid.Nil {
		return nil
	}
	return *u
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func nullUUID2(u *uuid.UUID) any { return nullUUID(u) }

// provisionSpecPayload serializes the full provisioning spec into the
// instances.provider_payload JSONB column so the worker can resolve every
// internal reference (OS template, snapshot, ISO, SSH keys, VPCs, firewall
// group, startup script) to its provider external id at execution time.
func provisionSpecPayload(in ProvisionInput) []byte {
	spec := map[string]any{
		"ipv6": in.IPv6,
	}
	if in.OSTemplateID != nil {
		spec["os_template_id"] = in.OSTemplateID.String()
	}
	if in.SnapshotID != nil {
		spec["snapshot_id"] = in.SnapshotID.String()
	}
	if in.IsoID != nil {
		spec["iso_id"] = in.IsoID.String()
	}
	if len(in.SSHKeyIDs) > 0 {
		ids := make([]string, 0, len(in.SSHKeyIDs))
		for _, id := range in.SSHKeyIDs {
			ids = append(ids, id.String())
		}
		spec["ssh_keys"] = ids
	}
	if len(in.VPCIDs) > 0 {
		ids := make([]string, 0, len(in.VPCIDs))
		for _, id := range in.VPCIDs {
			ids = append(ids, id.String())
		}
		spec["vpcs"] = ids
	}
	if in.FirewallGroupID != nil {
		spec["firewall_group_id"] = in.FirewallGroupID.String()
	}
	if in.StartupScriptID != nil {
		spec["startup_script_id"] = in.StartupScriptID.String()
	}
	b, _ := json.Marshal(spec)
	return b
}

type Region struct {
	ID         uuid.UUID
	ExternalID string
}

func (s *Service) resolveRegion(ctx context.Context, code string) (*Region, error) {
	row := s.db.QueryRow(ctx, `SELECT id, COALESCE(external_id,'') FROM regions WHERE code=$1 AND enabled LIMIT 1`, code)
	var r Region
	if err := row.Scan(&r.ID, &r.ExternalID); err != nil {
		return nil, apperrors.New(apperrors.CodeRegionUnavailable, "region not found")
	}
	return &r, nil
}

type Instance struct {
	ID              uuid.UUID `json:"id"`
	PublicID        string    `json:"public_id"`
	OrganizationID  uuid.UUID `json:"organization_id"`
	ProviderID      uuid.UUID `json:"provider_id"`
	Name            string    `json:"name"`
	Status          string    `json:"status"`
	ServiceKind     string    `json:"service_kind"`
	PowerStatus     string    `json:"power_status"`
	Vcpu            int       `json:"vcpu"`
	RamMB           int       `json:"ram_mb"`
	DiskGB          int       `json:"disk_gb"`
	BandwidthGB     *int64    `json:"bandwidth_gb"`
	PrimaryIPv4     string    `json:"primary_ipv4"`
	PrimaryIPv6     string    `json:"primary_ipv6"`
	Currency        string    `json:"currency"`
	RecurringAmount float64   `json:"recurring_amount"`
	CreatedAt       string    `json:"created_at"`
}

const selectInstanceCols = `
SELECT id, public_id, organization_id, provider_id, name, status::text, service_kind::text,
       COALESCE(power_status,''),
       vcpu, ram_mb, disk_gb, bandwidth_gb,
       COALESCE(primary_ipv4::text,''), COALESCE(primary_ipv6::text,''),
       currency::text, recurring_amount::text, created_at::text
FROM instances WHERE deleted_at IS NULL`

func scanInstance(row interface{ Scan(...any) error }) (*Instance, error) {
	var i Instance
	var recurStr string
	var bw *int64
	err := row.Scan(&i.ID, &i.PublicID, &i.OrganizationID, &i.ProviderID, &i.Name, &i.Status, &i.ServiceKind,
		&i.PowerStatus,
		&i.Vcpu, &i.RamMB, &i.DiskGB, &bw,
		&i.PrimaryIPv4, &i.PrimaryIPv6, &i.Currency, &recurStr, &i.CreatedAt)
	if err != nil {
		return nil, err
	}
	i.BandwidthGB = bw
	fmt.Sscanf(recurStr, "%f", &i.RecurringAmount)
	return &i, nil
}

func (s *Service) GetByIDAndOrg(ctx context.Context, id, orgID uuid.UUID) (*Instance, error) {
	i, err := scanInstance(s.db.QueryRow(ctx, selectInstanceCols+` AND id=$1 AND organization_id=$2`, id, orgID))
	if err != nil && isNoRows(err) {
		return nil, apperrors.New(apperrors.CodeNotFound, "instance not found")
	}
	return i, err
}

// byID loads any non-deleted instance regardless of organization (internal use).
func (s *Service) byID(ctx context.Context, id uuid.UUID) (*Instance, error) {
	return scanInstance(s.db.QueryRow(ctx, selectInstanceCols+` AND id=$1`, id))
}

// CountSnapshotsForInstance returns (snapshotCount, backupCount) for an
// org-scoped instance. Snapshots are soft-deleted (deleted_at IS NULL);
// backups have no deleted_at column, so every row referencing the instance
// counts.
func (s *Service) CountSnapshotsForInstance(ctx context.Context, instanceID, orgID uuid.UUID) (int, int, error) {
	var snapshots, backups int
	err := s.db.QueryRow(ctx, `
SELECT (SELECT count(*) FROM snapshots WHERE instance_id=$1 AND organization_id=$2 AND deleted_at IS NULL),
       (SELECT count(*) FROM backups   WHERE instance_id=$1 AND organization_id=$2)`,
		instanceID, orgID).Scan(&snapshots, &backups)
	return snapshots, backups, err
}

func (s *Service) ListByOrg(ctx context.Context, orgID uuid.UUID) ([]Instance, error) {
	rows, err := s.db.Query(ctx, selectInstanceCols+` AND organization_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Instance
	for rows.Next() {
		i, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

// Action performs stop/reboot/etc. and records a provider_action row.
func (s *Service) Action(ctx context.Context, instanceID, orgID, userID uuid.UUID, action string, force bool) error {
	i, err := s.GetByIDAndOrg(ctx, instanceID, orgID)
	if err != nil {
		return err
	}
	if i.Status == "deleted" || i.Status == "deleting" {
		return apperrors.New(apperrors.CodeInvalidState, "cannot perform action on deleted instance")
	}
	extVM, err := s.requireExternalVMID(ctx, instanceID)
	if err != nil {
		return err
	}
	pv, err := s.providerFor(ctx, i.ProviderID)
	if err != nil {
		return err
	}
	providerID := i.ProviderID
	orgIDAny := orgID
	actionID := uuid.New()
	// Container guests reuse the same provider_actions trail under their own
	// resource_type/action prefix; the external id column already stores the
	// "ct<vmid>" id for them.
	resType, actName := "vm", "vm_"+action
	if i.ServiceKind == "container" {
		resType, actName = "container", "container_"+action
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             status, started_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',now())`,
		actionID, providerID, orgIDAny, userID, actName, resType, instanceID, extVM); err != nil {
		return err
	}
	switch {
	case i.ServiceKind == "container":
		switch action {
		case "start":
			err = pv.StartContainer(ctx, extVM)
		case "stop":
			err = pv.StopContainer(ctx, extVM, force)
		case "reboot":
			err = pv.RebootContainer(ctx, extVM)
		default:
			err = apperrors.New(apperrors.CodeValidation,
				"action \""+action+"\" does not apply to containers")
		}
	default:
		switch action {
		case "stop":
			err = pv.StopVM(ctx, extVM, force)
		case "reboot":
			err = pv.RebootVM(ctx, extVM, force)
		case "start":
			err = pv.StartVM(ctx, extVM)
		case "reset":
			err = pv.ResetVM(ctx, extVM)
		case "pause":
			err = pv.PauseVM(ctx, extVM)
		case "resume":
			err = pv.ResumeVM(ctx, extVM)
		case "hibernate":
			err = pv.HibernateVM(ctx, extVM)
		default:
			err = apperrors.New(apperrors.CodeValidation, "unsupported action")
		}
	}
	status := "success"
	lastErr := ""
	if err != nil {
		status = "failed"
		lastErr = err.Error()
	}
	_, _ = s.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(), last_error=NULLIF($3,'')
WHERE id=$1`, actionID, status, lastErr)
	return err
}

func (s *Service) requireExternalVMID(ctx context.Context, instanceID uuid.UUID) (string, error) {
	var ext string
	err := s.db.QueryRow(ctx, `
SELECT external_vm_id FROM instances WHERE id=$1 AND external_vm_id IS NOT NULL`, instanceID).Scan(&ext)
	if err != nil {
		return "", apperrors.New(apperrors.CodeConflict, "instance has no provider mapping yet")
	}
	return ext, nil
}

// Terminate soft-deletes the instance and calls provider destroy.
func (s *Service) Terminate(ctx context.Context, instanceID, orgID, userID uuid.UUID) error {
	i, err := s.GetByIDAndOrg(ctx, instanceID, orgID)
	if err != nil {
		return err
	}
	if i.Status == "deleted" || i.Status == "deleting" {
		return apperrors.New(apperrors.CodeInvalidState, "already terminated")
	}
	extVM, err := s.requireExternalVMID(ctx, instanceID)
	if err != nil {
		return err
	}
	pv, err := s.providerFor(ctx, i.ProviderID)
	if err != nil {
		return err
	}
	providerID := i.ProviderID
	actName := "vm_destroy"
	if i.ServiceKind == "container" {
		actName = "container_destroy"
	}
	if _, err := s.db.Exec(ctx, `
UPDATE instances SET termination_requested_at=now(), status='deleting' WHERE id=$1`, instanceID); err != nil {
		return err
	}
	actionID := uuid.New()
	if _, err := s.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             status, started_at)
VALUES ($1,$2,$3,$4,$5,'vm',$6,$7,'running',now())`,
		actionID, providerID, orgID, userID, actName, instanceID, extVM); err != nil {
		return err
	}
	if i.ServiceKind == "container" {
		err = pv.DestroyContainer(ctx, extVM)
	} else {
		err = pv.DestroyVM(ctx, extVM)
	}
	status := "success"
	lastErr := ""
	if err != nil {
		status = "failed"
		lastErr = err.Error()
	}
	_, _ = s.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(), last_error=NULLIF($3,'')
WHERE id=$1`, actionID, status, lastErr)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
UPDATE instances SET terminated_at=now(), deleted_at=now(), status='deleted' WHERE id=$1`, instanceID)
	return err
}

// Rename changes the display name of an instance.
func (s *Service) Rename(ctx context.Context, instanceID, orgID uuid.UUID, newName string) error {
	tag, err := s.db.Exec(ctx, `
UPDATE instances SET name=$3 WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, instanceID, orgID, newName)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "instance not found")
	}
	return nil
}

// SyncFromProvider refreshes local state from the owning provider for one instance.
func (s *Service) SyncFromProvider(ctx context.Context, instanceID uuid.UUID) error {
	i, err := s.byID(ctx, instanceID)
	if err != nil {
		return err
	}
	extVM, err := s.requireExternalVMID(ctx, instanceID)
	if err != nil {
		return err
	}
	pv, err := s.providerFor(ctx, i.ProviderID)
	if err != nil {
		return err
	}
	vmState, err := pv.GetVM(ctx, extVM)
	if err != nil {
		return err
	}
	kcStatus := mapOnidelStatus(vmState.Status)
	_, err = s.db.Exec(ctx, `
UPDATE instances SET status=$2::resource_status, power_status=$3, primary_ipv4=NULLIF($4,'')::inet,
                     primary_ipv6=NULLIF($5,'')::inet, sync_status='synced',
                     last_synced_at=$6, provider_payload=jsonb_build_object('raw_status',$7)
WHERE id=$1`,
		instanceID, kcStatus, vmState.Status, vmState.MainIPv4, vmState.MainIPv6, time.Now(), vmState.Status)
	return err
}

func mapOnidelStatus(status string) string {
	switch status {
	case "building":
		return "provisioning"
	case "active":
		return "active"
	case "suspended":
		return "suspended"
	case "awaiting_payment":
		return "pending"
	case "terminating":
		return "deleting"
	default:
		return "unknown"
	}
}

func isNoRows(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	target := "no rows in result set"
	n := len(target)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == target {
			return true
		}
	}
	return false
}
