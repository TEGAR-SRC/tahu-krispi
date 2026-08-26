// Admin module (§51): platform operations — instances, jobs, orphans, security,
// blocked networks, feature flags and app settings.
package api

import (
	"encoding/json"
	"net"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
	httputil "kilat.cloud/backend/pkg/httputil"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ---- Instances ----

type admInstanceRow struct {
	ID                     uuid.UUID `json:"id"`
	PublicID               string    `json:"public_id"`
	OrganizationID         uuid.UUID `json:"organization_id"`
	OrgPublicID            string    `json:"org_public_id"`
	OrgSlug                string    `json:"org_slug"`
	Name                   string    `json:"name"`
	Status                 string    `json:"status"`
	PowerStatus            string    `json:"power_status"`
	Vcpu                   int       `json:"vcpu"`
	RamMB                  int       `json:"ram_mb"`
	DiskGB                 int       `json:"disk_gb"`
	SuspendedAt            string    `json:"suspended_at"`
	TerminationRequestedAt string    `json:"termination_requested_at"`
	CreatedAt              string    `json:"created_at"`
}

func (s *Server) adminListInstances(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admResourceStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid resource status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND i.status=$" + admPlaceholder(len(args))
	}
	orgFilter, args, err := admOrgFilter("i.organization_id", c.Query("organization_id"), args)
	if err != nil {
		return mw.WriteError(c, err)
	}
	where += orgFilter

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM instances i WHERE i.deleted_at IS NULL`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT i.id, i.public_id, i.organization_id, org.public_id, org.slug::text,
       i.name, i.status::text, COALESCE(i.power_status,''), i.vcpu, i.ram_mb, i.disk_gb,
       COALESCE(i.suspended_at::text,''), COALESCE(i.termination_requested_at::text,''),
       i.created_at::text
FROM instances i JOIN organizations org ON org.id=i.organization_id
WHERE i.deleted_at IS NULL`+where+
		` ORDER BY i.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	instances := []admInstanceRow{}
	for rows.Next() {
		var in admInstanceRow
		if err := rows.Scan(&in.ID, &in.PublicID, &in.OrganizationID, &in.OrgPublicID, &in.OrgSlug,
			&in.Name, &in.Status, &in.PowerStatus, &in.Vcpu, &in.RamMB, &in.DiskGB,
			&in.SuspendedAt, &in.TerminationRequestedAt, &in.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		instances = append(instances, in)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, instances, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

// adminLoadInstance fetches an instance id + status for admin actions.
func (s *Server) adminLoadInstance(c fiber.Ctx) (uuid.UUID, string, error) {
	id, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return uuid.Nil, "", err
	}
	var status string
	err = s.db.QueryRow(c.Context(),
		`SELECT status::text FROM instances WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&status)
	if err != nil {
		return uuid.Nil, "", apperrors.New(apperrors.CodeNotFound, "instance not found")
	}
	return id, status, nil
}

func (s *Server) adminSuspendInstance(c fiber.Ctx) error {
	instanceID, status, err := s.adminLoadInstance(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status == "suspended" || status == "deleting" || status == "deleted" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance cannot be suspended from state "+status))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx,
		`UPDATE instances SET status='suspended', suspended_at=now() WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "suspend_instance", "instance", instanceID,
		map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.suspend", "instance", &instanceID, map[string]any{"job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "suspended", "job_id": jobID}, nil)
}

func (s *Server) adminUnsuspendInstance(c fiber.Ctx) error {
	instanceID, status, err := s.adminLoadInstance(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status != "suspended" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance is not suspended"))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx,
		`UPDATE instances SET status='active', suspended_at=NULL WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "unsuspend_instance", "instance", instanceID,
		map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.unsuspend", "instance", &instanceID, map[string]any{"job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "active", "job_id": jobID}, nil)
}

func (s *Server) adminForceTerminateInstance(c fiber.Ctx) error {
	instanceID, status, err := s.adminLoadInstance(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status == "deleting" || status == "deleted" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "instance is already being terminated"))
	}
	ctx := c.Context()
	if _, err := s.db.Exec(ctx,
		`UPDATE instances SET termination_requested_at=now() WHERE id=$1`, instanceID); err != nil {
		return mw.WriteError(c, err)
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "terminate_instance", "instance", instanceID,
		map[string]any{"instance_id": instanceID.String()})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.force_terminate", "instance", &instanceID, map[string]any{"job_id": jobID})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "status": "termination_requested", "job_id": jobID}, nil)
}

type admMigrateInstanceInput struct {
	TargetNode string `json:"target_node"`
}

// adminMigrateInstance queues a cross-node migration of a self-hosted
// (proxmox) instance. Bad targets fail fast here; the migration itself runs
// asynchronously through the provisioning worker (MigrateVM).
func (s *Server) adminMigrateInstance(c fiber.Ctx) error {
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admMigrateInstanceInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.TargetNode) == "" {
		return mw.WriteError(c, vErrField("target_node", "target node is required"))
	}
	targetNode := strings.TrimSpace(in.TargetNode)

	ctx := c.Context()
	var (
		providerID uuid.UUID
		provCode   string
		regionCode string
	)
	// For proxmox providers the region code carries the PVE node name; the
	// LEFT JOIN keeps instances without a region row loadable (the adapter
	// still rejects same-node migrations when the job executes).
	err = s.db.QueryRow(ctx, `
SELECT i.provider_id, p.code::text, COALESCE(r.code::text,'')
FROM instances i
JOIN providers p ON p.id=i.provider_id
LEFT JOIN regions r ON r.id=i.region_id
WHERE i.id=$1 AND i.deleted_at IS NULL`, instanceID).
		Scan(&providerID, &provCode, &regionCode)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if provCode != "proxmox" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeUnsupported,
			"migration is only supported for self-hosted proxmox instances"))
	}
	var known bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM regions WHERE provider_id=$1 AND code=$2 AND enabled)`,
		providerID, targetNode).Scan(&known); err != nil {
		return mw.WriteError(c, err)
	}
	if !known {
		return mw.WriteError(c, apperrors.New(apperrors.CodeValidation,
			"target_node is not an enabled region of this provider"))
	}
	if regionCode != "" && strings.EqualFold(regionCode, targetNode) {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeValidation,
			"instance already resides on node %s", regionCode))
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "migrate_instance", "instance", instanceID,
		map[string]any{"instance_id": instanceID.String(), "target_node": targetNode})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.migrate", "instance", &instanceID, map[string]any{
		"job_id": jobID, "target_node": targetNode,
	})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "job_id": jobID, "target_node": targetNode}, nil)
}

// ---- Jobs ----

type admJobRow struct {
	ID             uuid.UUID  `json:"id"`
	Queue          string     `json:"queue"`
	JobType        string     `json:"job_type"`
	OrganizationID *uuid.UUID `json:"organization_id"`
	ResourceType   string     `json:"resource_type"`
	ResourceID     string     `json:"resource_id"`
	Status         string     `json:"status"`
	Attempts       int        `json:"attempts"`
	MaxAttempts    int        `json:"max_attempts"`
	RunAfter       string     `json:"run_after"`
	LockedBy       string     `json:"locked_by"`
	LastError      string     `json:"last_error"`
	CreatedAt      string     `json:"created_at"`
	CompletedAt    string     `json:"completed_at"`
}

func (s *Server) adminListJobs(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admJobStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid job status"))
	}
	queueName := strings.TrimSpace(c.Query("queue"))

	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " AND j.status=$" + admPlaceholder(len(args))
	}
	if queueName != "" {
		args = append(args, queueName)
		where += " AND j.queue=$" + admPlaceholder(len(args))
	}

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM jobs j WHERE TRUE`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT j.id, j.queue, j.job_type, j.organization_id, COALESCE(j.resource_type,''),
       COALESCE(j.resource_id::text,''), j.status, j.attempts, j.max_attempts,
       j.run_after::text, COALESCE(j.locked_by,''), COALESCE(j.last_error,''),
       j.created_at::text, COALESCE(j.completed_at::text,'')
FROM jobs j WHERE TRUE`+where+
		` ORDER BY j.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	jobs := []admJobRow{}
	for rows.Next() {
		var j admJobRow
		if err := rows.Scan(&j.ID, &j.Queue, &j.JobType, &j.OrganizationID, &j.ResourceType,
			&j.ResourceID, &j.Status, &j.Attempts, &j.MaxAttempts, &j.RunAfter, &j.LockedBy,
			&j.LastError, &j.CreatedAt, &j.CompletedAt); err != nil {
			return mw.WriteError(c, err)
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, jobs, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminJobStatus(c fiber.Ctx) (uuid.UUID, string, error) {
	jobID, err := admParseUUIDParam(c, "job_id", "job_id")
	if err != nil {
		return uuid.Nil, "", err
	}
	var status string
	err = s.db.QueryRow(c.Context(),
		`SELECT status FROM jobs WHERE id=$1`, jobID).Scan(&status)
	if err != nil {
		return uuid.Nil, "", apperrors.New(apperrors.CodeNotFound, "job not found")
	}
	return jobID, status, nil
}

func (s *Server) adminRetryJob(c fiber.Ctx) error {
	jobID, status, err := s.adminJobStatus(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status == "running" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeConflict, "cannot retry a running job; cancel it after it finishes"))
	}
	if _, err := s.db.Exec(c.Context(), `
UPDATE jobs SET status='queued', run_after=now(), locked_by=NULL, locked_at=NULL,
                last_error=NULL, completed_at=NULL
WHERE id=$1`, jobID); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.job.retry", "job", &jobID, map[string]any{"previous_status": status})
	return mw.JSON(c, 200, fiber.Map{"id": jobID, "status": "queued"}, nil)
}

func (s *Server) adminCancelJob(c fiber.Ctx) error {
	jobID, status, err := s.adminJobStatus(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if status != "queued" && status != "retry" {
		return mw.WriteError(c, apperrors.New(apperrors.CodeConflict, "only queued or retry jobs can be cancelled (current: "+status+")"))
	}
	if _, err := s.db.Exec(c.Context(),
		`UPDATE jobs SET status='cancelled', completed_at=now() WHERE id=$1`, jobID); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.job.cancel", "job", &jobID, map[string]any{"previous_status": status})
	return mw.JSON(c, 200, fiber.Map{"id": jobID, "status": "cancelled"}, nil)
}

// ---- Orphan provider resources ----

type admOrphanRow struct {
	ID                 uuid.UUID `json:"id"`
	ProviderID         uuid.UUID `json:"provider_id"`
	ProviderCode       string    `json:"provider_code"`
	ResourceType       string    `json:"resource_type"`
	ExternalResourceID string    `json:"external_resource_id"`
	FirstSeenAt        string    `json:"first_seen_at"`
	LastSeenAt         string    `json:"last_seen_at"`
	ResolvedAt         string    `json:"resolved_at"`
	Resolution         string    `json:"resolution"`
}

func (s *Server) adminListOrphans(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM orphan_provider_resources`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT o.id, o.provider_id, p.code::text, o.resource_type, o.external_resource_id,
       o.first_seen_at::text, o.last_seen_at::text,
       COALESCE(o.resolved_at::text,''), COALESCE(o.resolution,'')
FROM orphan_provider_resources o JOIN providers p ON p.id=o.provider_id
ORDER BY o.first_seen_at DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	orphans := []admOrphanRow{}
	for rows.Next() {
		var o admOrphanRow
		if err := rows.Scan(&o.ID, &o.ProviderID, &o.ProviderCode, &o.ResourceType,
			&o.ExternalResourceID, &o.FirstSeenAt, &o.LastSeenAt, &o.ResolvedAt, &o.Resolution); err != nil {
			return mw.WriteError(c, err)
		}
		orphans = append(orphans, o)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, orphans, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admResolveOrphanInput struct {
	Resolution string `json:"resolution"`
}

func (s *Server) adminResolveOrphan(c fiber.Ctx) error {
	orphanID, err := admParseUUIDParam(c, "orphan_id", "orphan_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in admResolveOrphanInput
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Resolution) == "" {
		return mw.WriteError(c, vErrField("resolution", "a resolution note is required"))
	}
	ctx := c.Context()
	tag, err := s.db.Exec(ctx,
		`UPDATE orphan_provider_resources SET resolved_at=now(), resolution=$2 WHERE id=$1 AND resolved_at IS NULL`,
		orphanID, strings.TrimSpace(in.Resolution))
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		var exists, resolved bool
		if err := s.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM orphan_provider_resources WHERE id=$1),
			        COALESCE((SELECT resolved_at IS NOT NULL FROM orphan_provider_resources WHERE id=$1), false)`,
			orphanID).Scan(&exists, &resolved); err != nil {
			return mw.WriteError(c, err)
		}
		if !exists {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "orphan not found"))
		}
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "orphan is already resolved"))
	}
	s.admAudit(c, "admin.orphan.resolve", "orphan_provider_resource", &orphanID)
	return mw.JSON(c, 200, fiber.Map{"id": orphanID, "status": "resolved"}, nil)
}

// ---- Security incidents ----

type admIncidentRow struct {
	ID             uuid.UUID  `json:"id"`
	UserID         *uuid.UUID `json:"user_id"`
	UserEmail      string     `json:"user_email"`
	OrganizationID *uuid.UUID `json:"organization_id"`
	OrgSlug        string     `json:"org_slug"`
	Type           string     `json:"type"`
	Severity       string     `json:"severity"`
	Status         string     `json:"status"`
	Description    string     `json:"description"`
	CreatedAt      string     `json:"created_at"`
	ResolvedAt     string     `json:"resolved_at"`
}

func (s *Server) adminListIncidents(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)
	status := lower(strings.TrimSpace(c.Query("status")))
	if status != "" && !admIncidentStatuses[status] {
		return mw.WriteError(c, vErrField("status", "invalid incident status"))
	}
	where := ""
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += " WHERE si.status=$" + admPlaceholder(len(args))
	}

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM security_incidents si`+where, args...).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	args = append(args, perPage, offset)
	rows, err := s.db.Query(ctx, `
SELECT si.id, si.user_id, COALESCE(u.email::text,''), si.organization_id,
       COALESCE(org.slug::text,''), si.type, si.severity, si.status,
       COALESCE(si.description,''), si.created_at::text, COALESCE(si.resolved_at::text,'')
FROM security_incidents si
LEFT JOIN users u ON u.id=si.user_id
LEFT JOIN organizations org ON org.id=si.organization_id`+where+
		` ORDER BY si.created_at DESC LIMIT `+admPlaceholder(len(args)-1)+` OFFSET `+admPlaceholder(len(args)), args...)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	incidents := []admIncidentRow{}
	for rows.Next() {
		var inc admIncidentRow
		if err := rows.Scan(&inc.ID, &inc.UserID, &inc.UserEmail, &inc.OrganizationID, &inc.OrgSlug,
			&inc.Type, &inc.Severity, &inc.Status, &inc.Description, &inc.CreatedAt, &inc.ResolvedAt); err != nil {
			return mw.WriteError(c, err)
		}
		incidents = append(incidents, inc)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, incidents, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

func (s *Server) adminResolveIncident(c fiber.Ctx) error {
	incidentID, err := admParseUUIDParam(c, "incident_id", "incident_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	tag, err := s.db.Exec(c.Context(),
		`UPDATE security_incidents SET status='resolved', resolved_at=now()
		 WHERE id=$1 AND status <> 'resolved'`, incidentID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		var exists, resolved bool
		if err := s.db.QueryRow(c.Context(),
			`SELECT EXISTS(SELECT 1 FROM security_incidents WHERE id=$1),
			        COALESCE((SELECT status='resolved' FROM security_incidents WHERE id=$1), false)`,
			incidentID).Scan(&exists, &resolved); err != nil {
			return mw.WriteError(c, err)
		}
		if !exists {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "incident not found"))
		}
		return mw.WriteError(c, apperrors.New(apperrors.CodeInvalidState, "incident is already resolved"))
	}
	s.admAudit(c, "admin.incident.resolve", "security_incident", &incidentID)
	return mw.JSON(c, 200, fiber.Map{"id": incidentID, "status": "resolved"}, nil)
}

// ---- Blocked networks ----

type admBlockedNetworkRow struct {
	ID        uuid.UUID `json:"id"`
	Network   string    `json:"network"`
	Reason    string    `json:"reason"`
	ExpiresAt string    `json:"expires_at"`
	CreatedBy string    `json:"created_by"`
	CreatedAt string    `json:"created_at"`
}

func (s *Server) adminListBlockedNetworks(c fiber.Ctx) error {
	ctx := c.Context()
	page, perPage, offset := admPage(c)

	var total int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM blocked_networks`).Scan(&total); err != nil {
		return mw.WriteError(c, err)
	}
	rows, err := s.db.Query(ctx, `
SELECT id, network::text, COALESCE(reason,''), COALESCE(expires_at::text,''),
       COALESCE(created_by::text,''), created_at::text
FROM blocked_networks
ORDER BY created_at DESC LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return mw.WriteError(c, err)
	}
	defer rows.Close()

	networks := []admBlockedNetworkRow{}
	for rows.Next() {
		var b admBlockedNetworkRow
		if err := rows.Scan(&b.ID, &b.Network, &b.Reason, &b.ExpiresAt, &b.CreatedBy, &b.CreatedAt); err != nil {
			return mw.WriteError(c, err)
		}
		networks = append(networks, b)
	}
	if err := rows.Err(); err != nil {
		return mw.WriteError(c, err)
	}
	return httputil.OK(c, 200, networks, &httputil.Meta{Page: page, PerPage: perPage, Total: total})
}

type admAddBlockedNetworkInput struct {
	CIDR   string `json:"cidr"`
	Reason string `json:"reason"`
}

func (s *Server) adminAddBlockedNetwork(c fiber.Ctx) error {
	var in admAddBlockedNetworkInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	_, ipNet, err := net.ParseCIDR(strings.TrimSpace(in.CIDR))
	if err != nil {
		return mw.WriteError(c, vErrField("cidr", "must be a valid CIDR notation network (e.g. 203.0.113.0/24)"))
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		return mw.WriteError(c, vErrField("reason", "is required"))
	}
	adminID := mustUserID(c)
	var id uuid.UUID
	err = s.db.QueryRow(c.Context(), `
INSERT INTO blocked_networks(network, reason, created_by) VALUES ($1,$2,$3) RETURNING id`,
		ipNet.String(), reason, adminID).Scan(&id)
	if err != nil {
		if admIsUnique(err) {
			return mw.WriteError(c, apperrors.New(apperrors.CodeConflict, "network is already blocked"))
		}
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.network.block", "blocked_network", &id, map[string]any{
		"network": ipNet.String(), "reason": reason,
	})
	return mw.JSON(c, 201, fiber.Map{
		"id": id, "network": ipNet.String(), "reason": reason,
	}, nil)
}

func (s *Server) adminDeleteBlockedNetwork(c fiber.Ctx) error {
	networkID, err := admParseUUIDParam(c, "network_id", "network_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	tag, err := s.db.Exec(c.Context(),
		`DELETE FROM blocked_networks WHERE id=$1`, networkID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "blocked network not found"))
	}
	s.admAudit(c, "admin.network.unblock", "blocked_network", &networkID)
	return c.SendStatus(204)
}

// ---- Feature flags ----

type admFlagResponse struct {
	Key       string          `json:"key"`
	Enabled   bool            `json:"enabled"`
	Rules     json.RawMessage `json:"rules"`
	UpdatedAt string          `json:"updated_at"`
}

func (s *Server) adminGetFlag(c fiber.Ctx) error {
	key := strings.TrimSpace(c.Params("key"))
	var f admFlagResponse
	var rules string
	err := s.db.QueryRow(c.Context(),
		`SELECT key, enabled, rules::text, updated_at::text FROM feature_flags WHERE key=$1`, key).
		Scan(&f.Key, &f.Enabled, &rules, &f.UpdatedAt)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "feature flag not found"))
	}
	f.Rules = json.RawMessage(rules)
	return mw.JSON(c, 200, f, nil)
}

type admSetFlagInput struct {
	Enabled bool            `json:"enabled"`
	Rules   json.RawMessage `json:"rules"`
}

func (s *Server) adminSetFlag(c fiber.Ctx) error {
	key := strings.TrimSpace(c.Params("key"))
	if key == "" {
		return mw.WriteError(c, vErrField("key", "is required"))
	}
	var in admSetFlagInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid json body"))
	}
	rulesJSON := "{}"
	if len(in.Rules) > 0 {
		var check map[string]any
		if err := json.Unmarshal(in.Rules, &check); err != nil {
			return mw.WriteError(c, vErrField("rules", "must be a valid JSON object"))
		}
		rulesJSON = string(in.Rules)
	}
	var f admFlagResponse
	var rules string
	err := s.db.QueryRow(c.Context(), `
INSERT INTO feature_flags(key, enabled, rules) VALUES ($1,$2,$3::jsonb)
ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled, rules=EXCLUDED.rules
RETURNING key, enabled, rules::text, updated_at::text`, key, in.Enabled, rulesJSON).
		Scan(&f.Key, &f.Enabled, &rules, &f.UpdatedAt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	f.Rules = json.RawMessage(rules)
	s.admAuditMeta(c, "admin.flag.set", "feature_flag", nil, map[string]any{
		"key": key, "enabled": f.Enabled,
	})
	return mw.JSON(c, 200, f, nil)
}

// ---- App settings ----

type admSettingResponse struct {
	Key       string `json:"key"`
	Value     any    `json:"value"`
	IsSecret  bool   `json:"is_secret"`
	UpdatedAt string `json:"updated_at"`
}

func (s *Server) adminGetSetting(c fiber.Ctx) error {
	key := strings.TrimSpace(c.Params("key"))
	var value string
	var setting admSettingResponse
	err := s.db.QueryRow(c.Context(),
		`SELECT value::text, is_secret, updated_at::text FROM app_settings WHERE key=$1`, key).
		Scan(&value, &setting.IsSecret, &setting.UpdatedAt)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "app setting not found"))
	}
	setting.Key = key
	if setting.IsSecret {
		setting.Value = admMaskedValue
	} else {
		setting.Value = json.RawMessage(value)
	}
	return mw.JSON(c, 200, setting, nil)
}

type admSetSettingInput struct {
	Value    json.RawMessage `json:"value"`
	IsSecret bool            `json:"is_secret"`
}

func (s *Server) adminSetSetting(c fiber.Ctx) error {
	key := strings.TrimSpace(c.Params("key"))
	if key == "" {
		return mw.WriteError(c, vErrField("key", "is required"))
	}
	var in admSetSettingInput
	if err := c.Bind().Body(&in); err != nil || len(in.Value) == 0 {
		return mw.WriteError(c, errValidation("value (JSON) is required"))
	}
	var validate any
	if err := json.Unmarshal(in.Value, &validate); err != nil {
		return mw.WriteError(c, vErrField("value", "must be valid JSON"))
	}
	adminID := mustUserID(c)
	var value string
	var setting admSettingResponse
	err := s.db.QueryRow(c.Context(), `
INSERT INTO app_settings(key, value, is_secret, updated_by) VALUES ($1,$2::jsonb,$3,$4)
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, is_secret=EXCLUDED.is_secret,
                                updated_by=EXCLUDED.updated_by
RETURNING value::text, is_secret, updated_at::text`,
		key, string(in.Value), in.IsSecret, adminID).Scan(&value, &setting.IsSecret, &setting.UpdatedAt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	setting.Key = key
	if setting.IsSecret {
		setting.Value = admMaskedValue
	} else {
		setting.Value = json.RawMessage(value)
	}
	meta := map[string]any{"key": key, "is_secret": setting.IsSecret}
	if setting.IsSecret {
		meta["value"] = admMaskedValue // never log secret values
	}
	s.admAuditMeta(c, "admin.setting.set", "app_setting", nil, meta)
	return mw.JSON(c, 200, setting, nil)
}
