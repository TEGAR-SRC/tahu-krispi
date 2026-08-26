// User-plane API surface for the newer Proxmox-backed VM capabilities: power
// extras (reset/pause/resume/hibernate), notes/tags, serial console, guest
// metrics & agent queries, and PVE-native per-VM firewall management. Every
// route is org-scoped through withOrg and resolves strict ownership via
// instanceExternalVM; providers lacking a capability answer 501 through
// apperrors.CodeUnsupported on their own. Serial console and metrics dispatch
// on instances.service_kind so LXC containers hit their provider counterparts.
package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"kilat.cloud/backend/internal/platform/crypto"
	"kilat.cloud/backend/internal/provider"
	mw "kilat.cloud/backend/pkg/middleware"
)

// ownedVMContext resolves the :id param against the caller's organization and
// bundles what every instance handler needs: instance id, provider-scoped
// external VM id, and the owning provider adapter.
func (s *Server) ownedVMContext(c fiber.Ctx) (uuid.UUID, string, provider.ComputeProvider, error) {
	ctx := c.Context()
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return uuid.Nil, "", nil, errValidation("invalid instance id")
	}
	vmExt, err := instanceExternalVM(ctx, s.db, instanceID, mustOrgID(c))
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	pv, err := s.instanceProvider(ctx, instanceID)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	return instanceID, vmExt, pv, nil
}

// getInstanceserviceKind reads instances.service_kind ('vm'|'container')
// straight from the row so dispatch does not depend on the Instance struct
// gaining a ServiceKind field. Rows on databases where the column has not been
// migrated in yet read as "vm" to keep the pre-container behavior.
func getInstanceserviceKind(ctx context.Context, db pgxQuerier, id uuid.UUID) (string, error) {
	var kind string
	err := db.QueryRow(ctx,
		`SELECT service_kind::text FROM instances WHERE id=$1`, id).Scan(&kind)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" { // undefined_column
			return "vm", nil
		}
		return "", err
	}
	return kind, nil
}

// powerActionStatus maps each accepted action to the async status label the
// handler returns while the provider call is in flight.
var powerActionStatus = map[string]string{
	"start":     "starting",
	"reset":     "resetting",
	"pause":     "pausing",
	"resume":    "resuming",
	"hibernate": "hibernating",
}

// handleInstancePowerAction builds the generic start/reset/pause/resume/
// hibernate handler family on top of compute.Service.Action, mirroring the
// stop/reboot handlers in handlers_compute.go.
func (s *Server) handleInstancePowerAction(action string) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, err := uuid.Parse(c.Params("id"))
		if err != nil {
			return mw.WriteError(c, errValidation("invalid instance id"))
		}
		if err := s.computeSvc.Action(c.Context(), id, mustOrgID(c), mustUserID(c), action, false); err != nil {
			return mw.WriteError(c, err)
		}
		return mw.JSON(c, 202, fiber.Map{"status": powerActionStatus[action]}, nil)
	}
}

// ---- Notes / tags ----

func (s *Server) handleGetInstanceNotes(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	notes, err := pv.VMNotes(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"notes": notes}, nil)
}

func (s *Server) handleUpdateInstanceNotes(c fiber.Ctx) error {
	var in struct {
		Notes string `json:"notes"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.SetVMNotes(c.Context(), vmExt, in.Notes); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

const (
	maxVMTags      = 32
	maxVMTagLength = 64
)

func (s *Server) handleGetInstanceTags(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	tags, err := pv.VMTags(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"tags": tags}, nil)
}

func (s *Server) handleUpdateInstanceTags(c fiber.Ctx) error {
	var in struct {
		Tags []string `json:"tags"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	if len(in.Tags) > maxVMTags {
		return mw.WriteError(c, vErrField("tags", "at most 32 tags are allowed"))
	}
	for _, tag := range in.Tags {
		if len(tag) > maxVMTagLength {
			return mw.WriteError(c, vErrField("tags", "each tag must be at most 64 characters"))
		}
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.SetVMTags(c.Context(), vmExt, in.Tags); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

// ---- Serial console ----

// handleSerialConsole opens an xterm.js serial session, mirroring
// handleVNCSession: the URL is encrypted before being stored in
// vm_console_sessions (the schema places no CHECK on console_type, so
// 'serial' is stored verbatim) and returned with its expiry timestamp.
// service_kind=container instances dispatch to the provider's container
// serial console; everything else keeps the VM path.
func (s *Server) handleSerialConsole(c fiber.Ctx) error {
	ctx := c.Context()
	instanceID, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	kind, err := getInstanceserviceKind(ctx, s.db, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}

	var url string
	var expireUnix int64
	if kind == "container" {
		url, expireUnix, err = pv.ContainerSerialConsole(ctx, vmExt)
	} else {
		url, expireUnix, err = pv.SerialConsole(ctx, vmExt)
	}
	if err != nil {
		return mw.WriteError(c, err)
	}

	key := sha256.Sum256([]byte("vnc:" + s.cfg.SecretEncryptionKey))
	cipherText, cerr := crypto.Encrypt(key[:], []byte(url))
	if cerr != nil {
		return mw.WriteError(c, cerr)
	}

	var expiresAt any
	if expireUnix > 0 {
		expiresAt = expireUnix
	}
	if _, err := s.db.Exec(ctx, `
INSERT INTO vm_console_sessions(instance_id, requested_by, console_type, url_ciphertext, expires_at)
VALUES ($1,$2,'serial',$3, CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint) END)`,
		instanceID, mustUserID(c), cipherText, expiresAt); err != nil {
		return mw.WriteError(c, err)
	}

	return mw.JSON(c, 200, fiber.Map{
		"serial_url": url,
		"expire_at":  expireUnix,
	}, nil)
}

// ---- Metrics & guest agent ----

var metricsTimeframes = map[string]bool{
	"hour": true, "day": true, "week": true, "month": true,
}

// handleInstanceMetrics serves the provider's round-robin metric series as-is;
// only PVE's timeframe vocabulary (hour/day/week/month) is accepted.
// service_kind=container instances read the container RRD series instead of
// the guest (qemu) one.
func (s *Server) handleInstanceMetrics(c fiber.Ctx) error {
	instanceID, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	timeframe := strings.ToLower(strings.TrimSpace(c.Query("timeframe", "hour")))
	if timeframe == "" {
		timeframe = "hour"
	}
	if !metricsTimeframes[timeframe] {
		return mw.WriteError(c, vErrField("timeframe", "must be one of hour, day, week, month"))
	}
	kind, err := getInstanceserviceKind(c.Context(), s.db, instanceID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var data any
	if kind == "container" {
		data, err = pv.ContainerMetrics(c.Context(), vmExt, timeframe)
	} else {
		data, err = pv.GuestMetrics(c.Context(), vmExt, timeframe)
	}
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, data, nil)
}

func (s *Server) handleAgentOSInfo(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	data, err := pv.GuestAgentOSInfo(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, data, nil)
}

func (s *Server) handleAgentFSInfo(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	data, err := pv.GuestAgentFSInfo(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, data, nil)
}

func (s *Server) handleAgentInfo(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	data, err := pv.GuestAgentInfo(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, data, nil)
}

func (s *Server) handleAgentPing(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.GuestAgentPing(c.Context(), vmExt); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "ok"}, nil)
}

// ---- Per-VM firewall ----

// vmFirewallRuleInput mirrors provider.ProviderFirewallRule with JSON tags so
// customers can post a normalized rule; normalization applies defaults and
// canonical casing before the rule reaches the provider adapter.
type vmFirewallRuleInput struct {
	Enabled     bool   `json:"enabled"`
	Type        string `json:"type"`
	Action      string `json:"action"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Proto       string `json:"proto"`
	DestPort    string `json:"dest_port"`
	SourcePort  string `json:"source_port"`
	Comment     string `json:"comment"`
}

func (in vmFirewallRuleInput) normalize() (provider.ProviderFirewallRule, error) {
	out := provider.ProviderFirewallRule{
		Enabled:     true,
		Type:        strings.ToLower(strings.TrimSpace(in.Type)),
		Action:      strings.ToUpper(strings.TrimSpace(in.Action)),
		Source:      strings.TrimSpace(in.Source),
		Destination: strings.TrimSpace(in.Destination),
		Proto:       strings.ToLower(strings.TrimSpace(in.Proto)),
		DestPort:    strings.TrimSpace(in.DestPort),
		SourcePort:  strings.TrimSpace(in.SourcePort),
		Comment:     strings.TrimSpace(in.Comment),
	}
	switch out.Type {
	case "":
		out.Type = "in"
	case "in", "out":
	default:
		return out, vErrField("type", `must be "in" or "out"`)
	}
	switch out.Action {
	case "":
		out.Action = "ACCEPT"
	case "ACCEPT", "DROP", "REJECT":
	default:
		return out, vErrField("action", "must be ACCEPT, DROP or REJECT")
	}
	return out, nil
}

func (s *Server) handleListVMFirewallRules(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rules, err := pv.FirewallRulesList(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"rules": rules}, nil)
}

func (s *Server) handleCreateVMFirewallRule(c fiber.Ctx) error {
	var in vmFirewallRuleInput
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	rule, verr := in.normalize()
	if verr != nil {
		return mw.WriteError(c, verr)
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.CreateFirewallRule(c.Context(), vmExt, rule); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) handleDeleteVMFirewallRule(c fiber.Ctx) error {
	pos, err := strconv.Atoi(c.Params("pos"))
	if err != nil || pos < 0 {
		return mw.WriteError(c, vErrField("pos", "must be a non-negative integer"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.DeleteFirewallRule(c.Context(), vmExt, pos); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) handleGetVMFirewallOptions(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	opts, err := pv.FirewallOptionsMap(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"options": opts}, nil)
}

// handleUpdateVMFirewallOptions forwards a free-form option map to the
// provider; rule-level keys are rejected up front because they belong on
// firewall rules, not on the VM options record.
func (s *Server) handleUpdateVMFirewallOptions(c fiber.Ctx) error {
	var opts map[string]any
	if err := c.Bind().Body(&opts); err != nil || opts == nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	for _, key := range []string{"dport", "proto", "action"} {
		if _, ok := opts[key]; ok {
			return mw.WriteError(c, vErrField(key, "belongs on firewall rules, not firewall options"))
		}
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.SetFirewallOptionsMap(c.Context(), vmExt, opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

// ---- Per-VM firewall ipsets ----

// ipsetNamePattern constrains ipset names to the lowercase identifier shape
// PVE accepts (+ipset/<name> references in rules stay unambiguous).
var ipsetNamePattern = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

func (s *Server) handleListVMFirewallIPSets(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	sets, err := pv.FirewallIPSetsList(c.Context(), vmExt)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"ipsets": sets}, nil)
}

func (s *Server) handleCreateVMFirewallIPSet(c fiber.Ctx) error {
	var in struct {
		Name    string `json:"name"`
		Comment string `json:"comment"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	name := strings.TrimSpace(in.Name)
	if !ipsetNamePattern.MatchString(name) {
		return mw.WriteError(c, vErrField("name", "must be 1-32 characters of [a-z0-9_-]"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.CreateFirewallIPSet(c.Context(), vmExt, name, in.Comment); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) handleDeleteVMFirewallIPSet(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.DeleteFirewallIPSet(c.Context(), vmExt, c.Params("name"), c.Query("force") == "1"); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) handleListVMFirewallIPSetEntries(c fiber.Ctx) error {
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	entries, err := pv.FirewallIPSetEntriesList(c.Context(), vmExt, c.Params("name"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"entries": entries}, nil)
}

func (s *Server) handleAddVMFirewallIPSetEntry(c fiber.Ctx) error {
	var in struct {
		CIDR    string `json:"cidr"`
		Comment string `json:"comment"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	cidr := strings.TrimSpace(in.CIDR)
	if cidr == "" {
		return mw.WriteError(c, vErrField("cidr", "cidr is required"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.AddFirewallIPSetEntry(c.Context(), vmExt, c.Params("name"), cidr, in.Comment); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

// handleUpdateVMFirewallIPSetEntry rewrites one entry; the trailing wildcard
// segment carries the current CIDR (it contains slashes) while the body may
// move it to new_cidr and/or rewrite the comment.
func (s *Server) handleUpdateVMFirewallIPSetEntry(c fiber.Ctx) error {
	cidr := strings.TrimSpace(c.Params("*"))
	if cidr == "" {
		return mw.WriteError(c, errValidation("cidr path param required"))
	}
	var in struct {
		NewCIDR string `json:"new_cidr"`
		Comment string `json:"comment"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid payload"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.UpdateFirewallIPSetEntry(c.Context(), vmExt, c.Params("name"), cidr,
		strings.TrimSpace(in.NewCIDR), in.Comment); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

// handleRemoveVMFirewallIPSetEntry drops one CIDR row identified by the
// mandatory cidr query parameter.
func (s *Server) handleRemoveVMFirewallIPSetEntry(c fiber.Ctx) error {
	cidr := strings.TrimSpace(c.Query("cidr"))
	if cidr == "" {
		return mw.WriteError(c, vErrField("cidr", "query parameter cidr is required"))
	}
	_, vmExt, pv, err := s.ownedVMContext(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := pv.RemoveFirewallIPSetEntry(c.Context(), vmExt, c.Params("name"), cidr); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}
