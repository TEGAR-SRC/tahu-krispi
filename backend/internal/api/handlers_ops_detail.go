// Admin module (§51): operations drill-down detail views for NOC staff —
// full instance record with every child row (subscription, provider actions,
// jobs, snapshot/backup counters) and full job records.
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Instance detail ----

type admInstanceDetail struct {
	ID                     uuid.UUID  `json:"id"`
	PublicID               string     `json:"public_id"`
	OrganizationID         uuid.UUID  `json:"organization_id"`
	Organization           admOrgRef  `json:"organization"`
	ProviderID             uuid.UUID  `json:"provider_id"`
	ProviderAccountID      *uuid.UUID `json:"provider_account_id"`
	ExternalVMID           string     `json:"external_vm_id"`
	ProductID              *uuid.UUID `json:"product_id"`
	PlanID                 *uuid.UUID `json:"plan_id"`
	SubscriptionID         *uuid.UUID `json:"subscription_id"`
	RegionID               *uuid.UUID `json:"region_id"`
	InstanceTypeID         *uuid.UUID `json:"instance_type_id"`
	OSTemplateID           *uuid.UUID `json:"os_template_id"`
	Name                   string     `json:"name"`
	Hostname               string     `json:"hostname"`
	Status                 string     `json:"status"`
	PowerStatus            string     `json:"power_status"`
	PricingMode            string     `json:"pricing_mode"`
	BillingPeriod          string     `json:"billing_period"`
	Currency               string     `json:"currency"`
	RecurringAmount        float64    `json:"recurring_amount"`
	Vcpu                   int        `json:"vcpu"`
	RamMB                  int        `json:"ram_mb"`
	DiskGB                 int        `json:"disk_gb"`
	AdditionalHDDGB        int        `json:"additional_hdd_gb"`
	BandwidthGB            *int64     `json:"bandwidth_gb"`
	NetworkRateMbps        *int       `json:"network_rate_mbps"`
	PrimaryIPv4            string     `json:"primary_ipv4"`
	PrimaryIPv6            string     `json:"primary_ipv6"`
	BGPEnabled             bool       `json:"bgp_enabled"`
	MeasuredBootEnabled    bool       `json:"measured_boot_enabled"`
	AutoBackupEnabled      bool       `json:"auto_backup_enabled"`
	SyncStatus             string     `json:"sync_status"`
	LastSyncedAt           string     `json:"last_synced_at"`
	ProvisionStartedAt     string     `json:"provision_started_at"`
	ProvisionedAt          string     `json:"provisioned_at"`
	SuspendedAt            string     `json:"suspended_at"`
	TerminationRequestedAt string     `json:"termination_requested_at"`
	TerminatedAt           string     `json:"terminated_at"`
	CreatedBy              string     `json:"created_by"`
	CreatedAt              string     `json:"created_at"`
	UpdatedAt              string     `json:"updated_at"`
	DeletedAt              string     `json:"deleted_at"`

	Subscription    *admSubSummary      `json:"subscription"`
	ProviderActions []admProviderAction `json:"provider_actions"`
	Jobs            []admJobBrief       `json:"jobs"`
	ChildCounts     admChildCounts      `json:"child_counts"`
}

type admOrgRef struct {
	ID       uuid.UUID `json:"id"`
	PublicID string    `json:"public_id"`
	Slug     string    `json:"slug"`
	Name     string    `json:"name"`
}

type admSubSummary struct {
	ID              uuid.UUID `json:"id"`
	PublicID        string    `json:"public_id"`
	Status          string    `json:"status"`
	RecurringAmount float64   `json:"recurring_amount"`
	NextInvoiceAt   string    `json:"next_invoice_at"`
}

type admProviderAction struct {
	ID                 uuid.UUID `json:"id"`
	Action             string    `json:"action"`
	ResourceType       string    `json:"resource_type"`
	ExternalResourceID string    `json:"external_resource_id"`
	Status             string    `json:"status"`
	AttemptCount       int       `json:"attempt_count"`
	ResponseStatus     int       `json:"response_status_code"`
	LastError          string    `json:"last_error"`
	StartedAt          string    `json:"started_at"`
	CompletedAt        string    `json:"completed_at"`
	CreatedAt          string    `json:"created_at"`
}

type admJobBrief struct {
	ID          uuid.UUID `json:"id"`
	Queue       string    `json:"queue"`
	JobType     string    `json:"job_type"`
	Status      string    `json:"status"`
	Attempts    int       `json:"attempts"`
	MaxAttempts int       `json:"max_attempts"`
	RunAfter    string    `json:"run_after"`
	LockedBy    string    `json:"locked_by"`
	LastError   string    `json:"last_error"`
	CreatedAt   string    `json:"created_at"`
	CompletedAt string    `json:"completed_at"`
}

type admChildCounts struct {
	Snapshots int `json:"snapshots"`
	Backups   int `json:"backups"`
}

// handleAdminInstanceDetail returns the entire instances row (including soft-
// deleted records so NOC can post-mortem terminations) plus org name, linked
// subscription summary, latest 50 provider actions, latest 25 jobs and
// non-deleted snapshot/backup counters.
func (s *Server) handleAdminInstanceDetail(c fiber.Ctx) error {
	ctx := c.Context()
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}

	var (
		d           admInstanceDetail
		recurText   string
		subID       *uuid.UUID
		subPublicID string
		subStatus   string
		subRecur    string
		subNextInv  string
	)
	err = s.db.QueryRow(ctx, `
SELECT i.id, i.public_id, i.organization_id, org.id, org.public_id, org.slug::text, org.name,
       i.provider_id, i.provider_account_id, COALESCE(i.external_vm_id,''),
       i.product_id, i.plan_id, i.subscription_id, i.region_id, i.instance_type_id, i.os_template_id,
       i.name, COALESCE(i.hostname,''), i.status::text, COALESCE(i.power_status,''),
       i.pricing_mode::text, i.billing_period::text, i.currency::text, i.recurring_amount::text,
       i.vcpu, i.ram_mb, i.disk_gb, i.additional_hdd_gb, i.bandwidth_gb, i.network_rate_mbps,
       COALESCE(i.primary_ipv4::text,''), COALESCE(i.primary_ipv6::text,''),
       i.bgp_enabled, i.measured_boot_enabled, i.auto_backup_enabled,
       i.sync_status::text, COALESCE(i.last_synced_at::text,''),
       COALESCE(i.provision_started_at::text,''), COALESCE(i.provisioned_at::text,''),
       COALESCE(i.suspended_at::text,''), COALESCE(i.termination_requested_at::text,''),
       COALESCE(i.terminated_at::text,''), COALESCE(i.created_by::text,''),
       i.created_at::text, i.updated_at::text, COALESCE(i.deleted_at::text,''),
       COALESCE(ssub.public_id,''), COALESCE(ssub.status::text,''), COALESCE(ssub.recurring_amount::text,''),
       COALESCE(ssub.next_invoice_at::text,'')
FROM instances i
JOIN organizations org ON org.id = i.organization_id
LEFT JOIN subscriptions ssub ON ssub.id = i.subscription_id
WHERE i.id = $1`, instanceID).
		Scan(&d.ID, &d.PublicID, &d.OrganizationID,
			&d.Organization.ID, &d.Organization.PublicID, &d.Organization.Slug, &d.Organization.Name,
			&d.ProviderID, &d.ProviderAccountID, &d.ExternalVMID,
			&d.ProductID, &d.PlanID, &subID, &d.RegionID, &d.InstanceTypeID, &d.OSTemplateID,
			&d.Name, &d.Hostname, &d.Status, &d.PowerStatus,
			&d.PricingMode, &d.BillingPeriod, &d.Currency, &recurText,
			&d.Vcpu, &d.RamMB, &d.DiskGB, &d.AdditionalHDDGB, &d.BandwidthGB, &d.NetworkRateMbps,
			&d.PrimaryIPv4, &d.PrimaryIPv6,
			&d.BGPEnabled, &d.MeasuredBootEnabled, &d.AutoBackupEnabled,
			&d.SyncStatus, &d.LastSyncedAt,
			&d.ProvisionStartedAt, &d.ProvisionedAt,
			&d.SuspendedAt, &d.TerminationRequestedAt,
			&d.TerminatedAt, &d.CreatedBy,
			&d.CreatedAt, &d.UpdatedAt, &d.DeletedAt,
			&subPublicID, &subStatus, &subRecur, &subNextInv)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
		}
		return mw.WriteError(c, err)
	}
	d.SubscriptionID = subID
	_, _ = fmt.Sscanf(recurText, "%f", &d.RecurringAmount)
	if subID != nil {
		sum := &admSubSummary{ID: *subID, PublicID: subPublicID, Status: subStatus, NextInvoiceAt: subNextInv}
		_, _ = fmt.Sscanf(subRecur, "%f", &sum.RecurringAmount)
		d.Subscription = sum
	}

	rows, err := s.db.Query(ctx, `
SELECT pa.id, pa.action, COALESCE(pa.resource_type,''), COALESCE(pa.external_resource_id,''),
       pa.status::text, pa.attempt_count, COALESCE(pa.response_status_code,0),
       COALESCE(pa.last_error,''), COALESCE(pa.started_at::text,''),
       COALESCE(pa.completed_at::text,''), pa.created_at::text
FROM provider_actions pa
WHERE pa.resource_type='vm' AND pa.internal_resource_id=$1
ORDER BY pa.created_at DESC LIMIT 50`, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	d.ProviderActions = []admProviderAction{}
	for rows.Next() {
		var a admProviderAction
		if err := rows.Scan(&a.ID, &a.Action, &a.ResourceType, &a.ExternalResourceID,
			&a.Status, &a.AttemptCount, &a.ResponseStatus,
			&a.LastError, &a.StartedAt, &a.CompletedAt, &a.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		d.ProviderActions = append(d.ProviderActions, a)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	rows, err = s.db.Query(ctx, `
SELECT j.id, j.queue, j.job_type, j.status, j.attempts, j.max_attempts,
       j.run_after::text, COALESCE(j.locked_by,''), COALESCE(j.last_error,''),
       j.created_at::text, COALESCE(j.completed_at::text,'')
FROM jobs j
WHERE j.resource_type IN ('vm','instance') AND j.resource_id=$1
ORDER BY j.created_at DESC LIMIT 25`, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()
	d.Jobs = []admJobBrief{}
	for rows.Next() {
		var jb admJobBrief
		if err := rows.Scan(&jb.ID, &jb.Queue, &jb.JobType, &jb.Status, &jb.Attempts, &jb.MaxAttempts,
			&jb.RunAfter, &jb.LockedBy, &jb.LastError, &jb.CreatedAt, &jb.CompletedAt); err != nil {
			return mw.WriteError(c, err)
		}
		d.Jobs = append(d.Jobs, jb)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}

	if err := s.db.QueryRow(ctx, `
SELECT (SELECT count(*) FROM snapshots WHERE instance_id=$1 AND deleted_at IS NULL),
       (SELECT count(*) FROM backups   WHERE instance_id=$1)`, instanceID).
		Scan(&d.ChildCounts.Snapshots, &d.ChildCounts.Backups); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, d, nil)
}

// ---- Job detail ----

type admJobDetail struct {
	ID                      uuid.UUID       `json:"id"`
	Queue                   string          `json:"queue"`
	JobType                 string          `json:"job_type"`
	OrganizationID          *uuid.UUID      `json:"organization_id"`
	ResourceType            string          `json:"resource_type"`
	ResourceID              string          `json:"resource_id"`
	Payload                 json.RawMessage `json:"payload"`
	Status                  string          `json:"status"`
	Attempts                int             `json:"attempts"`
	MaxAttempts             int             `json:"max_attempts"`
	RunAfter                string          `json:"run_after"`
	LockedBy                string          `json:"locked_by"`
	LockedAt                string          `json:"locked_at"`
	LastError               string          `json:"last_error"`
	CreatedAt               string          `json:"created_at"`
	UpdatedAt               string          `json:"updated_at"`
	CompletedAt             string          `json:"completed_at"`
	RelatedInstancePublicID string          `json:"related_instance_public_id"`
}

// handleAdminJobDetail returns the entire jobs row with pretty-printed payload
// JSON and the related instance public_id when resource_type='vm'/'instance'
// and resource_id resolves.
func (s *Server) handleAdminJobDetail(c fiber.Ctx) error {
	ctx := c.Context()
	jobID, err := admParseUUIDParam(c, "job_id", "job_id")
	if err != nil {
		return mw.WriteError(c, err)
	}

	var (
		d           admJobDetail
		payloadText string
	)
	err = s.db.QueryRow(ctx, `
SELECT j.id, j.queue, j.job_type, j.organization_id, COALESCE(j.resource_type,''),
       COALESCE(j.resource_id::text,''), j.payload::text, j.status,
       j.attempts, j.max_attempts, j.run_after::text, COALESCE(j.locked_by,''),
       COALESCE(j.locked_at::text,''), COALESCE(j.last_error,''),
       j.created_at::text, j.updated_at::text, COALESCE(j.completed_at::text,'')
FROM jobs j WHERE j.id=$1`, jobID).
		Scan(&d.ID, &d.Queue, &d.JobType, &d.OrganizationID, &d.ResourceType,
			&d.ResourceID, &payloadText, &d.Status,
			&d.Attempts, &d.MaxAttempts, &d.RunAfter, &d.LockedBy,
			&d.LockedAt, &d.LastError,
			&d.CreatedAt, &d.UpdatedAt, &d.CompletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "job not found"))
		}
		return mw.WriteError(c, err)
	}

	// jsonb from Postgres is always valid JSON; indent it for readability.
	var buf bytes.Buffer
	if err := json.Indent(&buf, []byte(payloadText), "", "  "); err == nil {
		d.Payload = buf.Bytes()
	} else {
		d.Payload = json.RawMessage(payloadText)
	}

	if d.ResourceType == "vm" || d.ResourceType == "instance" {
		if resourceID, perr := uuid.Parse(d.ResourceID); perr == nil {
			var publicID string
			qerr := s.db.QueryRow(ctx,
				`SELECT public_id FROM instances WHERE id=$1`, resourceID).Scan(&publicID)
			switch {
			case qerr == nil:
				d.RelatedInstancePublicID = publicID
			case !errors.Is(qerr, pgx.ErrNoRows):
				return mw.WriteError(c, qerr)
			}
		}
	}

	return mw.JSON(c, 200, d, nil)
}
