// provider.go adapts a Proxmox VE cluster to the provider.ComputeProvider
// interface. spec.Location carries the PVE node name (regions.external_code
// stores the node for this provider); VM external IDs are the numeric VMIDs.
//
// Capability map — native vs unsupported:
//
//	NATIVE      VM lifecycle, power, cross-node migration, resize (grow-only),
//	            noVNC tickets, snapshots (create/list/delete/rollback),
//	            vzdump backups (list/restore via qmrestore),
//	            ISO list/create-by-url/delete, catalog sync (nodes as locations)
//	OBSERVABILITY Nodes/ClusterResources/NodeStorages/RecentTasks helpers on
//	            *Adapter (outside ComputeProvider) expose raw PVE inventory
//	UNSUPPORTED SSH-key update/delete (keys ride cloud-init; EnsureSSHKey
//	            returns a deterministic placeholder), startup scripts,
//	            measured boot, reserved IPs, object storage, rDNS, BGP and
//	            both download-URL endpoints (PVE has no presigned URLs; its
//	            content endpoints require the secret token header, so no URL
//	            can safely be handed to a browser). Backup downloads are
//	            served instead through this backend's streaming proxy via the
//	            optional provider.BackupContentOpener capability.
package proxmox

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	goproxmox "github.com/luthermonson/go-proxmox"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	ProviderCode = "proxmox"

	// managedTag marks VMs created by Kilat Cloud so ListVMs can filter out
	// foreign guests on shared clusters.
	managedTag = "kilat"

	// diskStorage is the LVM-thin pool VM disks are carved from; it matches
	// the storage the seeded pricing assumes.
	diskStorage = "local-lvm"
	// defaultISOStorage receives server-side ISO downloads when no storage
	// with iso content is advertised.
	defaultISOStorage = "local"

	// cloudInitUser is the login user cloud-init provisions together with
	// the injected SSH keys.
	cloudInitUser = "kubectl"

	// vncTicketLifetime mirrors PVE's auth-ticket lifetime that bounds every
	// vncproxy ticket (2h).
	vncTicketLifetime = 2 * time.Hour

	taskTimeout     = 10 * time.Minute // create/destroy/snapshot/restore tasks
	startTimeout    = 3 * time.Minute  // start/reboot
	stopTimeout     = 5 * time.Minute  // graceful shutdowns
	downloadTimeout = 30 * time.Minute // ISO downloads depend on upstream speed
	migrateTimeout  = 60 * time.Minute // online migrations stream disk state and can run for many minutes
)

// Adapter implements provider.ComputeProvider against one Proxmox cluster.
type Adapter struct {
	c *Client
}

// Compile-time proof that Adapter satisfies the full interface.
var _ provider.ComputeProvider = (*Adapter)(nil)

// Compile-time proof that the streaming download capability is implemented.
var _ provider.BackupContentOpener = (*Adapter)(nil)

// NewAdapter wires an adapter from DB-stored endpoint/token credentials.
// Coordinator wiring:
//
//	prov, err := proxmox.NewAdapter(endpoint, tokenUser, tokenSecret)
//	provider.Register(prov) // or RegisterFactory("proxmox", func() ...)
func NewAdapter(baseURL, tokenUser, tokenSecret string) (*Adapter, error) {
	c, err := NewClient(baseURL, tokenUser, tokenSecret)
	if err != nil {
		return nil, err
	}
	return &Adapter{c: c}, nil
}

// Client exposes the low-level Proxmox client for callers needing operations
// outside the ComputeProvider surface (health checks, diagnostics).
func (a *Adapter) Client() *Client { return a.c }

func (a *Adapter) Code() string { return ProviderCode }

// ResizePolicy: the upgrade-only lock is an Onidel platform rule; the
// self-hosted Proxmox cluster may resize in both directions.
func (a *Adapter) ResizePolicy() provider.ResizePolicy {
	return provider.ResizePolicy{AllowDowngrade: true}
}

// ---- VM lifecycle ----

// BuildQemuOptions translates an InstanceSpec into PVE create-QEMU options.
// Exported pure function so tests can assert the exact option map without a
// cluster. node is accepted for future per-node tuning (CPU pinning, host
// PCI maps); today's option map is node-independent.
func BuildQemuOptions(spec provider.InstanceSpec, node string, vmid int) []goproxmox.VirtualMachineOption {
	opts := []goproxmox.VirtualMachineOption{
		{Name: "name", Value: spec.Name},
		{Name: "cores", Value: int(spec.CPU)},
		{Name: "memory", Value: int(spec.RAM)}, // InstanceSpec.RAM is MB == PVE MiB
		{Name: "scsi0", Value: fmt.Sprintf("%s:size=%dG", diskStorage, spec.Disk)},
		{Name: "scsihw", Value: "virtio-scsi-pci"},
		{Name: "net0", Value: "virtio,bridge=vmbr0"},
		{Name: "ostype", Value: "l26"},
		{Name: "agent", Value: 1},
	}
	if spec.IsoExternalID != "" {
		// OS-install flow: CD boots first so the installer runs.
		opts = append(opts,
			goproxmox.VirtualMachineOption{Name: "ide2", Value: spec.IsoExternalID + ",media=cdrom"},
			goproxmox.VirtualMachineOption{Name: "boot", Value: "order=ide2;" + diskStorage},
		)
	} else {
		// Disk-first boot for template/cloud-init images.
		opts = append(opts, goproxmox.VirtualMachineOption{Name: "boot", Value: "order=" + diskStorage})
	}
	if keys := authorizedKeys(spec.SSHKeyIDs); len(keys) > 0 {
		// EncodeSSHKeys joins with "\n" and percent-encodes exactly the way
		// PVE's urlencoded-string validator requires.
		opts = append(opts,
			goproxmox.VirtualMachineOption{Name: "ciuser", Value: cloudInitUser},
			goproxmox.VirtualMachineOption{Name: "sshkeys", Value: goproxmox.EncodeSSHKeys(keys...)},
		)
	}
	return opts
}

// authorizedKeys keeps only entries that look like OpenSSH public-key lines.
// The worker passes provider key external IDs in InstanceSpec.SSHKeyIDs;
// since this provider stores nothing at registration time (see EnsureSSHKey),
// opaque IDs cannot be expanded back into material and are skipped rather
// than injected as garbage. Keys uploaded as raw material flow through.
func authorizedKeys(entries []string) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		line := strings.TrimSpace(e)
		if line == "" || strings.ContainsAny(line, "\r\n") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		switch prefix := fields[0]; {
		case strings.HasPrefix(prefix, "ssh-"),
			strings.HasPrefix(prefix, "ecdsa-"),
			strings.HasPrefix(prefix, "sk-"):
			out = append(out, line)
		}
	}
	return out
}

func (a *Adapter) ProvisionVM(ctx context.Context, spec provider.InstanceSpec) error {
	if spec.Location == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: instance location (node name) is required")
	}
	vmid, err := a.c.NextVMID(ctx)
	if err != nil {
		return err
	}

	createTask, err := a.c.QEMUCreate(ctx, spec.Location, vmid, BuildQemuOptions(spec, spec.Location, vmid))
	if err != nil {
		return err
	}
	if err := a.c.WaitForTask(ctx, createTask, "create qemu", taskTimeout); err != nil {
		return apperrors.Newf(apperrors.CodeProvisionFailed, "proxmox create vm %d: %v", vmid, err)
	}

	// Best-effort ownership tag: provisioning never fails because tagging did.
	if loaded, lerr := a.c.NodeVM(ctx, spec.Location, vmid); lerr == nil && loaded != nil {
		_, _ = loaded.AddTag(ctx, managedTag)
	}

	if spec.IsoExternalID == "" {
		startTask, serr := a.c.QEMUStart(ctx, spec.Location, vmid)
		if serr != nil {
			return serr
		}
		if werr := a.c.WaitForTask(ctx, startTask, "start", startTimeout); werr != nil {
			return werr
		}
	}
	// ISO installs stay stopped on purpose: the customer completes OS setup
	// over VNC, mirroring Onidel's install flow.
	return nil
}

// locateVM resolves an external VMID to its cluster resource row, which
// carries the hosting node.
func (a *Adapter) locateVM(ctx context.Context, externalID string) (*goproxmox.ClusterResource, error) {
	vmid, err := strconv.ParseUint(strings.TrimSpace(externalID), 10, 64)
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid vm external id %q", externalID)
	}
	resources, err := a.c.ClusterResources(ctx, "vm")
	if err != nil {
		return nil, err
	}
	for _, r := range resources {
		if r.Type == "qemu" && r.VMID == vmid {
			return r, nil
		}
	}
	return nil, apperrors.Newf(apperrors.CodeNotFound, "proxmox: vm %q not found in cluster resources", externalID)
}

// mapPVEStatus maps qemu power state onto resource_status values.
func mapPVEStatus(status string) string {
	switch status {
	case "running":
		return "active"
	case "stopped":
		return "stopped"
	default:
		return "unknown"
	}
}

func (a *Adapter) GetVM(ctx context.Context, externalID string) (*provider.VMState, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	vm, err := a.c.NodeVM(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}

	v4, v6 := a.primaryIPs(ctx, res, vm)
	name := vm.Name
	if name == "" {
		name = res.Name
	}
	return &provider.VMState{
		ExternalID:  strconv.FormatUint(res.VMID, 10),
		Name:        name,
		Status:      mapPVEStatus(vm.Status),
		PowerStatus: vm.Status,
		MainIPv4:    v4,
		MainIPv6:    v6,
		VCPU:        vcpuOf(vm),
		RAM:         ramMBOf(vm),
		Disk:        diskGBOf(vm),
	}, nil
}

// primaryIPs prefers guest-agent reported addresses and falls back to the
// cloud-init ipconfig0 config while the agent is not up yet.
func (a *Adapter) primaryIPs(ctx context.Context, res *goproxmox.ClusterResource, vm *goproxmox.VirtualMachine) (v4, v6 string) {
	if vm.IsRunning() {
		if ifaces, err := a.c.AgentNetworkInterfaces(ctx, res.Node, int(res.VMID)); err == nil {
			v4, v6 = agentIPs(ifaces)
		}
	}
	f4, f6 := configIPs(vm.VirtualMachineConfig)
	if v4 == "" {
		v4 = f4
	}
	if v6 == "" {
		v6 = f6
	}
	return v4, v6
}

func agentIPs(ifaces []*goproxmox.AgentNetworkIface) (v4, v6 string) {
	for _, iface := range ifaces {
		for _, addr := range iface.IPAddresses {
			ip := addr.IPAddress
			switch addr.IPAddressType {
			case "ipv4":
				if v4 == "" && !strings.HasPrefix(ip, "127.") && !strings.HasPrefix(ip, "169.254.") {
					v4 = ip
				}
			case "ipv6":
				if v6 == "" && ip != "::1" && !strings.HasPrefix(ip, "fe80") {
					v6 = ip
				}
			}
		}
	}
	return v4, v6
}

// configIPs reads "ip=...,gw=...,ip6=..." key/value pairs from ipconfig0.
func configIPs(cfg *goproxmox.VirtualMachineConfig) (v4, v6 string) {
	if cfg == nil {
		return "", ""
	}
	for _, kv := range strings.Split(cfg.IPConfigs["ipconfig0"], ",") {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) != 2 {
			continue
		}
		val := parts[1]
		if idx := strings.Index(val, "/"); idx >= 0 {
			val = val[:idx] // strip CIDR prefix length
		}
		switch parts[0] {
		case "ip":
			if val != "" && val != "dhcp" {
				v4 = val
			}
		case "ip6":
			if val != "" && val != "dhcp" && val != "auto" {
				v6 = val
			}
		}
	}
	return v4, v6
}

func vcpuOf(vm *goproxmox.VirtualMachine) int64 {
	if vm.VirtualMachineConfig != nil && vm.VirtualMachineConfig.Cores != nil && *vm.VirtualMachineConfig.Cores > 0 {
		return int64(*vm.VirtualMachineConfig.Cores)
	}
	return int64(vm.CPUs)
}

func ramMBOf(vm *goproxmox.VirtualMachine) int64 {
	if cfg := vm.VirtualMachineConfig; cfg != nil && cfg.Memory > 0 {
		return int64(cfg.Memory)
	}
	return int64(vm.MaxMem >> 20) // bytes → MB
}

func diskGBOf(vm *goproxmox.VirtualMachine) int64 {
	if cfg := vm.VirtualMachineConfig; cfg != nil {
		if gb := diskSizeGB(cfg.SCSIs["scsi0"]); gb > 0 {
			return gb
		}
	}
	return int64(vm.MaxDisk >> 30) // bytes → GB
}

// diskSizeGB parses the size= option of a PVE disk line such as
// "local-lvm:vm-101-disk-0,size=32G".
func diskSizeGB(scsi0 string) int64 {
	for _, kv := range strings.Split(scsi0, ",") {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) != 2 || parts[0] != "size" {
			continue
		}
		return parseSizeToGB(parts[1])
	}
	return 0
}

// parseSizeToGB converts PVE sizes ("512M", "32G", "1T", "32GiB") into whole
// GB. Sub-GB values round down to zero.
func parseSizeToGB(size string) int64 {
	size = strings.TrimSpace(size)
	if size == "" {
		return 0
	}
	for _, suffix := range []string{"iB", "ib"} { // "GiB"/"MiB" listing style
		size = strings.TrimSuffix(size, suffix)
	}
	mult := int64(1)
	switch unit := size[len(size)-1]; unit {
	case 'K', 'k', 'M', 'm':
		return 0
	case 'G', 'g':
		size = size[:len(size)-1]
	case 'T', 't':
		mult = 1024
		size = size[:len(size)-1]
	}
	n, err := strconv.ParseInt(size, 10, 64)
	if err != nil {
		return 0
	}
	return n * mult
}

func (a *Adapter) ListVMs(ctx context.Context, teamExternalID string) ([]provider.VMState, error) {
	resources, err := a.c.ClusterResources(ctx, "vm")
	if err != nil {
		return nil, err
	}
	out := make([]provider.VMState, 0, len(resources))
	for _, r := range resources {
		if r.Type != "qemu" || r.Template == 1 {
			continue
		}
		// A guest belongs to Kilat Cloud when it carries the tag or lives in
		// the team's pool (teamExternalID doubles as the PVE pool name).
		if !hasManagedTag(r.Tags) && !(teamExternalID != "" && r.Pool == teamExternalID) {
			continue
		}
		out = append(out, provider.VMState{
			ExternalID:  strconv.FormatUint(r.VMID, 10),
			Name:        r.Name,
			Status:      mapPVEStatus(r.Status),
			PowerStatus: r.Status,
			VCPU:        int64(r.MaxCPU),
			RAM:         int64(r.MaxMem >> 20),
			Disk:        int64(r.MaxDisk >> 30),
		})
	}
	return out, nil
}

func hasManagedTag(tags string) bool {
	for _, t := range strings.Split(tags, ";") { // PVE tags join with ";"
		if strings.TrimSpace(t) == managedTag {
			return true
		}
	}
	return false
}

// PatchVM applies whitelisted spec changes: cpu→cores, ram→memory (MiB) and
// disk→grow-only scsi0 resize. Shrinks are rejected here even though
// ResizePolicy already keeps business logic from requesting them.
func (a *Adapter) PatchVM(ctx context.Context, externalID string, fields map[string]any) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	vm, err := a.c.NodeVM(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}

	var (
		cfgOpts     []goproxmox.VirtualMachineOption
		currentDisk = diskSizeGB(vm.VirtualMachineConfig.SCSIs["scsi0"])
		targetDisk  int64
	)
	for _, key := range []string{"cpu", "ram", "disk"} { // fixed order: deterministic
		raw, ok := fields[key]
		if !ok {
			continue
		}
		n, ok := coerceInt(raw)
		if !ok {
			return apperrors.Newf(apperrors.CodeValidation, "proxmox: patch field %q is not numeric (%#v)", key, raw)
		}
		switch key {
		case "cpu":
			if n <= 0 {
				return apperrors.Newf(apperrors.CodeValidation, "proxmox: cpu must be positive, got %d", n)
			}
			cfgOpts = append(cfgOpts, goproxmox.VirtualMachineOption{Name: "cores", Value: int(n)})
		case "ram":
			if n <= 0 {
				return apperrors.Newf(apperrors.CodeValidation, "proxmox: ram must be positive, got %d", n)
			}
			cfgOpts = append(cfgOpts, goproxmox.VirtualMachineOption{Name: "memory", Value: int(n)}) // MB == MiB
		case "disk":
			targetDisk = n
		}
	}
	if len(cfgOpts) > 0 {
		task, err := a.c.QEMUConfigSet(ctx, res.Node, int(res.VMID), cfgOpts...)
		if err != nil {
			return err
		}
		if err := a.c.WaitForTask(ctx, task, "set config", taskTimeout); err != nil {
			return err
		}
	}
	if targetDisk > 0 {
		if targetDisk < currentDisk {
			return apperrors.Newf(apperrors.CodeInvalidState,
				"proxmox: disk shrink %dG -> %dG is not allowed", currentDisk, targetDisk)
		}
		if targetDisk > currentDisk {
			delta := fmt.Sprintf("+%dG", targetDisk-currentDisk)
			task, err := a.c.QEMUResizeDisk(ctx, res.Node, int(res.VMID), "scsi0", delta)
			if err != nil {
				return err
			}
			if err := a.c.WaitForTask(ctx, task, "resize disk", taskTimeout); err != nil {
				return err
			}
		}
	}
	return nil
}

// coerceInt accepts JSON numbers (float64) and numeric strings alike.
func coerceInt(raw any) (int64, bool) {
	switch v := raw.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		return int64(v), true
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n, err == nil
	default:
		return 0, false
	}
}

func (a *Adapter) DestroyVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUDestroy(ctx, res.Node, int(res.VMID), false /* skipLock */)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "destroy", taskTimeout)
}

func (a *Adapter) StopVM(ctx context.Context, externalID string, force bool) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUStop(ctx, res.Node, int(res.VMID), force)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "stop", stopTimeout)
}

func (a *Adapter) RebootVM(ctx context.Context, externalID string, force bool) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUReboot(ctx, res.Node, int(res.VMID), force)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "reboot", startTimeout)
}

func (a *Adapter) StartVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUStart(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "start", startTimeout)
}

// MigrateVM moves the VM to another node of the same cluster. The PVE
// preconditions dry-run runs first as an advisory preflight: its result is
// only logged, never treated as a hard failure — PVE re-validates everything
// when the migration task itself executes and WaitForTask surfaces any real
// error with its exit status.
func (a *Adapter) MigrateVM(ctx context.Context, externalID, targetNode string) error {
	targetNode = strings.TrimSpace(targetNode)
	if targetNode == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: target node is required for migration")
	}
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	if res.Node == targetNode {
		return apperrors.Newf(apperrors.CodeValidation,
			"proxmox: vm %s already lives on node %s", externalID, targetNode)
	}
	if pre, perr := a.c.QEMUMigratePreconditions(ctx, res.Node, int(res.VMID), targetNode); perr != nil {
		log.Printf("proxmox: migrate vm %d %s -> %s preflight unavailable (continuing): %v",
			res.VMID, res.Node, targetNode, perr)
	} else if pre != nil {
		log.Printf("proxmox: migrate vm %d %s -> %s preflight: running=%v allowed_nodes=%v local_disks=%d",
			res.VMID, res.Node, targetNode, pre.Running, pre.AllowedNodes, len(pre.LocalDisks))
	}
	task, err := a.c.QEMUMigrate(ctx, res.Node, int(res.VMID), targetNode)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "migrate", migrateTimeout)
}

// VNCSession opens a noVNC ticket and returns the websocket URL plus its
// expiry. Note: PVE refuses API-token auth during the websocket upgrade
// itself (SDK ErrAPITokenWebSocketUnsupported); browsers therefore connect
// through a ticket-authenticated proxy in front of pveproxy.
func (a *Adapter) VNCSession(ctx context.Context, vmExternalID string) (string, int64, error) {
	res, err := a.locateVM(ctx, vmExternalID)
	if err != nil {
		return "", 0, err
	}
	vnc, err := a.c.VNCProxyTicket(ctx, res.Node, int(res.VMID))
	if err != nil {
		return "", 0, err
	}
	wsHost := strings.Replace(a.c.host, "https://", "wss://", 1)
	wsHost = strings.Replace(wsHost, "http://", "ws://", 1)
	vncURL := fmt.Sprintf("%s%s/nodes/%s/qemu/%d/vncwebsocket?port=%d&vncticket=%s",
		wsHost, apiPath, res.Node, res.VMID, int(vnc.Port), url.QueryEscape(vnc.Ticket))
	return vncURL, time.Now().Add(vncTicketLifetime).Unix(), nil
}

// ---- Snapshots / backups ----

func (a *Adapter) CreateSnapshot(ctx context.Context, vmExternalID, name, desc string) (string, error) {
	res, err := a.locateVM(ctx, vmExternalID)
	if err != nil {
		return "", err
	}
	task, err := a.c.SnapshotCreate(ctx, res.Node, int(res.VMID), name, desc)
	if err != nil {
		return "", err
	}
	if err := a.c.WaitForTask(ctx, task, "create snapshot", taskTimeout); err != nil {
		return "", err
	}
	return snapshotExtID(int(res.VMID), name), nil
}

// snapshotExtID encodes "vmid/snapname"; DeleteSnapshot splits on the first
// slash so snapnames containing "/" (PVE forbids them anyway) stay intact.
func snapshotExtID(vmid int, snapname string) string {
	return fmt.Sprintf("%d/%s", vmid, snapname)
}

func splitSnapshotExtID(extID string) (int, string, error) {
	vmidStr, snapname, found := strings.Cut(extID, "/")
	if !found {
		return 0, "", apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid snapshot id %q (want \"vmid/snapname\")", extID)
	}
	vmid, err := strconv.Atoi(vmidStr)
	if err != nil {
		return 0, "", apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid snapshot id %q", extID)
	}
	return vmid, snapname, nil
}

// ListSnapshots walks every Kilat-managed guest (Onidel parity: global list).
func (a *Adapter) ListSnapshots(ctx context.Context) ([]provider.ProviderSnapshot, error) {
	resources, err := a.c.ClusterResources(ctx, "vm")
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderSnapshot, 0)
	for _, r := range resources {
		if r.Type != "qemu" || r.Template == 1 {
			continue
		}
		snaps, err := a.c.SnapshotsList(ctx, r.Node, int(r.VMID))
		if err != nil {
			return nil, err
		}
		for _, s := range snaps {
			if s.Name == "current" { // pseudo-snapshot pointing at live state
				continue
			}
			out = append(out, provider.ProviderSnapshot{
				ExternalID: snapshotExtID(int(r.VMID), s.Name),
				Name:       s.Name,
				Desc:       s.Description,
				CreatedAt:  unixRFC3339(s.Snaptime),
				Status:     "available",
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExternalID < out[j].ExternalID })
	return out, nil
}

func unixRFC3339(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return time.Unix(unix, 0).UTC().Format(time.RFC3339)
}

func (a *Adapter) DeleteSnapshot(ctx context.Context, snapshotExtID string) error {
	vmid, snapname, err := splitSnapshotExtID(snapshotExtID)
	if err != nil {
		return err
	}
	node, err := a.nodeForVMID(ctx, int64(vmid))
	if err != nil {
		return err
	}
	task, err := a.c.SnapshotDelete(ctx, node, vmid, snapname)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "delete snapshot", taskTimeout)
}

// RestoreFromSnapshot rolls the VM back (PVE stops it automatically) then
// starts it again so the customer sees the same running state as Onidel.
func (a *Adapter) RestoreFromSnapshot(ctx context.Context, vmExternalID, snapshotExtID string) error {
	res, err := a.locateVM(ctx, vmExternalID)
	if err != nil {
		return err
	}
	_, snapname, err := splitSnapshotExtID(snapshotExtID)
	if err != nil {
		return err
	}
	rbTask, err := a.c.SnapshotRollback(ctx, res.Node, int(res.VMID), snapname)
	if err != nil {
		return err
	}
	if err := a.c.WaitForTask(ctx, rbTask, "rollback snapshot", taskTimeout); err != nil {
		return err
	}
	startTask, err := a.c.QEMUStart(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, startTask, "start", startTimeout)
}

// RestoreFromBackup rebuilds the VM from a vzdump archive via qmrestore
// (POST .../qemu with restore=1), overwriting the existing VMID.
func (a *Adapter) RestoreFromBackup(ctx context.Context, vmExternalID, backupExtID string) error {
	res, err := a.locateVM(ctx, vmExternalID)
	if err != nil {
		return err
	}
	task, err := a.c.BackupRestore(ctx, res.Node, backupExtID, diskStorage, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "restore backup", taskTimeout)
}

// VMBackups lists vzdump archives across all backup-capable storages whose
// volume id matches the VM (storage content rows carry the owning VMID).
func (a *Adapter) VMBackups(ctx context.Context, vmExternalID string) ([]provider.ProviderBackup, error) {
	vmid, err := strconv.ParseUint(strings.TrimSpace(vmExternalID), 10, 64)
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid vm external id %q", vmExternalID)
	}
	nodes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderBackup, 0)
	for _, node := range nodes {
		storages, err := a.c.NodeStorages(ctx, node)
		if err != nil {
			return nil, err
		}
		for _, st := range storages {
			if st.Enabled == 0 || !strings.Contains(st.Content, "backup") {
				continue
			}
			content, err := a.c.StorageContentList(ctx, node, st.Name)
			if err != nil {
				return nil, err
			}
			for _, vol := range content {
				if vol.VMID != vmid || !strings.Contains(vol.Volid, ":backup/") {
					continue
				}
				out = append(out, provider.ProviderBackup{
					ExternalID:         vol.Volid,
					CreatedAt:          unixRFC3339(int64(vol.Ctime)),
					InstanceExternalID: vmExternalID,
					Status:             "available",
					Size:               int64(vol.Size),
				})
			}
		}
	}
	return out, nil
}

// SnapshotDownloadURL is unsupported, and no streaming fallback exists either
// (unlike backups below): internal snapshots are not standalone volumes — a
// snapshot lives inside the VM's disk chain — so PVE exposes no per-snapshot
// file to download or stream in the first place.
func (a *Adapter) SnapshotDownloadURL(_ context.Context, _ string) (string, error) {
	return "", apperrors.Newf(apperrors.CodeUnsupported,
		"snapshot download URLs are not supported by the proxmox provider: internal snapshots "+
			"are not standalone volumes (they live inside the VM's disk chain), so PVE exposes "+
			"no downloadable snapshot object")
}

// BackupDownloadURL is unsupported by design, not for lack of wiring: PVE has
// no presigned URLs. Every storage-content download authenticates with the
// secret "Authorization: PVEAPIToken user@realm!token=secret" header (or an
// interactive auth cookie); neither can be embedded in a URL handed to a
// browser without leaking credentials or simply 401-ing. Downloads are served
// instead by this backend's streaming proxy: handlers type-assert the optional
// provider.BackupContentOpener capability and pump OpenBackupContent's reader
// to the caller while the token stays server-side.
func (a *Adapter) BackupDownloadURL(_ context.Context, _ string) (string, error) {
	return "", apperrors.Newf(apperrors.CodeUnsupported,
		"backup download URLs are not supported by the proxmox provider: PVE has no presigned "+
			"URLs — storage downloads authenticate with the secret Authorization: PVEAPIToken header, "+
			"so backups are streamed through this backend via OpenBackupContent instead")
}

// OpenBackupContent streams a vzdump archive straight off the cluster's
// storage. backupExtID follows exactly the convention VMBackups hands out:
// a PVE volid "<storage>:backup/<filename>". The volid alone does not name a
// node, so the hosting node is located by replaying VMBackups' walk over the
// online nodes' enabled backup storages before StorageContentDownload opens
// the byte stream. size carries Content-Length when advertised (-1 otherwise);
// the caller owns closing the reader.
func (a *Adapter) OpenBackupContent(ctx context.Context, backupExtID string) (io.ReadCloser, int64, error) {
	storageName, filename, ok := splitBackupVolid(backupExtID)
	if !ok {
		return nil, 0, apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid backup id %q (want \"<storage>:backup/<file>\")", backupExtID)
	}
	node, err := a.nodeForBackupVolume(ctx, storageName+":backup/"+filename)
	if err != nil {
		return nil, 0, err
	}
	return a.c.StorageContentDownload(ctx, node, storageName, "backup/"+filename)
}

// splitBackupVolid validates the "<storage>:backup/<filename>" external-id
// convention used by VMBackups and RestoreFromBackup and splits it into its
// storage name and raw filename. Extra slashes inside the filename are
// rejected — vzdump names never contain them.
func splitBackupVolid(extID string) (storageName, filename string, ok bool) {
	storageName, rest, found := strings.Cut(extID, ":")
	if !found || storageName == "" {
		return "", "", false
	}
	contentType, filename, hasSlash := strings.Cut(rest, "/")
	if !hasSlash || contentType != "backup" || filename == "" || strings.Contains(filename, "/") {
		return "", "", false
	}
	return storageName, filename, true
}

// nodeForBackupVolume finds which online node serves volid by replaying the
// VMBackups walk over enabled backup-capable storages (volid rows carry the
// authoritative node for both node-local and shared storages).
func (a *Adapter) nodeForBackupVolume(ctx context.Context, volid string) (string, error) {
	nodes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return "", err
	}
	for _, node := range nodes {
		storages, err := a.c.NodeStorages(ctx, node)
		if err != nil {
			return "", err
		}
		for _, st := range storages {
			if st.Enabled == 0 || !strings.Contains(st.Content, "backup") {
				continue
			}
			content, err := a.c.StorageContentList(ctx, node, st.Name)
			if err != nil {
				return "", err
			}
			for _, vol := range content {
				if vol.Volid == volid {
					return node, nil
				}
			}
		}
	}
	return "", apperrors.Newf(apperrors.CodeNotFound,
		"proxmox: backup volume %q not found on any online node", volid)
}

// ---- SSH keys ----

// EnsureSSHKey stores nothing on the cluster: Proxmox has no per-team SSH
// key registry, and keys ride cloud-init inside ProvisionVM instead. It
// returns the deterministic placeholder external id "pve-cloudinit" so the
// worker's resolveSSHKeys bookkeeping stays provider-agnostic. Because the
// stored id carries no material, BuildQemuOptions can only embed raw public
// key lines (see authorizedKeys).
func (a *Adapter) EnsureSSHKey(_ context.Context, _, name, _ string) (provider.ProviderSSHKey, error) {
	return provider.ProviderSSHKey{ExternalID: "pve-cloudinit", Name: name}, nil
}

// UpdateSSHKey is unsupported — there is nothing registered to update; new
// material takes effect on the next ProvisionVM via cloud-init.
func (a *Adapter) UpdateSSHKey(_ context.Context, _, _, _, _ string) error {
	return unsupported("ssh key updates")
}

func (a *Adapter) DeleteSSHKey(_ context.Context, _, _ string) error {
	return unsupported("ssh key deletion")
}

// ---- Startup scripts / measured boot ----

func (a *Adapter) EnsureStartupScript(_ context.Context, _, _, _ string) (provider.ProviderScript, error) {
	return provider.ProviderScript{}, unsupported("startup scripts")
}

func (a *Adapter) UpdateStartupScript(_ context.Context, _, _, _, _ string) error {
	return unsupported("startup scripts")
}

func (a *Adapter) DeleteStartupScript(_ context.Context, _, _ string) error {
	return unsupported("startup scripts")
}

func (a *Adapter) UploadMeasuredBootImage(_ context.Context, _, _, _ string, _ io.Reader, _ int64) (provider.MeasuredBootImage, error) {
	return provider.MeasuredBootImage{}, unsupported("measured boot images")
}

func (a *Adapter) ListMeasuredBootImages(_ context.Context, _ string) ([]provider.MeasuredBootImage, error) {
	return nil, unsupported("measured boot images")
}

func (a *Adapter) DeleteMeasuredBootImage(_ context.Context, _ string) error {
	return unsupported("measured boot images")
}

func (a *Adapter) AttachMeasuredBoot(_ context.Context, _, _ string) error {
	return unsupported("measured boot")
}

func (a *Adapter) DetachMeasuredBoot(_ context.Context, _ string) error {
	return unsupported("measured boot")
}

// ---- Custom ISO ----

// ListISOs dedupes iso content volumes across online nodes (shared storages
// appear once per node).
func (a *Adapter) ListISOs(ctx context.Context, _ string) ([]provider.ISOImage, error) {
	nodes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := make([]provider.ISOImage, 0)
	for _, node := range nodes {
		storages, err := a.c.NodeStorages(ctx, node)
		if err != nil {
			return nil, err
		}
		for _, st := range storages {
			if st.Enabled == 0 || !strings.Contains(st.Content, "iso") {
				continue
			}
			content, err := a.c.StorageContentList(ctx, node, st.Name)
			if err != nil {
				return nil, err
			}
			for _, vol := range content {
				_, filename, found := strings.Cut(vol.Volid, ":iso/")
				if !found || seen[vol.Volid] {
					continue
				}
				seen[vol.Volid] = true
				out = append(out, provider.ISOImage{
					ExternalID:      vol.Volid,
					Filename:        filename,
					Name:            filename,
					Size:            int64(vol.Size),
					ProgressPercent: 100, // listed means fully uploaded
					IsSystem:        false,
				})
			}
		}
	}
	return out, nil
}

// CreateISOByURL fetches the ISO onto the cluster using PVE's native
// download-url endpoint (server-side wget equivalent, no SSH required).
func (a *Adapter) CreateISOByURL(ctx context.Context, _ string, isoURL string) error {
	parsed, err := url.Parse(isoURL)
	if err != nil || parsed.Scheme != "http" && parsed.Scheme != "https" || path.Base(parsed.Path) == "." || path.Base(parsed.Path) == "/" {
		return apperrors.Newf(apperrors.CodeValidation, "proxmox: iso url must be http(s) with a filename, got %q", isoURL)
	}
	node, storage, err := a.pickISOStorage(ctx)
	if err != nil {
		return err
	}
	task, err := a.c.ISOCreateByURL(ctx, node, storage, path.Base(parsed.Path), isoURL)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "download iso", downloadTimeout)
}

// pickISOStorage chooses where ISO downloads land: the first storage with
// iso content on any online node, else the directory-based fallback.
func (a *Adapter) pickISOStorage(ctx context.Context) (node, storage string, err error) {
	nodes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return "", "", err
	}
	for _, n := range nodes {
		storages, serr := a.c.NodeStorages(ctx, n)
		if serr != nil {
			continue // try next node
		}
		for _, st := range storages {
			if st.Enabled != 0 && strings.Contains(st.Content, "iso") {
				return n, st.Name, nil
			}
		}
	}
	if len(nodes) == 0 {
		return "", "", apperrors.New(apperrors.CodeRegionUnavailable, "proxmox: no online nodes for iso upload")
	}
	return nodes[0], defaultISOStorage, nil
}

func (a *Adapter) DeleteISO(ctx context.Context, isoExtID string) error {
	storage, filename, found := strings.Cut(isoExtID, ":iso/")
	if !found || storage == "" || filename == "" {
		return apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid iso id %q (want \"storage:iso/filename\")", isoExtID)
	}
	nodes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		return apperrors.New(apperrors.CodeRegionUnavailable, "proxmox: no online nodes")
	}
	// Cluster-wide storages resolve from any node; use the first.
	task, err := a.c.ISODelete(ctx, nodes[0], storage, filename)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "delete iso", taskTimeout)
}

// ---- Reserved IPs / object storage / rDNS / BGP ----

// These capability families have no Proxmox counterpart reachable through
// this API surface (SDN/IPAM, Ceph RGW S3 and BGP need dedicated daemons);
// they fail fast with PROVIDER_UNSUPPORTED instead of silently no-oping.

func (a *Adapter) ListReservedIPs(_ context.Context, _ string) ([]provider.ProviderReservedIP, error) {
	return nil, unsupported("reserved ips")
}

func (a *Adapter) CreateReservedIP(_ context.Context, _, _, _, _ string) (string, string, error) {
	return "", "", unsupported("reserved ips")
}

func (a *Adapter) ConvertPrimaryIP(_ context.Context, _, _, _ string) (map[string]any, error) {
	return nil, unsupported("reserved ips")
}

func (a *Adapter) DeleteReservedIP(_ context.Context, _, _ string) error {
	return unsupported("reserved ips")
}

func (a *Adapter) PatchReservedIP(_ context.Context, _, _, _, _ string) error {
	return unsupported("reserved ips")
}

func (a *Adapter) ListStorageServices(_ context.Context, _ string) ([]provider.StorageServiceInfo, error) {
	return nil, unsupported("object storage services")
}

func (a *Adapter) CreateBucket(_ context.Context, _, _, _ string, _, _ bool) ([]provider.BucketKey, error) {
	return nil, unsupported("object storage buckets")
}

func (a *Adapter) BucketAccessKeys(_ context.Context, _, _, _ string) ([]provider.BucketKey, error) {
	return nil, unsupported("object storage buckets")
}

func (a *Adapter) SetReverseDNS(_ context.Context, _, _, _ string) error {
	return unsupported("reverse dns")
}

func (a *Adapter) DeleteReverseDNS(_ context.Context, _, _ string) error {
	return unsupported("reverse dns")
}

func (a *Adapter) ListReverseDNS(_ context.Context, _ string) ([]provider.RDNSRecord, error) {
	return nil, unsupported("reverse dns")
}

func (a *Adapter) EnableBGP(_ context.Context, _ string) error {
	return unsupported("bgp sessions")
}

func (a *Adapter) DisableBGP(_ context.Context, _ string) error {
	return unsupported("bgp sessions")
}

// ---- Catalog sync ----

// SyncCatalog reports nodes as locations. Instance types and OS templates
// stay DB-seeded for this provider (pricing is curated, cheaper than Onidel):
// cmd/worker providerSync only UPSERTS what SyncCatalog returns and never
// deletes missing rows (verified before finalizing), so empty lists here are
// an explicit no-op that cannot wipe seeded catalog/pricing rows.
func (a *Adapter) SyncCatalog(ctx context.Context) ([]provider.CatalogInstanceType, []provider.CatalogOSTemplate, []provider.CatalogLocation, error) {
	codes, err := onlineNodes(ctx, a.c)
	if err != nil {
		return nil, nil, nil, err
	}
	sort.Strings(codes)
	locs := make([]provider.CatalogLocation, 0, len(codes))
	for _, code := range codes {
		locs = append(locs, provider.CatalogLocation{Code: code, Name: code})
	}
	return []provider.CatalogInstanceType{}, []provider.CatalogOSTemplate{}, locs, nil
}

// ---- observability ----

// These helpers live on *Adapter only (deliberately outside
// provider.ComputeProvider): they expose raw PVE inventory and task data for
// Kilat Cloud dashboards and health checks, none of which has a normalized
// cross-provider meaning yet. Each is a thin pass-through over Client.

// Nodes lists cluster nodes with their online/offline status.
func (a *Adapter) Nodes(ctx context.Context) (goproxmox.NodeStatuses, error) {
	return a.c.Nodes(ctx)
}

// ClusterResources returns cluster resource rows (guests, storages, nodes)
// with optional PVE filters such as "vm".
func (a *Adapter) ClusterResources(ctx context.Context, filters ...string) (goproxmox.ClusterResources, error) {
	return a.c.ClusterResources(ctx, filters...)
}

// NodeStorages lists the storages visible from one node.
func (a *Adapter) NodeStorages(ctx context.Context, node string) (goproxmox.Storages, error) {
	return a.c.NodeStorages(ctx, node)
}

// RecentTasks lists recent tasks on one node — archived finished tasks plus
// the ones still running (source=all).
func (a *Adapter) RecentTasks(ctx context.Context, node string) ([]*goproxmox.Task, error) {
	return a.c.RecentTasks(ctx, node)
}

// ---- helpers ----

// unsupported builds the PROVIDER_UNSUPPORTED error used by every
// unimplemented capability family.
func unsupported(op string) error {
	return apperrors.Newf(apperrors.CodeUnsupported, "%s is not supported by the proxmox provider", op)
}

// onlineNodes returns sorted names of nodes reporting online status.
func onlineNodes(ctx context.Context, c *Client) ([]string, error) {
	ns, err := c.Nodes(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(ns))
	for _, n := range ns {
		if n.Status == "online" && n.Node != "" {
			out = append(out, n.Node)
		}
	}
	sort.Strings(out)
	return out, nil
}

// nodeForVMID finds the hosting node of a VMID without the full resource row.
func (a *Adapter) nodeForVMID(ctx context.Context, vmid int64) (string, error) {
	res, err := a.locateVM(ctx, strconv.FormatInt(vmid, 10))
	if err != nil {
		return "", err
	}
	return res.Node, nil
}

// ---- Extended capability surface (PVE) ----

// vmNotesTags reads notes/tags off the loaded config in one call.
func (a *Adapter) vmNotesTags(ctx context.Context, externalID string) (*goproxmox.VirtualMachine, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	vm, err := a.c.VMConfigGet(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}
	return vm, nil
}

func (a *Adapter) VMNotes(ctx context.Context, externalID string) (string, error) {
	vm, err := a.vmNotesTags(ctx, externalID)
	if err != nil {
		return "", err
	}
	if vm.VirtualMachineConfig == nil {
		return "", nil
	}
	return vm.VirtualMachineConfig.Description, nil
}

func (a *Adapter) SetVMNotes(ctx context.Context, externalID, notes string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	_, err = a.c.QEMUConfigSet(ctx, res.Node, int(res.VMID),
		goproxmox.VirtualMachineOption{Name: "description", Value: notes})
	return err
}

func (a *Adapter) VMTags(ctx context.Context, externalID string) ([]string, error) {
	vm, err := a.vmNotesTags(ctx, externalID)
	if err != nil {
		return nil, err
	}
	if vm.VirtualMachineConfig == nil || strings.TrimSpace(vm.VirtualMachineConfig.Tags) == "" {
		return []string{}, nil
	}
	return strings.Split(vm.VirtualMachineConfig.Tags, ";"), nil
}

func (a *Adapter) SetVMTags(ctx context.Context, externalID string, tags []string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.VMTagsSet(ctx, res.Node, int(res.VMID), tags)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "set tags", startTimeout)
}

func (a *Adapter) ResetVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUReset(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "reset", startTimeout)
}

func (a *Adapter) PauseVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUPause(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "pause", startTimeout)
}

func (a *Adapter) ResumeVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUResume(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "resume", startTimeout)
}

func (a *Adapter) HibernateVM(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUHibernate(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "hibernate", startTimeout)
}

// SerialConsole opens an xterm.js terminal ticket; browsers upgrade through
// the same vncwebsocket path with the term ticket (see VNCSession).
func (a *Adapter) SerialConsole(ctx context.Context, vmExternalID string) (string, int64, error) {
	res, err := a.locateVM(ctx, vmExternalID)
	if err != nil {
		return "", 0, err
	}
	term, err := a.c.SerialTermProxy(ctx, res.Node, int(res.VMID))
	if err != nil {
		return "", 0, err
	}
	wsHost := strings.Replace(a.c.host, "https://", "wss://", 1)
	wsHost = strings.Replace(wsHost, "http://", "ws://", 1)
	termURL := fmt.Sprintf("%s%s/nodes/%s/qemu/%d/vncwebsocket?port=%d&vncticket=%s",
		wsHost, apiPath, res.Node, res.VMID, int(term.Port), url.QueryEscape(term.Ticket))
	return termURL, time.Now().Add(vncTicketLifetime).Unix(), nil
}

func (a *Adapter) CloneVM(ctx context.Context, externalID, newName string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	newID, err := a.c.ClusterNextID(ctx)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUClone(ctx, res.Node, int(res.VMID), newID, newName, "", "", true)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "clone", cloneTimeout)
}

func (a *Adapter) ConvertToTemplate(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUConvertToTemplate(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "convert to template", startTimeout)
}

func (a *Adapter) MoveVolume(ctx context.Context, externalID, volume, targetStorage string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.QEMUMoveDisk(ctx, res.Node, int(res.VMID), volume, targetStorage)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "move disk", moveTimeout)
}

func (a *Adapter) CloudInitRegenerate(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.CloudInitRegenerate(ctx, res.Node, int(res.VMID))
}

func (a *Adapter) GuestMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return a.c.VMRRDData(ctx, res.Node, int(res.VMID), timeframe, "AVERAGE")
}

func (a *Adapter) GuestAgentPing(ctx context.Context, externalID string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.AgentPing(ctx, res.Node, int(res.VMID))
}

func (a *Adapter) GuestAgentOSInfo(ctx context.Context, externalID string) (any, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return a.c.AgentOsInfo(ctx, res.Node, int(res.VMID))
}

func (a *Adapter) GuestAgentFSInfo(ctx context.Context, externalID string) (any, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return a.c.AgentFsInfo(ctx, res.Node, int(res.VMID))
}

func (a *Adapter) GuestAgentInfo(ctx context.Context, externalID string) (any, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return a.c.AgentInfo(ctx, res.Node, int(res.VMID))
}

// ---- Per-VM firewall normalization ----

func fwRuleFromProvider(r provider.ProviderFirewallRule) *goproxmox.FirewallRule {
	out := &goproxmox.FirewallRule{
		Type:    r.Type,
		Action:  r.Action,
		Comment: r.Comment,
		Dest:    r.Destination,
		Dport:   r.DestPort,
		Source:  r.Source,
	}
	if s := r.SourcePort; s != "" {
		out.Sport = s
	}
	if r.Proto != "" {
		out.Proto = r.Proto
	}
	if r.Enabled {
		out.Enable = 1
	}
	return out
}

func fwRuleToProvider(r *goproxmox.FirewallRule) provider.ProviderFirewallRule {
	out := provider.ProviderFirewallRule{
		Pos:         r.Pos,
		Type:        r.Type,
		Action:      r.Action,
		Source:      r.Source,
		Destination: r.Dest,
		Proto:       r.Proto,
		DestPort:    r.Dport,
		SourcePort:  r.Sport,
		Comment:     r.Comment,
	}
	out.Enabled = r.Enable == 1
	return out
}

func (a *Adapter) FirewallRulesList(ctx context.Context, externalID string) ([]provider.ProviderFirewallRule, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	rules, err := a.c.VMFirewallRules(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderFirewallRule, 0, len(rules))
	for _, r := range rules {
		out = append(out, fwRuleToProvider(r))
	}
	return out, nil
}

func (a *Adapter) CreateFirewallRule(ctx context.Context, externalID string, rule provider.ProviderFirewallRule) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallRuleCreate(ctx, res.Node, int(res.VMID), fwRuleFromProvider(rule))
}

func (a *Adapter) DeleteFirewallRule(ctx context.Context, externalID string, pos int) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	rule, err := a.c.VMFirewallRuleAt(ctx, res.Node, int(res.VMID), pos)
	if err != nil {
		return err
	}
	return wrapErr("firewall rule delete", rule.Delete(ctx))
}

func (a *Adapter) FirewallOptionsMap(ctx context.Context, externalID string) (map[string]any, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	opt, err := a.c.VMFirewallOptionGet(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}
	raw, jerr := json.Marshal(opt)
	if jerr != nil {
		return nil, fmt.Errorf("proxmox: marshal firewall options: %w", jerr)
	}
	var out map[string]any
	if jerr := json.Unmarshal(raw, &out); jerr != nil {
		return nil, fmt.Errorf("proxmox: unmarshal firewall options: %w", jerr)
	}
	return out, nil
}

func (a *Adapter) SetFirewallOptionsMap(ctx context.Context, externalID string, opts map[string]any) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	raw, jerr := json.Marshal(opts)
	if jerr != nil {
		return apperrors.New(apperrors.CodeValidation, "invalid firewall options payload")
	}
	var opt goproxmox.FirewallVirtualMachineOption
	if jerr := json.Unmarshal(raw, &opt); jerr != nil {
		return apperrors.Newf(apperrors.CodeValidation, "invalid firewall options payload: %v", jerr)
	}
	return a.c.VMFirewallOptionSet(ctx, res.Node, int(res.VMID), &opt)
}

// ---- Per-VM firewall ipsets ----

func (a *Adapter) FirewallIPSetsList(ctx context.Context, externalID string) ([]provider.ProviderIPSet, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	sets, err := a.c.VMFirewallIPSets(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderIPSet, 0, len(sets))
	for _, s := range sets {
		out = append(out, provider.ProviderIPSet{Name: s.Name, Comment: s.Comment})
	}
	return out, nil
}

func (a *Adapter) CreateFirewallIPSet(ctx context.Context, externalID, name, comment string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallIPSetCreate(ctx, res.Node, int(res.VMID), name, comment)
}

func (a *Adapter) DeleteFirewallIPSet(ctx context.Context, externalID, name string, force bool) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallIPSetDelete(ctx, res.Node, int(res.VMID), name, force)
}

func (a *Adapter) FirewallIPSetEntriesList(ctx context.Context, externalID, name string) ([]provider.ProviderIPSetEntry, error) {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	entries, err := a.c.VMFirewallIPSetEntries(ctx, res.Node, int(res.VMID), name)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderIPSetEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, provider.ProviderIPSetEntry{CIDR: e.CIDR, Comment: e.Comment})
	}
	return out, nil
}

func (a *Adapter) AddFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, comment string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallIPSetEntryAdd(ctx, res.Node, int(res.VMID), name, cidr, comment)
}

func (a *Adapter) UpdateFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, newCIDR, comment string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallIPSetEntryUpdate(ctx, res.Node, int(res.VMID), name, cidr, newCIDR, comment)
}

func (a *Adapter) RemoveFirewallIPSetEntry(ctx context.Context, externalID, name, cidr string) error {
	res, err := a.locateVM(ctx, externalID)
	if err != nil {
		return err
	}
	return a.c.VMFirewallIPSetEntryRemove(ctx, res.Node, int(res.VMID), name, cidr)
}

// ---- Extended surface II (*Adapter only, outside ComputeProvider) ----
// Thin pass-throughs over Client for PVE capabilities that have no normalized
// cross-provider meaning yet; each mirrors its Client counterpart 1:1.

// BackupJobRunNow triggers one immediate run of scheduled backup job id and
// returns the task without waiting — vzdump runs are long by nature, callers
// observe progress through the task endpoints instead.
func (a *Adapter) BackupJobRunNow(ctx context.Context, id string) (*goproxmox.Task, error) {
	return a.c.BackupJobRunNow(ctx, id)
}

// HAArm / HADisarm control the cluster HA stack watchdog state.
func (a *Adapter) HAArm(ctx context.Context) error { return a.c.HAArm(ctx) }

func (a *Adapter) HADisarm(ctx context.Context, resourceMode string) error {
	return a.c.HADisarm(ctx, resourceMode)
}

// PoolUpdateMembers adds (delete=false) or removes (delete=true) comma
// separated VM/storage lists to/from pool poolid.
func (a *Adapter) PoolUpdateMembers(ctx context.Context, poolid, comment string, vmsCSV, storagesCSV string, delete bool) error {
	return a.c.PoolUpdateMembers(ctx, poolid, comment, vmsCSV, storagesCSV, delete)
}

// BackupFileRestoreList browses files inside a stored backup volume.
func (a *Adapter) BackupFileRestoreList(ctx context.Context, node, storage, volume, filepath string) ([]*goproxmox.StorageFileRestoreEntry, error) {
	return a.c.BackupFileRestoreList(ctx, node, storage, volume, filepath)
}

// ClusterStoragesList / ClusterStorageGet / ClusterStorageCreate /
// ClusterStorageUpdate / ClusterStorageDelete manage cluster-wide storage
// definitions. Mutations return the PVE task without waiting so callers can
// batch several edits cheaply.
func (a *Adapter) ClusterStoragesList(ctx context.Context) (goproxmox.ClusterStorages, error) {
	return a.c.ClusterStoragesList(ctx)
}

func (a *Adapter) ClusterStorageGet(ctx context.Context, name string) (*goproxmox.ClusterStorage, error) {
	return a.c.ClusterStorageGet(ctx, name)
}

func (a *Adapter) ClusterStorageCreate(ctx context.Context, opts []goproxmox.ClusterStorageOptions) (*goproxmox.Task, error) {
	return a.c.ClusterStorageCreate(ctx, opts)
}

func (a *Adapter) ClusterStorageUpdate(ctx context.Context, name string, opts []goproxmox.ClusterStorageOptions) (*goproxmox.Task, error) {
	return a.c.ClusterStorageUpdate(ctx, name, opts)
}

func (a *Adapter) ClusterStorageDelete(ctx context.Context, name string) (*goproxmox.Task, error) {
	return a.c.ClusterStorageDelete(ctx, name)
}

// NodeDNSGet / NodeDNSSet / NodeTimeGet read and write per-node resolver and
// clock settings; gets decode into flexible maps mirroring the PVE envelope.
func (a *Adapter) NodeDNSGet(ctx context.Context, node string) (map[string]any, error) {
	return a.c.NodeDNSGet(ctx, node)
}

func (a *Adapter) NodeDNSSet(ctx context.Context, node, search, dns1, dns2, dns3 string) error {
	return a.c.NodeDNSSet(ctx, node, search, dns1, dns2, dns3)
}

func (a *Adapter) NodeTimeGet(ctx context.Context, node string) (map[string]any, error) {
	return a.c.NodeTimeGet(ctx, node)
}

// NodeQEMUCPUModels lists the CPU models this node can run (arch "" for the
// host default, "x86_64" or "aarch64").
func (a *Adapter) NodeQEMUCPUModels(ctx context.Context, node, arch string) ([]*goproxmox.QEMUCPUModel, error) {
	return a.c.NodeQEMUCPUModels(ctx, node, arch)
}

// ---------------------------------------------------------------------------
// Containers (LXC). External IDs use the "ct<vmid>" convention ("ct101");
// snapshot external ids are "ct<vmid>/<snapname>". Mirrors the VM surface
// above: same task waits, same status mapping, same managed tag.
// ---------------------------------------------------------------------------

const (
	// containerOSType is the default LXC OS family for fresh containers;
	// PVE create accepts debian/alpine/arch/... and the seeded templates
	// are Debian-based.
	containerOSType = "debian"

	// containerNet0 is the default veth: first guest NIC on the cluster
	// bridge with DHCP so the container comes up reachable like the VMs.
	containerNet0 = "name=eth0,bridge=vmbr0,ip=dhcp"
)

// containerExternalID encodes a VMID into the "ct<vmid>" convention.
func containerExternalID(vmid int) string {
	return fmt.Sprintf("ct%d", vmid)
}

// locateContainer resolves a "ct<vmid>" external id to its cluster resource
// row, which carries the hosting node. The resource list stays unfiltered
// because the type filter narrows client-side to lxc rows only.
func (a *Adapter) locateContainer(ctx context.Context, externalID string) (*goproxmox.ClusterResource, error) {
	vmidStr := strings.TrimSpace(externalID)
	if !strings.HasPrefix(vmidStr, "ct") || len(vmidStr) <= 2 {
		return nil, apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid container external id %q (want \"ct<vmid>\")", externalID)
	}
	vmid, err := strconv.ParseUint(vmidStr[2:], 10, 64)
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid container external id %q", externalID)
	}
	resources, err := a.c.ClusterResources(ctx)
	if err != nil {
		return nil, err
	}
	for _, r := range resources {
		if r.Type == "lxc" && r.VMID == vmid {
			return r, nil
		}
	}
	return nil, apperrors.Newf(apperrors.CodeNotFound,
		"proxmox: container %q not found in cluster resources", externalID)
}

// BuildContainerOptions translates an InstanceSpec into PVE create-LXC
// options. Exported pure function so tests can assert the exact option map
// without a cluster. rootPassword is only embedded when the spec carries no
// usable SSH key material; provisioning callers generate it via
// randomContainerPassword. rootfs lands on the same diskStorage pool the VMs
// use; unprivileged+nesting match the hardened default profile.
func BuildContainerOptions(spec provider.InstanceSpec, rootPassword string) []goproxmox.ContainerOption {
	opts := []goproxmox.ContainerOption{
		{Name: "hostname", Value: spec.Name},
		{Name: "ostype", Value: containerOSType},
		{Name: "cores", Value: int(spec.CPU)},
		{Name: "memory", Value: int(spec.RAM)}, // InstanceSpec.RAM is MB == PVE MiB (balloon limit)
		{Name: "rootfs", Value: fmt.Sprintf("%s:size=%dG", diskStorage, spec.Disk)},
		{Name: "net0", Value: containerNet0},
		{Name: "unprivileged", Value: 1},
		{Name: "features", Value: "nesting=1"},
	}
	if keys := authorizedKeys(spec.SSHKeyIDs); len(keys) > 0 {
		// EncodeSSHKeys percent-encodes exactly the way PVE's urlencoded-string
		// validator requires (same call the QEMU cloud-init path uses).
		opts = append(opts, goproxmox.ContainerOption{
			Name: "sshkeys", Value: goproxmox.EncodeSSHKeys(keys...)})
	} else if rootPassword != "" {
		opts = append(opts, goproxmox.ContainerOption{
			Name: "password", Value: rootPassword})
	}
	return opts
}

// pwAlphabet holds exactly 64 characters so index extraction via buf&63 is
// unbiased: lowercase + uppercase + digits + "#%".
const pwAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%"

// randomContainerPassword mints a 24-char root password for containers
// provisioned without SSH keys — PVE delivers it through the create call.
func randomContainerPassword() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", apperrors.Newf(apperrors.CodeProvisionFailed,
			"proxmox: generate container root password: %v", err)
	}
	for i, b := range buf {
		buf[i] = pwAlphabet[int(b)&63]
	}
	return string(buf), nil
}

func (a *Adapter) ProvisionContainer(ctx context.Context, spec provider.InstanceSpec) error {
	if spec.Location == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: instance location (node name) is required")
	}
	vmid, err := a.c.NextVMID(ctx)
	if err != nil {
		return err
	}

	rootPassword := ""
	if len(authorizedKeys(spec.SSHKeyIDs)) == 0 {
		rootPassword, err = randomContainerPassword()
		if err != nil {
			return err
		}
	}

	createTask, err := a.c.ContainerCreate(ctx, spec.Location, vmid, BuildContainerOptions(spec, rootPassword))
	if err != nil {
		return err
	}
	if err := a.c.WaitForTask(ctx, createTask, "create lxc", taskTimeout); err != nil {
		return apperrors.Newf(apperrors.CodeProvisionFailed, "proxmox create container %d: %v", vmid, err)
	}

	// Best-effort ownership tag: provisioning never fails because tagging did.
	if loaded, lerr := a.c.ContainerGet(ctx, spec.Location, vmid); lerr == nil && loaded != nil {
		_, _ = loaded.AddTag(ctx, managedTag)
	}

	startTask, serr := a.c.ContainerStart(ctx, spec.Location, vmid)
	if serr != nil {
		return serr
	}
	return a.c.WaitForTask(ctx, startTask, "start", startTimeout)
}

func (a *Adapter) StartContainer(ctx context.Context, externalID string) error {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.ContainerStart(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "start", startTimeout)
}

func (a *Adapter) StopContainer(ctx context.Context, externalID string, force bool) error {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.ContainerStop(ctx, res.Node, int(res.VMID), force)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "stop", stopTimeout)
}

func (a *Adapter) RebootContainer(ctx context.Context, externalID string) error {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.ContainerReboot(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "reboot", startTimeout)
}

func (a *Adapter) DestroyContainer(ctx context.Context, externalID string) error {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	task, err := a.c.ContainerDelete(ctx, res.Node, int(res.VMID), true /* purge */, true /* destroyUnreferencedDisks */)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "destroy", taskTimeout)
}

// MigrateContainer moves the container to another node of the same cluster.
// The preconditions dry-run runs first as an advisory preflight, mirroring
// MigrateVM: logged, never fatal — PVE re-validates during the migration task
// itself and WaitForTask surfaces any real error with its exit status.
func (a *Adapter) MigrateContainer(ctx context.Context, externalID, targetNode string) error {
	targetNode = strings.TrimSpace(targetNode)
	if targetNode == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: target node is required for migration")
	}
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	if res.Node == targetNode {
		return apperrors.Newf(apperrors.CodeValidation,
			"proxmox: container %s already lives on node %s", externalID, targetNode)
	}
	if pre, perr := a.c.ContainerMigratePreconditions(ctx, res.Node, int(res.VMID), targetNode); perr != nil {
		log.Printf("proxmox: migrate ct %d %s -> %s preflight unavailable (continuing): %v",
			res.VMID, res.Node, targetNode, perr)
	} else if pre != nil {
		log.Printf("proxmox: migrate ct %d %s -> %s preflight: running=%v allowed_nodes=%v local_disks=%d",
			res.VMID, res.Node, targetNode, pre.Running, pre.AllowedNodes, len(pre.LocalDisks))
	}
	task, err := a.c.ContainerMigrate(ctx, res.Node, int(res.VMID), targetNode)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "migrate", migrateTimeout)
}

// ContainerSerialConsole opens an xterm.js terminal ticket for the container;
// browsers upgrade through /nodes/{node}/lxc/{vmid}/vncwebsocket with the
// term ticket (see SerialConsole).
func (a *Adapter) ContainerSerialConsole(ctx context.Context, externalID string) (string, int64, error) {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return "", 0, err
	}
	term, err := a.c.ContainerTermProxy(ctx, res.Node, int(res.VMID))
	if err != nil {
		return "", 0, err
	}
	wsHost := strings.Replace(a.c.host, "https://", "wss://", 1)
	wsHost = strings.Replace(wsHost, "http://", "ws://", 1)
	termURL := fmt.Sprintf("%s%s/nodes/%s/lxc/%d/vncwebsocket?port=%d&vncticket=%s",
		wsHost, apiPath, res.Node, res.VMID, int(term.Port), url.QueryEscape(term.Ticket))
	return termURL, time.Now().Add(vncTicketLifetime).Unix(), nil
}

// ContainerMetrics returns the container's round-robin metric series.
func (a *Adapter) ContainerMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return a.c.ContainerRRDData(ctx, res.Node, int(res.VMID), timeframe, "AVERAGE")
}

// ContainersListAll maps every LXC resource row onto VMState using the same
// status mapping as ListVMs; template rows are skipped.
func (a *Adapter) ContainersListAll(ctx context.Context) ([]provider.VMState, error) {
	resources, err := a.c.ClusterResources(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]provider.VMState, 0, len(resources))
	for _, r := range resources {
		if r.Type != "lxc" || r.Template == 1 {
			continue
		}
		out = append(out, provider.VMState{
			ExternalID:  containerExternalID(int(r.VMID)),
			Name:        r.Name,
			Status:      mapPVEStatus(r.Status),
			PowerStatus: r.Status,
			VCPU:        int64(r.MaxCPU),
			RAM:         int64(r.MaxMem >> 20),
			Disk:        int64(r.MaxDisk >> 30),
		})
	}
	return out, nil
}

// ---- container snapshots ----

// containerSnapshotExtID encodes "ct<vmid>/<snapname>";
// splitContainerSnapshotExtID splits it back.
func containerSnapshotExtID(vmid int, snapname string) string {
	return fmt.Sprintf("%s/%s", containerExternalID(vmid), snapname)
}

func splitContainerSnapshotExtID(extID string) (vmid int, snapname string, err error) {
	body := strings.TrimSpace(extID)
	if !strings.HasPrefix(body, "ct") {
		return 0, "", apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid container snapshot id %q (want \"ct<vmid>/<snapname>\")", extID)
	}
	vmidStr, snapname, found := strings.Cut(body[2:], "/")
	if !found || vmidStr == "" || snapname == "" {
		return 0, "", apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid container snapshot id %q", extID)
	}
	vmid, aerr := strconv.Atoi(vmidStr)
	if aerr != nil {
		return 0, "", apperrors.Newf(apperrors.CodeValidation,
			"proxmox: invalid container snapshot id %q", extID)
	}
	return vmid, snapname, nil
}

func (a *Adapter) ContainerSnapshotCreate(ctx context.Context, externalID, name, desc string) (string, error) {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return "", err
	}
	task, err := a.c.ContainerSnapshotCreate(ctx, res.Node, int(res.VMID), name, desc)
	if err != nil {
		return "", err
	}
	if err := a.c.WaitForTask(ctx, task, "create snapshot", taskTimeout); err != nil {
		return "", err
	}
	return containerSnapshotExtID(int(res.VMID), name), nil
}

// ContainerSnapshotsList lists one container's snapshots ("current"
// pseudo-snapshot skipped), sorted by external id for stable output.
func (a *Adapter) ContainerSnapshotsList(ctx context.Context, externalID string) ([]provider.ProviderSnapshot, error) {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return nil, err
	}
	snaps, err := a.c.ContainerSnapshotsList(ctx, res.Node, int(res.VMID))
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderSnapshot, 0, len(snaps))
	for _, s := range snaps {
		if s.Name == "current" { // pseudo-snapshot pointing at live state
			continue
		}
		out = append(out, provider.ProviderSnapshot{
			ExternalID: containerSnapshotExtID(int(res.VMID), s.Name),
			Name:       s.Name,
			Desc:       s.Description,
			CreatedAt:  unixRFC3339(s.SnapshotCreationTime),
			Status:     "available",
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExternalID < out[j].ExternalID })
	return out, nil
}

func (a *Adapter) ContainerSnapshotDelete(ctx context.Context, snapshotExtID string) error {
	vmid, snapname, err := splitContainerSnapshotExtID(snapshotExtID)
	if err != nil {
		return err
	}
	node, err := a.nodeForContainerVMID(ctx, vmid)
	if err != nil {
		return err
	}
	task, err := a.c.ContainerSnapshotDelete(ctx, node, vmid, snapname)
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, task, "delete snapshot", taskTimeout)
}

// ContainerSnapshotRollback rolls the container back (PVE stops it as part
// of rollback) then starts it again so the customer sees the same running
// state as Onidel — mirror of RestoreFromSnapshot.
func (a *Adapter) ContainerSnapshotRollback(ctx context.Context, externalID, snapshotExtID string) error {
	res, err := a.locateContainer(ctx, externalID)
	if err != nil {
		return err
	}
	_, snapname, err := splitContainerSnapshotExtID(snapshotExtID)
	if err != nil {
		return err
	}
	rbTask, err := a.c.ContainerSnapshotRollback(ctx, res.Node, int(res.VMID), snapname, false)
	if err != nil {
		return err
	}
	if err := a.c.WaitForTask(ctx, rbTask, "rollback snapshot", taskTimeout); err != nil {
		return err
	}
	startTask, err := a.c.ContainerStart(ctx, res.Node, int(res.VMID))
	if err != nil {
		return err
	}
	return a.c.WaitForTask(ctx, startTask, "start", startTimeout)
}

// nodeForContainerVMID finds the hosting node of a container VMID without the
// full resource row.
func (a *Adapter) nodeForContainerVMID(ctx context.Context, vmid int) (string, error) {
	res, err := a.locateContainer(ctx, containerExternalID(vmid))
	if err != nil {
		return "", err
	}
	return res.Node, nil
}
