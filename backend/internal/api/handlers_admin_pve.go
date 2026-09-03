// Admin-plane operations over the full breadth of the Proxmox adapter:
// instance clone/template/move-volume plus node & cluster observability,
// ad-hoc backups, backup jobs, HA resources, firewall groups and cluster
// firewall rules, pools, Ceph status, and SDN inventory. All routes ride
// requireStaff("auto"): /providers reads resolve to the infra area (NOC)
// while every mutation stays platform_admin-only, and /instances routes
// belong to infra.
//
// PROXMOX-ONLY file: every handler here is proxmox murni (cluster, nodes,
// disks, certs, command, backup, storages, backup-jobs, ha, fw, pools, sdn,
// ceph, containers via handlers_admin_proxmox.go). Onidel / VMware / Dokploy
// live in their own files (handlers_isos.go / handlers_admin_vmware.go /
// handlers_dokploy.go) — kode, id, slug semua prefix provider. Guard kind
// check di tiap handler via proxmoxAdapterFor (if kind != proxmox return
// 501 expect proxmox); instance handlers check kind explicitly.
package api

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	goproxmox "github.com/luthermonson/go-proxmox"

	"kilat.cloud/backend/internal/provider"
	"kilat.cloud/backend/internal/provider/proxmox"
	apperrors "kilat.cloud/backend/pkg/errors"
	mw "kilat.cloud/backend/pkg/middleware"
)

// admInstanceProvider resolves an admin-targeted instance (no organization
// scoping) to its external VM id and owning provider adapter; instances
// without a live external mapping answer 404/conflict like the user plane.
func (s *Server) admInstanceProvider(c fiber.Ctx) (uuid.UUID, string, provider.ComputeProvider, error) {
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	var ext *string
	err = s.db.QueryRow(c.Context(), `
SELECT i.external_vm_id FROM instances i
WHERE i.id=$1 AND i.deleted_at IS NULL`, instanceID).Scan(&ext)
	if err != nil {
		return uuid.Nil, "", nil, apperrors.New(apperrors.CodeNotFound, "instance not found")
	}
	if ext == nil || *ext == "" {
		return uuid.Nil, "", nil, apperrors.New(apperrors.CodeConflict, "instance has no provider mapping yet")
	}
	pv, err := s.instanceProvider(c.Context(), instanceID)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	return instanceID, *ext, pv, nil
}

// ---- Clone / template / move-volume ----

// adminCloneInstance queues an asynchronous clone of a self-hosted (proxmox)
// instance through the provisioning worker; other provider kinds answer 501
// via CodeUnsupported so Onidel instances are rejected up front.
func (s *Server) adminCloneInstance(c fiber.Ctx) error {
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Name) == "" {
		return mw.WriteError(c, vErrField("name", "name is required"))
	}
	name := strings.TrimSpace(in.Name)

	ctx := c.Context()
	var kind string
	err = s.db.QueryRow(ctx, `
SELECT p.kind::text FROM instances i JOIN providers p ON p.id=i.provider_id
WHERE i.id=$1 AND i.deleted_at IS NULL`, instanceID).Scan(&kind)
	if err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if kind != proxmox.ProviderCode {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"clone is only supported for proxmox instances (kind=%q) expect proxmox", kind))
	}
	jobID, err := s.admEnqueueJob(ctx, "provisioning", "clone_instance", "instance", instanceID,
		map[string]any{"instance_id": instanceID.String(), "name": name})
	if err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.clone", "instance", &instanceID, map[string]any{
		"job_id": jobID, "name": name,
	})
	return mw.JSON(c, 202, fiber.Map{"id": instanceID, "job_id": jobID, "name": name}, nil)
}

// adminConvertToTemplate converts a VM into a PVE template synchronously;
// proxmox murni only — guard kind via instance's provider before touching the
// adapter so onidel/vmware/dokploy answer 501 expect proxmox.
func (s *Server) adminConvertToTemplate(c fiber.Ctx) error {
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var kind string
	if err := s.db.QueryRow(c.Context(),
		`SELECT p.kind::text FROM instances i JOIN providers p ON p.id=i.provider_id WHERE i.id=$1 AND i.deleted_at IS NULL`, instanceID).Scan(&kind); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if kind != proxmox.ProviderCode {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"template conversion is only available for proxmox instances (kind=%q) expect proxmox", kind))
	}
	_, ext, pv, gerr := s.admInstanceProvider(c)
	if gerr != nil {
		return mw.WriteError(c, gerr)
	}
	if err := pv.ConvertToTemplate(c.Context(), ext); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.template", "instance", &instanceID, nil)
	return mw.JSON(c, 200, fiber.Map{"id": instanceID, "status": "template"}, nil)
}

// adminMoveVolume moves one guest volume to another storage synchronously.
// proxmox murni only — same kind guard as convert.
func (s *Server) adminMoveVolume(c fiber.Ctx) error {
	instanceID, err := admParseUUIDParam(c, "instance_id", "instance_id")
	if err != nil {
		return mw.WriteError(c, err)
	}
	var kind string
	if err := s.db.QueryRow(c.Context(),
		`SELECT p.kind::text FROM instances i JOIN providers p ON p.id=i.provider_id WHERE i.id=$1 AND i.deleted_at IS NULL`, instanceID).Scan(&kind); err != nil {
		return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "instance not found"))
	}
	if kind != proxmox.ProviderCode {
		return mw.WriteError(c, apperrors.Newf(apperrors.CodeUnsupported,
			"move-volume is only available for proxmox instances (kind=%q) expect proxmox", kind))
	}
	_, ext, pv, gerr := s.admInstanceProvider(c)
	if gerr != nil {
		return mw.WriteError(c, gerr)
	}
	var in struct {
		Volume        string `json:"volume"`
		TargetStorage string `json:"target_storage"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Volume) == "" {
		return mw.WriteError(c, vErrField("volume", "volume and target_storage are required"))
	}
	if strings.TrimSpace(in.TargetStorage) == "" {
		return mw.WriteError(c, vErrField("target_storage", "target_storage is required"))
	}
	volume := strings.TrimSpace(in.Volume)
	targetStorage := strings.TrimSpace(in.TargetStorage)
	if err := pv.MoveVolume(c.Context(), ext, volume, targetStorage); err != nil {
		return mw.WriteError(c, err)
	}
	s.admAuditMeta(c, "admin.instance.move_volume", "instance", &instanceID, map[string]any{
		"volume": volume, "target_storage": targetStorage,
	})
	return mw.JSON(c, 200, fiber.Map{"id": instanceID, "status": "moved"}, nil)
}

// ---- Node observability & operations ----

func (s *Server) adminNodeDetail(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node, err := ad.Client().NodeStatusDetail(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, node, nil)
}

func (s *Server) adminNodeDisks(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	disks, err := ad.Client().NodeDisks(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, disks, nil)
}

func (s *Server) adminNodeCertificates(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	certs, err := ad.Client().NodeCertificates(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, certs, nil)
}

// adminNodeCommand issues reboot/shutdown/wakeonlan against one node; the
// wrapper re-validates the command vocabulary on its own.
func (s *Server) adminNodeCommand(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Command string `json:"command"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Command) == "" {
		return mw.WriteError(c, vErrField("command", "command is required"))
	}
	command := strings.TrimSpace(in.Command)
	switch command {
	case "reboot", "shutdown", "wakeonlan":
	default:
		return mw.WriteError(c, vErrField("command", "must be reboot, shutdown or wakeonlan"))
	}
	task, err := ad.Client().NodeCommand(c.Context(), c.Params("node"), command)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": c.Params("node"), "command": command, "task": task}, nil)
}

// adminNodeBackup runs an ad-hoc vzdump backup of one guest onto a storage.
func (s *Server) adminNodeBackup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Storage string `json:"storage"`
		Mode    string `json:"mode"`
		VMID    int    `json:"vmid"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Storage) == "" {
		return mw.WriteError(c, vErrField("storage", "storage is required"))
	}
	if in.VMID <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	task, err := ad.Client().VzdumpBackup(c.Context(), c.Params("node"), in.VMID,
		strings.TrimSpace(in.Storage), strings.TrimSpace(in.Mode))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{
		"node": c.Params("node"), "vmid": in.VMID, "storage": strings.TrimSpace(in.Storage), "task": task,
	}, nil)
}

// ---- Storage content ----

func (s *Server) adminStorageContentList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Query("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "query parameter node is required"))
	}
	content, err := ad.Client().StorageContentList(c.Context(), node, c.Params("storage"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, content, nil)
}

func (s *Server) adminDeleteStorageContent(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Query("node"))
	volume := strings.TrimSpace(c.Query("volume"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "query parameter node is required"))
	}
	if volume == "" {
		return mw.WriteError(c, vErrField("volume", "query parameter volume is required"))
	}
	task, err := ad.Client().DeleteStorageContent(c.Context(), node, c.Params("storage"), volume)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "deleting", "task": task}, nil)
}

// ---- Scheduled backup jobs ----

func (s *Server) adminListBackupJobs(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	jobs, err := ad.Client().BackupJobsList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, jobs, nil)
}

func (s *Server) adminCreateBackupJob(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.ClusterBackupOptions
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid backup job payload"))
	}
	if err := ad.Client().BackupJobCreate(c.Context(), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminUpdateBackupJob(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.ClusterBackupOptions
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid backup job payload"))
	}
	if err := ad.Client().BackupJobUpdate(c.Context(), c.Params("job_id"), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminDeleteBackupJob(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := ad.Client().BackupJobDelete(c.Context(), c.Params("job_id")); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

// ---- HA resources ----

func (s *Server) adminListHAResources(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	resources, err := ad.Client().HAResourcesList(c.Context(), c.Query("type"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, resources, nil)
}

func (s *Server) adminCreateHAResource(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.HAResourceCreateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha resource payload"))
	}
	if strings.TrimSpace(opts.SID) == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	if err := ad.Client().HAResourceCreate(c.Context(), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminDeleteHAResource(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	sid := strings.TrimSpace(c.Query("sid"))
	if sid == "" {
		return mw.WriteError(c, vErrField("sid", "query parameter sid is required"))
	}
	if err := ad.Client().HAResourceDelete(c.Context(), sid, c.Query("purge") == "true"); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

// ---- Cluster log & tasks ----

func (s *Server) adminClusterLog(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	max := 100
	if n, perr := strconv.Atoi(c.Query("max")); perr == nil && n > 0 {
		max = n
	}
	entries, err := ad.Client().ClusterLogEntries(c.Context(), max)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, entries, nil)
}

func (s *Server) adminClusterTasks(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	tasks, err := ad.Client().ClusterTaskList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, tasks, nil)
}

// ---- Firewall security groups & cluster firewall ----

func (s *Server) adminListFWGroups(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	groups, err := ad.Client().FWGroupsList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, groups, nil)
}

func (s *Server) adminCreateFWGroup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var group goproxmox.FirewallSecurityGroup
	if err := c.Bind().Body(&group); err != nil {
		return mw.WriteError(c, errValidation("invalid fw group payload"))
	}
	if strings.TrimSpace(group.Group) == "" {
		return mw.WriteError(c, vErrField("group", "group name is required"))
	}
	if err := ad.Client().FWGroupCreate(c.Context(), &group); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminDeleteFWGroup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	name := strings.TrimSpace(c.Query("name"))
	if name == "" {
		return mw.WriteError(c, vErrField("name", "query parameter name is required"))
	}
	if err := ad.Client().FWGroupDelete(c.Context(), name); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) adminListFWGroupRules(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rules, err := ad.Client().FWGroupRulesList(c.Context(), c.Params("group"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, rules, nil)
}

func (s *Server) adminCreateFWGroupRule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var rule goproxmox.FirewallRule
	if err := c.Bind().Body(&rule); err != nil {
		return mw.WriteError(c, errValidation("invalid fw rule payload"))
	}
	if err := ad.Client().FWGroupRuleCreate(c.Context(), c.Params("group"), &rule); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminDeleteFWGroupRule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	pos, cerr := strconv.Atoi(c.Params("pos"))
	if cerr != nil || pos < 0 {
		return mw.WriteError(c, vErrField("pos", "must be a non-negative integer"))
	}
	if err := ad.Client().FWGroupRuleDelete(c.Context(), c.Params("group"), pos); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) adminListClusterFirewallRules(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rules, err := ad.Client().ClusterFirewallRules(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, rules, nil)
}

func (s *Server) adminCreateClusterFirewallRule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var rule goproxmox.FirewallRule
	if err := c.Bind().Body(&rule); err != nil {
		return mw.WriteError(c, errValidation("invalid fw rule payload"))
	}
	if err := ad.Client().ClusterFirewallRuleCreate(c.Context(), &rule); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminDeleteClusterFirewallRule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	pos, cerr := strconv.Atoi(c.Params("pos"))
	if cerr != nil || pos < 0 {
		return mw.WriteError(c, vErrField("pos", "must be a non-negative integer"))
	}
	if err := ad.Client().ClusterFirewallRuleDelete(c.Context(), pos); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

// ---- Pools ----

func (s *Server) adminListPools(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	pools, err := ad.Client().PoolsList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, pools, nil)
}

func (s *Server) adminCreatePool(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		PoolID  string `json:"poolid"`
		Comment string `json:"comment"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.PoolID) == "" {
		return mw.WriteError(c, vErrField("poolid", "poolid is required"))
	}
	if err := ad.Client().PoolCreate(c.Context(), strings.TrimSpace(in.PoolID), in.Comment); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminUpdatePool(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Comment string `json:"comment"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid pool payload"))
	}
	if err := ad.Client().PoolUpdate(c.Context(), c.Params("pool_id"), in.Comment); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminDeletePool(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := ad.Client().PoolDelete(c.Context(), c.Params("pool_id")); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

// ---- Ceph & SDN ----

func (s *Server) adminCephStatus(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	status, err := ad.Client().CephStatus(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, status, nil)
}

func (s *Server) adminSDNZones(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	zones, err := ad.Client().SDNZones(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, zones, nil)
}

func (s *Server) adminSDNVNets(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	vnets, err := ad.Client().SDNVNets(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, vnets, nil)
}

// ---- Backup job run-now / HA watchdog / pool members / file-restore ----

// adminBackupJobRunNow triggers one immediate run of a scheduled backup job.
func (s *Server) adminBackupJobRunNow(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	task, err := ad.BackupJobRunNow(c.Context(), c.Params("job_id"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"job_id": c.Params("job_id"), "status": "running", "task": task}, nil)
}

func (s *Server) adminHAArm(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := ad.HAArm(c.Context()); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "armed"}, nil)
}

func (s *Server) adminHADisarm(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Mode string `json:"mode"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid ha payload"))
	}
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	switch mode {
	case "freeze", "ignore":
	default:
		return mw.WriteError(c, vErrField("mode", "must be freeze or ignore"))
	}
	if err := ad.HADisarm(c.Context(), mode); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "disarmed", "mode": mode}, nil)
}

func (s *Server) adminPoolUpdateMembers(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Comment  string `json:"comment"`
		VMs      string `json:"vms"`
		Storages string `json:"storages"`
		Delete   bool   `json:"delete"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid pool payload"))
	}
	if err := ad.PoolUpdateMembers(c.Context(), c.Params("pool_id"),
		in.Comment, in.VMs, in.Storages, in.Delete); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminBackupFileRestoreList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Query("node"))
	volume := strings.TrimSpace(c.Query("volume"))
	filepath := strings.TrimSpace(c.Query("path"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "query parameter node is required"))
	}
	if volume == "" {
		return mw.WriteError(c, vErrField("volume", "query parameter volume is required"))
	}
	if filepath == "" {
		return mw.WriteError(c, vErrField("path", "query parameter path is required"))
	}
	entries, err := ad.BackupFileRestoreList(c.Context(), node, c.Params("storage"), volume, filepath)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, entries, nil)
}

// ---- Cluster storages ----

// scalarJSON renders a JSON-decoded body value as the flat string the
// ClusterStorageOptions pair expects; only non-string scalars need marshaling.
func scalarJSON(val any) string {
	if str, ok := val.(string); ok {
		return strings.TrimSpace(str)
	}
	b, _ := json.Marshal(val)
	return string(b)
}

// clusterStorageOptions flattens a free-form JSON body into the SDK's
// name/value option pairs. requireIdentity pins the storage/type keys a create
// call must carry first on the wire; updates accept any subset.
func clusterStorageOptions(in map[string]any, requireIdentity bool) ([]goproxmox.ClusterStorageOptions, error) {
	opts := make([]goproxmox.ClusterStorageOptions, 0, len(in)+2)
	if requireIdentity {
		storage, _ := in["storage"].(string)
		stype, _ := in["type"].(string)
		if strings.TrimSpace(storage) == "" {
			return nil, vErrField("storage", "storage is required")
		}
		if strings.TrimSpace(stype) == "" {
			return nil, vErrField("type", "type is required")
		}
		opts = append(opts,
			goproxmox.ClusterStorageOptions{Name: "storage", Value: strings.TrimSpace(storage)},
			goproxmox.ClusterStorageOptions{Name: "type", Value: strings.TrimSpace(stype)},
		)
	}
	for key, val := range in {
		if requireIdentity && (key == "storage" || key == "type") {
			continue // already pinned above so PVE reads them before the rest
		}
		opts = append(opts, goproxmox.ClusterStorageOptions{Name: key, Value: scalarJSON(val)})
	}
	return opts, nil
}

func (s *Server) adminClusterStoragesList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	storages, err := ad.ClusterStoragesList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, storages, nil)
}

func (s *Server) adminClusterStorageCreate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in map[string]any
	if err := c.Bind().Body(&in); err != nil || in == nil {
		return mw.WriteError(c, errValidation("invalid cluster storage payload"))
	}
	opts, verr := clusterStorageOptions(in, true)
	if verr != nil {
		return mw.WriteError(c, verr)
	}
	task, err := ad.ClusterStorageCreate(c.Context(), opts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created", "task": task}, nil)
}

func (s *Server) adminClusterStorageUpdate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in map[string]any
	if err := c.Bind().Body(&in); err != nil || in == nil {
		return mw.WriteError(c, errValidation("invalid cluster storage payload"))
	}
	opts, verr := clusterStorageOptions(in, false)
	if verr != nil {
		return mw.WriteError(c, verr)
	}
	task, err := ad.ClusterStorageUpdate(c.Context(), c.Params("name"), opts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "task": task}, nil)
}

func (s *Server) adminClusterStorageDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	task, err := ad.ClusterStorageDelete(c.Context(), c.Params("name"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"status": "deleting", "task": task}, nil)
}

// ---- Node resolvers, clock & CPU models ----

func (s *Server) adminNodeDNSGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	dns, err := ad.NodeDNSGet(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, dns, nil)
}

func (s *Server) adminNodeDNSSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Search string `json:"search"`
		DNS1   string `json:"dns1"`
		DNS2   string `json:"dns2"`
		DNS3   string `json:"dns3"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid dns payload"))
	}
	search := strings.TrimSpace(in.Search)
	if search == "" {
		return mw.WriteError(c, vErrField("search", "search is required"))
	}
	if err := ad.NodeDNSSet(c.Context(), c.Params("node"), search,
		strings.TrimSpace(in.DNS1), strings.TrimSpace(in.DNS2), strings.TrimSpace(in.DNS3)); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminNodeTimeGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	clock, err := ad.NodeTimeGet(c.Context(), c.Params("node"))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, clock, nil)
}

// adminProviderCPUModels lists the QEMU CPU models guests may use. The PVE
// endpoint is node-scoped, so an optional node query picks one explicitly and
// otherwise the first node reported by the cluster answers.
func (s *Server) adminProviderCPUModels(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Query("node"))
	if node == "" {
		nodes, nerr := ad.Nodes(c.Context())
		if nerr != nil {
			return mw.WriteError(c, nerr)
		}
		if len(nodes) == 0 || nodes[0].Node == "" {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "cluster reports no nodes"))
		}
		node = nodes[0].Node
	}
	arch := strings.TrimSpace(c.Query("arch", "x86_64"))
	models, err := ad.NodeQEMUCPUModels(c.Context(), node, arch)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "arch": arch, "models": models}, nil)
}
