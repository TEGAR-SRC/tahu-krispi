// provider.go adapts a VMware vSphere deployment (vCenter + ESXi) to the
// provider.ComputeProvider interface. spec.Location carries the target
// ESXi host or cluster name (regions.external_code); VM external IDs are
// vSphere MoRef strings ("VirtualMachine:vm-123").
//
// Capability map — native vs unsupported:
//
//	NATIVE      VM lifecycle (clone from template or empty create), power
//	            controls (on/off/reset/suspend/graceful guest shutdown and
//	            reboot), cross-host vMotion, CPU/RAM resize (both
//	            directions; disks grow-only — a vSphere storage limitation),
//	            snapshots (create/list/revert/remove), clone,
//	            convert-to-template, storage vMotion, notes
//	            (config.annotation), tags (vAPI tags service), guest
//	            observability read from vm.Guest properties plus
//	            PerformanceManager counters, catalog sync (clusters/hosts as
//	            locations, templates as os_templates)
//	UNSUPPORTED console sessions (vSphere uses the WebMKS/VMRC ticket
//	            protocol — deliberately not exposed as raw URLs), SSH keys /
//	            startup scripts / cloud-init regenerate / measured boot
//	            (guest-customization domain), per-VM firewall rules &
//	            IPSets (the vSphere firewall is the distributed firewall at
//	            datacenter level, not a per-VM rule API), reserved IPs /
//	            object storage / rDNS / BGP (platform-side network
//	            products), backup download URLs and restore-from-backup
//	            (vSphere backups are VADP/API-based jobs, not downloadable
//	            files), ISO upload/delete (needs the datastore file-manager
//	            upload flow), hibernate (vSphere offers suspend only), and
//	            every Container* method.
//
// Proxmox-specific Adapter capabilities that have no generic interface
// member (BackupJobRunNow, HAArm/HADisarm, PoolUpdateMembers,
// BackupFileRestoreList, ClusterStorages*, NodeDNSGet/Set, NodeTimeGet,
// NodeQEMUCPUModels) are deliberately NOT implemented here — they are
// *proxmox.Adapter methods, not part of provider.ComputeProvider.
package vmware

import (
	"context"
	"fmt"
	"io"
	"log"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/performance"
	"github.com/vmware/govmomi/units"
	"github.com/vmware/govmomi/vapi/rest"
	"github.com/vmware/govmomi/vapi/tags"
	"github.com/vmware/govmomi/vim25"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/types"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	ProviderCode = "vmware"

	// managedTag marks VMs created by Kilat Cloud so ListVMs can filter out
	// foreign guests on shared vCenters. It lives inside tagCategory.
	managedTag = "kilat"

	// tagCategory groups every Kilat-managed tag in the vAPI tag service.
	tagCategory = "kilat-cloud"

	// kilatFolder is an alternative ownership marker: any VM living in a
	// folder with this name under a datacenter's vm folder counts as managed.
	kilatFolder = "kilat"

	// defaultPortGroup is tried when the spec carries no resolvable network.
	defaultPortGroup = "VM Network"

	// shutdownGrace bounds the wait for a graceful guest-tools shutdown
	// before falling back to a hard power-off.
	shutdownGrace = 30 * time.Second

	// shutdownPoll is how often StopVM re-reads the power state while
	// waiting for the graceful shutdown.
	shutdownPoll = time.Second
)

// Adapter implements provider.ComputeProvider against one vCenter endpoint.
type Adapter struct {
	c *Client
}

// Compile-time proof that Adapter satisfies the full interface.
var _ provider.ComputeProvider = (*Adapter)(nil)

// NewAdapter wires an adapter from DB-stored endpoint credentials.
// Coordinator wiring:
//
//	prov, err := vmware.NewAdapter(endpoint, user, password, insecure)
//	provider.Register(prov)
func NewAdapter(baseURL, username, password string, insecure bool) (*Adapter, error) {
	c, err := NewClient(baseURL, username, password, insecure)
	if err != nil {
		return nil, err
	}
	return &Adapter{c: c}, nil
}

// Client exposes the low-level client for callers needing operations outside
// the ComputeProvider surface (health checks, diagnostics).
func (a *Adapter) Client() *Client { return a.c }

func (a *Adapter) Code() string { return ProviderCode }

// ResizePolicy: the upgrade-only lock is an Onidel platform rule; the
// self-hosted vSphere deployment may resize CPU/RAM in both directions.
// (Disks remain grow-only everywhere: vSphere cannot shrink virtual disks.)
func (a *Adapter) ResizePolicy() provider.ResizePolicy {
	return provider.ResizePolicy{AllowDowngrade: true}
}

// ---- external ID conventions ----

// parseVMRef resolves an external VM id to its MoRef. Canonical form is the
// govmomi MoRef string "VirtualMachine:vm-123"; the bare "vm-123" value is
// accepted as well.
func parseVMRef(externalID string) (types.ManagedObjectReference, error) {
	id := strings.TrimSpace(externalID)
	var ref types.ManagedObjectReference
	if ref.FromString(id) && ref.Type == "VirtualMachine" {
		return ref, nil
	}
	if strings.HasPrefix(id, "vm-") {
		return types.ManagedObjectReference{Type: "VirtualMachine", Value: id}, nil
	}
	return ref, apperrors.Newf(apperrors.CodeValidation,
		"vmware: invalid vm external id %q (want \"VirtualMachine:vm-<id>\")", id)
}

// snapshotExtID encodes "<vmExtID>/<snapname>"; splitSnapshotExtID cuts on
// the first slash (the vm part itself contains none).
func snapshotExtID(vmExternalID, name string) string {
	return vmExternalID + "/" + name
}

func splitSnapshotExtID(extID string) (vmExternalID, snapName string, err error) {
	vmPart, name, found := strings.Cut(extID, "/")
	if !found || vmPart == "" || name == "" {
		return "", "", apperrors.Newf(apperrors.CodeValidation,
			"vmware: invalid snapshot id %q (want \"<vm-ext-id>/<snapname>\")", extID)
	}
	if _, perr := parseVMRef(vmPart); perr != nil {
		return "", "", apperrors.Newf(apperrors.CodeValidation,
			"vmware: invalid snapshot id %q", extID)
	}
	return vmPart, name, nil
}

// ---- property fetch helpers ----

// vmProps is the projection of mo.VirtualMachine the adapter relies on.
type vmProps struct {
	obj      *object.VirtualMachine
	ref      types.ManagedObjectReference
	name     string
	runtime  types.VirtualMachineRuntimeInfo
	guest    *types.GuestInfo
	config   *types.VirtualMachineConfigInfo
	snapshot *types.VirtualMachineSnapshotInfo
}

func (p *vmProps) isTemplate() bool { return p.config != nil && p.config.Template }

// primaryDiskKB returns the largest virtual disk size in KiB.
func (p *vmProps) primaryDiskKB() int64 {
	var max int64
	if p.config == nil {
		return 0
	}
	for _, dev := range p.config.Hardware.Device {
		if disk, ok := dev.(*types.VirtualDisk); ok && disk.CapacityInKB > max {
			max = disk.CapacityInKB
		}
	}
	return max
}

func (p *vmProps) toolsRunning() bool {
	return p.guest != nil && p.guest.ToolsRunningStatus == string(types.VirtualMachineToolsRunningStatusGuestToolsRunning)
}

func (p *vmProps) toVMState() *provider.VMState {
	status, power := mapPowerState(p.runtime.PowerState)
	st := &provider.VMState{
		ExternalID:  p.ref.String(),
		Name:        p.name,
		Status:      status,
		PowerStatus: power,
		Disk:        p.primaryDiskKB() * units.KB / units.GB,
	}
	if p.config != nil {
		st.VCPU = int64(p.config.Hardware.NumCPU)
		st.RAM = int64(p.config.Hardware.MemoryMB)
	}
	if p.guest != nil {
		st.MainIPv4 = p.guest.IpAddress
	}
	return st
}

// fetchVM loads the projected properties for one VM reference.
func fetchVM(ctx context.Context, v *vim25.Client, ref types.ManagedObjectReference) (*vmProps, error) {
	obj := object.NewVirtualMachine(v, ref)
	var m mo.VirtualMachine
	props := []string{"name", "runtime", "guest", "summary", "snapshot", "config"}
	if err := obj.Properties(ctx, ref, props, &m); err != nil {
		return nil, mapLookupErr(ref, err)
	}
	return &vmProps{
		obj:      obj,
		ref:      ref,
		name:     m.Name,
		runtime:  m.Runtime,
		guest:    m.Guest,
		config:   m.Config,
		snapshot: m.Snapshot,
	}, nil
}

// mapLookupErr turns "managed object not found" lookups into CodeNotFound;
// anything else stays a provider-unavailable failure.
func mapLookupErr(ref types.ManagedObjectReference, err error) error {
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "was not found") || strings.Contains(msg, "does not exist") {
		return apperrors.Newf(apperrors.CodeNotFound,
			"vmware: vm %s not found: %v", ref.Value, err)
	}
	return apperrors.Newf(apperrors.CodeProviderUnavailable,
		"vmware: load vm %s: %v", ref.Value, err)
}

// mapPowerState maps vSphere power state onto Kilat Cloud resource status.
func mapPowerState(s types.VirtualMachinePowerState) (status, powerStatus string) {
	switch s {
	case types.VirtualMachinePowerStatePoweredOn:
		return "active", string(s)
	case types.VirtualMachinePowerStatePoweredOff:
		return "stopped", string(s)
	case types.VirtualMachinePowerStateSuspended:
		return "suspended", string(s)
	default:
		return "unknown", string(s)
	}
}

// ---- small shared helpers ----

// waitTask blocks until the task completes, normalizing the failure.
func waitTask(task *object.Task, what string) error {
	if err := task.Wait(context.Background()); err != nil {
		return apperrors.Newf(apperrors.CodeProvisionFailed, "vmware: %s failed: %v", what, err)
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
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

// unsupported builds the PROVIDER_UNSUPPORTED error used by every
// unimplemented capability family.
func unsupported(op string) error {
	return apperrors.Newf(apperrors.CodeUnsupported,
		"%s is not supported by the vmware provider", op)
}

// ---- VM lifecycle ----

func (a *Adapter) ProvisionVM(ctx context.Context, spec provider.InstanceSpec) error {
	if strings.TrimSpace(spec.Name) == "" {
		return apperrors.New(apperrors.CodeValidation, "vmware: instance name is required")
	}
	if spec.CPU <= 0 || spec.RAM <= 0 || spec.Disk <= 0 {
		return apperrors.Newf(apperrors.CodeValidation,
			"vmware: cpu/ram/disk must be positive (got %d/%d/%d)", spec.CPU, spec.RAM, spec.Disk)
	}
	var ref types.ManagedObjectReference
	if spec.OSExternalID != nil {
		tmplID := strconv.FormatInt(*spec.OSExternalID, 10)
		tmpl, terr := a.findTemplateByID(ctx, tmplID)
		if terr == nil {
			cloneRef, cerr := a.cloneFromTemplate(ctx, tmpl, spec)
			if cerr != nil {
				return cerr
			}
			ref = cloneRef
		}
		// No resolvable template: fall through to the empty-VM path.
		// InstanceSpec.OSExternalID carries the internal os_templates row
		// number; this provider maps it to a vSphere template MoRef
		// ("vm-<n>") or template name. When business logic has no such
		// mapping yet, a fresh empty VM is provisioned instead.
	}
	if ref == (types.ManagedObjectReference{}) {
		emptyRef, cerr := a.createEmptyVM(ctx, spec)
		if cerr != nil {
			return cerr
		}
		ref = emptyRef
	}
	a.attachManagedTagBestEffort(ctx, ref)
	return nil
}

// findTemplateByID locates a template whose MoRef value or inventory name
// equals id (e.g. "7" -> "vm-7").
func (a *Adapter) findTemplateByID(ctx context.Context, id string) (*object.VirtualMachine, error) {
	wantValue := "vm-" + id
	res, err := vimCall(ctx, a.c, func(v *vim25.Client) (*object.VirtualMachine, error) {
		for _, vm := range listAllVMs(ctx, v) {
			isTmpl, ierr := vm.IsTemplate(ctx)
			if ierr != nil || !isTmpl {
				continue
			}
			if vm.Reference().Value == wantValue || path.Base(vm.InventoryPath) == id {
				return vm, nil
			}
		}
		return nil, apperrors.Newf(apperrors.CodeNotFound, "vmware: template %q not found", wantValue)
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// listAllVMs walks every datacenter's vm folder (finder defaults to a single
// datacenter, so the adapter loops explicitly).
func listAllVMs(ctx context.Context, v *vim25.Client) []*object.VirtualMachine {
	f := finder(ctx, v)
	dcs, err := f.DatacenterList(ctx, "*")
	if err != nil {
		dcs = nil // single-datacenter fallback below still runs
	}
	var out []*object.VirtualMachine
	seen := map[string]bool{}
	collect := func() {
		vms, lerr := f.VirtualMachineList(ctx, "*")
		if lerr != nil {
			return
		}
		for _, vm := range vms {
			key := vm.Reference().String()
			if !seen[key] {
				seen[key] = true
				out = append(out, vm)
			}
		}
	}
	if len(dcs) == 0 {
		collect()
		return out
	}
	for _, dc := range dcs {
		f.SetDatacenter(dc)
		collect()
	}
	return out
}

// cloneFromTemplate clones tmpl into the default vm folder, applies
// cpu/memory through the clone config, grows the primary disk if needed and
// powers the result on.
func (a *Adapter) cloneFromTemplate(ctx context.Context, tmpl *object.VirtualMachine, spec provider.InstanceSpec) (types.ManagedObjectReference, error) {
	type result struct{ ref types.ManagedObjectReference }
	res, err := vimCall(ctx, a.c, func(v *vim25.Client) (result, error) {
		f := finder(ctx, v)
		dc, err := f.DefaultDatacenter(ctx)
		if err != nil {
			return result{}, err
		}
		folders, err := dc.Folders(ctx)
		if err != nil {
			return result{}, err
		}
		pool, err := defaultResourcePool(ctx, f)
		if err != nil {
			return result{}, err
		}
		ds, err := f.DefaultDatastore(ctx)
		if err != nil {
			return result{}, err
		}
		poolRef, dsRef := pool.Reference(), ds.Reference()
		cfg := &types.VirtualMachineConfigSpec{
			NumCPUs:  int32(spec.CPU),
			MemoryMB: spec.RAM, // InstanceSpec.RAM is MB == vSphere memoryMB
		}
		cloneSpec := types.VirtualMachineCloneSpec{
			Location: types.VirtualMachineRelocateSpec{
				Pool:      &poolRef,
				Datastore: &dsRef,
			},
			PowerOn: false,
			Config:  cfg,
		}
		task, err := tmpl.Clone(ctx, folders.VmFolder, spec.Name, cloneSpec)
		if err != nil {
			return result{}, err
		}
		info, err := task.WaitForResult(ctx, nil)
		if err != nil {
			return result{}, err
		}
		ref, ok := info.Result.(types.ManagedObjectReference)
		if !ok {
			return result{}, fmt.Errorf("clone returned unexpected result %T", info.Result)
		}
		return result{ref: ref}, nil
	})
	if err != nil {
		return types.ManagedObjectReference{}, apperrors.Newf(apperrors.CodeProvisionFailed,
			"vmware: clone template to %q failed: %v", spec.Name, err)
	}
	// Disk growth happens post-clone: a clone config cannot enlarge the
	// template's existing virtual disk.
	if gerr := a.growPrimaryDiskToGB(ctx, res.ref, spec.Disk); gerr != nil {
		return types.ManagedObjectReference{}, gerr
	}
	return res.ref, a.powerOn(ctx, res.ref)
}

// createEmptyVM builds a fresh VM from scratch: pvscsi boot disk sized to
// spec.Disk on the default datastore plus one NIC (portgroup resolved from
// spec.VPCIDs[0] when possible), then powers it on.
func (a *Adapter) createEmptyVM(ctx context.Context, spec provider.InstanceSpec) (types.ManagedObjectReference, error) {
	type result struct{ ref types.ManagedObjectReference }
	res, err := vimCall(ctx, a.c, func(v *vim25.Client) (result, error) {
		f := finder(ctx, v)
		host, herr := resolveTargetHost(ctx, f, spec.Location)
		if herr != nil {
			return result{}, herr
		}
		pool, err := host.ResourcePool(ctx)
		if err != nil {
			return result{}, err
		}
		ds, err := f.DefaultDatastore(ctx)
		if err != nil {
			return result{}, err
		}

		devices := object.VirtualDeviceList{}
		scsi, err := devices.CreateSCSIController("pvscsi")
		if err != nil {
			return result{}, err
		}
		disk := devices.CreateDisk(scsi.(types.BaseVirtualController), ds.Reference(),
			fmt.Sprintf("[%s] %s/disk1.vmdk", ds.Name(), spec.Name))
		disk.CapacityInKB = spec.Disk * units.GB / units.KB
		devices = append(devices, scsi, disk)
		if nic, nerr := buildNIC(ctx, f, spec); nerr == nil {
			devices = append(devices, nic)
		} else {
			log.Printf("vmware: provisioning %q without NIC: %v", spec.Name, nerr)
		}
		deviceChange, err := devices.ConfigSpec(types.VirtualDeviceConfigSpecOperationAdd)
		if err != nil {
			return result{}, err
		}

		cfg := types.VirtualMachineConfigSpec{
			Name:         spec.Name,
			GuestId:      string(types.VirtualMachineGuestOsIdentifierOtherGuest64),
			NumCPUs:      int32(spec.CPU),
			MemoryMB:     spec.RAM,
			Files:        &types.VirtualMachineFileInfo{VmPathName: "[" + ds.Name() + "]"},
			DeviceChange: deviceChange,
		}
		dc, err := f.DefaultDatacenter(ctx)
		if err != nil {
			return result{}, err
		}
		folders, err := dc.Folders(ctx)
		if err != nil {
			return result{}, err
		}
		task, err := folders.VmFolder.CreateVM(ctx, cfg, pool, host)
		if err != nil {
			return result{}, err
		}
		info, err := task.WaitForResult(ctx, nil)
		if err != nil {
			return result{}, err
		}
		ref, ok := info.Result.(types.ManagedObjectReference)
		if !ok {
			return result{}, fmt.Errorf("create vm returned unexpected result %T", info.Result)
		}
		return result{ref: ref}, nil
	})
	if err != nil {
		return types.ManagedObjectReference{}, apperrors.Newf(apperrors.CodeProvisionFailed,
			"vmware: create empty VM %q failed: %v", spec.Name, err)
	}
	return res.ref, a.powerOn(ctx, res.ref)
}

// resolveTargetHost picks the destination host for a new VM: explicit host
// name, cluster name (first member host), or the first inventory host of
// the default datacenter.
func resolveTargetHost(ctx context.Context, f *find.Finder, location string) (*object.HostSystem, error) {
	location = strings.TrimSpace(location)
	if location == "" {
		hosts, err := f.HostSystemList(ctx, "*/*") // clustered + standalone
		if err != nil || len(hosts) == 0 {
			return nil, apperrors.Newf(apperrors.CodeRegionUnavailable,
				"vmware: no hosts available in default datacenter")
		}
		return hosts[0], nil
	}
	if h, err := f.HostSystem(ctx, location); err == nil {
		return h, nil
	}
	hosts, err := f.HostSystemList(ctx, location+"/*")
	if err != nil || len(hosts) == 0 {
		return nil, apperrors.Newf(apperrors.CodeRegionUnavailable,
			"vmware: location %q matches no host or cluster", location)
	}
	return hosts[0], nil
}

// defaultResourcePool resolves the pool for clones deterministically:
// the vCenter default when unambiguous, else the first inventory pool
// (standalone hosts and clusters each own one).
func defaultResourcePool(ctx context.Context, f *find.Finder) (*object.ResourcePool, error) {
	if pool, err := f.DefaultResourcePool(ctx); err == nil {
		return pool, nil
	}
	pools, err := f.ResourcePoolList(ctx, "*/*")
	if err != nil || len(pools) == 0 {
		return nil, apperrors.Newf(apperrors.CodeRegionUnavailable,
			"vmware: no resource pool available in default datacenter")
	}
	return pools[0], nil
}

// buildNIC resolves the portgroup backing for a new VM: spec.VPCIDs[0] when
// it names a reachable portgroup/network, else the default VM Network.
func buildNIC(ctx context.Context, f *find.Finder, spec provider.InstanceSpec) (types.BaseVirtualDevice, error) {
	candidates := []string{}
	if len(spec.VPCIDs) > 0 && strings.TrimSpace(spec.VPCIDs[0]) != "" {
		candidates = append(candidates, strings.TrimSpace(spec.VPCIDs[0]))
	}
	candidates = append(candidates, defaultPortGroup)
	for _, name := range candidates {
		net, err := f.Network(ctx, name)
		if err != nil {
			continue
		}
		backing, err := net.EthernetCardBackingInfo(ctx)
		if err != nil {
			continue
		}
		return object.VirtualDeviceList{}.CreateEthernetCard("vmxnet3", backing)
	}
	return nil, apperrors.Newf(apperrors.CodeValidation,
		"vmware: no usable portgroup among %v", candidates)
}

// powerTask runs one of the simple power methods (PowerOn/Suspend/Reset...)
// and waits for its task.
func powerTask(ctx context.Context, c *Client, ref types.ManagedObjectReference, what string, run func(vm *object.VirtualMachine) (*object.Task, error)) error {
	_, err := vimCall(ctx, c, func(v *vim25.Client) (struct{}, error) {
		task, err := run(object.NewVirtualMachine(v, ref))
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState, "vmware: %s vm %s: %v", what, ref.Value, err)
	}
	return nil
}

func (a *Adapter) powerOn(ctx context.Context, ref types.ManagedObjectReference) error {
	return powerTask(ctx, a.c, ref, "power on", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.PowerOn(ctx)
	})
}

func (a *Adapter) powerOff(ctx context.Context, ref types.ManagedObjectReference) error {
	err := powerTask(ctx, a.c, ref, "power off", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.PowerOff(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState, "%v", err)
	}
	return nil
}

// powerState reads the current runtime power state.
func (a *Adapter) powerState(ctx context.Context, ref types.ManagedObjectReference) (types.VirtualMachinePowerState, error) {
	return vimCall(ctx, a.c, func(v *vim25.Client) (types.VirtualMachinePowerState, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return "", err
		}
		return props.runtime.PowerState, nil
	})
}

// toolsRunning reports whether VMware Tools reports running.
func (a *Adapter) toolsRunning(ctx context.Context, ref types.ManagedObjectReference) (bool, error) {
	return vimCall(ctx, a.c, func(v *vim25.Client) (bool, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return false, err
		}
		return props.toolsRunning(), nil
	})
}

func (a *Adapter) GetVM(ctx context.Context, externalID string) (*provider.VMState, error) {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return nil, err
	}
	state, err := vimCall(ctx, a.c, func(v *vim25.Client) (*provider.VMState, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return nil, err
		}
		return props.toVMState(), nil
	})
	if err != nil {
		return nil, err
	}
	return state, nil
}

// ListVMs returns every Kilat-managed VM: guests carrying the "kilat" tag
// or living in a "kilat" vm folder. teamExternalID is accepted for
// interface parity but not filtered on — one vCenter endpoint maps to one
// team scope in this deployment model.
func (a *Adapter) ListVMs(ctx context.Context, teamExternalID string) ([]provider.VMState, error) {
	refs, err := a.managedVMRefs(ctx)
	if err != nil {
		return nil, err
	}
	states, err := vimCall(ctx, a.c, func(v *vim25.Client) ([]provider.VMState, error) {
		out := make([]provider.VMState, 0, len(refs))
		for _, ref := range refs {
			props, ferr := fetchVM(ctx, v, ref)
			if ferr != nil {
				continue // vanished between listing and fetch; skip
			}
			out = append(out, *props.toVMState())
		}
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(states, func(i, j int) bool { return states[i].ExternalID < states[j].ExternalID })
	return states, nil
}

// managedVMRefs unions tag-attached refs with children of any "kilat" vm
// folder across datacenters.
func (a *Adapter) managedVMRefs(ctx context.Context) ([]types.ManagedObjectReference, error) {
	seen := map[string]bool{}
	var refs []types.ManagedObjectReference
	add := func(list []mo.Reference) {
		for _, r := range list {
			ref := r.Reference()
			if ref.Type == "VirtualMachine" && !seen[ref.String()] {
				seen[ref.String()] = true
				refs = append(refs, ref)
			}
		}
	}

	// Ownership-tag members (vAPI REST service).
	tagged, err := restCall(ctx, a.c, func(rc *rest.Client) ([]mo.Reference, error) {
		m := tags.NewManager(rc)
		catID, err := ensureCategory(ctx, m)
		if err != nil {
			return nil, err
		}
		tagID, err := ensureTag(ctx, m, catID, managedTag)
		if err != nil {
			return nil, err
		}
		return m.ListAttachedObjects(ctx, tagID)
	})
	switch {
	case err == nil:
		add(tagged)
	default:
		log.Printf("vmware: tag-based managed list unavailable (continuing with folder scan): %v", err)
	}

	// Folder members (SOAP inventory).
	foldered, ferr := vimCall(ctx, a.c, func(v *vim25.Client) ([]mo.Reference, error) {
		f := finder(ctx, v)
		dcs, err := f.DatacenterList(ctx, "*")
		if err != nil {
			return nil, err
		}
		var out []mo.Reference
		for _, dc := range dcs {
			folders, err := dc.Folders(ctx)
			if err != nil {
				continue
			}
			children, err := folders.VmFolder.Children(ctx)
			if err != nil {
				continue
			}
			for _, ch := range children {
				kfolder, ok := ch.(*object.Folder)
				if !ok {
					continue
				}
				name, err := kfolder.ObjectName(ctx)
				if err != nil || name != kilatFolder {
					continue
				}
				kids, err := kfolder.Children(ctx)
				if err != nil {
					continue
				}
				for _, kid := range kids {
					out = append(out, kid.Reference())
				}
			}
		}
		return out, nil
	})
	switch {
	case ferr == nil:
		add(foldered)
	case len(refs) > 0:
		log.Printf("vmware: folder scan unavailable (using tag members only): %v", ferr)
	default:
		return nil, ferr
	}
	return refs, nil
}

// attachManagedTagBestEffort tags freshly provisioned VMs; tagging failures
// are logged, never fatal.
func (a *Adapter) attachManagedTagBestEffort(ctx context.Context, ref types.ManagedObjectReference) {
	_, err := restCall(ctx, a.c, func(rc *rest.Client) (struct{}, error) {
		m := tags.NewManager(rc)
		catID, err := ensureCategory(ctx, m)
		if err != nil {
			return struct{}{}, err
		}
		tagID, err := ensureTag(ctx, m, catID, managedTag)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, m.AttachTag(ctx, tagID, ref)
	})
	if err != nil {
		log.Printf("vmware: could not attach %q ownership tag to %s (continuing): %v",
			managedTag, ref.Value, err)
	}
}

// PatchVM applies cpu/ram/disk changes. CPU/RAM move in either direction
// (see ResizePolicy); disk may only grow — vSphere cannot shrink virtual
// disks, so shrink attempts fail validation instead of silently clamping.
func (a *Adapter) PatchVM(ctx context.Context, externalID string, fields map[string]any) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	current, err := a.GetVM(ctx, ref.String())
	if err != nil {
		return err
	}

	var (
		spec       types.VirtualMachineConfigSpec
		targetDisk int64
	)
	for _, key := range []string{"cpu", "ram", "disk"} { // fixed order: deterministic
		raw, ok := fields[key]
		if !ok {
			continue
		}
		n, numeric := coerceInt(raw)
		if !numeric {
			return apperrors.Newf(apperrors.CodeValidation,
				"vmware: patch field %q is not numeric (%#v)", key, raw)
		}
		if n <= 0 {
			return apperrors.Newf(apperrors.CodeValidation,
				"vmware: %s must be positive, got %d", key, n)
		}
		switch key {
		case "cpu":
			spec.NumCPUs = int32(n)
		case "ram":
			spec.MemoryMB = n
		case "disk":
			targetDisk = n
		}
	}

	if spec.NumCPUs != 0 || spec.MemoryMB != 0 {
		if err := powerTasklessReconfigure(ctx, a.c, ref, spec); err != nil {
			return err
		}
	}
	if targetDisk > 0 && targetDisk != current.Disk {
		return a.resizePrimaryDisk(ctx, ref, targetDisk)
	}
	return nil
}

// powerTasklessReconfigure issues Reconfigure + waits for its task.
func powerTasklessReconfigure(ctx context.Context, c *Client, ref types.ManagedObjectReference, spec types.VirtualMachineConfigSpec) error {
	_, err := vimCall(ctx, c, func(v *vim25.Client) (struct{}, error) {
		task, err := object.NewVirtualMachine(v, ref).Reconfigure(ctx, spec)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: reconfigure vm %s: %v", ref.Value, err)
	}
	return nil
}

// resizePrimaryDisk grows (never shrinks) the primary virtual disk to GB.
func (a *Adapter) resizePrimaryDisk(ctx context.Context, ref types.ManagedObjectReference, gb int64) error {
	currentKB, err := a.primaryDiskKBOf(ctx, ref)
	if err != nil {
		return err
	}
	targetKB := gb * units.GB / units.KB
	if targetKB <= currentKB {
		if targetKB == currentKB {
			return nil
		}
		return apperrors.Newf(apperrors.CodeValidation,
			"vmware: disk shrink %dG -> %dG is not supported by vSphere",
			currentKB*units.KB/units.GB, gb)
	}
	return a.growPrimaryDiskToKB(ctx, ref, targetKB)
}

func (a *Adapter) primaryDiskKBOf(ctx context.Context, ref types.ManagedObjectReference) (int64, error) {
	return vimCall(ctx, a.c, func(v *vim25.Client) (int64, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return 0, err
		}
		return props.primaryDiskKB(), nil
	})
}

// growPrimaryDiskToGB grows the largest virtual disk to at least gb.
func (a *Adapter) growPrimaryDiskToGB(ctx context.Context, ref types.ManagedObjectReference, gb int64) error {
	return a.growPrimaryDiskToKB(ctx, ref, gb*units.GB/units.KB)
}

func (a *Adapter) growPrimaryDiskToKB(ctx context.Context, ref types.ManagedObjectReference, targetKB int64) error {
	err := powerTaskEdit(ctx, a.c, ref, targetKB)
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: resize disk of vm %s: %v", ref.Value, err)
	}
	return nil
}

// powerTaskEdit edits the biggest disk device to targetKB via EditDevice.
func powerTaskEdit(ctx context.Context, c *Client, ref types.ManagedObjectReference, targetKB int64) error {
	_, err := vimCall(ctx, c, func(v *vim25.Client) (struct{}, error) {
		obj := object.NewVirtualMachine(v, ref)
		list, err := obj.Device(ctx)
		if err != nil {
			return struct{}{}, err
		}
		var biggest *types.VirtualDisk
		for _, d := range list.SelectByType((*types.VirtualDisk)(nil)) {
			disk, ok := d.(*types.VirtualDisk)
			if !ok {
				continue
			}
			if biggest == nil || disk.CapacityInKB > biggest.CapacityInKB {
				biggest = disk
			}
		}
		if biggest == nil {
			return struct{}{}, apperrors.New(apperrors.CodeNotFound, "vmware: vm has no virtual disk")
		}
		if biggest.CapacityInKB >= targetKB {
			return struct{}{}, nil // already big enough
		}
		grown := *biggest
		grown.CapacityInKB = targetKB
		return struct{}{}, obj.EditDevice(ctx, &grown)
	})
	return err
}

func (a *Adapter) DestroyVM(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	// The VM is being deleted anyway: power it off first when running so
	// Destroy succeeds (vSphere's Unregister path requires a stopped guest).
	if state, serr := a.powerState(ctx, ref); serr == nil && state != types.VirtualMachinePowerStatePoweredOff {
		_ = a.powerOff(ctx, ref)
	}
	if err := powerTask(ctx, a.c, ref, "destroy", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.Destroy(ctx)
	}); err != nil {
		return apperrors.Newf(apperrors.CodeProvisionFailed, "vmware: destroy vm %s failed: %v", ref.Value, err)
	}
	return nil
}

// StopVM powers off. force=true (or absent/blocked VMware Tools) issues a
// hard PowerOff; force=false first asks the guest OS to shut down via
// ShutdownGuest and falls back to PowerOff once the grace period lapses.
func (a *Adapter) StopVM(ctx context.Context, externalID string, force bool) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	if force {
		return a.powerOff(ctx, ref)
	}
	toolsUp, err := a.toolsRunning(ctx, ref)
	if err != nil {
		return err
	}
	if !toolsUp {
		return a.powerOff(ctx, ref) // no tools: graceful shutdown impossible
	}
	_, serr := vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		return struct{}{}, object.NewVirtualMachine(v, ref).ShutdownGuest(ctx)
	})
	if serr != nil {
		return a.powerOff(ctx, ref) // guest refused the request; hard stop
	}
	deadline := time.Now().Add(shutdownGrace)
	for time.Now().Before(deadline) {
		state, gerr := a.powerState(ctx, ref)
		if gerr == nil && state == types.VirtualMachinePowerStatePoweredOff {
			return nil
		}
		time.Sleep(shutdownPoll)
	}
	return a.powerOff(ctx, ref)
}

// RebootVM resets. force=false prefers a guest-tools coordinated reboot and
// silently falls back to Reset when tools are absent or refuse.
func (a *Adapter) RebootVM(ctx context.Context, externalID string, force bool) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	if !force {
		if up, terr := a.toolsRunning(ctx, ref); terr == nil && up {
			_, rerr := vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
				return struct{}{}, object.NewVirtualMachine(v, ref).RebootGuest(ctx)
			})
			if rerr == nil {
				return nil
			}
		}
	}
	return powerTask(ctx, a.c, ref, "reset", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.Reset(ctx)
	})
}

func (a *Adapter) StartVM(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	return a.powerOn(ctx, ref)
}

// MigrateVM vMotions the VM to the target host within the same vCenter.
// MigratePreconditions-style dry-runs do not exist in the generic interface;
// vSphere revalidates everything server-side when Relocate executes.
func (a *Adapter) MigrateVM(ctx context.Context, externalID, targetNode string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	targetNode = strings.TrimSpace(targetNode)
	if targetNode == "" {
		return apperrors.New(apperrors.CodeValidation, "vmware: target host is required for migration")
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		f := finder(ctx, v)
		host, herr := f.HostSystem(ctx, targetNode)
		if herr != nil {
			return struct{}{}, apperrors.Newf(apperrors.CodeRegionUnavailable,
				"vmware: target host %q not found", targetNode)
		}
		hostRef := host.Reference()
		spec := types.VirtualMachineRelocateSpec{Host: &hostRef}
		task, terr := object.NewVirtualMachine(v, ref).Relocate(ctx, spec, types.VirtualMachineMovePriorityDefaultPriority)
		if terr != nil {
			return struct{}{}, terr
		}
		return struct{}{}, task.Wait(ctx)
	})
	return err
}

func (a *Adapter) ResetVM(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	return powerTask(ctx, a.c, ref, "reset", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.Reset(ctx)
	})
}

// PauseVM suspends the VM to memory (vSphere's Suspend).
func (a *Adapter) PauseVM(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	return powerTask(ctx, a.c, ref, "suspend", func(vm *object.VirtualMachine) (*object.Task, error) {
		return vm.Suspend(ctx)
	})
}

// ResumeVM powers the VM back on; vSphere resumes suspended VMs on PowerOn.
func (a *Adapter) ResumeVM(ctx context.Context, externalID string) error {
	return a.StartVM(ctx, externalID)
}

// HibernateVM stays unsupported: vSphere offers suspend-to-memory only
// (PauseVM); real hibernation needs guest cooperation this API lacks.
func (a *Adapter) HibernateVM(ctx context.Context, externalID string) error {
	return unsupported("hibernate")
}

// SerialConsole and VNCSession stay unsupported ON PURPOSE: vSphere exposes
// consoles through WebMKS (websocket tickets issued by vCenter) or the VMRC
// client protocol — neither is a raw VNC/serial URL this backend could hand
// to a browser without building its own proxy layer first.
func (a *Adapter) SerialConsole(ctx context.Context, vmExternalID string) (string, int64, error) {
	return "", 0, unsupported("console (WebMKS/VMRC protocol, not raw serial URLs)")
}

func (a *Adapter) VNCSession(ctx context.Context, vmExternalID string) (string, int64, error) {
	return "", 0, unsupported("console (WebMKS/VMRC protocol, not raw VNC URLs)")
}

// CloneVM makes a full copy of the VM under newName, left powered off.
func (a *Adapter) CloneVM(ctx context.Context, externalID, newName string) error {
	src, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		f := finder(ctx, v)
		dc, err := f.DefaultDatacenter(ctx)
		if err != nil {
			return struct{}{}, err
		}
		folders, err := dc.Folders(ctx)
		if err != nil {
			return struct{}{}, err
		}
		pool, err := defaultResourcePool(ctx, f)
		if err != nil {
			return struct{}{}, err
		}
		ds, err := f.DefaultDatastore(ctx)
		if err != nil {
			return struct{}{}, err
		}
		poolRef, dsRef := pool.Reference(), ds.Reference()
		cloneSpec := types.VirtualMachineCloneSpec{
			Location: types.VirtualMachineRelocateSpec{
				Pool:      &poolRef,
				Datastore: &dsRef,
			},
			PowerOn: false,
		}
		task, err := object.NewVirtualMachine(v, src).Clone(ctx, folders.VmFolder, newName, cloneSpec)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeProvisionFailed,
			"vmware: clone vm %s to %q failed: %v", src.Value, newName, err)
	}
	return nil
}

// ConvertToTemplate marks a powered-off VM as a vCenter template. vCenter
// refuses the conversion while the VM runs; mirrored here as InvalidState
// instead of surprising the customer with a silent power-off.
func (a *Adapter) ConvertToTemplate(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	state, err := a.powerState(ctx, ref)
	if err != nil {
		return err
	}
	if state == types.VirtualMachinePowerStatePoweredOn {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: vm %s must be powered off before converting to a template", ref.Value)
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		return struct{}{}, object.NewVirtualMachine(v, ref).MarkAsTemplate(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: convert vm %s to template: %v", ref.Value, err)
	}
	return nil
}

// MoveVolume performs a storage vMotion of the whole VM to targetStorage
// (datastore name). volume is accepted for interface parity; vSphere moves
// all disks of a VM together, matching the single-disk product shape.
func (a *Adapter) MoveVolume(ctx context.Context, externalID, volume, targetStorage string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	targetStorage = strings.TrimSpace(targetStorage)
	if targetStorage == "" {
		return apperrors.New(apperrors.CodeValidation, "vmware: target datastore is required")
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		f := finder(ctx, v)
		ds, err := f.Datastore(ctx, targetStorage)
		if err != nil {
			return struct{}{}, apperrors.Newf(apperrors.CodeNotFound,
				"vmware: datastore %q not found", targetStorage)
		}
		dsRef := ds.Reference()
		spec := types.VirtualMachineRelocateSpec{
			Datastore:    &dsRef,
			DiskMoveType: string(types.VirtualMachineRelocateDiskMoveOptionsMoveAllDiskBackingsAndDisallowSharing),
		}
		task, err := object.NewVirtualMachine(v, ref).Relocate(ctx, spec, types.VirtualMachineMovePriorityDefaultPriority)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	return err
}

// ---- Snapshots / backups ----

func (a *Adapter) CreateSnapshot(ctx context.Context, vmExternalID, name, desc string) (string, error) {
	ref, err := parseVMRef(vmExternalID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(name) == "" {
		return "", apperrors.New(apperrors.CodeValidation, "vmware: snapshot name is required")
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		// memory=false keeps deltas small (crash-consistent); quiesce=false
		// avoids requiring VMware Tools inside the guest.
		task, err := object.NewVirtualMachine(v, ref).CreateSnapshot(ctx, name, desc, false /* memory */, false /* quiesce */)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return "", apperrors.Newf(apperrors.CodeProvisionFailed,
			"vmware: create snapshot %q of vm %s failed: %v", name, ref.Value, err)
	}
	return snapshotExtID(ref.String(), name), nil
}

// ListSnapshots walks every Kilat-managed guest (Onidel parity: global list).
func (a *Adapter) ListSnapshots(ctx context.Context) ([]provider.ProviderSnapshot, error) {
	refs, err := a.managedVMRefs(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderSnapshot, 0)
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		for _, ref := range refs {
			props, ferr := fetchVM(ctx, v, ref)
			if ferr != nil || props.snapshot == nil {
				continue
			}
			walkSnapshotTree(props.snapshot.RootSnapshotList, ref.String(), &out)
		}
		return struct{}{}, nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ExternalID < out[j].ExternalID })
	return out, nil
}

func walkSnapshotTree(nodes []types.VirtualMachineSnapshotTree, vmExt string, out *[]provider.ProviderSnapshot) {
	for _, n := range nodes {
		*out = append(*out, provider.ProviderSnapshot{
			ExternalID: snapshotExtID(vmExt, n.Name),
			Name:       n.Name,
			Desc:       n.Description,
			CreatedAt:  n.CreateTime.UTC().Format(time.RFC3339),
			Status:     "available",
		})
		walkSnapshotTree(n.ChildSnapshotList, vmExt, out)
	}
}

func (a *Adapter) DeleteSnapshot(ctx context.Context, extID string) error {
	vmExt, snapName, err := splitSnapshotExtID(extID)
	if err != nil {
		return err
	}
	ref, err := parseVMRef(vmExt)
	if err != nil {
		return err
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		task, err := object.NewVirtualMachine(v, ref).RemoveSnapshot(ctx, snapName, false /* removeChildren */, nil /* consolidate */)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeNotFound,
			"vmware: delete snapshot %q: %v", snapName, err)
	}
	return nil
}

// RestoreFromSnapshot reverts the VM to the snapshot. suppressPowerOn=false
// lets vSphere bring the VM back to the power state captured at snapshot
// time, mirroring Onidel semantics where restores end with a running VM.
func (a *Adapter) RestoreFromSnapshot(ctx context.Context, vmExternalID, extID string) error {
	vmExt, snapName, err := splitSnapshotExtID(extID)
	if err != nil {
		return err
	}
	if vmExt != strings.TrimSpace(vmExternalID) {
		return apperrors.Newf(apperrors.CodeValidation,
			"vmware: snapshot %q does not belong to vm %q", extID, vmExternalID)
	}
	ref, err := parseVMRef(vmExt)
	if err != nil {
		return err
	}
	_, err = vimCall(ctx, a.c, func(v *vim25.Client) (struct{}, error) {
		task, err := object.NewVirtualMachine(v, ref).RevertToSnapshot(ctx, snapName, false /* suppressPowerOn */)
		if err != nil {
			return struct{}{}, err
		}
		return struct{}{}, task.Wait(ctx)
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: revert to snapshot %q: %v", snapName, err)
	}
	return nil
}

// RestoreFromBackup stays unsupported: vSphere backups are VADP/proxy-based
// jobs (Veeam et al.), not self-contained archives this backend can replay.
func (a *Adapter) RestoreFromBackup(ctx context.Context, vmExternalID, backupExtID string) error {
	return unsupported("backup restore (VADP integration required)")
}

// VMBackups returns an empty list: absent a VADP backup appliance there is
// no platform-managed backup inventory to report.
func (a *Adapter) VMBackups(ctx context.Context, vmExternalID string) ([]provider.ProviderBackup, error) {
	return []provider.ProviderBackup{}, nil
}

// SnapshotDownloadURL and BackupDownloadURL stay unsupported: vSphere does
// not expose presigned download URLs for snapshots/backups (that is VADP +
// backup-appliance territory), so nothing safe to hand to a browser exists.
func (a *Adapter) SnapshotDownloadURL(_ context.Context, _ string) (string, error) {
	return "", unsupported("snapshot downloads (no presigned URLs in vSphere)")
}

func (a *Adapter) BackupDownloadURL(_ context.Context, _ string) (string, error) {
	return "", unsupported("backup downloads (VADP/API-based, no direct URLs)")
}

// ---- notes & tags ----

func (a *Adapter) VMNotes(ctx context.Context, externalID string) (string, error) {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return "", err
	}
	return vimCall(ctx, a.c, func(v *vim25.Client) (string, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return "", err
		}
		if props.config == nil {
			return "", nil
		}
		return props.config.Annotation, nil
	})
}

func (a *Adapter) SetVMNotes(ctx context.Context, externalID, notes string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	return powerTasklessReconfigure(ctx, a.c, ref, types.VirtualMachineConfigSpec{Annotation: notes})
}

// VMTags returns the names of all vAPI tags attached to the VM.
func (a *Adapter) VMTags(ctx context.Context, externalID string) ([]string, error) {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return nil, err
	}
	names, err := restCall(ctx, a.c, func(rc *rest.Client) ([]string, error) {
		m := tags.NewManager(rc)
		attached, err := m.GetAttachedTags(ctx, ref)
		if err != nil {
			return nil, err
		}
		out := make([]string, 0, len(attached))
		for _, t := range attached {
			out = append(out, t.Name)
		}
		return out, nil
	})
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: list tags on vm %s: %v", ref.Value, err)
	}
	return names, nil
}

// SetVMTags replaces the VM's tags inside the Kilat category. The ownership
// tag ("kilat") is always kept/added so ListVMs filtering cannot be broken
// accidentally; tags in foreign categories are left untouched.
func (a *Adapter) SetVMTags(ctx context.Context, externalID string, newTags []string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	want := make([]string, 0, len(newTags)+1)
	sawManaged := false
	for _, t := range newTags {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if t == managedTag {
			sawManaged = true
		}
		want = append(want, t)
	}
	if !sawManaged {
		want = append(want, managedTag)
	}

	_, err = restCall(ctx, a.c, func(rc *rest.Client) (struct{}, error) {
		m := tags.NewManager(rc)
		catID, err := ensureCategory(ctx, m)
		if err != nil {
			return struct{}{}, err
		}
		attached, err := m.GetAttachedTags(ctx, ref)
		if err != nil {
			return struct{}{}, err
		}
		for _, t := range attached {
			if t.CategoryID != catID {
				continue // foreign categories are not ours to manage
			}
			if !contains(want, t.Name) {
				if derr := m.DetachTag(ctx, t.ID, ref); derr != nil {
					return struct{}{}, derr
				}
			}
		}
		for _, name := range want {
			tagID, terr := ensureTag(ctx, m, catID, name)
			if terr != nil {
				return struct{}{}, terr
			}
			if aerr := m.AttachTag(ctx, tagID, ref); aerr != nil {
				return struct{}{}, aerr
			}
		}
		return struct{}{}, nil
	})
	if err != nil {
		return apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: set tags on vm %s: %v", ref.Value, err)
	}
	return nil
}

// ensureCategory finds-or-creates the Kilat tag category.
func ensureCategory(ctx context.Context, m *tags.Manager) (string, error) {
	cat, err := m.GetCategory(ctx, tagCategory)
	if err == nil {
		return cat.ID, nil
	}
	return m.CreateCategory(ctx, &tags.Category{
		Name:            tagCategory,
		Description:     "Kilat Cloud managed objects",
		Cardinality:     "MULTIPLE",
		AssociableTypes: []string{"VirtualMachine"},
	})
}

// ensureTag finds-or-creates one tag by name inside the Kilat category.
func ensureTag(ctx context.Context, m *tags.Manager, catID, name string) (string, error) {
	existing, err := m.GetTagsForCategory(ctx, catID)
	if err == nil {
		for _, t := range existing {
			if t.Name == name {
				return t.ID, nil
			}
		}
	}
	return m.CreateTag(ctx, &tags.Tag{Name: name, CategoryID: catID, Description: "Kilat Cloud"})
}

// CloudInitRegenerate stays unsupported: vSphere has no cloud-init state to
// regenerate — guest customization is a different mechanism (customization
// specs applied at clone time).
func (a *Adapter) CloudInitRegenerate(ctx context.Context, externalID string) error {
	return unsupported("cloud-init regeneration (use customization specs at clone)")
}

// ---- guest observability ----

// GuestAgentPing reports liveness of VMware Tools. Unlike PVE's QEMU agent
// this needs no guest credentials — the hypervisor observes the tools state.
func (a *Adapter) GuestAgentPing(ctx context.Context, externalID string) error {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return err
	}
	up, err := a.toolsRunning(ctx, ref)
	if err != nil {
		return err
	}
	if !up {
		return apperrors.Newf(apperrors.CodeInvalidState,
			"vmware: guest tools not running on %s", ref.Value)
	}
	return nil
}

// GuestAgentOSInfo/GuestAgentFSInfo need authenticated guest operations
// (per-VM guest credentials the platform does not store) — reject rather
// than pretend.
func (a *Adapter) GuestAgentOSInfo(ctx context.Context, externalID string) (any, error) {
	return nil, unsupported("guest OS info (requires per-VM guest credentials)")
}

func (a *Adapter) GuestAgentFSInfo(ctx context.Context, externalID string) (any, error) {
	return nil, unsupported("guest filesystem info (requires per-VM guest credentials)")
}

// GuestAgentInfo returns lightweight guest facts read straight from vm.Guest
// properties — no credentials involved.
func (a *Adapter) GuestAgentInfo(ctx context.Context, externalID string) (any, error) {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return nil, err
	}
	info, err := vimCall(ctx, a.c, func(v *vim25.Client) (map[string]any, error) {
		props, err := fetchVM(ctx, v, ref)
		if err != nil {
			return nil, err
		}
		out := map[string]any{}
		if g := props.guest; g != nil {
			out["toolsRunningStatus"] = g.ToolsRunningStatus
			out["guestFullName"] = g.GuestFullName
			out["guestId"] = g.GuestId
			out["ipAddress"] = g.IpAddress
		}
		if props.config != nil {
			out["template"] = props.config.Template
		}
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return info, nil
}

// GuestMetrics samples realtime/historical counters via the vSphere
// PerformanceManager. timeframe "hour" maps to the 20s realtime interval,
// everything else ("day") to the 300s historical interval.
func (a *Adapter) GuestMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	ref, err := parseVMRef(externalID)
	if err != nil {
		return nil, err
	}
	interval := int32(300) // "day" and anything else historical
	if strings.EqualFold(strings.TrimSpace(timeframe), "hour") {
		interval = 20 // realtime sampling period in vcsim and most vCenters
	}
	series, err := vimCall(ctx, a.c, func(v *vim25.Client) ([]performance.EntityMetric, error) {
		pm := performance.NewManager(v)
		spec := types.PerfQuerySpec{
			IntervalId: interval,
			MaxSample:  60,
		}
		raw, err := pm.SampleByName(ctx, spec,
			[]string{"cpu.usage.average", "mem.active.average"}, []types.ManagedObjectReference{ref})
		if err != nil {
			return nil, err
		}
		return pm.ToMetricSeries(ctx, raw)
	})
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: metrics for %s: %v", ref.Value, err)
	}
	return series, nil
}

// ---- per-VM firewall ----
// The vSphere firewall is the distributed firewall (NSX/DFW) operating at
// datacenter/distributed-portgroup level; there is no per-VM rule API to
// normalize against, so the whole family rejects with PROVIDER_UNSUPPORTED.

func (a *Adapter) FirewallRulesList(ctx context.Context, externalID string) ([]provider.ProviderFirewallRule, error) {
	return nil, unsupported("firewall rules (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) CreateFirewallRule(ctx context.Context, externalID string, rule provider.ProviderFirewallRule) error {
	return unsupported("firewall rules (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) DeleteFirewallRule(ctx context.Context, externalID string, pos int) error {
	return unsupported("firewall rules (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) FirewallOptionsMap(ctx context.Context, externalID string) (map[string]any, error) {
	return nil, unsupported("firewall options (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) SetFirewallOptionsMap(ctx context.Context, externalID string, opts map[string]any) error {
	return unsupported("firewall options (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) FirewallIPSetsList(ctx context.Context, externalID string) ([]provider.ProviderIPSet, error) {
	return nil, unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) CreateFirewallIPSet(ctx context.Context, externalID, name, comment string) error {
	return unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) DeleteFirewallIPSet(ctx context.Context, externalID, name string, force bool) error {
	return unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) FirewallIPSetEntriesList(ctx context.Context, externalID, name string) ([]provider.ProviderIPSetEntry, error) {
	return nil, unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) AddFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, comment string) error {
	return unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) UpdateFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, newCIDR, comment string) error {
	return unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

func (a *Adapter) RemoveFirewallIPSetEntry(ctx context.Context, externalID, name, cidr string) error {
	return unsupported("firewall ipsets (vSphere firewall is DFW-level, not per-VM)")
}

// ---- containers ----
// vSphere sells no LXC-equivalent; the whole container family rejects.

func (a *Adapter) ProvisionContainer(ctx context.Context, spec provider.InstanceSpec) error {
	return unsupported("container")
}

func (a *Adapter) StartContainer(ctx context.Context, externalID string) error {
	return unsupported("container")
}

func (a *Adapter) StopContainer(ctx context.Context, externalID string, force bool) error {
	return unsupported("container")
}

func (a *Adapter) RebootContainer(ctx context.Context, externalID string) error {
	return unsupported("container")
}

func (a *Adapter) DestroyContainer(ctx context.Context, externalID string) error {
	return unsupported("container")
}

func (a *Adapter) MigrateContainer(ctx context.Context, externalID, targetNode string) error {
	return unsupported("container")
}

func (a *Adapter) ContainerSerialConsole(ctx context.Context, externalID string) (string, int64, error) {
	return "", 0, unsupported("container")
}

func (a *Adapter) ContainerSnapshotCreate(ctx context.Context, externalID, name, desc string) (string, error) {
	return "", unsupported("container")
}

func (a *Adapter) ContainerSnapshotsList(ctx context.Context, externalID string) ([]provider.ProviderSnapshot, error) {
	return nil, unsupported("container")
}

func (a *Adapter) ContainerSnapshotDelete(ctx context.Context, snapshotExtID string) error {
	return unsupported("container")
}

func (a *Adapter) ContainerSnapshotRollback(ctx context.Context, externalID, snapshotExtID string) error {
	return unsupported("container")
}

func (a *Adapter) ContainerMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	return nil, unsupported("container")
}

// ---- SSH keys / startup scripts / measured boot ----
// These ride guest customization (clone-time specs) in vSphere, not
// platform-registered resources.

func (a *Adapter) EnsureSSHKey(ctx context.Context, teamID, name, publicKey string) (provider.ProviderSSHKey, error) {
	return provider.ProviderSSHKey{}, unsupported("ssh keys (apply via customization specs at clone)")
}

func (a *Adapter) UpdateSSHKey(ctx context.Context, keyExtID, teamID, name, publicKey string) error {
	return unsupported("ssh keys (apply via customization specs at clone)")
}

func (a *Adapter) DeleteSSHKey(ctx context.Context, keyExtID, teamID string) error {
	return unsupported("ssh keys (apply via customization specs at clone)")
}

func (a *Adapter) EnsureStartupScript(ctx context.Context, teamID, name, content string) (provider.ProviderScript, error) {
	return provider.ProviderScript{}, unsupported("startup scripts (apply via customization specs at clone)")
}

func (a *Adapter) UpdateStartupScript(ctx context.Context, scriptExtID, teamID, name, content string) error {
	return unsupported("startup scripts (apply via customization specs at clone)")
}

func (a *Adapter) DeleteStartupScript(ctx context.Context, scriptExtID, teamID string) error {
	return unsupported("startup scripts (apply via customization specs at clone)")
}

func (a *Adapter) UploadMeasuredBootImage(ctx context.Context, teamID, filename, description string, data io.Reader, size int64) (provider.MeasuredBootImage, error) {
	return provider.MeasuredBootImage{}, unsupported("measured boot images")
}

func (a *Adapter) ListMeasuredBootImages(ctx context.Context, teamID string) ([]provider.MeasuredBootImage, error) {
	return nil, unsupported("measured boot images")
}

func (a *Adapter) DeleteMeasuredBootImage(ctx context.Context, imageExtID string) error {
	return unsupported("measured boot images")
}

func (a *Adapter) AttachMeasuredBoot(ctx context.Context, vmExternalID, imageExtID string) error {
	return unsupported("measured boot")
}

func (a *Adapter) DetachMeasuredBoot(ctx context.Context, vmExternalID string) error {
	return unsupported("measured boot")
}

// ---- custom ISOs ----
// Uploading an ISO means streaming bytes into a datastore through the file
// manager lease flow; deferred until the product needs it.

func (a *Adapter) ListISOs(ctx context.Context, teamID string) ([]provider.ISOImage, error) {
	return nil, unsupported("custom iso uploads")
}

func (a *Adapter) CreateISOByURL(ctx context.Context, teamID, isoURL string) error {
	return unsupported("custom iso uploads")
}

func (a *Adapter) DeleteISO(ctx context.Context, isoExtID string) error {
	return unsupported("custom iso uploads")
}

// ---- reserved IPs / object storage / rDNS / BGP ----
// Platform-side network products (Onidel parity): not vSphere concepts.

func (a *Adapter) ListReservedIPs(ctx context.Context, teamID string) ([]provider.ProviderReservedIP, error) {
	return nil, unsupported("reserved ips")
}

func (a *Adapter) CreateReservedIP(ctx context.Context, teamID, location, name, ipType string) (string, string, error) {
	return "", "", unsupported("reserved ips")
}

func (a *Adapter) ConvertPrimaryIP(ctx context.Context, teamID, ipAddress, name string) (map[string]any, error) {
	return nil, unsupported("reserved ips")
}

func (a *Adapter) DeleteReservedIP(ctx context.Context, ripExtID, teamID string) error {
	return unsupported("reserved ips")
}

func (a *Adapter) PatchReservedIP(ctx context.Context, ripExtID, teamID, name, anchorIP string) error {
	return unsupported("reserved ips")
}

func (a *Adapter) ListStorageServices(ctx context.Context, teamID string) ([]provider.StorageServiceInfo, error) {
	return nil, unsupported("object storage services")
}

func (a *Adapter) CreateBucket(ctx context.Context, serviceExtID, teamID, bucketName string, versioning, objectLock bool) ([]provider.BucketKey, error) {
	return nil, unsupported("object storage buckets")
}

func (a *Adapter) BucketAccessKeys(ctx context.Context, serviceExtID, bucketName, teamID string) ([]provider.BucketKey, error) {
	return nil, unsupported("object storage buckets")
}

func (a *Adapter) SetReverseDNS(ctx context.Context, vmExternalID, ipAddr, domain string) error {
	return unsupported("reverse dns")
}

func (a *Adapter) DeleteReverseDNS(ctx context.Context, vmExternalID, ipAddr string) error {
	return unsupported("reverse dns")
}

func (a *Adapter) ListReverseDNS(ctx context.Context, vmExternalID string) ([]provider.RDNSRecord, error) {
	return nil, unsupported("reverse dns")
}

func (a *Adapter) EnableBGP(ctx context.Context, vmExternalID string) error {
	return unsupported("bgp sessions")
}

func (a *Adapter) DisableBGP(ctx context.Context, vmExternalID string) error {
	return unsupported("bgp sessions")
}

// ---- infrastructure inventory ----

// HostInventory is one ESXi host as seen by vCenter: thread count, physical
// memory and current power/connection state from the host summary.
type HostInventory struct {
	Name        string `json:"name"`
	CPUThreads  int16  `json:"cpu_threads"`
	MemoryBytes int64  `json:"memory_bytes"`
	PowerState  string `json:"power_state"`
}

// DatastoreInventory is one VMFS/vSAN/local datastore with its capacity and
// free space in bytes.
type DatastoreInventory struct {
	Name      string `json:"name"`
	Type      string `json:"type,omitempty"`
	Capacity  int64  `json:"capacity_bytes"`
	FreeBytes int64  `json:"free_bytes"`
}

// InventoryReport is the raw vSphere infrastructure view served by the NOC
// inventory endpoint.
type InventoryReport struct {
	Hosts         []HostInventory      `json:"hosts"`
	Datastores    []DatastoreInventory `json:"datastores"`
	Clusters      []string             `json:"clusters"`
	ResourcePools []string             `json:"resource_pools"`
}

// Inventory walks the whole inventory of the configured datacenter(s): every
// host (clustered + standalone), datastore, cluster compute resource and
// resource pool. Adapter-only helper outside ComputeProvider, mirroring
// proxmox.Adapter's Nodes/ClusterResources observability surface.
func (a *Adapter) Inventory(ctx context.Context) (*InventoryReport, error) {
	rep, err := vimCall(ctx, a.c, func(v *vim25.Client) (*InventoryReport, error) {
		f := finder(ctx, v)
		rep := &InventoryReport{
			Hosts:         []HostInventory{},
			Datastores:    []DatastoreInventory{},
			Clusters:      []string{},
			ResourcePools: []string{},
		}

		if clusters, cerr := f.ClusterComputeResourceList(ctx, "*"); cerr == nil {
			for _, cl := range clusters {
				rep.Clusters = append(rep.Clusters, cl.Name())
			}
			sort.Strings(rep.Clusters)
		}
		if pools, perr := f.ResourcePoolList(ctx, "*/*"); perr == nil {
			for _, p := range pools {
				rep.ResourcePools = append(rep.ResourcePools, p.Name())
			}
			sort.Strings(rep.ResourcePools)
		}

		hosts, herr := f.HostSystemList(ctx, "*/*")
		if herr != nil {
			return nil, herr
		}
		for _, h := range hosts {
			var m mo.HostSystem
			if perr := h.Properties(ctx, h.Reference(), []string{"name", "summary"}, &m); perr != nil {
				continue // vanished mid-walk; skip like ListVMs does
			}
			hh := HostInventory{
				Name:       m.Name,
				PowerState: string(m.Summary.Runtime.PowerState),
			}
			if m.Summary.Hardware != nil {
				hh.CPUThreads = m.Summary.Hardware.NumCpuThreads
				hh.MemoryBytes = m.Summary.Hardware.MemorySize
			}
			rep.Hosts = append(rep.Hosts, hh)
		}

		dss, derr := f.DatastoreList(ctx, "*")
		if derr != nil {
			return nil, derr
		}
		for _, ds := range dss {
			var m mo.Datastore
			if perr := ds.Properties(ctx, ds.Reference(), []string{"name", "summary"}, &m); perr != nil {
				continue
			}
			rep.Datastores = append(rep.Datastores, DatastoreInventory{
				Name:      m.Name,
				Type:      m.Summary.Type,
				Capacity:  m.Summary.Capacity,
				FreeBytes: m.Summary.FreeSpace,
			})
		}
		return rep, nil
	})
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: inventory: %v", err)
	}
	return rep, nil
}

// ---- catalog sync ----

// SyncCatalog maps clusters then standalone hosts to locations (code =
// inventory name), vCenter templates to OS templates (external id = the
// template name, ready to be joined back at provision time), and publishes
// three static instance-type profiles sized for typical vSphere offerings.
func (a *Adapter) SyncCatalog(ctx context.Context) ([]provider.CatalogInstanceType, []provider.CatalogOSTemplate, []provider.CatalogLocation, error) {
	type catalogData struct {
		codes     []string
		templates []provider.CatalogOSTemplate
	}
	data, err := vimCall(ctx, a.c, func(v *vim25.Client) (catalogData, error) {
		f := finder(ctx, v)

		codes := []string{}
		clusters, cerr := f.ClusterComputeResourceList(ctx, "*")
		if cerr == nil {
			for _, c := range clusters {
				codes = append(codes, c.Name())
			}
		}
		hosts, herr := f.HostSystemList(ctx, "*/*") // clustered + standalone hosts
		if herr == nil {
			for _, h := range hosts {
				codes = append(codes, h.Name())
			}
		}
		sort.Strings(codes)
		codes = uniqueStrings(codes)

		templatesOut := []provider.CatalogOSTemplate{}
		for _, vm := range listAllVMs(ctx, v) {
			isTmpl, terr := vm.IsTemplate(ctx)
			if terr != nil || !isTmpl {
				continue
			}
			name := path.Base(vm.InventoryPath)
			templatesOut = append(templatesOut, provider.CatalogOSTemplate{
				ExternalID: name,
				Name:       name,
				Family:     familyOf(name),
			})
		}
		sort.Slice(templatesOut, func(i, j int) bool { return templatesOut[i].ExternalID < templatesOut[j].ExternalID })
		return catalogData{codes: codes, templates: templatesOut}, nil
	})
	if err != nil {
		return nil, nil, nil, err
	}

	locs := make([]provider.CatalogLocation, 0, len(data.codes))
	for _, code := range data.codes {
		locs = append(locs, provider.CatalogLocation{Code: code, Name: code})
	}

	typesOut := []provider.CatalogInstanceType{}
	for _, loc := range locs {
		typesOut = append(typesOut,
			catalogType("small", 1, 2048, 40, loc.Code),
			catalogType("medium", 2, 4096, 80, loc.Code),
			catalogType("large", 4, 8192, 160, loc.Code),
		)
	}
	return typesOut, data.templates, locs, nil
}

var sizeLabels = map[string]string{"small": "Small", "medium": "Medium", "large": "Large"}

func catalogType(size string, cpu, ram, disk int64, loc string) provider.CatalogInstanceType {
	return provider.CatalogInstanceType{
		ExternalID:  "vmware-" + size,
		Code:        size,
		Name:        "vSphere " + sizeLabels[size],
		Category:    "virtual",
		MaxVCPU:     cpu,
		MaxRAM:      ram,
		MaxDisk:     disk,
		NetworkRate: 10000,
		Locations:   []string{loc},
	}
}

// familyOf guesses an OS family from a template name for catalog grouping.
func familyOf(name string) string {
	n := strings.ToLower(name)
	for _, fam := range []string{"ubuntu", "debian", "almalinux", "rocky", "centos", "windows", "fedora"} {
		if strings.Contains(n, fam) {
			return fam
		}
	}
	return "other"
}

func uniqueStrings(in []string) []string {
	out := in[:0]
	var prev string
	first := true
	for _, s := range in {
		if first || s != prev {
			out = append(out, s)
		}
		prev = s
		first = false
	}
	return out
}
