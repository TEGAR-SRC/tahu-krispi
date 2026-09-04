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
	"net/url"
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

func (s *Server) adminNodeCertificateUpload(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Certificates string `json:"certificates"`
		Key          string `json:"key"`
		Force        bool   `json:"force"`
		Restart      bool   `json:"restart"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid certificate payload"))
	}
	if strings.TrimSpace(in.Certificates) == "" {
		return mw.WriteError(c, vErrField("certificates", "certificates (PEM chain) is required"))
	}
	if strings.TrimSpace(in.Key) == "" {
		return mw.WriteError(c, vErrField("key", "private key (PEM) is required"))
	}
	if err := ad.Client().NodeCertificateUpload(c.Context(), c.Params("node"), &goproxmox.CustomCertificate{
		Certificates: strings.TrimSpace(in.Certificates),
		Key:          strings.TrimSpace(in.Key),
		Force:        in.Force,
		Restart:      in.Restart,
	}); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "uploaded", "node": c.Params("node")}, nil)
}

func (s *Server) adminNodeCertificateDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := ad.Client().NodeCertificateDelete(c.Context(), c.Params("node")); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "node": c.Params("node")}, nil)
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

// ---- Replication jobs ----

func (s *Server) adminListReplicationJobs(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	jobs, err := ad.Client().ReplicationJobsList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if jobs == nil {
		jobs = []*goproxmox.ReplicationJob{}
	}
	return mw.JSON(c, 200, jobs, nil)
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

func (s *Server) adminUpdateHAResource(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	sid := strings.TrimSpace(c.Params("sid"))
	if sid == "" {
		return mw.WriteError(c, vErrField("sid", "sid is required"))
	}
	if decoded, derr := url.PathUnescape(sid); derr == nil {
		sid = decoded
	}
	var opts goproxmox.HAResourceUpdateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha resource payload"))
	}
	if err := ad.Client().HAResourceUpdate(c.Context(), sid, &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "sid": sid}, nil)
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

// ---- HA groups & rules ----

func (s *Server) adminListHAGroups(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	groups, err := ad.Client().HAGroupsList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, groups, nil)
}

func (s *Server) adminCreateHAGroup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.HAGroupCreateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha group payload"))
	}
	if strings.TrimSpace(opts.Group) == "" {
		return mw.WriteError(c, vErrField("group", "group is required"))
	}
	if strings.TrimSpace(opts.Nodes) == "" {
		return mw.WriteError(c, vErrField("nodes", "nodes is required"))
	}
	if err := ad.Client().HAGroupCreate(c.Context(), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminUpdateHAGroup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.HAGroupUpdateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha group payload"))
	}
	if strings.TrimSpace(c.Params("group")) == "" {
		return mw.WriteError(c, vErrField("group", "group is required"))
	}
	if err := ad.Client().HAGroupUpdate(c.Context(), c.Params("group"), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminDeleteHAGroup(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	group := strings.TrimSpace(c.Params("group"))
	if group == "" {
		return mw.WriteError(c, vErrField("group", "group is required"))
	}
	if err := ad.Client().HAGroupDelete(c.Context(), group); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted"}, nil)
}

func (s *Server) adminListHARules(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rules, err := ad.Client().HARulesList(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, rules, nil)
}

func (s *Server) adminCreateHARule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.HARuleCreateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha rule payload"))
	}
	if strings.TrimSpace(opts.Rule) == "" {
		return mw.WriteError(c, vErrField("rule", "rule is required"))
	}
	if strings.TrimSpace(opts.Type) == "" {
		return mw.WriteError(c, vErrField("type", "type is required"))
	}
	if strings.TrimSpace(opts.Resources) == "" {
		return mw.WriteError(c, vErrField("resources", "resources is required"))
	}
	if err := ad.Client().HARuleCreate(c.Context(), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created"}, nil)
}

func (s *Server) adminUpdateHARule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var opts goproxmox.HARuleUpdateOption
	if err := c.Bind().Body(&opts); err != nil {
		return mw.WriteError(c, errValidation("invalid ha rule payload"))
	}
	if strings.TrimSpace(c.Params("rule")) == "" {
		return mw.WriteError(c, vErrField("rule", "rule is required"))
	}
	if err := ad.Client().HARuleUpdate(c.Context(), c.Params("rule"), &opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
}

func (s *Server) adminDeleteHARule(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rule := strings.TrimSpace(c.Params("rule"))
	if rule == "" {
		return mw.WriteError(c, vErrField("rule", "rule is required"))
	}
	if err := ad.Client().HARuleDelete(c.Context(), rule); err != nil {
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

// ---- Firewall aliases (cluster /firewall/aliases) ----

func (s *Server) adminListFWAliases(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	aliases, err := ad.Client().FirewallAliases(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if aliases == nil {
		aliases = []*goproxmox.FirewallAlias{}
	}
	return mw.JSON(c, 200, aliases, nil)
}

func (s *Server) adminCreateFWAlias(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in goproxmox.FirewallAliasCreateOption
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid fw alias payload"))
	}
	if strings.TrimSpace(in.Name) == "" {
		return mw.WriteError(c, vErrField("name", "name is required"))
	}
	if strings.TrimSpace(in.CIDR) == "" {
		return mw.WriteError(c, vErrField("cidr", "cidr is required"))
	}
	in.Name = strings.TrimSpace(in.Name)
	in.CIDR = strings.TrimSpace(in.CIDR)
	in.Comment = strings.TrimSpace(in.Comment)
	if err := ad.Client().FirewallAliasCreate(c.Context(), &in); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created", "name": in.Name}, nil)
}

func (s *Server) adminDeleteFWAlias(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	name := strings.TrimSpace(c.Params("name"))
	if name == "" {
		name = strings.TrimSpace(c.Query("name"))
	}
	if name == "" {
		return mw.WriteError(c, vErrField("name", "name is required"))
	}
	if err := ad.Client().FirewallAliasDelete(c.Context(), name); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "name": name}, nil)
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

// adminCephPoolDetail returns status for one Ceph pool. GET infra-readable (NOC + platform_admin),
// proxmox murni via proxmoxAdapterFor guard (non-proxmox -> 501 expect proxmox). PVE address is
// node-scoped (/nodes/{node}/ceph/pool/{pool}/status): the handler accepts ?node= and ?verbose=1.
// When ?node= is omitted the first online node answers (like adminProviderCPUModels), so the
// route stays node-free: GET /admin/proxmox/:id/ceph/pools/:pool.
func (s *Server) adminCephPoolDetail(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	pool := strings.TrimSpace(c.Params("pool"))
	if pool == "" {
		return mw.WriteError(c, vErrField("pool", "pool name is required"))
	}
	node := strings.TrimSpace(c.Query("node"))
	if node == "" {
		nodes, nerr := ad.Nodes(c.Context())
		if nerr != nil {
			return mw.WriteError(c, nerr)
		}
		for _, n := range nodes {
			if n.Status == "online" && strings.TrimSpace(n.Node) != "" {
				node = strings.TrimSpace(n.Node)
				break
			}
		}
		if node == "" && len(nodes) > 0 {
			candidate := strings.TrimSpace(nodes[0].Node)
			if candidate == "" {
				candidate = strings.TrimSpace(nodes[0].Name)
			}
			node = candidate
		}
		if node == "" {
			return mw.WriteError(c, apperrors.New(apperrors.CodeNotFound, "cluster reports no nodes for ceph pool lookup"))
		}
	}
	verbose := strings.TrimSpace(c.Query("verbose")) == "1" || strings.EqualFold(strings.TrimSpace(c.Query("verbose")), "true")
	status, err := ad.Client().CephPoolStatus(c.Context(), node, pool, verbose)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "pool": pool, "status": status}, nil)
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

func (s *Server) adminHAManagerStatus(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	status, err := ad.Client().HAManagerStatus(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, status, nil)
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
	poolID := c.Params("pool_id")
	if poolID == "" {
		poolID = c.Params("pool")
	}
	if err := ad.PoolUpdateMembers(c.Context(), poolID,
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

func (s *Server) adminNodeTimeSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		Timezone string `json:"timezone"`
	}
	if err := c.Bind().Body(&in); err != nil {
		return mw.WriteError(c, errValidation("invalid time payload"))
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		return mw.WriteError(c, vErrField("timezone", "timezone is required"))
	}
	if err := ad.NodeTimeSet(c.Context(), c.Params("node"), tz); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated"}, nil)
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

// adminNodeSerialProxy returns a node host-shell termproxy ticket (xterm.js).
// GET /admin/proxmox/:id/nodes/:node/serial-proxy — infra-readable (NOC + platform_admin),
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminNodeSerialProxy(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	term, err := ad.Client().NodeTermProxy(c.Context(), node)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, term, nil)
}

func (s *Server) adminNodeReport(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	report, err := ad.Client().NodeReport(c.Context(), node)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "report": report}, nil)
}

// adminPruneBackupsPreview lists which backups WOULD be removed by the keep policy (dry-run).
// GET /admin/proxmox/:id/nodes/:node/prune?storage=&prune-backups=&type=&vmid=  -> infra readable.
func (s *Server) adminPruneBackupsPreview(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	storage := strings.TrimSpace(c.Query("storage"))
	if storage == "" {
		return mw.WriteError(c, vErrField("storage", "storage is required"))
	}
	pruneBackups := strings.TrimSpace(c.Query("prune-backups", c.Query("prune_backups")))
	typ := strings.TrimSpace(c.Query("type"))
	if typ != "" && typ != "qemu" && typ != "lxc" {
		return mw.WriteError(c, vErrField("type", "must be qemu or lxc"))
	}
	vmidStr := strings.TrimSpace(c.Query("vmid"))
	var vmid uint64
	if vmidStr != "" {
		parsed, perr := strconv.ParseUint(vmidStr, 10, 64)
		if perr != nil {
			return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
		}
		vmid = parsed
	}
	var opts *goproxmox.StoragePruneBackupsOptions
	if pruneBackups != "" || typ != "" || vmid != 0 {
		opts = &goproxmox.StoragePruneBackupsOptions{PruneBackups: pruneBackups, Type: typ, VMID: vmid}
	}
	items, err := ad.Client().PruneBackupsPreview(c.Context(), node, storage, opts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, items, nil)
}

// adminPruneBackups runs the keep-policy prune for real.
// POST /admin/proxmox/:id/nodes/:node/prune {storage, prune_backups, type, vmid} -> platform_admin only.
func (s *Server) adminPruneBackups(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	var raw map[string]any
	if err := c.Bind().Body(&raw); err != nil {
		return mw.WriteError(c, errValidation("invalid prune payload"))
	}
	storage := ""
	if v, ok := raw["storage"]; ok {
		if s, ok := v.(string); ok {
			storage = strings.TrimSpace(s)
		}
	}
	if storage == "" {
		storage = strings.TrimSpace(c.Query("storage"))
	}
	if storage == "" {
		return mw.WriteError(c, vErrField("storage", "storage is required"))
	}
	pruneBackups := ""
	if v, ok := raw["prune_backups"]; ok {
		if s, ok := v.(string); ok {
			pruneBackups = strings.TrimSpace(s)
		}
	}
	if v, ok := raw["prune-backups"]; ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			pruneBackups = strings.TrimSpace(s)
		}
	}
	if pruneBackups == "" {
		pruneBackups = strings.TrimSpace(c.Query("prune-backups", c.Query("prune_backups")))
	}
	typ := ""
	if v, ok := raw["type"]; ok {
		if s, ok := v.(string); ok {
			typ = strings.TrimSpace(s)
		}
	}
	if typ == "" {
		typ = strings.TrimSpace(c.Query("type"))
	}
	if typ != "" && typ != "qemu" && typ != "lxc" {
		return mw.WriteError(c, vErrField("type", "must be qemu or lxc"))
	}
	var vmid uint64
	if v, ok := raw["vmid"]; ok && v != nil {
		switch vv := v.(type) {
		case float64:
			vmid = uint64(vv)
		case string:
			if strings.TrimSpace(vv) != "" {
				parsed, perr := strconv.ParseUint(strings.TrimSpace(vv), 10, 64)
				if perr != nil {
					return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
				}
				vmid = parsed
			}
		case int:
			if vv > 0 {
				vmid = uint64(vv)
			}
		case int64:
			if vv > 0 {
				vmid = uint64(vv)
			}
		}
	}
	if vmid == 0 {
		if q := strings.TrimSpace(c.Query("vmid")); q != "" {
			parsed, perr := strconv.ParseUint(q, 10, 64)
			if perr != nil {
				return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
			}
			vmid = parsed
		}
	}
	var opts *goproxmox.StoragePruneBackupsOptions
	if pruneBackups != "" || typ != "" || vmid != 0 {
		opts = &goproxmox.StoragePruneBackupsOptions{PruneBackups: pruneBackups, Type: typ, VMID: vmid}
	}
	task, err := ad.Client().PruneBackups(c.Context(), node, storage, opts)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "storage": storage, "task": task}, nil)
}

// adminProxmoxCloudInitGet returns the pending cloud-init diff for one QEMU
// guest (GET /nodes/{node}/qemu/{vmid}/cloudinit). GET is infra-readable
// (NOC + platform_admin) via requireStaff("infra"); the live PVE response is
// a per-key diff — Value is what is applied, Pending is what a regenerate
// would write, Delete marks a key pending removal.
func (s *Server) adminProxmoxCloudInitGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	pending, err := ad.Client().CloudInitPending(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if pending == nil {
		pending = []*goproxmox.VirtualMachineCloudInitPending{}
	}
	return mw.JSON(c, 200, pending, nil)
}

// adminProxmoxQemuPerNode returns QEMU guests on one node via
// ClusterResources filtered to type=vm per node. GET is infra-readable.
func (s *Server) adminProxmoxQemuPerNode(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	resources, err := ad.Client().ClusterResources(c.Context(), "vm")
	if err != nil {
		return mw.WriteError(c, err)
	}
	filtered := make([]any, 0)
	for _, r := range resources {
		if r == nil {
			continue
		}
		if r.Node != node {
			continue
		}
		if r.Type != "qemu" {
			continue
		}
		filtered = append(filtered, r)
	}
	return mw.JSON(c, 200, filtered, nil)
}

// adminProxmoxNodeRRDData exposes node RRD series (GET /nodes/{node}/rrddata).
// GET /admin/proxmox/:id/nodes/:node/rrd?timeframe=&cf= — infra-readable.
func (s *Server) adminProxmoxNodeRRDData(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	timeframe := strings.TrimSpace(c.Query("timeframe"))
	if timeframe == "" {
		timeframe = "hour"
	}
	cf := strings.TrimSpace(c.Query("cf"))
	if cf == "" {
		cf = "AVERAGE"
	}
	data, err := ad.Client().NodeRRDData(c.Context(), node, timeframe, cf)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if data == nil {
		data = []*goproxmox.RRDData{}
	}
	return mw.JSON(c, 200, data, nil)
}

// adminProxmoxQemuRRDData exposes QEMU guest RRD series (GET /nodes/{node}/qemu/{vmid}/rrddata).
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/rrd?timeframe=&cf= — infra-readable.
func (s *Server) adminProxmoxQemuRRDData(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	timeframe := strings.TrimSpace(c.Query("timeframe"))
	if timeframe == "" {
		timeframe = "hour"
	}
	cf := strings.TrimSpace(c.Query("cf"))
	if cf == "" {
		cf = "AVERAGE"
	}
	data, err := ad.Client().VMRRDData(c.Context(), node, vmid, timeframe, cf)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if data == nil {
		data = []*goproxmox.RRDData{}
	}
	return mw.JSON(c, 200, data, nil)
}

// adminProxmoxVersion exposes PVE's /version (proxmox murni).
// GET /admin/proxmox/:id/version — infra-readable (NOC + platform_admin),
// guard via proxmoxAdapterFor so non-proxmox kind answers 501 expect proxmox.
func (s *Server) adminProxmoxVersion(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	v, err := ad.Client().Version(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if v == nil {
		return mw.JSON(c, 200, fiber.Map{}, nil)
	}
	return mw.JSON(c, 200, v, nil)
}

// adminProxmoxNextID allocates the next free VMID from the cluster
// (GET /cluster/nextid). GET is infra-readable.
func (s *Server) adminProxmoxNextID(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	id, err := ad.Client().ClusterNextID(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"next_id": id}, nil)
}

// adminProxmoxTemplates lists QEMU/LXC templates (cluster resources where template==1).
// GET /admin/proxmox/:id/templates — infra-readable (NOC + platform_admin), proxmoxAdapterFor guard.
func (s *Server) adminProxmoxTemplates(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	resources, err := ad.Client().ClusterResources(c.Context(), "vm")
	if err != nil {
		return mw.WriteError(c, err)
	}
	filtered := make([]any, 0)
	for _, r := range resources {
		if r == nil {
			continue
		}
		if r.Template != 1 {
			continue
		}
		filtered = append(filtered, r)
	}
	// Also include LXC templates if any (type lxc template==1)
	resources2, err := ad.Client().ClusterResources(c.Context())
	if err == nil {
		for _, r := range resources2 {
			if r == nil || r.Type != "lxc" || r.Template != 1 {
				continue
			}
			filtered = append(filtered, r)
		}
	}
	return mw.JSON(c, 200, filtered, nil)
}

// adminProxmoxTemplateDelete deletes a template VM via QEMUDestroy/LXC destroy.
// DELETE /admin/proxmox/:id/templates/:vmid?node= — platform_admin only.
func (s *Server) adminProxmoxTemplateDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	node := strings.TrimSpace(c.Query("node"))
	if node == "" {
		n, nerr := ad.NodeForVMID(c.Context(), int64(vmid))
		if nerr != nil {
			return mw.WriteError(c, nerr)
		}
		node = n
	}
	task, err := ad.Client().QEMUDestroy(c.Context(), node, vmid, true)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "task": task}, nil)
}

// adminProxmoxSnapshotsList lists snapshots for one QEMU VM.
// GET /admin/proxmox/:id/snapshots?vmid= — infra-readable.
func (s *Server) adminProxmoxSnapshotsList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	vmidStr := strings.TrimSpace(c.Query("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	node, err := ad.NodeForVMID(c.Context(), int64(vmid))
	if err != nil {
		return mw.WriteError(c, err)
	}
	snaps, err := ad.Client().SnapshotsList(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if snaps == nil {
		snaps = []*goproxmox.VirtualMachineSnapshot{}
	}
	return mw.JSON(c, 200, snaps, nil)
}

// adminProxmoxSnapshotCreate creates a snapshot on one QEMU VM.
// POST /admin/proxmox/:id/snapshots {vmid, snapname, description?} — platform_admin only.
func (s *Server) adminProxmoxSnapshotCreate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		VMID        int    `json:"vmid"`
		Snapname    string `json:"snapname"`
		Description string `json:"description"`
	}
	if err := c.Bind().Body(&in); err != nil || in.VMID <= 0 || strings.TrimSpace(in.Snapname) == "" {
		return mw.WriteError(c, vErrField("snapname", "vmid and snapname are required"))
	}
	if strings.TrimSpace(in.Snapname) == "current" {
		return mw.WriteError(c, vErrField("snapname", "current is reserved by PVE"))
	}
	node, err := ad.NodeForVMID(c.Context(), int64(in.VMID))
	if err != nil {
		return mw.WriteError(c, err)
	}
	task, err := ad.Client().SnapshotCreate(c.Context(), node, in.VMID, strings.TrimSpace(in.Snapname), strings.TrimSpace(in.Description))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": in.VMID, "snapname": strings.TrimSpace(in.Snapname), "task": task}, nil)
}

// adminProxmoxSnapshotRollback rolls a VM back to a snapshot and restarts it.
// POST /admin/proxmox/:id/snapshots/rollback {vmid, snapname} — platform_admin only.
func (s *Server) adminProxmoxSnapshotRollback(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var in struct {
		VMID     int    `json:"vmid"`
		Snapname string `json:"snapname"`
	}
	if err := c.Bind().Body(&in); err != nil || in.VMID <= 0 || strings.TrimSpace(in.Snapname) == "" {
		return mw.WriteError(c, vErrField("snapname", "vmid and snapname are required"))
	}
	node, err := ad.NodeForVMID(c.Context(), int64(in.VMID))
	if err != nil {
		return mw.WriteError(c, err)
	}
	task, err := ad.Client().SnapshotRollback(c.Context(), node, in.VMID, strings.TrimSpace(in.Snapname))
	if err != nil {
		return mw.WriteError(c, err)
	}
	// Restart after rollback so guest returns to captured state.
	if err := ad.Client().WaitForTask(c.Context(), task, "rollback snapshot", 5*60*1_000_000_000); err != nil {
		return mw.WriteError(c, err)
	}
	startTask, err := ad.Client().QEMUStart(c.Context(), node, in.VMID)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": in.VMID, "snapname": strings.TrimSpace(in.Snapname), "task": startTask}, nil)
}

// adminProxmoxSnapshotDelete deletes a snapshot.
// DELETE /admin/proxmox/:id/snapshots/:snapname?vmid= — platform_admin only.
func (s *Server) adminProxmoxSnapshotDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	snapname := strings.TrimSpace(c.Params("snapname"))
	if snapname == "" {
		snapname = strings.TrimSpace(c.Query("snapname"))
	}
	if snapname == "" {
		return mw.WriteError(c, vErrField("snapname", "snapname is required"))
	}
	vmidStr := strings.TrimSpace(c.Query("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	node, err := ad.NodeForVMID(c.Context(), int64(vmid))
	if err != nil {
		return mw.WriteError(c, err)
	}
	task, err := ad.Client().SnapshotDelete(c.Context(), node, vmid, snapname)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "snapname": snapname, "task": task}, nil)
}

// ---- QEMU snapshots per node (GET infra, POST/DELETE platform_admin) ----

// adminProxmoxQemuSnapshotList lists snapshots for one QEMU VM on a specific node.
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot — infra-readable (NOC + platform_admin).
func (s *Server) adminProxmoxQemuSnapshotList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	snaps, err := ad.Client().SnapshotsList(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if snaps == nil {
		snaps = []*goproxmox.VirtualMachineSnapshot{}
	}
	return mw.JSON(c, 200, snaps, nil)
}

// adminProxmoxQemuSnapshotCreate creates a snapshot on one QEMU VM on a specific node.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot {snapname, description?} — platform_admin only.
func (s *Server) adminProxmoxQemuSnapshotCreate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var in struct {
		Snapname    string `json:"snapname"`
		Description string `json:"description"`
	}
	if err := c.Bind().Body(&in); err != nil || strings.TrimSpace(in.Snapname) == "" {
		return mw.WriteError(c, vErrField("snapname", "snapname is required"))
	}
	snapname := strings.TrimSpace(in.Snapname)
	if snapname == "current" {
		return mw.WriteError(c, vErrField("snapname", "current is reserved by PVE"))
	}
	task, err := ad.Client().SnapshotCreate(c.Context(), node, vmid, snapname, strings.TrimSpace(in.Description))
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "snapname": snapname, "task": task}, nil)
}

// adminProxmoxQemuSnapshotDelete deletes a snapshot on one QEMU VM on a specific node.
// DELETE /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/:snapname — platform_admin only.
func (s *Server) adminProxmoxQemuSnapshotDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	snapname := strings.TrimSpace(c.Params("snapname"))
	if snapname == "" {
		snapname = strings.TrimSpace(c.Query("snapname"))
	}
	if snapname == "" {
		return mw.WriteError(c, vErrField("snapname", "snapname is required"))
	}
	task, err := ad.Client().SnapshotDelete(c.Context(), node, vmid, snapname)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "snapname": snapname, "task": task}, nil)
}

// adminProxmoxQemuSnapshotRollback rolls a VM back to a snapshot on a specific node and restarts it.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/rollback {snapname}
// also accepts POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/snapshot/:snapname/rollback — platform_admin only.
func (s *Server) adminProxmoxQemuSnapshotRollback(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	snapname := strings.TrimSpace(c.Params("snapname"))
	if snapname == "" {
		var in struct {
			Snapname string `json:"snapname"`
		}
		_ = c.Bind().Body(&in)
		snapname = strings.TrimSpace(in.Snapname)
	}
	if snapname == "" {
		return mw.WriteError(c, vErrField("snapname", "snapname is required"))
	}
	task, err := ad.Client().SnapshotRollback(c.Context(), node, vmid, snapname)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := ad.Client().WaitForTask(c.Context(), task, "rollback snapshot", 5*60*1_000_000_000); err != nil {
		return mw.WriteError(c, err)
	}
	startTask, err := ad.Client().QEMUStart(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "snapname": snapname, "task": startTask}, nil)
}

// ---- Access: users / groups / roles (GET /access/*) ----

// adminAccessUsersList lists PVE users (GET /access/users).
// GET /admin/proxmox/:id/access/users — infra-readable (NOC + platform_admin).
func (s *Server) adminAccessUsersList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	users, err := ad.Client().AccessUsers(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if users == nil {
		users = goproxmox.Users{}
	}
	return mw.JSON(c, 200, users, nil)
}

// adminAccessUserCreate creates a PVE user.
// POST /admin/proxmox/:id/access/users — platform_admin only.
func (s *Server) adminAccessUserCreate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	var raw map[string]any
	if err := c.Bind().Body(&raw); err != nil || raw == nil {
		return mw.WriteError(c, errValidation("invalid user payload"))
	}
	userid, _ := raw["userid"].(string)
	userid = strings.TrimSpace(userid)
	if userid == "" {
		if v, ok := raw["user"].(string); ok {
			userid = strings.TrimSpace(v)
		}
	}
	if userid == "" {
		return mw.WriteError(c, vErrField("userid", "userid is required (e.g. alice@pve)"))
	}
	if !strings.Contains(userid, "@") {
		return mw.WriteError(c, vErrField("userid", "userid must contain realm, e.g. alice@pve"))
	}
	password, _ := raw["password"].(string)
	password = strings.TrimSpace(password)
	if password == "" {
		return mw.WriteError(c, vErrField("password", "password is required"))
	}
	email, _ := raw["email"].(string)
	firstname, _ := raw["firstname"].(string)
	lastname, _ := raw["lastname"].(string)
	comment, _ := raw["comment"].(string)
	groups := parseAccessCSV(raw["groups"])
	keysRaw := raw["keys"]
	var keys []string
	switch v := keysRaw.(type) {
	case string:
		if strings.TrimSpace(v) != "" {
			keys = []string{strings.TrimSpace(v)}
		}
	case []any:
		for _, it := range v {
			if s, ok := it.(string); ok && strings.TrimSpace(s) != "" {
				keys = append(keys, strings.TrimSpace(s))
			}
		}
	case []string:
		keys = v
	}
	expire := 0
	if v, ok := raw["expire"]; ok {
		switch vv := v.(type) {
		case float64:
			expire = int(vv)
		case int:
			expire = vv
		case string:
			if n, perr := strconv.Atoi(strings.TrimSpace(vv)); perr == nil {
				expire = n
			}
		}
	}
	enable := true
	if v, ok := raw["enable"]; ok {
		switch vv := v.(type) {
		case bool:
			enable = vv
		case float64:
			enable = vv != 0
		case string:
			if strings.EqualFold(strings.TrimSpace(vv), "false") || strings.TrimSpace(vv) == "0" {
				enable = false
			}
		}
	}
	nu := &goproxmox.NewUser{
		UserID:    userid,
		Password:  password,
		Email:     strings.TrimSpace(email),
		Firstname: strings.TrimSpace(firstname),
		Lastname:  strings.TrimSpace(lastname),
		Comment:   strings.TrimSpace(comment),
		Groups:    goproxmox.CSV(groups),
		Keys:      keys,
		Expire:    expire,
		Enable:    enable,
	}
	if err := ad.Client().AccessUserCreate(c.Context(), nu); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created", "userid": userid}, nil)
}

// adminAccessUserUpdate updates a PVE user.
// PUT /admin/proxmox/:id/access/users/:userid — platform_admin only.
func (s *Server) adminAccessUserUpdate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	userid := strings.TrimSpace(c.Params("userid"))
	if userid == "" {
		return mw.WriteError(c, vErrField("userid", "userid is required"))
	}
	var raw map[string]any
	if err := c.Bind().Body(&raw); err != nil || raw == nil {
		return mw.WriteError(c, errValidation("invalid user payload"))
	}
	var opts goproxmox.UserOptions
	if v, ok := raw["comment"]; ok {
		if s, ok := v.(string); ok {
			opts.Comment = strings.TrimSpace(s)
		}
	}
	if v, ok := raw["email"]; ok {
		if s, ok := v.(string); ok {
			opts.Email = strings.TrimSpace(s)
		}
	}
	if v, ok := raw["firstname"]; ok {
		if s, ok := v.(string); ok {
			opts.Firstname = strings.TrimSpace(s)
		}
	}
	if v, ok := raw["lastname"]; ok {
		if s, ok := v.(string); ok {
			opts.Lastname = strings.TrimSpace(s)
		}
	}
	if v, ok := raw["keys"]; ok {
		switch vv := v.(type) {
		case string:
			opts.Keys = strings.TrimSpace(vv)
		case []any:
			parts := make([]string, 0, len(vv))
			for _, it := range vv {
				if s, ok := it.(string); ok && strings.TrimSpace(s) != "" {
					parts = append(parts, strings.TrimSpace(s))
				}
			}
			opts.Keys = strings.Join(parts, "\n")
		}
	}
	if v, ok := raw["groups"]; ok {
		groups := parseAccessCSV(v)
		opts.Groups = goproxmox.CSV(groups)
	}
	if v, ok := raw["expire"]; ok {
		switch vv := v.(type) {
		case float64:
			opts.Expire = int(vv)
		case int:
			opts.Expire = vv
		case string:
			if n, perr := strconv.Atoi(strings.TrimSpace(vv)); perr == nil {
				opts.Expire = n
			}
		}
	}
	if v, ok := raw["enable"]; ok {
		var b goproxmox.IntOrBool
		switch vv := v.(type) {
		case bool:
			b = goproxmox.IntOrBool(vv)
		case float64:
			b = goproxmox.IntOrBool(vv != 0)
		case string:
			b = goproxmox.IntOrBool(!(strings.EqualFold(strings.TrimSpace(vv), "false") || strings.TrimSpace(vv) == "0"))
		default:
			b = goproxmox.IntOrBool(true)
		}
		opts.Enable = &b
	}
	if v, ok := raw["append"]; ok {
		switch vv := v.(type) {
		case bool:
			opts.Append = goproxmox.IntOrBool(vv)
		case float64:
			opts.Append = goproxmox.IntOrBool(vv != 0)
		}
	}
	if err := ad.Client().AccessUserUpdate(c.Context(), userid, opts); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "userid": userid}, nil)
}

// adminAccessUserDelete deletes a PVE user.
// DELETE /admin/proxmox/:id/access/users/:userid — platform_admin only.
func (s *Server) adminAccessUserDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	userid := strings.TrimSpace(c.Params("userid"))
	if userid == "" {
		return mw.WriteError(c, vErrField("userid", "userid is required"))
	}
	if err := ad.Client().AccessUserDelete(c.Context(), userid); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "userid": userid}, nil)
}

// adminAccessGroupsList lists PVE groups.
// GET /admin/proxmox/:id/access/groups — infra-readable.
func (s *Server) adminAccessGroupsList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	groups, err := ad.Client().AccessGroups(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if groups == nil {
		groups = goproxmox.Groups{}
	}
	return mw.JSON(c, 200, groups, nil)
}

// adminAccessRolesList lists PVE roles.
// GET /admin/proxmox/:id/access/roles — infra-readable.
func (s *Server) adminAccessRolesList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	roles, err := ad.Client().AccessRoles(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if roles == nil {
		roles = goproxmox.Roles{}
	}
	return mw.JSON(c, 200, roles, nil)
}

// adminAccessACLList lists PVE ACL entries (GET /access/acl).
// GET /admin/proxmox/:id/access/acl — infra-readable (NOC + platform_admin),
// proxmox murni via proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox.
func (s *Server) adminAccessACLList(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	acls, err := ad.Client().AccessACL(c.Context())
	if err != nil {
		return mw.WriteError(c, err)
	}
	if acls == nil {
		acls = goproxmox.ACLs{}
	}
	return mw.JSON(c, 200, acls, nil)
}

// ---- QEMU config (GET infra, PUT platform_admin) ----

// adminProxmoxQemuConfigGet returns the raw QEMU config for one VM.
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/config — infra-readable (NOC + platform_admin),
// guard via proxmoxAdapterFor so non-proxmox kind answers 501 expect proxmox.
func (s *Server) adminProxmoxQemuConfigGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	cfg, err := ad.Client().QEMUConfigGet(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, cfg, nil)
}

// adminProxmoxQemuConfigSet updates the QEMU config for one VM.
// PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/config — platform_admin only,
// body is a free-form JSON object of PVE config keys (e.g. {"cores":2,"memory":2048}).
func (s *Server) adminProxmoxQemuConfigSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var raw map[string]any
	if err := c.Bind().Body(&raw); err != nil || raw == nil {
		return mw.WriteError(c, errValidation("invalid qemu config payload"))
	}
	// Trim empty string keys so a UI that sends {name:""} does not accidentally
	// clear a required field; explicit deletes should use the dedicated delete
	// API rather than blank PUT values.
	clean := make(map[string]any, len(raw))
	for k, v := range raw {
		kk := strings.TrimSpace(k)
		if kk == "" {
			continue
		}
		if s, ok := v.(string); ok && strings.TrimSpace(s) == "" {
			continue
		}
		clean[kk] = v
	}
	if len(clean) == 0 {
		return mw.WriteError(c, errValidation("qemu config payload is empty"))
	}
	if err := ad.Client().QEMUConfigUpdate(c.Context(), node, vmid, clean); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "node": node, "vmid": vmid}, nil)
}

// adminProxmoxQemuTagsGet returns the tag list for one QEMU VM.
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags — infra-readable (NOC + platform_admin),
// proxmox murni via proxmoxAdapterFor guard.
func (s *Server) adminProxmoxQemuTagsGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	cfg, err := ad.Client().QEMUConfigGet(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	rawTags := ""
	if v, ok := cfg["tags"]; ok {
		if s, ok := v.(string); ok {
			rawTags = strings.TrimSpace(s)
		}
	}
	tags := []string{}
	if rawTags != "" {
		for _, p := range strings.Split(rawTags, ";") {
			if t := strings.TrimSpace(p); t != "" {
				tags = append(tags, t)
			}
		}
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "vmid": vmid, "tags": tags, "raw": rawTags}, nil)
}

// adminProxmoxQemuTagsSet rewrites the tag list wholesale via PVE tags config.
// PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/tags — platform_admin only,
// body {tags: string[] | string} where string is ";" or "," separated. PVE
// stores tags as a single ";"-joined string via PUT /nodes/{node}/qemu/{vmid}/config.
func (s *Server) adminProxmoxQemuTagsSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var body map[string]any
	if err := c.Bind().Body(&body); err != nil || body == nil {
		return mw.WriteError(c, errValidation("invalid tags payload"))
	}
	rawVal, ok := body["tags"]
	if !ok {
		return mw.WriteError(c, vErrField("tags", "tags is required (string[] or \";\"-separated string)"))
	}
	var tags []string
	switch v := rawVal.(type) {
	case string:
		s := strings.TrimSpace(v)
		if s != "" {
			for _, p := range strings.Split(s, ";") {
				for _, q := range strings.Split(p, ",") {
					if t := strings.TrimSpace(q); t != "" {
						tags = append(tags, t)
					}
				}
			}
		}
	case []any:
		for _, it := range v {
			switch sv := it.(type) {
			case string:
				if t := strings.TrimSpace(sv); t != "" {
					tags = append(tags, t)
				}
			case float64:
				tags = append(tags, strconv.FormatFloat(sv, 'f', -1, 64))
			default:
				return mw.WriteError(c, vErrField("tags", "each tag must be a string"))
			}
		}
	case []string:
		for _, t := range v {
			if s := strings.TrimSpace(t); s != "" {
				tags = append(tags, s)
			}
		}
	default:
		return mw.WriteError(c, vErrField("tags", "tags must be a string array or \";\"-separated string"))
	}
	if len(tags) > 32 {
		return mw.WriteError(c, vErrField("tags", "at most 32 tags are allowed"))
	}
	for _, t := range tags {
		if len(t) > 64 {
			return mw.WriteError(c, vErrField("tags", "each tag must be at most 64 characters"))
		}
	}
	joined := strings.Join(tags, ";")
	if err := ad.Client().QEMUConfigUpdate(c.Context(), node, vmid, map[string]any{"tags": joined}); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "node": node, "vmid": vmid, "tags": tags}, nil)
}

// adminProxmoxQemuReset hard-resets one QEMU VM via PVE POST /nodes/{node}/qemu/{vmid}/status/reset.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/reset — platform_admin only,
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminProxmoxQemuReset(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	task, err := ad.Client().QEMUReset(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "status": "resetting", "task": task}, nil)
}

// adminProxmoxQemuResume resumes a suspended QEMU VM via PVE POST /nodes/{node}/qemu/{vmid}/status/resume.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/resume — platform_admin only,
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminProxmoxQemuResume(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	task, err := ad.Client().QEMUResume(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "status": "resuming", "task": task}, nil)
}

// adminProxmoxQemuPauseStatus returns QEMU guest context for the pause page (GET infra, 5s poll).
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause — infra-readable (NOC + platform_admin),
// proxmox murni via proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox.
func (s *Server) adminProxmoxQemuPauseStatus(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	ctx := c.Context()
	resources, _ := ad.Client().ClusterResources(ctx)
	var guest any
	for _, r := range resources {
		if r.Type == "qemu" && int(r.VMID) == vmid {
			guest = r
			break
		}
	}
	ext := strconv.Itoa(vmid)
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"node":        node,
		"vmid":        vmid,
		"external_id": ext,
		"guest":       guest,
		"hint":        "POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause — suspend QEMU VM to RAM",
	}, nil)
}

// adminProxmoxQemuPause suspends a QEMU VM to RAM via PVE POST /nodes/{node}/qemu/{vmid}/status/suspend.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/pause — platform_admin only,
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminProxmoxQemuPause(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	task, err := ad.Client().QEMUPause(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "status": "pausing", "task": task}, nil)
}

// adminProxmoxQemuHibernateStatus returns QEMU guest context for the hibernate page (GET infra, 5s poll).
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/hibernate — infra-readable (NOC + platform_admin),
// proxmox murni via proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox.
func (s *Server) adminProxmoxQemuHibernateStatus(c fiber.Ctx) error {
	providerID, code, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	ctx := c.Context()
	resources, _ := ad.Client().ClusterResources(ctx)
	var guest any
	for _, r := range resources {
		if r.Type == "qemu" && int(r.VMID) == vmid {
			guest = r
			break
		}
	}
	ext := strconv.Itoa(vmid)
	return mw.JSON(c, 200, fiber.Map{
		"provider_id": providerID,
		"code":        code,
		"node":        node,
		"vmid":        vmid,
		"external_id": ext,
		"guest":       guest,
		"hint":        "POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/hibernate — hibernate QEMU VM to disk (suspend-to-disk)",
	}, nil)
}

// adminProxmoxQemuHibernate suspends a QEMU VM to disk via PVE POST /nodes/{node}/qemu/{vmid}/status/suspend todisk=1.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/hibernate — platform_admin only,
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminProxmoxQemuHibernate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	task, err := ad.Client().QEMUHibernate(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 202, fiber.Map{"node": node, "vmid": vmid, "status": "hibernating", "task": task}, nil)
}

// ---- QEMU notes (GET infra, PUT platform_admin) ----

// adminProxmoxQemuNotesGet returns the notes (PVE description) for one QEMU VM.
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes — infra-readable (NOC + platform_admin),
// guard via proxmoxAdapterFor so non-proxmox kind answers 501 expect proxmox.
func (s *Server) adminProxmoxQemuNotesGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	cfg, err := ad.Client().QEMUConfigGet(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	notes := ""
	if v, ok := cfg["description"]; ok && v != nil {
		if s, ok := v.(string); ok {
			notes = s
		} else {
			b, _ := json.Marshal(v)
			var s2 string
			if err := json.Unmarshal(b, &s2); err == nil {
				notes = s2
			} else {
				notes = strings.TrimSpace(string(b))
				notes = strings.Trim(notes, "\"")
			}
		}
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "vmid": vmid, "notes": notes, "description": notes}, nil)
}

// adminProxmoxQemuNotesSet updates the notes (PVE description) for one QEMU VM.
// PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/notes — platform_admin only,
// body {notes?: string, description?: string} (either key accepted, notes takes precedence),
// empty string clears the description. Guard via proxmoxAdapterFor.
func (s *Server) adminProxmoxQemuNotesSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var raw map[string]any
	if err := c.Bind().Body(&raw); err != nil {
		return mw.WriteError(c, errValidation("invalid qemu notes payload"))
	}
	if raw == nil {
		return mw.WriteError(c, errValidation("invalid qemu notes payload"))
	}
	var notesPtr *string
	if v, ok := raw["notes"]; ok {
		if v == nil {
			s := ""
			notesPtr = &s
		} else if s, ok := v.(string); ok {
			notesPtr = &s
		} else {
			b, _ := json.Marshal(v)
			var s string
			if err := json.Unmarshal(b, &s); err == nil {
				notesPtr = &s
			} else {
				ss := strings.TrimSpace(string(b))
				ss = strings.Trim(ss, "\"")
				notesPtr = &ss
			}
		}
	} else if v, ok := raw["description"]; ok {
		if v == nil {
			s := ""
			notesPtr = &s
		} else if s, ok := v.(string); ok {
			notesPtr = &s
		} else {
			b, _ := json.Marshal(v)
			var s string
			if err := json.Unmarshal(b, &s); err == nil {
				notesPtr = &s
			} else {
				ss := strings.TrimSpace(string(b))
				ss = strings.Trim(ss, "\"")
				notesPtr = &ss
			}
		}
	}
	if notesPtr == nil {
		return mw.WriteError(c, vErrField("notes", "notes (or description) is required"))
	}
	notes := *notesPtr
	if err := ad.Client().QEMUConfigUpdate(c.Context(), node, vmid, map[string]any{"description": notes}); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "node": node, "vmid": vmid, "notes": notes}, nil)
}

// ---- QEMU per-VM firewall helpers for ProxmoxQemuFirewallPage ----

// adminProxmoxQemuFirewallStatus GETs the live VM firewall rules + options for a QEMU VM.
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall — infra-readable (NOC + platform_admin),
// proxmox murni (proxmoxAdapterFor guard — non-proxmox answers 501 expect proxmox).
func (s *Server) adminProxmoxQemuFirewallStatus(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	rules, err := ad.Client().VMFirewallRules(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if rules == nil {
		rules = []*goproxmox.FirewallRule{}
	}
	opt, _ := ad.Client().VMFirewallOptionGet(c.Context(), node, vmid)
	return mw.JSON(c, 200, fiber.Map{"node": node, "vmid": vmid, "rules": rules, "options": opt}, nil)
}

// adminProxmoxQemuFirewallCreate adds one firewall rule to a QEMU VM.
// POST /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall — platform_admin only, proxmox murni.
func (s *Server) adminProxmoxQemuFirewallCreate(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var rule goproxmox.FirewallRule
	if err := c.Bind().Body(&rule); err != nil {
		return mw.WriteError(c, errValidation("invalid firewall rule payload"))
	}
	if strings.TrimSpace(rule.Action) == "" {
		return mw.WriteError(c, vErrField("action", "action is required (ACCEPT/DROP/REJECT)"))
	}
	if err := ad.Client().VMFirewallRuleCreate(c.Context(), node, vmid, &rule); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 201, fiber.Map{"status": "created", "node": node, "vmid": vmid, "action": rule.Action}, nil)
}

// adminProxmoxQemuFirewallDelete removes a firewall rule by pos from a QEMU VM.
// DELETE /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall/:pos — platform_admin only, proxmox murni.
func (s *Server) adminProxmoxQemuFirewallDelete(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	posStr := strings.TrimSpace(c.Params("pos"))
	pos, cerr := strconv.Atoi(posStr)
	if cerr != nil || pos < 0 {
		return mw.WriteError(c, vErrField("pos", "pos must be a non-negative integer"))
	}
	rule, err := ad.Client().VMFirewallRuleAt(c.Context(), node, vmid, pos)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if err := rule.Delete(c.Context()); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "deleted", "node": node, "vmid": vmid, "pos": pos}, nil)
}

// adminProxmoxQemuFirewallOptionsGet GETs the VM firewall options (enable/policy).
// GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall/options — infra-readable, proxmox murni.
func (s *Server) adminProxmoxQemuFirewallOptionsGet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	opt, err := ad.Client().VMFirewallOptionGet(c.Context(), node, vmid)
	if err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"node": node, "vmid": vmid, "options": opt}, nil)
}

// adminProxmoxQemuFirewallOptionsSet PUTs the VM firewall options (enable/policy).
// PUT /admin/proxmox/:id/nodes/:node/qemu/:vmid/firewall/options — platform_admin only, proxmox murni.
func (s *Server) adminProxmoxQemuFirewallOptionsSet(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	var opt goproxmox.FirewallVirtualMachineOption
	if err := c.Bind().Body(&opt); err != nil {
		return mw.WriteError(c, errValidation("invalid firewall options payload"))
	}
	if err := ad.Client().VMFirewallOptionSet(c.Context(), node, vmid, &opt); err != nil {
		return mw.WriteError(c, err)
	}
	return mw.JSON(c, 200, fiber.Map{"status": "updated", "node": node, "vmid": vmid, "options": opt}, nil)
}

// ---- QEMU Agent passthrough ----
// Task specifies GET /admin/proxmox/:id/nodes/:node/qemu/:vmid/agent/* as a per-VM action page.
// This handler exposes the full PVE QEMU guest-agent surface via a wildcard suffix.
// GET is infra-readable (NOC + platform_admin), POST is platform_admin-only, guarded via proxmoxAdapterFor.
// The suffix after /agent/ (trimmed) is proxied 1:1 to the PVE node: empty -> GET /agent (command index),
// "get-time" -> GET /agent/get-time, "ping" -> POST /agent/ping, etc. Handles file-read encoding,
// command body forwarding, and the inner {"result":...} unwrap already done by the SDK.

func (s *Server) adminProxmoxQemuAgent(c fiber.Ctx) error {
	_, _, ad, err := s.proxmoxAdapterFor(c)
	if err != nil {
		return mw.WriteError(c, err)
	}
	node := strings.TrimSpace(c.Params("node"))
	if node == "" {
		return mw.WriteError(c, vErrField("node", "node is required"))
	}
	vmidStr := strings.TrimSpace(c.Params("vmid"))
	vmid, cerr := strconv.Atoi(vmidStr)
	if cerr != nil || vmid <= 0 {
		return mw.WriteError(c, vErrField("vmid", "must be a positive integer"))
	}
	method := string(c.Method())
	// fiber wildcard param is "*"
	suffix := strings.TrimSpace(c.Params("*"))
	suffix = strings.Trim(suffix, "/")
	// Normalize common aliases and guard traversal attempts.
	if strings.Contains(suffix, "..") {
		return mw.WriteError(c, vErrField("agent", "invalid agent path"))
	}
	// For POST, body may carry {"command": "..."} or file-write fields; forward generically.
	var body any
	if method == "POST" || method == "PUT" {
		if len(c.Body()) > 0 {
			var raw any
			if jerr := json.Unmarshal(c.Body(), &raw); jerr == nil {
				body = raw
			} else {
				body = map[string]any{"raw": string(c.Body())}
			}
		}
	}
	// Fiber v3 fasthttp request has no URL field — reconstruct query from c.Queries() and raw query string.
	rawQS := string(c.Request().URI().QueryString())
	qVals, _ := url.ParseQuery(rawQS)
	out, err := ad.Client().AgentPassthrough(c.Context(), node, vmid, method, suffix, qVals, body)
	if err != nil {
		return mw.WriteError(c, err)
	}
	if out == nil {
		return mw.JSON(c, 200, fiber.Map{"node": node, "vmid": vmid, "agent": suffix, "data": nil}, nil)
	}
	return mw.JSON(c, 200, out, nil)
}

func parseAccessCSV(v any) []string {
	switch vv := v.(type) {
	case string:
		s := strings.TrimSpace(vv)
		if s == "" {
			return nil
		}
		parts := strings.Split(s, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if q := strings.TrimSpace(p); q != "" {
				out = append(out, q)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(vv))
		for _, it := range vv {
			switch sv := it.(type) {
			case string:
				if q := strings.TrimSpace(sv); q != "" {
					out = append(out, q)
				}
			case float64:
				out = append(out, strconv.FormatFloat(sv, 'f', -1, 64))
			}
		}
		return out
	case []string:
		return vv
	default:
		return nil
	}
}

