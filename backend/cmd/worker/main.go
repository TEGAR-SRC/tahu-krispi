// Package main is the Kilat Cloud worker entry point. It polls every queue in
// the jobs table (provisioning, sync, webhook, email, maintenance, ...) and
// executes real handlers against the configured cloud providers: VM
// provisioning and lifecycle, snapshots/restores, catalog sync, e-mail
// delivery, HMAC-signed customer webhooks, renewal invoicing, invoice PDF
// rendering and provider reconciliation. Instance-scoped jobs route through
// providerForInstance; global catalog/reconciliation flows stay Onidel.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"kilat.cloud/backend/internal/audit"
	"kilat.cloud/backend/internal/billing"
	"kilat.cloud/backend/internal/compute"
	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/platform/logger"
	mailpkg "kilat.cloud/backend/internal/platform/mail"
	objstore "kilat.cloud/backend/internal/platform/objectstorage"
	"kilat.cloud/backend/internal/platform/postgres"
	"kilat.cloud/backend/internal/platform/queue"
	redisclient "kilat.cloud/backend/internal/platform/redis"
	"kilat.cloud/backend/internal/pricing"
	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/onidel"
	"kilat.cloud/backend/internal/provider/proxmox"
	"kilat.cloud/backend/internal/provider/vmware"
	"kilat.cloud/backend/internal/subscription"
	"kilat.cloud/backend/internal/wallet"
	"kilat.cloud/backend/internal/webhook"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	provisionLockTTL = 10 * time.Minute
	syncRetryDelay   = 30 * time.Second
)

// workerApp bundles every dependency the job handlers need; it mirrors the
// wiring of internal/api.Server but for background work.
type workerApp struct {
	cfg        *config.Config
	log        *logger.Logger
	db         *pgxpool.Pool
	rdb        *goredis.Client
	mailSender *mailpkg.Sender
	prov       provider.ComputeProvider
	computeSvc *compute.Service
	subSvc     *subscription.Service
	billingSvc *billing.Service
	auditSvc   *audit.Service
	deliverer  *webhook.Deliverer

	objOnce  chan struct{} // guards lazy objStore init
	objStore *objstore.Client
	objErr   error
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	log := logger.New(cfg.AppEnv)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := postgres.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres init failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	defer db.Close()
	rdb, err := redisclient.New(ctx, cfg.RedisURL)
	if err != nil {
		log.Error("redis init failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	defer rdb.Close()

	onidelAdapter := onidel.NewAdapter(cfg.OnidelBaseURL, cfg.OnidelAPIKey)
	provider.Register(onidelAdapter)
	proxmox.RegisterFactoryFromDB(db, crypto.DeriveKey("kilat-secret-kek", cfg.SecretEncryptionKey))
	vmware.RegisterFactoryFromDB(db, crypto.DeriveKey("kilat-secret-kek", cfg.SecretEncryptionKey))

	app := &workerApp{
		cfg:        cfg,
		log:        log,
		db:         db,
		rdb:        rdb,
		mailSender: mailpkg.NewSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom),
		prov:       onidelAdapter,
		computeSvc: compute.NewService(db, onidelAdapter, pricing.NewService(db)),
		subSvc:     subscription.NewService(db, cfg.SubscriptionGraceDays),
		billingSvc: billing.NewService(db, wallet.NewService(db)),
		auditSvc:   audit.NewService(db),
		deliverer:  webhook.NewDeliverer(db),
		objOnce:    make(chan struct{}),
	}

	w := queue.NewWorker(db, workerName())
	w.Register("provision_instance", app.provisionInstance)
	w.Register("sync_instance", app.syncInstance)
	w.Register("create_snapshot", app.createSnapshot)
	w.Register("restore_snapshot", app.restoreSnapshot)
	w.Register("restore_backup", app.restoreBackup)
	w.Register("terminate_instance", app.terminateInstance)
	w.Register("suspend_instance", app.suspendInstance)
	w.Register("unsuspend_instance", app.unsuspendInstance)
	w.Register("migrate_instance", app.migrateInstance)
	w.Register("clone_instance", app.cloneInstance)
	w.Register("provider_sync", app.providerSync)
	w.Register("send_email", app.sendEmail)
	w.Register("send_notification", app.sendEmail) // same notification pipeline
	w.Register("deliver_webhook", app.deliverWebhook)
	w.Register("generate_invoice", app.generateInvoices)
	w.Register("generate_invoice_pdf", app.generateInvoicePDF)
	w.Register("reconciliation_tick", func(ctx context.Context, _ queue.Job) error {
		return app.reconciliationTick(ctx)
	})
	w.Register("iso_register_provider", app.isoRegisterProvider)

	// Maintenance ticker: provider reconciliation every hour plus a queued
	// generate_invoice job so subscription renewals are invoiced autonomously
	// (the job row gives each run history, retries and a failure trail).
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		if err := app.reconciliationTick(ctx); err != nil {
			log.Error("reconciliation tick failed", map[string]any{"error": err.Error()})
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := app.reconciliationTick(ctx); err != nil {
					log.Error("reconciliation tick failed", map[string]any{"error": err.Error()})
				}
				if err := enqueueJob(ctx, db, "maintenance", "generate_invoice", "", nil,
					map[string]any{"trigger": "hourly_ticker"}, 0); err != nil {
					log.Error("enqueue generate_invoice failed", map[string]any{"error": err.Error()})
				}
			}
		}
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		cancel()
	}()

	log.Info("worker started", map[string]any{"name": workerName()})
	if err := w.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error("worker exited", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	log.Info("worker stopped cleanly", nil)
}

func workerName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "worker-1"
	}
	return "worker-" + host
}

// ---- shared helpers ----

// objClient lazily constructs the S3/R2 client from config (same pattern as
// the API server). Returns an error when object storage is not configured so
// callers can degrade gracefully in dev environments without R2.
func (a *workerApp) objClient(ctx context.Context) (*objstore.Client, error) {
	select {
	case <-a.objOnce:
	default:
		if a.cfg.R2Endpoint == "" || a.cfg.R2Bucket == "" {
			a.objErr = fmt.Errorf("object storage not configured")
			close(a.objOnce)
		} else {
			useSSL := !strings.HasPrefix(a.cfg.R2Endpoint, "http://")
			endpoint := strings.TrimPrefix(strings.TrimPrefix(a.cfg.R2Endpoint, "https://"), "http://")
			cl, err := objstore.New(ctx, endpoint, a.cfg.R2AccessKey, a.cfg.R2SecretKey, "", a.cfg.R2Bucket, useSSL)
			a.objStore, a.objErr = cl, err
			close(a.objOnce)
		}
	}
	return a.objStore, a.objErr
}

func enqueueJob(ctx context.Context, db *pgxpool.Pool, queueName, jobType, resType string,
	resID *uuid.UUID, payload map[string]any, runAfter time.Duration) error {

	b, _ := json.Marshal(payload)
	_, err := db.Exec(ctx, `
INSERT INTO jobs(queue, job_type, resource_type, resource_id, payload, run_after)
VALUES ($1,$2,NULLIF($3,''),$4,$5::jsonb, now()+($6 || ' seconds')::interval)`,
		queueName, jobType, resType, uuidAny(resID), b,
		strconv.Itoa(int(runAfter.Seconds())))
	return err
}

func uuidAny(u *uuid.UUID) any {
	if u == nil {
		return nil
	}
	return *u
}

func decodePayload(job queue.Job, dst any) error {
	if len(job.Payload) == 0 {
		return nil // empty payload is valid for drain-style jobs
	}
	return json.Unmarshal(job.Payload, dst)
}

func (a *workerApp) resolveProviderID(ctx context.Context) (uuid.UUID, error) {
	var id uuid.UUID
	err := a.db.QueryRow(ctx, `
SELECT id FROM providers WHERE kind='onidel' AND enabled LIMIT 1`).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("onidel provider not configured: %w", err)
	}
	return id, nil
}

// providerForInstance resolves the adapter owning an instance by looking up
// its providers.code; instances without a provider mapping (provider_id NULL,
// row gone) fall back to the default Onidel provider.
func (a *workerApp) providerForInstance(ctx context.Context, instanceID uuid.UUID) (provider.ComputeProvider, error) {
	var code string
	err := a.db.QueryRow(ctx, `
SELECT p.code FROM instances i JOIN providers p ON p.id = i.provider_id WHERE i.id = $1`, instanceID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return a.prov, nil // unmapped -> Onidel fallback
	}
	if err != nil {
		return nil, fmt.Errorf("resolve instance provider: %w", err)
	}
	pv, err := provider.Lookup(strings.ToLower(code)) // citext may preserve case; registry keys are lowercase
	if err != nil {
		return nil, fmt.Errorf("resolve provider %q: %w", code, err)
	}
	return pv, nil
}

func (a *workerApp) resolveTeamExt(ctx context.Context, orgID, providerID uuid.UUID) (string, error) {
	var ext string
	err := a.db.QueryRow(ctx, `
SELECT external_account_id FROM provider_accounts
WHERE organization_id=$1 AND provider_id=$2 AND external_account_id IS NOT NULL`,
		orgID, providerID).Scan(&ext)
	if err != nil {
		return "", fmt.Errorf("organization %s not mapped to an onidel team", orgID)
	}
	return ext, nil
}

// emitDomainEvent records a domain_event and fans it out to every enabled
// webhook matching the event type (delivery rows + deliver_webhook jobs).
func (a *workerApp) emitDomainEvent(ctx context.Context, orgID uuid.UUID,
	eventType, resType string, resID *uuid.UUID, payload map[string]any) error {

	payloadJSON, _ := json.Marshal(payload)
	var eventID uuid.UUID
	if err := a.db.QueryRow(ctx, `
INSERT INTO domain_events(organization_id, event_type, resource_type, resource_id, payload)
VALUES ($1,$2,NULLIF($3,''),$4,$5::jsonb) RETURNING id`,
		orgID, eventType, resType, uuidAny(resID), payloadJSON).Scan(&eventID); err != nil {
		return fmt.Errorf("insert domain event: %w", err)
	}
	rows, err := a.db.Query(ctx, `
SELECT id FROM webhooks
WHERE organization_id=$1 AND enabled AND ($2::text = ANY(events) OR '*'::text = ANY(events))`,
		orgID, eventType)
	if err != nil {
		return err
	}
	defer rows.Close()
	var hookIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		hookIDs = append(hookIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	envelope, _ := json.Marshal(map[string]any{
		"id": eventID, "event_type": eventType,
		"resource_type": resType, "resource_id": resID, "data": payload,
	})
	for _, hookID := range hookIDs {
		var deliveryID uuid.UUID
		if err := a.db.QueryRow(ctx, `
INSERT INTO webhook_deliveries(webhook_id, event_id, request_payload)
VALUES ($1,$2,$3::jsonb)
ON CONFLICT (webhook_id, event_id) DO UPDATE SET request_payload=EXCLUDED.request_payload
RETURNING id`, hookID, eventID, envelope).Scan(&deliveryID); err != nil {
			return fmt.Errorf("insert webhook delivery: %w", err)
		}
		if err := enqueueJob(ctx, a.db, "webhook", "deliver_webhook", "webhook_delivery",
			&deliveryID, map[string]any{"webhook_delivery_id": deliveryID}, 0); err != nil {
			return err
		}
	}
	return nil
}

// notifyUser queues one email notification plus its send_email job.
func (a *workerApp) notifyUser(ctx context.Context, userID *uuid.UUID, orgID uuid.UUID,
	eventType, subject, body string, data map[string]any) error {

	if userID == nil || *userID == uuid.Nil {
		return nil
	}
	dataJSON, _ := json.Marshal(data)
	var notifID uuid.UUID
	if err := a.db.QueryRow(ctx, `
INSERT INTO notifications(user_id, organization_id, channel, event_type, subject, body, data, status)
VALUES ($1,$2,'email',$3,NULLIF($4,''),NULLIF($5,''),$6::jsonb,'queued') RETURNING id`,
		*userID, orgID, eventType, subject, body, dataJSON).Scan(&notifID); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return enqueueJob(ctx, a.db, "email", "send_email", "notification",
		&notifID, map[string]any{"notification_id": notifID}, 0)
}

func (a *workerApp) orgOwner(ctx context.Context, orgID uuid.UUID) *uuid.UUID {
	var uid *uuid.UUID
	if err := a.db.QueryRow(ctx, `SELECT created_by FROM organizations WHERE id=$1`, orgID).Scan(&uid); err == nil && uid != nil {
		return uid
	}
	_ = a.db.QueryRow(ctx, `
SELECT user_id FROM organization_members WHERE organization_id=$1 AND role='owner'
ORDER BY joined_at LIMIT 1`, orgID).Scan(&uid)
	return uid
}

func (a *workerApp) auditEntry(ctx context.Context, orgID, userID *uuid.UUID,
	action, resType string, resID *uuid.UUID, meta map[string]any) {

	a.auditSvc.Log(ctx, audit.Entry{
		OrganizationID: orgID, ActorUserID: userID,
		Action: action, ResourceType: resType, ResourceID: resID,
		Metadata: meta,
	})
}

// instanceSpecPayload is the JSON shape stored in instances.provider_payload
// by compute.Service.Provision; the worker resolves every internal reference
// to its provider external id at execution time.
type instanceSpecPayload struct {
	OSTemplateID    string   `json:"os_template_id"`
	SnapshotID      string   `json:"snapshot_id"`
	IsoID           string   `json:"iso_id"`
	SSHKeyIDs       []string `json:"ssh_keys"`
	VPCIDs          []string `json:"vpcs"`
	FirewallGroupID string   `json:"firewall_group_id"`
	StartupScriptID string   `json:"startup_script_id"`
	IPv6            bool     `json:"ipv6"`
}

// ---- provision_instance ----

func (a *workerApp) provisionInstance(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}

	// Redis SETNX lock guards against double provisioning across workers.
	lockKey := "kc:lock:provision:" + instID.String()
	lockVal := job.ID.String()
	acquired, err := a.rdb.SetNX(ctx, lockKey, lockVal, provisionLockTTL).Result()
	if err != nil {
		return fmt.Errorf("acquire provision lock: %w", err)
	}
	if !acquired {
		return fmt.Errorf("provision lock %s held elsewhere; will retry", lockKey)
	}
	defer func() {
		releaseCtx := context.WithoutCancel(ctx)
		if cur, gerr := a.rdb.Get(releaseCtx, lockKey).Result(); gerr == nil && cur == lockVal {
			a.rdb.Del(releaseCtx, lockKey)
		}
	}()

	var (
		orgID, providerID uuid.UUID
		publicID, name    string
		regionCode        string
		typeExt           string
		vcpu, ramMB, disk int
		osTemplateExt     *string
		specRaw           []byte
		externalVMID      *string
		billPeriod        string
		createdBy         *uuid.UUID
		regionProvCode    string
		serviceKind       string
	)
	err = a.db.QueryRow(ctx, `
SELECT i.organization_id, i.provider_id, i.public_id, i.name,
       COALESCE(r.code::text,''), COALESCE(it.external_id,''),
       i.vcpu, i.ram_mb, i.disk_gb,
       ot.external_id, i.provider_payload, i.external_vm_id,
       COALESCE(i.billing_period::text,'monthly'), i.created_by,
       COALESCE(rp.code::text,''), COALESCE(i.service_kind::text,'vm')
FROM instances i
LEFT JOIN regions r ON r.id=i.region_id
LEFT JOIN providers rp ON rp.id=r.provider_id
LEFT JOIN instance_types it ON it.id=i.instance_type_id
LEFT JOIN os_templates ot ON ot.id=i.os_template_id
WHERE i.id=$1 AND i.deleted_at IS NULL`, instID).
		Scan(&orgID, &providerID, &publicID, &name, &regionCode, &typeExt,
			&vcpu, &ramMB, &disk, &osTemplateExt, &specRaw, &externalVMID, &billPeriod, &createdBy,
			&regionProvCode, &serviceKind)
	if err != nil {
		return fmt.Errorf("load instance: %w", err)
	}

	// Containers execute on the instance's own provider (Onidel rejects them
	// by design); when the region carries no provider code, fall back to the
	// providers.code behind instances.provider_id like the VM path does.
	isContainer := serviceKind == "container"
	if isContainer && regionProvCode == "" {
		var fb string
		if ferr := a.db.QueryRow(ctx,
			`SELECT code::text FROM providers WHERE id=$1`, providerID).Scan(&fb); ferr == nil {
			regionProvCode = fb
		}
	}

	// Anti double-provision: skip when another execution already mapped the VM.
	if externalVMID != nil && *externalVMID != "" {
		var done bool
		if qerr := a.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM provider_actions WHERE idempotency_key=$1 AND status='success')`,
			job.ID.String()).Scan(&done); qerr == nil && done {
			return a.syncInstanceByID(ctx, instID) // replay final state
		}
		a.log.Info("instance already provisioned; skipping", map[string]any{"instance": publicID})
		return nil
	}

	var spec instanceSpecPayload
	if len(specRaw) > 0 {
		if uerr := json.Unmarshal(specRaw, &spec); uerr != nil {
			a.log.Warn("unparsable provider_payload on instance; continuing with defaults",
				map[string]any{"instance": publicID, "error": uerr.Error()})
		}
	}

	// Multi-provider routing: the region's provider decides which adapter
	// executes this job. The Onidel branch keeps its original concept set
	// (team mapping, SSH-key/startup-script registration, VPC/firewall
	// resolution); other providers take the slim direct-spec path below.
	var (
		pv       provider.ComputeProvider
		vmSpec   provider.InstanceSpec
		listTeam string // scope for the post-provision name-match listing
	)
	if strings.EqualFold(regionProvCode, "proxmox") {
		pv, err = provider.Lookup(strings.ToLower(regionProvCode))
		if err != nil {
			return err
		}
		pubKeys, kerr := a.rawSSHPublicKeys(ctx, orgID, spec.SSHKeyIDs)
		if kerr != nil {
			return kerr
		}
		isoExt, ierr := a.resolveExternalRef(ctx, orgID, "custom_isos", "external_iso_id", spec.IsoID)
		if ierr != nil {
			return ierr
		}
		// Slim spec: the VM lands directly on the region's PVE node
		// (regions.code carries the node name for this provider). OS-template
		// and snapshot references are Onidel concepts its ProvisionVM ignores.
		vmSpec = provider.InstanceSpec{
			Name:          name,
			PaymentCycle:  billPeriod,
			Location:      regionCode,
			CPU:           int64(vcpu),
			RAM:           int64(ramMB),
			Disk:          int64(disk),
			IsoExternalID: isoExt,
			SSHKeyIDs:     pubKeys,
			IPv6:          spec.IPv6,
		}
	} else {
		teamExt, terr := a.resolveTeamExt(ctx, orgID, providerID)
		if terr != nil {
			return terr
		}

		sshExtIDs, serr := a.resolveSSHKeys(ctx, orgID, teamExt, spec.SSHKeyIDs)
		if serr != nil {
			return serr
		}
		vpcExtIDs := a.resolveVPCs(ctx, orgID, spec.VPCIDs)
		fwExt, ferr := a.resolveFirewallGroup(ctx, orgID, spec.FirewallGroupID)
		if ferr != nil {
			return ferr
		}
		scriptExt, scerr := a.resolveStartupScript(ctx, orgID, teamExt, spec.StartupScriptID)
		if scerr != nil {
			return scerr
		}
		snapshotExt, snerr := a.resolveExternalRef(ctx, orgID, "snapshots", "external_snapshot_id", spec.SnapshotID)
		if snerr != nil {
			return snerr
		}
		isoExt, ierr := a.resolveExternalRef(ctx, orgID, "custom_isos", "external_iso_id", spec.IsoID)
		if ierr != nil {
			return ierr
		}

		var osNumeric *int64
		if osTemplateExt != nil && *osTemplateExt != "" {
			n, perr := strconv.ParseInt(*osTemplateExt, 10, 64)
			if perr != nil {
				return fmt.Errorf("os template external id %q is not numeric", *osTemplateExt)
			}
			osNumeric = &n
		}
		if typeExt == "" {
			return errors.New("instance has no instance type external id; run provider_sync first")
		}

		vmSpec = provider.InstanceSpec{
			ExternalTeamID:         teamExt,
			Name:                   name,
			PaymentCycle:           billPeriod,
			Location:               regionCode,
			InstanceTypeExternalID: typeExt,
			CPU:                    int64(vcpu),
			RAM:                    int64(ramMB),
			Disk:                   int64(disk),
			OSExternalID:           osNumeric,
			SnapshotExternalID:     snapshotExt,
			IsoExternalID:          isoExt,
			SSHKeyIDs:              sshExtIDs,
			VPCIDs:                 vpcExtIDs,
			FirewallGroupID:        fwExt,
			StartupScriptID:        scriptExt,
			IPv6:                   spec.IPv6,
		}
		pv = a.prov
		listTeam = teamExt
	}

	// Idempotent action record keyed by the job id (UNIQUE(provider_id,
	// idempotency_key)): a replayed successful job never re-calls the provider
	// create call.
	actName, resType := "vm_provision", "vm"
	if isContainer {
		actName, resType = "container_provision", "container"
	}
	if _, err := a.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, idempotency_key,
                             status, started_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',now())
ON CONFLICT (provider_id, idempotency_key) DO NOTHING`,
		uuid.New(), providerID, orgID, createdBy, actName, resType, instID, job.ID.String()); err != nil {
		return fmt.Errorf("record provider action: %w", err)
	}

	var perr error
	if isContainer {
		perr = pv.ProvisionContainer(ctx, vmSpec)
	} else {
		perr = pv.ProvisionVM(ctx, vmSpec)
	}
	if perr != nil {
		_, _ = a.db.Exec(ctx, `
UPDATE provider_actions SET status='failed', completed_at=now(), last_error=NULLIF($2,'')
WHERE idempotency_key=$1 AND provider_id=$3`, job.ID.String(), perr.Error(), providerID)
		return fmt.Errorf("provider provision %s: %w", serviceKind, perr)
	}

	// The create call returns no id: resolve the new guest by listing the
	// scope's machines and matching the name (names are unique per scope).
	if _, err := a.db.Exec(ctx, `
UPDATE instances SET provision_started_at=COALESCE(provision_started_at, now()),
                     status='provisioning'
WHERE id=$1`, instID); err != nil {
		return err
	}
	extVM := ""
	vms, lerr := listProviderGuests(ctx, pv, listTeam, isContainer)
	if lerr != nil {
		a.log.Warn("provision ok but listing guests failed; sync_instance will retry resolution",
			map[string]any{"instance": publicID, "error": lerr.Error()})
	} else {
		for i := range vms {
			if vms[i].Name == name {
				extVM = vms[i].ExternalID
				break
			}
		}
	}
	if extVM != "" {
		if _, err := a.db.Exec(ctx, `
UPDATE instances SET external_vm_id=$2 WHERE id=$1 AND external_vm_id IS NULL`, instID, extVM); err != nil {
			return err
		}
	}
	_, _ = a.db.Exec(ctx, `
UPDATE provider_actions SET status='success', completed_at=now(),
       external_resource_id=NULLIF($1,'')
WHERE idempotency_key=$2 AND provider_id=$3`, extVM, job.ID.String(), providerID)

	a.auditEntry(ctx, &orgID, createdBy, "instance.provision_started", "vm", &instID,
		map[string]any{"public_id": publicID, "external_vm_id": extVM})

	return enqueueJob(ctx, a.db, "sync", "sync_instance", "instance", &instID,
		map[string]any{"instance_id": instID.String()}, syncRetryDelay)
}

// listProviderGuests lists guests for post-provision name matching. Containers
// never show up in ListVMs (qemu-scoped on Proxmox), so Proxmox adapters are
// asked for their LXC rows instead; adapters without container support yield
// no candidates and leave resolution to a later sync_instance pass.
func listProviderGuests(ctx context.Context, pv provider.ComputeProvider, teamExt string, container bool) ([]provider.VMState, error) {
	if !container {
		return pv.ListVMs(ctx, teamExt)
	}
	if px, ok := pv.(*proxmox.Adapter); ok {
		return px.ContainersListAll(ctx)
	}
	return nil, nil
}

// resolveSSHKeys maps internal ssh_keys ids to provider key ids, registering
// keys that have not been pushed to the provider yet.
func (a *workerApp) resolveSSHKeys(ctx context.Context, orgID uuid.UUID, teamExt string, rawIDs []string) ([]string, error) {
	out := make([]string, 0, len(rawIDs))
	for _, raw := range rawIDs {
		keyID, err := uuid.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid ssh key id %q", raw)
		}
		var extID *string
		var keyName, pubKey string
		if err := a.db.QueryRow(ctx, `
SELECT external_ssh_key_id, name, public_key FROM ssh_keys
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, keyID, orgID).
			Scan(&extID, &keyName, &pubKey); err != nil {
			return nil, fmt.Errorf("load ssh key %s: %w", raw, err)
		}
		if extID == nil || *extID == "" {
			ensured, err := a.prov.EnsureSSHKey(ctx, teamExt, keyName, pubKey)
			if err != nil {
				return nil, fmt.Errorf("ensure ssh key %q at provider: %w", keyName, err)
			}
			extID = &ensured.ExternalID
			if _, err := a.db.Exec(ctx, `
UPDATE ssh_keys SET external_ssh_key_id=$2, last_synced_at=now() WHERE id=$1`, keyID, ensured.ExternalID); err != nil {
				return nil, err
			}
		}
		out = append(out, *extID)
	}
	return out, nil
}

// rawSSHPublicKeys loads raw public key material for provisioning on providers
// without a key registry (e.g. proxmox): there the material rides cloud-init
// inside ProvisionVM instead of provider-side key objects.
func (a *workerApp) rawSSHPublicKeys(ctx context.Context, orgID uuid.UUID, rawIDs []string) ([]string, error) {
	out := make([]string, 0, len(rawIDs))
	for _, raw := range rawIDs {
		keyID, err := uuid.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid ssh key id %q", raw)
		}
		var pubKey string
		if err := a.db.QueryRow(ctx, `
SELECT public_key FROM ssh_keys
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, keyID, orgID).Scan(&pubKey); err != nil {
			return nil, fmt.Errorf("load ssh key %s: %w", raw, err)
		}
		out = append(out, pubKey)
	}
	return out, nil
}

// resolveVPCs returns provider ids for already-synced VPCs; VPCs that exist
// only locally are skipped (best-effort network attach) instead of failing
// the whole provisioning.
func (a *workerApp) resolveVPCs(ctx context.Context, orgID uuid.UUID, rawIDs []string) []string {
	out := make([]string, 0, len(rawIDs))
	for _, raw := range rawIDs {
		vpcID, err := uuid.Parse(raw)
		if err != nil {
			continue
		}
		var extID *string
		if err := a.db.QueryRow(ctx, `
SELECT external_vpc_id FROM vpcs WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
			vpcID, orgID).Scan(&extID); err != nil || extID == nil || *extID == "" {
			a.log.Warn("skipping vpc without provider mapping", map[string]any{"vpc": raw})
			continue
		}
		out = append(out, *extID)
	}
	return out
}

func (a *workerApp) resolveFirewallGroup(ctx context.Context, orgID uuid.UUID, raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	fwID, err := uuid.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid firewall group id %q", raw)
	}
	var extID *string
	if err := a.db.QueryRow(ctx, `
SELECT external_firewall_id FROM firewall_groups
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, fwID, orgID).Scan(&extID); err != nil {
		return "", fmt.Errorf("load firewall group: %w", err)
	}
	if extID == nil {
		return "", nil // best-effort: group exists locally but is not synced yet
	}
	return *extID, nil
}

func (a *workerApp) resolveStartupScript(ctx context.Context, orgID uuid.UUID, teamExt, raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	scriptID, err := uuid.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid startup script id %q", raw)
	}
	var extID *string
	var name, content string
	if err := a.db.QueryRow(ctx, `
SELECT external_script_id, name, content FROM startup_scripts
WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, scriptID, orgID).
		Scan(&extID, &name, &content); err != nil {
		return "", fmt.Errorf("load startup script: %w", err)
	}
	if extID != nil && *extID != "" {
		return *extID, nil
	}
	created, err := a.prov.EnsureStartupScript(ctx, teamExt, name, content)
	if err != nil {
		return "", fmt.Errorf("ensure startup script %q: %w", name, err)
	}
	if _, err := a.db.Exec(ctx, `
UPDATE startup_scripts SET external_script_id=$2, last_synced_at=now() WHERE id=$1`,
		scriptID, created.ExternalID); err != nil {
		return "", err
	}
	return created.ExternalID, nil
}

// resolveExternalRef loads table.column for an optional uuid reference; an
// empty result means the referenced resource has no provider mapping yet,
// which is retryable.
func (a *workerApp) resolveExternalRef(ctx context.Context, orgID uuid.UUID, table, column, raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	refID, err := uuid.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid %s id %q", table, raw)
	}
	// table/column come from call sites above, never from user input.
	q := fmt.Sprintf(`SELECT %s FROM %s WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, column, table)
	var ext *string
	if err := a.db.QueryRow(ctx, q, refID, orgID).Scan(&ext); err != nil {
		return "", fmt.Errorf("load %s %s: %w", table, raw, err)
	}
	if ext == nil || *ext == "" {
		return "", fmt.Errorf("%s %s has no provider mapping yet; will retry", table, raw)
	}
	return *ext, nil
}

// ---- sync_instance ----

func (a *workerApp) syncInstance(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}
	return a.syncInstanceByID(ctx, instID)
}

func (a *workerApp) syncInstanceByID(ctx context.Context, instID uuid.UUID) error {
	var (
		orgID, providerID uuid.UUID
		name, publicID    string
		prevStatus        string
		externalVMID      *string
		createdBy         *uuid.UUID
		serviceKind       string
	)
	err := a.db.QueryRow(ctx, `
SELECT organization_id, provider_id, name, public_id, status::text, external_vm_id, created_by,
       COALESCE(service_kind::text,'vm')
FROM instances WHERE id=$1 AND deleted_at IS NULL`, instID).
		Scan(&orgID, &providerID, &name, &publicID, &prevStatus, &externalVMID, &createdBy, &serviceKind)
	if err != nil {
		return fmt.Errorf("load instance: %w", err)
	}

	pv, err := a.providerForInstance(ctx, instID)
	if err != nil {
		return err
	}
	// Onidel lists team-scoped VMs; other providers list managed VMs without
	// a team account and resolve the instance by name.
	teamExt := ""
	if pv.Code() == "onidel" {
		if teamExt, err = a.resolveTeamExt(ctx, orgID, providerID); err != nil {
			return err
		}
	}

	extVM := ""
	if externalVMID != nil {
		extVM = *externalVMID
	}

	var (
		guestStatus, powerStatus, mainV4, mainV6 string
	)
	if serviceKind == "container" {
		// Containers refresh through the adapter's LXC listing: GetVM is
		// qemu-scoped on Proxmox and would reject "ct<vmid>" ids.
		px, ok := pv.(*proxmox.Adapter)
		if !ok {
			return fmt.Errorf("container sync not supported on provider %q", pv.Code())
		}
		cts, lerr := px.ContainersListAll(ctx)
		if lerr != nil {
			return fmt.Errorf("list containers: %w", lerr)
		}
		var ct *provider.VMState
		for i := range cts {
			if (extVM != "" && cts[i].ExternalID == extVM) || (extVM == "" && cts[i].Name == name) {
				ct = &cts[i]
				break
			}
		}
		if ct == nil {
			if extVM == "" {
				return fmt.Errorf("container %q not found on provider yet", name)
			}
			return fmt.Errorf("container %s not found on provider", extVM)
		}
		if extVM == "" {
			extVM = ct.ExternalID
			if _, uerr := a.db.Exec(ctx, `
UPDATE instances SET external_vm_id=$2 WHERE id=$1 AND external_vm_id IS NULL`, instID, extVM); uerr != nil {
				return uerr
			}
		}
		guestStatus, powerStatus = ct.Status, ct.PowerStatus
	} else {
		if extVM == "" {
			vms, lerr := pv.ListVMs(ctx, teamExt)
			if lerr != nil {
				return fmt.Errorf("resolve vm by name: %w", lerr)
			}
			for i := range vms {
				if vms[i].Name == name {
					extVM = vms[i].ExternalID
					break
				}
			}
			if extVM == "" {
				return fmt.Errorf("vm %q not found on provider yet", name)
			}
			if _, uerr := a.db.Exec(ctx, `
UPDATE instances SET external_vm_id=$2 WHERE id=$1 AND external_vm_id IS NULL`, instID, extVM); uerr != nil {
				return uerr
			}
		}

		vm, gerr := pv.GetVM(ctx, extVM)
		if gerr != nil {
			return fmt.Errorf("get vm %s: %w", extVM, gerr)
		}
		guestStatus, powerStatus = vm.Status, vm.PowerStatus
		mainV4, mainV6 = vm.MainIPv4, vm.MainIPv6
	}

	kcStatus := guestStatus // adapter already normalizes via mapOnidelStatus
	rawExtra, _ := json.Marshal(map[string]any{"raw_status_source": "sync_instance"})
	if _, err := a.db.Exec(ctx, `
UPDATE instances SET status=$2::resource_status, power_status=NULLIF($3,''),
       primary_ipv4=NULLIF($4,'')::inet, primary_ipv6=NULLIF($5,'')::inet,
       sync_status='synced', last_synced_at=now(),
       provisioned_at=CASE WHEN $2='active' THEN COALESCE(provisioned_at, now()) ELSE provisioned_at END,
       provider_payload=instances.provider_payload || $6::jsonb
WHERE id=$1`,
		instID, kcStatus, powerStatus, mainV4, mainV6, rawExtra); err != nil {
		return fmt.Errorf("update instance from provider: %w", err)
	}

	if prevStatus != "active" && kcStatus == "active" {
		data := map[string]any{
			"name": name, "public_id": publicID, "ipv4": mainV4,
		}
		if err := a.emitDomainEvent(ctx, orgID, "instance.provisioned", "vm", &instID, data); err != nil {
			return err
		}
		if err := a.notifyUser(ctx, createdBy, orgID, "instance.provisioned",
			fmt.Sprintf("Instance %s is ready", name),
			fmt.Sprintf("Your instance %s (%s) is active. IPv4: %s", name, publicID, orDash(mainV4)),
			data); err != nil {
			return err
		}
		a.auditEntry(ctx, &orgID, nil, "instance.provisioned", "vm", &instID,
			map[string]any{"ipv4": mainV4})
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// ---- create_snapshot / restore_snapshot / restore_backup ----

func (a *workerApp) createSnapshot(ctx context.Context, job queue.Job) error {
	var p struct {
		SnapshotID string `json:"snapshot_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	snapID, err := uuid.Parse(p.SnapshotID)
	if err != nil {
		return fmt.Errorf("invalid snapshot id: %w", err)
	}

	var (
		orgID          uuid.UUID
		snapName, desc string
		extSnapID      *string
		vmExt          *string
		instanceName   string
		srcInstance    *uuid.UUID
		srcKind        string
	)
	err = a.db.QueryRow(ctx, `
SELECT s.organization_id, s.name, COALESCE(s.description,''),
       s.external_snapshot_id, i.external_vm_id, COALESCE(i.name,''), i.id,
       COALESCE(i.service_kind::text,'')
FROM snapshots s
LEFT JOIN instances i ON i.id=s.instance_id
WHERE s.id=$1 AND s.deleted_at IS NULL`, snapID).
		Scan(&orgID, &snapName, &desc, &extSnapID, &vmExt, &instanceName, &srcInstance, &srcKind)
	if err != nil {
		return fmt.Errorf("load snapshot: %w", err)
	}

	// Route provider calls through the adapter owning the source instance;
	// a snapshot whose instance row vanished keeps the Onidel default.
	pv := a.prov
	if srcInstance != nil && *srcInstance != uuid.Nil {
		routed, rerr := a.providerForInstance(ctx, *srcInstance)
		if rerr != nil {
			return rerr
		}
		pv = routed
	}

	alreadyCreated := extSnapID != nil && *extSnapID != ""
	if !alreadyCreated {
		if vmExt == nil || *vmExt == "" {
			return errors.New("source instance has no provider mapping yet; will retry")
		}
		var newExt string
		var cerr error
		if srcKind == "container" {
			newExt, cerr = pv.ContainerSnapshotCreate(ctx, *vmExt, snapName, desc)
		} else {
			newExt, cerr = pv.CreateSnapshot(ctx, *vmExt, snapName, desc)
		}
		if cerr != nil {
			return fmt.Errorf("provider create snapshot: %w", cerr)
		}
		extSnapID = &newExt
		if _, uerr := a.db.Exec(ctx, `
UPDATE snapshots SET external_snapshot_id=$2, status='provisioning', last_synced_at=now()
WHERE id=$1`, snapID, newExt); uerr != nil {
			return uerr
		}
	}

	// Reconcile immediately: match the fresh external id against the snapshot
	// listing to capture size/status. A listing hiccup leaves the row in
	// 'provisioning'; later provider_sync passes converge it — the create call
	// itself must NOT be repeated. Containers list per-guest instead of
	// cluster-wide.
	var (
		snaps []provider.ProviderSnapshot
		lerr  error
	)
	if srcKind == "container" {
		if px, ok := pv.(*proxmox.Adapter); ok {
			snaps, lerr = px.ContainerSnapshotsList(ctx, *vmExt)
		}
	} else {
		snaps, lerr = pv.ListSnapshots(ctx)
	}
	if lerr == nil {
		for _, sn := range snaps {
			if sn.ExternalID == *extSnapID {
				size := sn.Size
				if _, uerr := a.db.Exec(ctx, `
UPDATE snapshots SET status=CASE WHEN $2='available' THEN 'active' ELSE status END::resource_status,
       size_bytes=GREATEST(COALESCE(size_bytes,0), $3), last_synced_at=now()
WHERE id=$1`, snapID, sn.Status, size); uerr != nil {
					return uerr
				}
				break
			}
		}
	}

	data := map[string]any{
		"snapshot_id": snapID.String(), "name": snapName, "instance": instanceName,
	}
	if err := a.emitDomainEvent(ctx, orgID, "snapshot.completed", "snapshot", &snapID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, a.orgOwner(ctx, orgID), orgID, "snapshot.completed",
		fmt.Sprintf("Snapshot %s completed", snapName),
		fmt.Sprintf("Snapshot %s for instance %s is available.", snapName, orDash(instanceName)), data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, nil, "snapshot.create", "snapshot", &snapID, data)
	return nil
}

func (a *workerApp) restoreSnapshot(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		SnapshotID string `json:"snapshot_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}
	snapID, err := uuid.Parse(p.SnapshotID)
	if err != nil {
		return fmt.Errorf("invalid snapshot id: %w", err)
	}

	var orgID uuid.UUID
	var vmExt, snapExt *string
	var name, publicID, svcKind string
	err = a.db.QueryRow(ctx, `
SELECT i.organization_id, i.name, i.public_id, i.external_vm_id, s.external_snapshot_id,
       COALESCE(i.service_kind::text,'')
FROM instances i JOIN snapshots s ON s.instance_id=i.id
WHERE i.id=$1 AND s.id=$2`, instID, snapID).
		Scan(&orgID, &name, &publicID, &vmExt, &snapExt, &svcKind)
	if err != nil {
		return fmt.Errorf("load restore target: %w", err)
	}
	if vmExt == nil || *vmExt == "" || snapExt == nil || *snapExt == "" {
		return errors.New("instance or snapshot has no provider mapping yet; will retry")
	}
	pv, perr := a.providerForInstance(ctx, instID)
	if perr != nil {
		return perr
	}
	if svcKind == "container" {
		if err := pv.ContainerSnapshotRollback(ctx, *vmExt, *snapExt); err != nil {
			return fmt.Errorf("provider rollback container snapshot: %w", err)
		}
	} else if err := pv.RestoreFromSnapshot(ctx, *vmExt, *snapExt); err != nil {
		return fmt.Errorf("provider restore from snapshot: %w", err)
	}
	if _, err := a.db.Exec(ctx, `
UPDATE instances SET sync_status='queued' WHERE id=$1`, instID); err != nil {
		return err
	}
	if err := enqueueJob(ctx, a.db, "sync", "sync_instance", "instance", &instID,
		map[string]any{"instance_id": instID.String()}, 60*time.Second); err != nil {
		return err
	}

	data := map[string]any{"name": name, "public_id": publicID, "restore": "snapshot"}
	if err := a.emitDomainEvent(ctx, orgID, "instance.restore_completed", "vm", &instID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, a.orgOwner(ctx, orgID), orgID, "instance.restore_completed",
		fmt.Sprintf("Restore started for %s", name),
		fmt.Sprintf("Instance %s (%s) is being restored from snapshot.", name, publicID), data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, nil, "instance.restore_snapshot", "vm", &instID, data)
	return nil
}

func (a *workerApp) restoreBackup(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		BackupID   string `json:"backup_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}
	backupID, err := uuid.Parse(p.BackupID)
	if err != nil {
		return fmt.Errorf("invalid backup id: %w", err)
	}

	var orgID uuid.UUID
	var vmExt, backupExt *string
	var name, publicID, svcKind string
	err = a.db.QueryRow(ctx, `
SELECT i.organization_id, i.name, i.public_id, i.external_vm_id, b.external_backup_id,
       COALESCE(i.service_kind::text,'')
FROM instances i JOIN backups b ON b.instance_id=i.id
WHERE i.id=$1 AND b.id=$2`, instID, backupID).
		Scan(&orgID, &name, &publicID, &vmExt, &backupExt, &svcKind)
	if err != nil {
		return fmt.Errorf("load restore target: %w", err)
	}
	if svcKind == "container" {
		// vzdump-based CT restore is deliberately not opened yet.
		return apperrors.New(apperrors.CodeValidation,
			"backup restore is not available for containers yet")
	}
	if vmExt == nil || *vmExt == "" || backupExt == nil || *backupExt == "" {
		return errors.New("instance or backup has no provider mapping yet; will retry")
	}
	pv, perr := a.providerForInstance(ctx, instID)
	if perr != nil {
		return perr
	}
	if err := pv.RestoreFromBackup(ctx, *vmExt, *backupExt); err != nil {
		return fmt.Errorf("provider restore from backup: %w", err)
	}
	if _, err := a.db.Exec(ctx, `
UPDATE instances SET sync_status='queued' WHERE id=$1`, instID); err != nil {
		return err
	}
	if err := enqueueJob(ctx, a.db, "sync", "sync_instance", "instance", &instID,
		map[string]any{"instance_id": instID.String()}, 60*time.Second); err != nil {
		return err
	}

	data := map[string]any{"name": name, "public_id": publicID, "restore": "backup"}
	if err := a.emitDomainEvent(ctx, orgID, "instance.restore_completed", "vm", &instID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, a.orgOwner(ctx, orgID), orgID, "instance.restore_completed",
		fmt.Sprintf("Restore started for %s", name),
		fmt.Sprintf("Instance %s (%s) is being restored from backup.", name, publicID), data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, nil, "instance.restore_backup", "vm", &instID, data)
	return nil
}

// ---- terminate / suspend / unsuspend ----

func (a *workerApp) terminateInstance(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		Reason     string `json:"reason"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}

	var orgID, providerID uuid.UUID
	var name, publicID, status, svcKind string
	var vmExt *string
	var createdBy *uuid.UUID
	err = a.db.QueryRow(ctx, `
SELECT organization_id, provider_id, name, public_id, status::text, external_vm_id, created_by,
       COALESCE(service_kind::text,'vm')
FROM instances WHERE id=$1`, instID).
		Scan(&orgID, &providerID, &name, &publicID, &status, &vmExt, &createdBy, &svcKind)
	if err != nil {
		return fmt.Errorf("load instance: %w", err)
	}
	if status == "deleted" {
		return nil // already terminated; idempotent replay
	}

	if vmExt != nil && *vmExt != "" {
		pv, perr := a.providerForInstance(ctx, instID)
		if perr != nil {
			return perr
		}
		actName := "vm_destroy"
		if svcKind == "container" {
			actName = "container_destroy"
		}
		actionID := uuid.New()
		if _, err := a.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             idempotency_key, status, started_at)
VALUES ($1,$2,$3,$4,$5,'vm',$6,$7,$8,'running',now())
ON CONFLICT (provider_id, idempotency_key) DO NOTHING`,
			actionID, providerID, orgID, createdBy, actName, instID, *vmExt, job.ID.String()); err != nil {
			return err
		}
		var derr error
		if svcKind == "container" {
			derr = pv.DestroyContainer(ctx, *vmExt)
		} else {
			derr = pv.DestroyVM(ctx, *vmExt)
		}
		actStatus, lastErr := "success", ""
		if derr != nil {
			actStatus, lastErr = "failed", derr.Error()
		}
		_, _ = a.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(),
       last_error=NULLIF($3,'')
WHERE idempotency_key=$1`, job.ID.String(), actStatus, lastErr)
		if derr != nil {
			return fmt.Errorf("provider destroy vm: %w", derr)
		}
	}

	if _, err := a.db.Exec(ctx, `
UPDATE instances SET terminated_at=now(), deleted_at=now(), status='deleted' WHERE id=$1`, instID); err != nil {
		return err
	}
	data := map[string]any{"name": name, "public_id": publicID, "reason": p.Reason}
	if err := a.emitDomainEvent(ctx, orgID, "instance.terminated", "vm", &instID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, createdBy, orgID, "instance.terminated",
		fmt.Sprintf("Instance %s terminated", name),
		fmt.Sprintf("Instance %s (%s) was terminated.", name, publicID), data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, createdBy, "instance.terminate", "vm", &instID, data)
	return nil
}

// suspendInstance marks the local record suspended and asks the provider to
// suspend the VM best-effort (Onidel exposes no dedicated suspend endpoint;
// PatchVM {'status':'suspended'} is attempted but its failure does not block
// the local state change).
func (a *workerApp) suspendInstance(ctx context.Context, job queue.Job) error {
	return a.changeSuspension(ctx, job, true)
}

func (a *workerApp) unsuspendInstance(ctx context.Context, job queue.Job) error {
	return a.changeSuspension(ctx, job, false)
}

func (a *workerApp) changeSuspension(ctx context.Context, job queue.Job, suspend bool) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		Reason     string `json:"reason"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}

	var orgID uuid.UUID
	var name, publicID string
	var vmExt *string
	err = a.db.QueryRow(ctx, `
SELECT organization_id, name, public_id, external_vm_id FROM instances WHERE id=$1`, instID).
		Scan(&orgID, &name, &publicID, &vmExt)
	if err != nil {
		return fmt.Errorf("load instance: %w", err)
	}
	targetStatus := "active"
	if suspend {
		targetStatus = "suspended"
	}
	if vmExt != nil && *vmExt != "" {
		pv, perr := a.providerForInstance(ctx, instID)
		if perr != nil {
			return perr // never flip local state while the right provider is unknown
		}
		if verr := pv.PatchVM(ctx, *vmExt, map[string]any{"status": targetStatus}); verr != nil {
			a.log.Warn("best-effort provider patch failed; applying local suspension state anyway",
				map[string]any{"instance": publicID, "target": targetStatus, "error": verr.Error()})
		}
	}
	if suspend {
		if _, err := a.db.Exec(ctx, `
UPDATE instances SET status='suspended', suspended_at=now() WHERE id=$1`, instID); err != nil {
			return err
		}
	} else {
		if _, err := a.db.Exec(ctx, `
UPDATE instances SET status='active', suspended_at=NULL WHERE id=$1`, instID); err != nil {
			return err
		}
	}

	eventType, subject, bodyText := "instance.unsuspended",
		fmt.Sprintf("Instance %s unsuspended", name),
		fmt.Sprintf("Instance %s (%s) is active again.", name, publicID)
	if suspend {
		reason := p.Reason
		if reason == "" {
			reason = "administrative action"
		}
		eventType = "instance.suspended"
		subject = fmt.Sprintf("Instance %s has been suspended", name)
		bodyText = fmt.Sprintf("Instance %s (%s) was suspended. Reason: %s", name, publicID, reason)
	}
	data := map[string]any{"name": name, "public_id": publicID, "reason": p.Reason}
	if err := a.emitDomainEvent(ctx, orgID, eventType, "vm", &instID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, a.orgOwner(ctx, orgID), orgID, eventType, subject, bodyText, data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, nil, eventType, "vm", &instID, data)
	return nil
}

// ---- migrate_instance ----

// migrateInstance asks the provider owning the instance to move its VM to
// another node (an online PVE migration can run for many minutes). The
// provider_actions row is inserted 'running' before the provider call and
// flipped to success/failed afterwards, mirroring terminateInstance; any
// failure is returned so the shared jobs-table retry/backoff applies.
func (a *workerApp) migrateInstance(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		TargetNode string `json:"target_node"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	if p.InstanceID == "" || p.TargetNode == "" {
		return errors.New("payload requires instance_id and target_node")
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}

	var orgID, providerID uuid.UUID
	var name, publicID, svcKind string
	var vmExt *string
	var createdBy *uuid.UUID
	err = a.db.QueryRow(ctx, `
SELECT organization_id, provider_id, name, public_id, external_vm_id, created_by,
       COALESCE(service_kind::text,'vm')
FROM instances WHERE id=$1 AND deleted_at IS NULL`, instID).
		Scan(&orgID, &providerID, &name, &publicID, &vmExt, &createdBy, &svcKind)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // instance gone meanwhile; nothing left to migrate
		}
		return fmt.Errorf("load instance: %w", err)
	}
	if vmExt == nil || *vmExt == "" {
		return fmt.Errorf("instance %s not provisioned yet", publicID)
	}

	pv, perr := a.providerForInstance(ctx, instID)
	if perr != nil {
		return perr
	}

	actName := "vm_migrate"
	if svcKind == "container" {
		actName = "container_migrate"
	}
	actionID := uuid.New()
	if _, err := a.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             idempotency_key, status, started_at)
VALUES ($1,$2,$3,$4,$5,'vm',$6,$7,$8,'running',now())
ON CONFLICT (provider_id, idempotency_key) DO NOTHING`,
		actionID, providerID, orgID, createdBy, actName, instID, *vmExt, job.ID.String()); err != nil {
		return err
	}
	var merr error
	if svcKind == "container" {
		merr = pv.MigrateContainer(ctx, *vmExt, p.TargetNode)
	} else {
		merr = pv.MigrateVM(ctx, *vmExt, p.TargetNode)
	}
	actStatus, lastErr := "success", ""
	if merr != nil {
		actStatus, lastErr = "failed", merr.Error()
	}
	_, _ = a.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(),
       last_error=NULLIF($3,'')
WHERE idempotency_key=$1`, job.ID.String(), actStatus, lastErr)
	if merr != nil {
		return fmt.Errorf("provider migrate vm: %w", merr)
	}

	data := map[string]any{"name": name, "public_id": publicID, "target_node": p.TargetNode}
	if err := a.emitDomainEvent(ctx, orgID, "instance.migrated", "vm", &instID, data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, createdBy, "instance.migrate", "vm", &instID, data)
	return a.syncInstanceByID(ctx, instID)
}

// ---- clone_instance ----

// cloneInstance asks the provider owning the instance to duplicate its VM under
// a new name. Design note: the clone currently duplicates the VM on the
// provider and records the action/event trail against the SOURCE instance only;
// creating a standalone new instances row (own lifecycle, separate billing) is
// a product decision and intentionally not done here. Mirrors migrateInstance:
// provider_actions 'running' before the call, success/failed + completed_at +
// last_error NULLIF afterwards; any failure is returned so the shared
// jobs-table retry/backoff applies.
func (a *workerApp) cloneInstance(ctx context.Context, job queue.Job) error {
	var p struct {
		InstanceID string `json:"instance_id"`
		Name       string `json:"name"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	if p.InstanceID == "" || p.Name == "" {
		return errors.New("payload requires instance_id and name")
	}
	instID, err := uuid.Parse(p.InstanceID)
	if err != nil {
		return fmt.Errorf("invalid instance id: %w", err)
	}

	var orgID, providerID uuid.UUID
	var publicID, svcKind string
	var vmExt *string
	var createdBy *uuid.UUID
	err = a.db.QueryRow(ctx, `
SELECT organization_id, provider_id, public_id, external_vm_id, created_by,
       COALESCE(service_kind::text,'vm')
FROM instances WHERE id=$1 AND deleted_at IS NULL`, instID).
		Scan(&orgID, &providerID, &publicID, &vmExt, &createdBy, &svcKind)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // instance gone meanwhile; nothing left to clone
		}
		return fmt.Errorf("load instance: %w", err)
	}
	if svcKind == "container" {
		// The SDK supports CT clones but the platform does not open them yet.
		return apperrors.New(apperrors.CodeValidation,
			"cloning containers is not supported yet")
	}
	if vmExt == nil || *vmExt == "" {
		return fmt.Errorf("instance %s not provisioned yet; no external_vm_id to clone", publicID)
	}

	pv, perr := a.providerForInstance(ctx, instID)
	if perr != nil {
		return perr
	}

	actionID := uuid.New()
	if _, err := a.db.Exec(ctx, `
INSERT INTO provider_actions(id, provider_id, organization_id, requested_by, action,
                             resource_type, internal_resource_id, external_resource_id,
                             idempotency_key, status, started_at)
VALUES ($1,$2,$3,$4,'vm_clone','vm',$5,$6,$7,'running',now())
ON CONFLICT (provider_id, idempotency_key) DO NOTHING`,
		actionID, providerID, orgID, createdBy, instID, *vmExt, job.ID.String()); err != nil {
		return err
	}
	cerr := pv.CloneVM(ctx, *vmExt, p.Name)
	actStatus, lastErr := "success", ""
	if cerr != nil {
		actStatus, lastErr = "failed", cerr.Error()
	}
	_, _ = a.db.Exec(ctx, `
UPDATE provider_actions SET status=$2::provider_action_status, completed_at=now(),
       last_error=NULLIF($3,'')
WHERE idempotency_key=$1`, job.ID.String(), actStatus, lastErr)
	if cerr != nil {
		return fmt.Errorf("provider clone vm: %w", cerr)
	}

	data := map[string]any{"name": p.Name, "source_public_id": publicID}
	if err := a.emitDomainEvent(ctx, orgID, "instance.cloned", "vm", &instID, data); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, createdBy, "instance.clone", "vm", &instID, data)
	return a.syncInstanceByID(ctx, instID)
}

// ---- provider_sync ----

func (a *workerApp) providerSync(ctx context.Context, _ queue.Job) error {
	provID, err := a.resolveProviderID(ctx)
	if err != nil {
		return err
	}
	types, templates, locations, err := a.prov.SyncCatalog(ctx)
	if err != nil {
		_, _ = a.db.Exec(ctx, `
UPDATE providers SET health_status='error', last_health_check_at=now() WHERE id=$1`, provID)
		return fmt.Errorf("provider sync catalog: %w", err)
	}

	for _, loc := range locations {
		if loc.Code == "" || loc.Name == "" {
			continue
		}
		if _, err := a.db.Exec(ctx, `
INSERT INTO regions(provider_id, code, name, enabled, last_synced_at)
VALUES ($1,$2,$3,true,now())
ON CONFLICT (provider_id, code) DO UPDATE
SET name=EXCLUDED.name, enabled=true, last_synced_at=now()`,
			provID, loc.Code, loc.Name); err != nil {
			return fmt.Errorf("upsert region: %w", err)
		}
	}

	for _, t := range types {
		payload, _ := json.Marshal(map[string]any{"network_rate_mbps": t.NetworkRate, "locations": t.Locations})
		if _, err := a.db.Exec(ctx, `
INSERT INTO instance_types(provider_id, external_id, code, name, category,
                           max_vcpu, max_ram_mb, max_disk_gb, provider_payload, last_synced_at)
VALUES ($1,$2,NULLIF($3,''),$4,NULLIF($5,''),$6,$7,$8,$9::jsonb,now())
ON CONFLICT (provider_id, external_id) DO UPDATE
SET code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
    max_vcpu=EXCLUDED.max_vcpu, max_ram_mb=EXCLUDED.max_ram_mb,
    max_disk_gb=EXCLUDED.max_disk_gb, provider_payload=EXCLUDED.provider_payload,
    last_synced_at=now()`,
			provID, t.ExternalID, t.Code, t.Name, t.Category,
			t.MaxVCPU, t.MaxRAM, t.MaxDisk, payload); err != nil {
			return fmt.Errorf("upsert instance type: %w", err)
		}
	}

	for _, t := range templates {
		if _, err := a.db.Exec(ctx, `
INSERT INTO os_templates(provider_id, external_id, name, family, last_synced_at)
VALUES ($1,$2,$3,NULLIF($4,''),now())
ON CONFLICT (provider_id, external_id) DO UPDATE
SET name=EXCLUDED.name, family=EXCLUDED.family, last_synced_at=now()`,
			provID, t.ExternalID, t.Name, t.Family); err != nil {
			return fmt.Errorf("upsert os template: %w", err)
		}
	}

	if _, err := a.db.Exec(ctx, `
UPDATE providers SET health_status='ok', last_health_check_at=now() WHERE id=$1`, provID); err != nil {
		return err
	}
	a.log.Info("provider catalog synced", map[string]any{
		"instance_types": len(types), "os_templates": len(templates), "regions": len(locations),
	})
	return nil
}

// ---- send_email / send_notification ----

func (a *workerApp) sendEmail(ctx context.Context, job queue.Job) error {
	var p struct {
		NotificationID string `json:"notification_id"`
	}
	_ = decodePayload(job, &p)
	var notifID uuid.UUID
	if id, err := uuid.Parse(p.NotificationID); err == nil {
		notifID = id
	} else {
		// Drain mode: atomically claim the oldest queued email notification so
		// concurrent workers cannot pick the same row twice.
		row := a.db.QueryRow(ctx, `
UPDATE notifications SET status='sending'
WHERE id = (
  SELECT id FROM notifications WHERE channel='email' AND status='queued'
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING id`)
		if err := row.Scan(&notifID); err != nil {
			return nil // queue empty
		}
	}

	var (
		userID                *uuid.UUID
		eventType             string
		subject, bodyFallback string
		dataRaw               []byte
		status                string
		email                 *string
	)
	err := a.db.QueryRow(ctx, `
SELECT n.user_id, n.event_type, COALESCE(n.subject,''), COALESCE(n.body,''),
       n.data, n.status::text, u.email::text
FROM notifications n LEFT JOIN users u ON u.id=n.user_id
WHERE n.id=$1 FOR UPDATE OF n`, notifID).
		Scan(&userID, &eventType, &subject, &bodyFallback, &dataRaw, &status, &email)
	if err != nil {
		return fmt.Errorf("load notification: %w", err)
	}
	if status == "sent" || status == "read" {
		return nil
	}
	if userID == nil || email == nil || *email == "" {
		_, _ = a.db.Exec(ctx, `
UPDATE notifications SET status='failed', last_error='no recipient address' WHERE id=$1`, notifID)
		return nil // permanent condition; do not spin retries
	}

	var data map[string]any
	if len(dataRaw) > 0 {
		_ = json.Unmarshal(dataRaw, &data)
	}
	msgSubject, textBody, htmlBody := renderNotification(eventType, data, subject, bodyFallback)

	sendErr := a.mailSender.Send(ctx, *email, msgSubject, textBody, htmlBody)
	if errors.Is(sendErr, mailpkg.ErrNotConfigured) {
		// SMTP intentionally unconfigured (dev): park as failed with the reason
		// recorded and stop retrying by returning nil.
		_, _ = a.db.Exec(ctx, `
UPDATE notifications SET status='failed', last_error=$2 WHERE id=$1`, notifID, sendErr.Error())
		a.log.Warn("smtp not configured; notification parked as failed", map[string]any{"event": eventType})
		return nil
	}
	if sendErr != nil {
		_, _ = a.db.Exec(ctx, `
UPDATE notifications SET status='failed', last_error=$2 WHERE id=$1`, notifID, sendErr.Error())
		return fmt.Errorf("send mail: %w", sendErr) // retryable
	}
	_, err = a.db.Exec(ctx, `
UPDATE notifications SET status='sent', sent_at=now(), last_error=NULL WHERE id=$1`, notifID)
	return err
}

// renderNotification maps an event_type onto the branded transactional mail
// templates, falling back to the generic subject/body stored on the
// notifications row when no specific template exists.
func renderNotification(eventType string, data map[string]any, fallbackSubject, fallbackBody string) (subject, textBody, htmlBody string) {
	dstr := func(key string) string {
		if v, ok := data[key].(string); ok {
			return v
		}
		return ""
	}
	dfnum := func(key string) float64 {
		switch v := data[key].(type) {
		case float64:
			return v
		case string:
			var f float64
			fmt.Sscanf(v, "%f", &f)
			return f
		default:
			return 0
		}
	}
	switch eventType {
	case "instance.provisioned":
		return mailpkg.InstanceProvisioned(dstr("name"), dstr("public_id"), dstr("ipv4"))
	case "instance.suspended":
		return mailpkg.InstanceSuspended(dstr("name"), dstr("reason"))
	case "invoice.issued":
		total := strconv.FormatFloat(dfnum("total"), 'f', 2, 64)
		return mailpkg.InvoiceIssued(dstr("invoice_number"), total, dstr("currency"),
			dstr("due_date"), dstr("pay_link"))
	case "invoice.paid":
		amount := strconv.FormatFloat(dfnum("amount"), 'f', 2, 64)
		return mailpkg.PaymentReceived(amount, dstr("currency"), dstr("invoice_number"))
	default:
		subject = fallbackSubject
		if subject == "" {
			subject = "Kilat Cloud notification: " + eventType
		}
		textBody = fallbackBody
		if textBody == "" {
			b, _ := json.MarshalIndent(data, "", "  ")
			textBody = string(b)
		}
		htmlBody = "<html><body><p>" + html.EscapeString(textBody) + "</p></body></html>"
		return subject, textBody, htmlBody
	}
}

// ---- deliver_webhook ----

func (a *workerApp) deliverWebhook(ctx context.Context, job queue.Job) error {
	var p struct {
		WebhookDeliveryID string `json:"webhook_delivery_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	deliveryID, err := uuid.Parse(p.WebhookDeliveryID)
	if err != nil {
		return fmt.Errorf("invalid webhook_delivery_id: %w", err)
	}
	return a.deliverer.Deliver(ctx, deliveryID)
}

// ---- generate_invoice (subscription renewals) ----

func (a *workerApp) generateInvoices(ctx context.Context, _ queue.Job) error {
	due, err := a.subSvc.ProcessTransitions(ctx, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("process subscription transitions: %w", err)
	}
	for _, subID := range due {
		inv, ierr := a.billingSvc.CreateRenewalInvoice(ctx, subID)
		if ierr != nil {
			// One broken subscription must not block the whole billing run;
			// the next tick re-flags it because it stays past_due.
			a.log.Error("renewal invoice creation failed",
				map[string]any{"subscription": subID.String(), "error": ierr.Error()})
			continue
		}
		if ferr := a.fanoutInvoiceIssued(ctx, inv); ferr != nil {
			a.log.Error("invoice fanout failed",
				map[string]any{"invoice": inv.PublicID, "error": ferr.Error()})
		}
	}
	return nil
}

func (a *workerApp) fanoutInvoiceIssued(ctx context.Context, inv *billing.Invoice) error {
	var orgID uuid.UUID
	var currency, dueAt string
	if err := a.db.QueryRow(ctx, `
SELECT organization_id, currency::text, COALESCE(due_at::text,'')
FROM invoices WHERE id=$1`, inv.ID).Scan(&orgID, &currency, &dueAt); err != nil {
		return err
	}
	payLink := strings.TrimRight(a.cfg.ConsoleBaseURL, "/") + "/billing/invoices/" + inv.PublicID
	data := map[string]any{
		"invoice_number": inv.InvoiceNumber,
		"total":          inv.Total,
		"currency":       currency,
		"due_date":       dueAt,
		"pay_link":       payLink,
	}
	if err := a.emitDomainEvent(ctx, orgID, "invoice.issued", "invoice", &inv.ID, data); err != nil {
		return err
	}
	if err := a.notifyUser(ctx, a.orgOwner(ctx, orgID), orgID, "invoice.issued",
		fmt.Sprintf("Invoice %s issued", inv.InvoiceNumber),
		fmt.Sprintf("A new invoice %s (%s %.2f) is due on %s. Pay at %s",
			inv.InvoiceNumber, currency, inv.Total, dueAt, payLink), data); err != nil {
		return err
	}
	// Render the PDF asynchronously so slow object-storage calls stay out of
	// the billing loop.
	if err := enqueueJob(ctx, a.db, "maintenance", "generate_invoice_pdf", "invoice", &inv.ID,
		map[string]any{"invoice_id": inv.ID.String()}, 0); err != nil {
		return err
	}
	a.auditEntry(ctx, &orgID, nil, "invoice.issue_renewal", "invoice", &inv.ID, data)
	return nil
}

// ---- generate_invoice_pdf ----

func (a *workerApp) generateInvoicePDF(ctx context.Context, job queue.Job) error {
	var p struct {
		InvoiceID string `json:"invoice_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	invoiceID, err := uuid.Parse(p.InvoiceID)
	if err != nil {
		return fmt.Errorf("invalid invoice id: %w", err)
	}

	var h struct {
		PublicID, Number, OrgName, IssuedAt, DueAt, Currency string
		Subtotal, Tax, Total                                 float64
	}
	var subStr, taxStr, totStr string
	err = a.db.QueryRow(ctx, `
SELECT i.public_id, i.invoice_number, COALESCE(o.name,'Customer'),
       COALESCE(i.issued_at::text,''), COALESCE(i.due_at::text,''), i.currency::text,
       i.subtotal::text, i.tax::text, i.total::text
FROM invoices i JOIN organizations o ON o.id=i.organization_id
WHERE i.id=$1`, invoiceID).
		Scan(&h.PublicID, &h.Number, &h.OrgName, &h.IssuedAt, &h.DueAt, &h.Currency,
			&subStr, &taxStr, &totStr)
	if err != nil {
		return fmt.Errorf("load invoice: %w", err)
	}
	fmt.Sscanf(subStr, "%f", &h.Subtotal)
	fmt.Sscanf(taxStr, "%f", &h.Tax)
	fmt.Sscanf(totStr, "%f", &h.Total)

	rows, err := a.db.Query(ctx, `
SELECT description, quantity::text, unit_price::text, subtotal::text
FROM invoice_items WHERE invoice_id=$1 ORDER BY id`, invoiceID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []invoiceItemRow{}
	for rows.Next() {
		var it invoiceItemRow
		if err := rows.Scan(&it.Desc, &it.Qty, &it.Unit, &it.Subtotal); err != nil {
			return err
		}
		it.Qty = fmtNum(it.Qty)
		it.Unit = fmtNum(it.Unit)
		it.Subtotal = fmtNum(it.Subtotal)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	storageUnavailable := func(reason error) error {
		// Object storage is intentionally unconfigured (dev): record the reason
		// on the job row and return nil so the queue does not retry forever.
		_, _ = a.db.Exec(ctx, `UPDATE jobs SET last_error=$2 WHERE id=$1`,
			job.ID, "object storage unavailable: "+reason.Error())
		a.log.Warn("invoice pdf skipped", map[string]any{"invoice": h.PublicID, "error": reason.Error()})
		return nil
	}
	client, cerr := a.objClient(ctx)
	if cerr != nil {
		return storageUnavailable(cerr)
	}
	var backendID uuid.UUID
	if berr := a.db.QueryRow(ctx, `
SELECT id FROM object_storage_backends WHERE enabled ORDER BY created_at LIMIT 1`).
		Scan(&backendID); berr != nil {
		return storageUnavailable(berr)
	}

	pdfBytes, rerr := renderInvoicePDF(h.PublicID, h.Number, h.OrgName, h.IssuedAt, h.DueAt,
		h.Currency, h.Subtotal, h.Tax, h.Total, items)
	if rerr != nil {
		return fmt.Errorf("render invoice pdf: %w", rerr)
	}

	objectKey := "invoices/" + h.PublicID + ".pdf"
	etag, perr := client.PutObject(ctx, objectKey, bytes.NewReader(pdfBytes), int64(len(pdfBytes)), "application/pdf")
	if perr != nil {
		return fmt.Errorf("upload invoice pdf: %w", perr)
	}

	var objID uuid.UUID
	if err := a.db.QueryRow(ctx, `
INSERT INTO stored_objects(storage_backend_id, organization_id, object_key, purpose,
                           mime_type, size_bytes, etag)
VALUES ($1,(SELECT organization_id FROM invoices WHERE id=$2),$3,'invoice_pdf',
        'application/pdf',$4,NULLIF($5,''))
ON CONFLICT (storage_backend_id, object_key) DO UPDATE
SET mime_type=EXCLUDED.mime_type, size_bytes=EXCLUDED.size_bytes, etag=EXCLUDED.etag,
    deleted_at=NULL
RETURNING id`, backendID, invoiceID, objectKey, int64(len(pdfBytes)), etag).Scan(&objID); err != nil {
		return fmt.Errorf("insert stored_object: %w", err)
	}
	if _, err := a.db.Exec(ctx, `
UPDATE invoices SET pdf_object_id=$2 WHERE id=$1`, invoiceID, objID); err != nil {
		return err
	}
	a.log.Info("invoice pdf rendered", map[string]any{"invoice": h.PublicID, "key": objectKey})
	return nil
}

// invoiceItemRow is one rendered line of the invoice PDF.
type invoiceItemRow struct{ Desc, Qty, Unit, Subtotal string }

// renderInvoicePDF draws a compact branded A4 invoice into a byte buffer.
func renderInvoicePDF(publicID, number, orgName, issuedAt, dueAt, currency string,
	subtotal, tax, total float64, items []invoiceItemRow) ([]byte, error) {

	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetAutoPageBreak(true, 20)
	pdf.AddPage()

	pdf.SetFont("Helvetica", "B", 20)
	pdf.Cell(0, 12, "Kilat Cloud")
	pdf.Ln(13)
	pdf.SetFont("Helvetica", "", 10)
	pdf.SetTextColor(110, 110, 110)
	pdf.Cell(0, 5, "kilat-cloud.com")
	pdf.Ln(10)
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", 15)
	pdf.Cell(0, 8, "Invoice "+number)
	pdf.Ln(11)

	pdf.SetFont("Helvetica", "", 10)
	meta := [][2]string{
		{"Customer", orgName},
		{"Issued", issuedAt},
		{"Due", dueAt},
		{"Currency", currency},
	}
	for _, m := range meta {
		pdf.Cell(28, 6, m[0])
		pdf.Cell(0, 6, m[1])
		pdf.Ln(7)
	}
	pdf.Ln(4)

	pdf.SetFont("Helvetica", "B", 10)
	pdf.SetFillColor(238, 240, 243)
	pdf.CellFormat(88, 8, "Description", "1", 0, "L", true, 0, "")
	pdf.CellFormat(24, 8, "Qty", "1", 0, "R", true, 0, "")
	pdf.CellFormat(38, 8, "Unit price", "1", 0, "R", true, 0, "")
	pdf.CellFormat(38, 8, "Subtotal", "1", 0, "R", true, 0, "")
	pdf.Ln(-1)

	pdf.SetFont("Helvetica", "", 10)
	for _, it := range items {
		desc := it.Desc
		if len(desc) > 55 {
			desc = desc[:52] + "..."
		}
		pdf.CellFormat(88, 7, desc, "1", 0, "L", false, 0, "")
		pdf.CellFormat(24, 7, it.Qty, "1", 0, "R", false, 0, "")
		pdf.CellFormat(38, 7, it.Unit, "1", 0, "R", false, 0, "")
		pdf.CellFormat(38, 7, it.Subtotal, "1", 0, "R", false, 0, "")
		pdf.Ln(-1)
	}

	pdf.Ln(6)
	pdf.SetX(112)
	pdf.Cell(40, 7, "Subtotal")
	pdf.CellFormat(36, 7, fmtNumF(subtotal), "0", 0, "R", false, 0, "")
	pdf.Ln(-1)
	pdf.SetX(112)
	pdf.Cell(40, 7, "Tax")
	pdf.CellFormat(36, 7, fmtNumF(tax), "0", 0, "R", false, 0, "")
	pdf.Ln(-1)
	pdf.SetFont("Helvetica", "B", 11)
	pdf.SetX(112)
	pdf.Cell(40, 8, "Total")
	pdf.CellFormat(36, 8, fmtNumF(total), "0", 0, "R", false, 0, "")
	pdf.Ln(-1)

	pdf.SetY(-32)
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(130, 130, 130)
	pdf.CellFormat(0, 5, "Thank you for choosing Kilat Cloud - kilat-cloud.com", "", 0, "C", false, 0, "")
	pdf.Ln(-1)
	pdf.CellFormat(0, 5, "Document reference "+publicID, "", 0, "C", false, 0, "")

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// fmtNum trims a numeric ::text value to two decimals ("100000.0000" -> "100000.00").
func fmtNum(raw string) string {
	var f float64
	fmt.Sscanf(raw, "%f", &f)
	return strconv.FormatFloat(f, 'f', 2, 64)
}

func fmtNumF(f float64) string { return strconv.FormatFloat(f, 'f', 2, 64) }

// ---- iso_register_provider ----

const (
	isoPresignExpiry = 24 * time.Hour
	isoVerifyWait    = 60 * time.Second // bounded wait for provider listing
	isoVerifyPoll    = 10 * time.Second
)

// isoRegisterProvider pushes a stored custom ISO to the provider owning its
// custom_isos row. The source is either the presigned internal-object URL
// (upload flow) or the user-supplied URL (by-URL flow). Every failure returns
// an error so the shared jobs-table retry/backoff applies; on the final
// allowed attempt the row is marked failed while the stored object stays
// intact for retry.
func (a *workerApp) isoRegisterProvider(ctx context.Context, job queue.Job) error {
	var p struct {
		IsoID string `json:"iso_id"`
	}
	if err := decodePayload(job, &p); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	isoID, err := uuid.Parse(p.IsoID)
	if err != nil {
		return fmt.Errorf("invalid iso id: %w", err)
	}

	var (
		orgID, providerID uuid.UUID
		name              string
		extID             *string
		storageKey        *string
		sourceURL         *string
		regStatus         string
		provCode          string
	)
	err = a.db.QueryRow(ctx, `
SELECT ci.organization_id, ci.provider_id, ci.name, ci.external_iso_id, ci.storage_key,
       ci.source_url, COALESCE(ci.register_status,''), COALESCE(p.code::text,'')
FROM custom_isos ci
LEFT JOIN providers p ON p.id = ci.provider_id
WHERE ci.id=$1 AND ci.deleted_at IS NULL`, isoID).
		Scan(&orgID, &providerID, &name, &extID, &storageKey, &sourceURL, &regStatus, &provCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // soft-deleted meanwhile; registration is moot
		}
		return fmt.Errorf("load custom iso: %w", err)
	}
	if regStatus == "active" && extID != nil && *extID != "" {
		return nil // already registered by an earlier run
	}

	finalAttempt := job.Attempts >= job.MaxAttempts
	failFinal := func(reason error) error {
		if finalAttempt {
			a.isoMarkRegistrationFailed(ctx, isoID, reason.Error())
		}
		return reason
	}

	// Multi-provider routing (same rule as providerForInstance): onidel rows
	// and rows without a usable provider mapping keep the original team-scoped
	// flow untouched; every other providers.code resolves through the registry.
	// Providers without a team concept (proxmox ignores the parameter) receive
	// an empty team scope.
	pv := a.prov
	teamExt := ""
	switch code := strings.ToLower(strings.TrimSpace(provCode)); {
	case code == "" || code == "onidel":
		if teamExt, err = a.resolveTeamExt(ctx, orgID, providerID); err != nil {
			return failFinal(err)
		}
	default:
		if pv, err = provider.Lookup(code); err != nil {
			return failFinal(fmt.Errorf("resolve provider %q: %w", provCode, err))
		}
	}

	candidates := isoNameCandidates(name, storageKey, sourceURL)

	// A previous attempt may have pushed the ISO but died before persisting
	// the mapping; scan first so the create call stays idempotent per name.
	isos, lerr := pv.ListISOs(ctx, teamExt)
	if lerr != nil {
		return failFinal(fmt.Errorf("list isos: %w", lerr))
	}
	before := make(map[string]bool, len(isos))
	for _, iso := range isos {
		before[iso.ExternalID] = true
		if !iso.IsSystem && matchesISOCandidates(iso, candidates) &&
			!a.isoExternalClaimed(ctx, iso.ExternalID, isoID, providerID) {
			return a.finishISORegistration(ctx, orgID, isoID, iso)
		}
	}

	url := ""
	switch {
	case storageKey != nil && *storageKey != "":
		cl, cerr := a.objClient(ctx)
		if cerr != nil {
			return failFinal(cerr)
		}
		purl, perr := cl.PresignedGet(ctx, *storageKey, isoPresignExpiry)
		if perr != nil {
			return failFinal(fmt.Errorf("presign iso object: %w", perr))
		}
		url = purl
	case sourceURL != nil && *sourceURL != "":
		url = *sourceURL
	default:
		return failFinal(errors.New("custom iso has neither storage_key nor source_url"))
	}

	// Visible progress while the provider ingests the file.
	if _, uerr := a.db.Exec(ctx, `
UPDATE custom_isos SET register_status='registering', status='provisioning'
WHERE id=$1 AND register_status <> 'active'`, isoID); uerr != nil {
		return uerr
	}

	if cerr := pv.CreateISOByURL(ctx, teamExt, url); cerr != nil {
		return failFinal(fmt.Errorf("provider create iso by url: %w", cerr))
	}

	// Bounded wait for the entry to appear in the provider listing (providers
	// ingest by fetching the URL). The first matching NEW entry wins; as a
	// safety net for renamed uploads, a single unseen non-system entry after
	// the wait window is adopted too. Timeout keeps the job retryable.
	newSeen := map[string]provider.ISOImage{}
	deadline := time.Now().Add(isoVerifyWait)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(isoVerifyPoll):
		}
		isos, lerr := pv.ListISOs(ctx, teamExt)
		if lerr != nil {
			if time.Now().After(deadline) {
				return failFinal(fmt.Errorf("list isos while verifying: %w", lerr))
			}
			continue // transient listing hiccup inside the wait window
		}
		singleNew := provider.ISOImage{}
		count := 0
		for _, iso := range isos {
			if iso.IsSystem || before[iso.ExternalID] {
				continue
			}
			newSeen[iso.ExternalID] = iso
			count++
			singleNew = iso
			if matchesISOCandidates(iso, candidates) &&
				!a.isoExternalClaimed(ctx, iso.ExternalID, isoID, providerID) {
				return a.finishISORegistration(ctx, orgID, isoID, iso)
			}
		}
		if count == 1 && time.Now().After(deadline) &&
			!a.isoExternalClaimed(ctx, singleNew.ExternalID, isoID, providerID) {
			return a.finishISORegistration(ctx, orgID, isoID, singleNew)
		}
		if time.Now().After(deadline) {
			return failFinal(fmt.Errorf("iso %q did not appear on the provider within %s", name, isoVerifyWait))
		}
	}
}

// finishISORegistration persists the confirmed provider mapping, adopting the
// provider-reported byte size as ground truth.
func (a *workerApp) finishISORegistration(ctx context.Context, orgID, isoID uuid.UUID,
	iso provider.ISOImage) error {

	if _, err := a.db.Exec(ctx, `
UPDATE custom_isos SET external_iso_id=$2,
       size_bytes=CASE WHEN $3 > 0 THEN $3 ELSE size_bytes END,
       register_status='active', status='active', last_synced_at=now(),
       provider_payload=provider_payload || jsonb_build_object('provider_size_bytes', $3)
WHERE id=$1`, isoID, iso.ExternalID, iso.Size); err != nil {
		return fmt.Errorf("mark iso active: %w", err)
	}
	a.auditEntry(ctx, &orgID, nil, "iso.registered", "custom_iso", &isoID, map[string]any{
		"external_iso_id": iso.ExternalID, "size_bytes": iso.Size})
	return nil
}

// isoMarkRegistrationFailed records the terminal failure of the registration;
// storage_key and the R2 object are intentionally kept so users can retry.
func (a *workerApp) isoMarkRegistrationFailed(ctx context.Context, isoID uuid.UUID, msg string) {
	_, _ = a.db.Exec(ctx, `
UPDATE custom_isos SET register_status='failed', status='failed',
       provider_payload=provider_payload || jsonb_build_object('last_error', $2::text)
WHERE id=$1 AND deleted_at IS NULL`, isoID, msg)
}

// isoExternalClaimed reports whether another live custom_isos row already owns
// this provider ISO id, preventing mapping theft between rows.
func (a *workerApp) isoExternalClaimed(ctx context.Context, extID string,
	selfID, provID uuid.UUID) bool {

	var claimed bool
	_ = a.db.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM custom_isos
WHERE external_iso_id=$1 AND provider_id=$2 AND id <> $3 AND deleted_at IS NULL)`,
		extID, provID, selfID).Scan(&claimed)
	return claimed
}

// normISOName lowercases and strips a trailing .iso for tolerant comparisons.
func normISOName(s string) string {
	s = strings.ToLower(strings.TrimSpace(path.Base(strings.ReplaceAll(s, "\\", "/"))))
	return strings.TrimSuffix(s, ".iso")
}

// isoNameCandidates collects the names/filenames the provider entry may carry:
// the display name plus the base filenames of the stored key and source URL.
func isoNameCandidates(name string, storageKey, sourceURL *string) []string {
	set := map[string]bool{}
	add := func(s string) {
		if s = normISOName(s); s != "" {
			set[s] = true
		}
	}
	add(name)
	if storageKey != nil {
		add(*storageKey)
	}
	if sourceURL != nil {
		add(*sourceURL)
		if u, perr := url.Parse(*sourceURL); perr == nil && u.Path != "" {
			add(u.Path)
		}
	}
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	return out
}

// matchesISOCandidates reports whether a provider ISO entry matches any of the
// expected names or filenames.
func matchesISOCandidates(iso provider.ISOImage, candidates []string) bool {
	fn, nm := normISOName(iso.Filename), normISOName(iso.Name)
	for _, c := range candidates {
		if c != "" && (fn == c || nm == c) {
			return true
		}
	}
	return false
}

// ---- reconciliation_tick ----

// reconciliationTick compares provider-side VMs against local instances per
// mapped organization and upserts orphan_provider_resources rows. It NEVER
// destroys anything: orphan handling stays a human decision.
func (a *workerApp) reconciliationTick(ctx context.Context) error {
	provID, err := a.resolveProviderID(ctx)
	if err != nil {
		return err
	}
	acctRows, err := a.db.Query(ctx, `
SELECT pa.organization_id, pa.id, pa.external_account_id
FROM provider_accounts pa JOIN providers p ON p.id=pa.provider_id
WHERE p.kind='onidel' AND p.enabled AND pa.external_account_id IS NOT NULL`)
	if err != nil {
		return err
	}
	type account struct {
		orgID, acctID uuid.UUID
		teamExt       string
	}
	var accounts []account
	for acctRows.Next() {
		var rec account
		if err := acctRows.Scan(&rec.orgID, &rec.acctID, &rec.teamExt); err != nil {
			acctRows.Close()
			return err
		}
		accounts = append(accounts, rec)
	}
	acctRows.Close()
	if err := acctRows.Err(); err != nil {
		return err
	}

	discovered := 0
	for _, acc := range accounts {
		vms, lerr := a.prov.ListVMs(ctx, acc.teamExt)
		if lerr != nil {
			a.log.Warn("reconciliation list vms failed", map[string]any{
				"organization": acc.orgID.String(), "error": lerr.Error(),
			})
			continue
		}

		local := map[string]bool{}
		instRows, qerr := a.db.Query(ctx, `
SELECT external_vm_id FROM instances
WHERE organization_id=$1 AND provider_id=$2 AND external_vm_id IS NOT NULL AND deleted_at IS NULL`,
			acc.orgID, provID)
		if qerr != nil {
			return qerr
		}
		for instRows.Next() {
			var ext string
			if serr := instRows.Scan(&ext); serr != nil {
				instRows.Close()
				return serr
			}
			local[ext] = true
		}
		instRows.Close()
		if err := instRows.Err(); err != nil {
			return err
		}

		atProvider := map[string]bool{}
		for _, vm := range vms {
			atProvider[vm.ExternalID] = true
			if local[vm.ExternalID] {
				continue
			}
			discovered++
			payload, _ := json.Marshal(map[string]any{
				"name": vm.Name, "status": vm.Status, "ipv4": vm.MainIPv4,
			})
			var orphanID uuid.UUID
			serr := a.db.QueryRow(ctx, `
SELECT id FROM orphan_provider_resources
WHERE provider_id=$1 AND resource_type='vm' AND external_resource_id=$2 AND resolved_at IS NULL`,
				provID, vm.ExternalID).Scan(&orphanID)
			switch {
			case errors.Is(serr, pgx.ErrNoRows): // first sighting -> record first_seen
				if _, ierr := a.db.Exec(ctx, `
INSERT INTO orphan_provider_resources(provider_id, provider_account_id, resource_type,
                                     external_resource_id, provider_payload)
VALUES ($1,$2,'vm',$3,$4::jsonb)`, provID, acc.acctID, vm.ExternalID, payload); ierr != nil {
					return ierr
				}
			case serr != nil:
				return serr
			default: // still present at the provider -> refresh last_seen
				if _, uerr := a.db.Exec(ctx, `
UPDATE orphan_provider_resources SET last_seen_at=now(), provider_payload=$2::jsonb
WHERE id=$1 AND resolved_at IS NULL`, orphanID, payload); uerr != nil {
					return uerr
				}
			}
		}

		// Orphans that disappeared from the provider listing get resolved so
		// they stop reappearing on every pass.
		staleRows, qerr := a.db.Query(ctx, `
SELECT id FROM orphan_provider_resources
WHERE provider_id=$1 AND resource_type='vm' AND resolved_at IS NULL`, provID)
		if qerr != nil {
			return qerr
		}
		var stale []uuid.UUID
		for staleRows.Next() {
			var id uuid.UUID
			if serr := staleRows.Scan(&id); serr != nil {
				staleRows.Close()
				return serr
			}
			stale = append(stale, id)
		}
		staleRows.Close()
		if err := staleRows.Err(); err != nil {
			return err
		}
		for _, id := range stale {
			var ext string
			if gerr := a.db.QueryRow(ctx, `
SELECT external_resource_id FROM orphan_provider_resources WHERE id=$1`, id).Scan(&ext); gerr != nil {
				continue
			}
			if !atProvider[ext] {
				if _, uerr := a.db.Exec(ctx, `
UPDATE orphan_provider_resources SET resolved_at=now(),
       resolution='resource no longer present at provider'
WHERE id=$1`, id); uerr != nil {
					return uerr
				}
			}
		}
	}
	if discovered > 0 {
		a.log.Info("reconciliation discovered provider-only resources", map[string]any{"count": discovered})
	}
	return nil
}
