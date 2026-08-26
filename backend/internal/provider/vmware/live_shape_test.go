// live_shape_test.go exercises the adapter against the govmomi in-memory
// vCenter simulator (no real vSphere deployment needed): one datacenter,
// one cluster with two hosts, two VMs and one datastore. One model VM is
// converted into a template through the adapter itself, the other carries
// the "kilat" ownership tag, mirroring the shapes the production vCenter
// presents.
package vmware

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/performance"
	"github.com/vmware/govmomi/session"
	"github.com/vmware/govmomi/simulator"
	"github.com/vmware/govmomi/vim25"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/soap"
	"github.com/vmware/govmomi/vim25/types"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"

	_ "github.com/vmware/govmomi/vapi/simulator" // registers REST endpoints (tags)
)

// env bundles what tests interact with: the adapter plus a raw logged-in
// govmomi client for inventory assertions.
type env struct {
	adp    *Adapter
	raw    *vim25.Client
	finder *find.Finder
	model  *simulator.Model
}

// newEnv boots a fresh simulator vCenter per test for full isolation.
// Inventory shape: DC0 > cluster DC0_C0 (hosts DC0_C0_H0/H1) > VMs
// DC0_C0_RP0_VM0 and DC0_C0_RP0_VM1, datastore LocalDS_0.
func newEnv(t *testing.T) *env {
	t.Helper()

	m := simulator.VPX()
	m.Autostart = false // VMs start powered off so template conversion works
	m.ClusterHost = 2   // two hosts for the vMotion test
	if err := m.Create(); err != nil {
		t.Fatalf("create simulator model: %v", err)
	}
	m.Service.RegisterEndpoints = true
	server := m.Service.NewServer()
	t.Cleanup(server.Close)
	t.Cleanup(m.Remove)

	adp, err := NewAdapter(server.URL.String(), "user", "pass", true)
	if err != nil {
		t.Fatalf("NewAdapter: %v", err)
	}

	ctx := context.Background()
	c, err := vim25.NewClient(ctx, soap.NewClient(server.URL, true))
	if err != nil {
		t.Fatalf("raw govmomi client: %v", err)
	}
	if err := session.NewManager(c).Login(ctx, simulator.DefaultLogin); err != nil {
		t.Fatalf("raw login: %v", err)
	}
	finder := find.NewFinder(c, true)
	dc, err := finder.DefaultDatacenter(ctx)
	if err != nil {
		t.Fatalf("default datacenter: %v", err)
	}
	finder.SetDatacenter(dc)

	return &env{
		adp:    adp,
		raw:    c,
		finder: finder,
		model:  m,
	}
}

// vmExt resolves a model VM by inventory name to its external id.
func (e *env) vmExt(t *testing.T, name string) string {
	t.Helper()
	vm, err := e.finder.VirtualMachine(context.Background(), name)
	if err != nil {
		t.Fatalf("find vm %q: %v", name, err)
	}
	return vm.Reference().String()
}

// templateMoRefNumber converts a template MoRef "vm-12" into the decimal id
// InstanceSpec.OSExternalID would carry.
func templateMoRefNumber(ext string) int64 {
	var n int64
	fmt.Sscanf(ext, "VirtualMachine:vm-%d", &n)
	return n
}

// makeTemplate converts model VM0 into a vCenter template via the adapter.
func (e *env) makeTemplate(t *testing.T) string {
	t.Helper()
	ext := e.vmExt(t, "DC0_C0_RP0_VM0")
	if err := e.adp.ConvertToTemplate(context.Background(), ext); err != nil {
		t.Fatalf("ConvertToTemplate(%s): %v", ext, err)
	}
	return ext
}

// tagAsManaged marks VM1 as Kilat-managed through SetVMTags.
func (e *env) tagAsManaged(t *testing.T) string {
	t.Helper()
	ext := e.vmExt(t, "DC0_C0_RP0_VM1")
	if err := e.adp.SetVMTags(context.Background(), ext, []string{"prod"}); err != nil {
		t.Fatalf("SetVMTags(%s): %v", ext, err)
	}
	return ext
}

func TestNewAdapterValidation(t *testing.T) {
	if _, err := NewAdapter("", "user", "pass", true); !apperrorsIsValidation(err) {
		t.Errorf("empty baseURL: want validation error, got %v", err)
	}
	if _, err := NewAdapter("https://vcenter.local", "", "", false); !apperrorsIsValidation(err) {
		t.Errorf("missing credentials: want validation error, got %v", err)
	}
	if _, err := NewAdapter("https://vcenter.local", "user", "pass", true); err != nil {
		t.Errorf("valid wiring should not dial: got %v", err)
	}
}

func apperrorsIsValidation(err error) bool {
	var ae *apperrors.AppError
	return errors.As(err, &ae) && ae.Code == apperrors.CodeValidation
}

func TestResizePolicyAllowsDowngrade(t *testing.T) {
	e := newEnv(t)
	pol := e.adp.ResizePolicy()
	if !pol.AllowDowngrade {
		t.Error("self-hosted vSphere should allow downgrades like proxmox")
	}
	if e.adp.Code() != ProviderCode {
		t.Errorf("Code() = %q, want %q", e.adp.Code(), ProviderCode)
	}
}

func TestProvisionVMClonesTemplateResizesAndStarts(t *testing.T) {
	e := newEnv(t)
	tmplExt := e.makeTemplate(t)
	osID := templateMoRefNumber(tmplExt)

	spec := provider.InstanceSpec{
		Name:         "kilat-web01",
		CPU:          2,
		RAM:          4096,
		Disk:         20, // model disks are 10G; patch grows to 20
		OSExternalID: &osID,
	}
	ctx := context.Background()
	if err := e.adp.ProvisionVM(ctx, spec); err != nil {
		t.Fatalf("ProvisionVM clone: %v", err)
	}

	vms, err := e.adp.ListVMs(ctx, "")
	if err != nil {
		t.Fatalf("ListVMs: %v", err)
	}
	var got *provider.VMState
	for i := range vms {
		if vms[i].Name == "kilat-web01" {
			got = &vms[i]
		}
	}
	if got == nil {
		t.Fatalf("provisioned VM not found among managed guests: %+v", vms)
	}
	if got.Status != "active" || got.PowerStatus != "poweredOn" {
		t.Errorf("clone should end powered on, got status=%q power=%q", got.Status, got.PowerStatus)
	}
	if got.VCPU != 2 || got.RAM != 4096 {
		t.Errorf("reconfigure via clone spec failed: vcpu=%d ram=%d, want 2/4096", got.VCPU, got.RAM)
	}
	if got.Disk != 20 {
		t.Errorf("disk growth failed: got %dG, want 20G", got.Disk)
	}
}

func TestProvisionVMFallsBackToEmptyVM(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	spec := provider.InstanceSpec{Name: "kilat-bare", CPU: 1, RAM: 2048, Disk: 15}
	if err := e.adp.ProvisionVM(ctx, spec); err != nil {
		t.Fatalf("ProvisionVM empty: %v", err)
	}
	vms, err := e.adp.ListVMs(ctx, "")
	if err != nil {
		t.Fatalf("ListVMs: %v", err)
	}
	for _, vm := range vms {
		if vm.Name == "kilat-bare" {
			if vm.Disk != 15 || vm.VCPU != 1 || vm.RAM != 2048 {
				t.Errorf("empty VM shape wrong: %+v", vm)
			}
			if vm.PowerStatus != "poweredOn" {
				t.Errorf("empty VM should be powered on, got %q", vm.PowerStatus)
			}
			return
		}
	}
	t.Fatalf("empty VM %q not found among %+v", "kilat-bare", vms)
}

func TestGetVMAndListVMsOwnershipFilter(t *testing.T) {
	e := newEnv(t)
	_ = e.makeTemplate(t)
	managed := e.tagAsManaged(t)

	state, err := e.adp.GetVM(context.Background(), managed)
	if err != nil {
		t.Fatalf("GetVM: %v", err)
	}
	if state.Name != "DC0_C0_RP0_VM1" {
		t.Errorf("Name = %q", state.Name)
	}
	if state.ExternalID != managed {
		t.Errorf("ExternalID roundtrip = %q, want %q", state.ExternalID, managed)
	}
	if state.Disk != 10 { // model disks are 10 GB
		t.Errorf("Disk = %dG, want 10", state.Disk)
	}
	if state.PowerStatus != "poweredOff" {
		t.Errorf("model VM starts poweredOff, got %q", state.PowerStatus)
	}

	vms, err := e.adp.ListVMs(context.Background(), "team-ignored")
	if err != nil {
		t.Fatalf("ListVMs: %v", err)
	}
	if len(vms) != 1 || vms[0].ExternalID != managed {
		t.Errorf("ownership filter failed: %+v", vms)
	}
}

func TestPatchVMResizeRules(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()

	if err := e.adp.PatchVM(ctx, vmExt, map[string]any{"cpu": 4, "ram": 8192}); err != nil {
		t.Fatalf("PatchVM grow: %v", err)
	}
	if err := e.adp.PatchVM(ctx, vmExt, map[string]any{"disk": 16}); err != nil {
		t.Fatalf("PatchVM disk grow: %v", err)
	}
	state, err := e.adp.GetVM(ctx, vmExt)
	if err != nil {
		t.Fatalf("GetVM: %v", err)
	}
	if state.VCPU != 4 || state.RAM != 8192 || state.Disk != 16 {
		t.Errorf("patch result: %+v, want vcpu=4 ram=8192 disk=16", state)
	}

	// Downgrade of cpu/ram is allowed by policy...
	if err := e.adp.PatchVM(ctx, vmExt, map[string]any{"cpu": 2}); err != nil {
		t.Errorf("PatchVM cpu downgrade: %v", err)
	}
	// ...but vSphere cannot shrink disks.
	err = e.adp.PatchVM(ctx, vmExt, map[string]any{"disk": 5})
	if !apperrorsIsValidation(err) {
		t.Errorf("disk shrink: want CodeValidation, got %v", err)
	}
}

func TestPowerControlsLifecycle(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()
	ref := parseRefT(t, vmExt)

	if err := e.adp.StartVM(ctx, vmExt); err != nil {
		t.Fatalf("StartVM: %v", err)
	}
	if st, _ := e.adp.powerState(ctx, ref); st != "poweredOn" {
		t.Fatalf("after StartVM: %q", st)
	}
	if err := e.adp.StopVM(ctx, vmExt, true); err != nil {
		t.Fatalf("StopVM force: %v", err)
	}
	if st, _ := e.adp.powerState(ctx, ref); st != "poweredOff" {
		t.Fatalf("after force StopVM: %q", st)
	}
	// Graceful stop with absent guest tools falls back to hard power-off.
	if err := e.adp.StartVM(ctx, vmExt); err != nil {
		t.Fatalf("StartVM #2: %v", err)
	}
	if err := e.adp.StopVM(ctx, vmExt, false); err != nil {
		t.Fatalf("StopVM graceful w/o tools: %v", err)
	}
	if st, _ := e.adp.powerState(ctx, ref); st != "poweredOff" {
		t.Fatalf("after graceful StopVM fallback: %q", st)
	}
	// Reset (and Pause) require a running VM, like real vCenter.
	if err := e.adp.StartVM(ctx, vmExt); err != nil {
		t.Fatalf("StartVM #3: %v", err)
	}
	if err := e.adp.ResetVM(ctx, vmExt); err != nil {
		t.Fatalf("ResetVM: %v", err)
	}
	if err := e.adp.PauseVM(ctx, vmExt); err != nil {
		t.Fatalf("PauseVM: %v", err)
	}
	if st, _ := e.adp.powerState(ctx, ref); st != "suspended" {
		t.Fatalf("after PauseVM: %q", st)
	}
	if err := e.adp.ResumeVM(ctx, vmExt); err != nil {
		t.Fatalf("ResumeVM: %v", err)
	}
	if st, _ := e.adp.powerState(ctx, ref); st != "poweredOn" {
		t.Fatalf("after ResumeVM: %q", st)
	}
	if err := e.adp.DestroyVM(ctx, vmExt); err != nil {
		t.Fatalf("DestroyVM: %v", err)
	}
	if _, err := e.adp.GetVM(ctx, vmExt); err == nil {
		t.Error("GetVM after destroy should fail")
	}
}

// parseRefT converts an external id to a MoRef for direct adapter helpers.
func parseRefT(t *testing.T, ext string) types.ManagedObjectReference {
	t.Helper()
	ref, err := parseVMRef(ext)
	if err != nil {
		t.Fatalf("parseVMRef(%q): %v", ext, err)
	}
	return ref
}

// runtimeHostName reads which host currently hosts the VM (raw inventory
// read, independent of the adapter under test).
func (e *env) runtimeHostName(t *testing.T, ref types.ManagedObjectReference) string {
	t.Helper()
	var m mo.VirtualMachine
	err := object.NewVirtualMachine(e.raw, ref).Properties(context.Background(),
		ref, []string{"runtime.host"}, &m)
	if err != nil {
		t.Fatalf("read runtime.host: %v", err)
	}
	if m.Runtime.Host == nil {
		return ""
	}
	return m.Runtime.Host.Value
}

func TestMigrateVMBetweenHosts(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ref := parseRefT(t, vmExt)
	ctx := context.Background()

	currentHost := e.runtimeHostName(t, ref)

	hosts, err := e.finder.HostSystemList(ctx, "*/*")
	if err != nil || len(hosts) < 2 {
		t.Fatalf("need two cluster hosts: %v", err)
	}
	target := hosts[0].Name()
	if currentHost == hosts[0].Reference().Value {
		target = hosts[1].Name()
	}
	if err := e.adp.MigrateVM(ctx, vmExt, target); err != nil {
		t.Fatalf("MigrateVM -> %s: %v", target, err)
	}
	if after := e.runtimeHostName(t, ref); after != hostsByName(hosts, target) {
		t.Errorf("vm did not move: host=%q want %q", after, target)
	}
	if err := e.adp.MigrateVM(ctx, vmExt, ""); err == nil {
		t.Error("empty target must fail validation")
	}
}

// hostsByName returns the MoRef value of the host with the given name.
func hostsByName(hosts []*object.HostSystem, name string) string {
	for _, h := range hosts {
		if h.Name() == name {
			return h.Reference().Value
		}
	}
	return ""
}

func TestSnapshotLifecycleRoundtrip(t *testing.T) {
	e := newEnv(t)
	vmExt := e.tagAsManaged(t)
	ctx := context.Background()

	extID, err := e.adp.CreateSnapshot(ctx, vmExt, "pre-upgrade", "before kernel bump")
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	if extID != vmExt+"/pre-upgrade" {
		t.Errorf("snapshot ext id = %q, want %q", extID, vmExt+"/pre-upgrade")
	}

	snaps, err := e.adp.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots: %v", err)
	}
	if len(snaps) != 1 || snaps[0].Name != "pre-upgrade" {
		t.Fatalf("list after create: %+v", snaps)
	}
	if snaps[0].CreatedAt == "" {
		t.Error("snapshot CreatedAt should be RFC3339 populated")
	}

	if err := e.adp.RestoreFromSnapshot(ctx, vmExt, extID); err != nil {
		t.Fatalf("RestoreFromSnapshot: %v", err)
	}
	if err := e.adp.DeleteSnapshot(ctx, extID); err != nil {
		t.Fatalf("DeleteSnapshot: %v", err)
	}
	snaps, err = e.adp.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots after delete: %v", err)
	}
	if len(snaps) != 0 {
		t.Errorf("snapshots left after delete: %+v", snaps)
	}

	if err := e.adp.RestoreFromSnapshot(ctx, vmExt, "VirtualMachine:vm-999/nope"); err == nil {
		t.Error("cross-vm restore must be rejected")
	}
}

func TestCloneVMThenConvertToTemplate(t *testing.T) {
	e := newEnv(t)
	srcExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()

	if err := e.adp.CloneVM(ctx, srcExt, "golden-copy"); err != nil {
		t.Fatalf("CloneVM: %v", err)
	}
	copyExt := e.vmExt(t, "golden-copy")

	// Clones stay powered off, so template conversion must succeed.
	if err := e.adp.ConvertToTemplate(ctx, copyExt); err != nil {
		t.Fatalf("ConvertToTemplate: %v", err)
	}
	vm, err := e.finder.VirtualMachine(ctx, "golden-copy")
	if err != nil {
		t.Fatalf("find clone: %v", err)
	}
	isTmpl, err := vm.IsTemplate(ctx)
	if err != nil || !isTmpl {
		t.Errorf("clone should now be a template (is=%v err=%v)", isTmpl, err)
	}

	// Converting the running source VM must be refused, not silently stopped.
	if err := e.adp.StartVM(ctx, srcExt); err != nil {
		t.Fatalf("StartVM src: %v", err)
	}
	err = e.adp.ConvertToTemplate(ctx, srcExt)
	var ae *apperrors.AppError
	if !errors.As(err, &ae) || ae.Code != apperrors.CodeInvalidState {
		t.Errorf("ConvertToTemplate(running): want CodeInvalidState, got %v", err)
	}
}

func TestNotesAndTagsRoundtrip(t *testing.T) {
	e := newEnv(t)
	vmExt := e.tagAsManaged(t)
	ctx := context.Background()

	if err := e.adp.SetVMNotes(ctx, vmExt, "owned by team kilat"); err != nil {
		t.Fatalf("SetVMNotes: %v", err)
	}
	notes, err := e.adp.VMNotes(ctx, vmExt)
	if err != nil || notes != "owned by team kilat" {
		t.Errorf("notes roundtrip = %q, %v", notes, err)
	}

	if err := e.adp.SetVMTags(ctx, vmExt, []string{"staging", "gpu"}); err != nil {
		t.Fatalf("SetVMTags: %v", err)
	}
	tagsOut, err := e.adp.VMTags(ctx, vmExt)
	if err != nil {
		t.Fatalf("VMTags: %v", err)
	}
	got := map[string]bool{}
	for _, tg := range tagsOut {
		got[tg] = true
	}
	// Ownership tag is preserved; new tags attached; replaced tag detached.
	for _, want := range []string{"kilat", "staging", "gpu"} {
		if !got[want] {
			t.Errorf("tag %q missing after SetVMTags: %v", want, tagsOut)
		}
	}
	if got["prod"] {
		t.Errorf("replaced tag %q still attached: %v", "prod", tagsOut)
	}
}

func TestGuestAgentInfoPingAndMetrics(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()

	info, err := e.adp.GuestAgentInfo(ctx, vmExt)
	if err != nil {
		t.Fatalf("GuestAgentInfo: %v", err)
	}
	m, ok := info.(map[string]any)
	if !ok {
		t.Fatalf("GuestAgentInfo type = %T", info)
	}
	if _, ok := m["toolsRunningStatus"]; !ok {
		t.Errorf("toolsRunningStatus missing: %v", m)
	}
	if _, ok := m["guestFullName"]; !ok {
		t.Errorf("guestFullName missing: %v", m)
	}

	// Simulator guests run no VMware Tools, so ping reports unhealthy...
	err = e.adp.GuestAgentPing(ctx, vmExt)
	var ae *apperrors.AppError
	if !errors.As(err, &ae) || ae.Code != apperrors.CodeInvalidState {
		t.Errorf("ping w/o tools: want CodeInvalidState, got %v", err)
	}
	// ...while OS/FS introspection is refused outright (guest credentials).
	if _, err := e.adp.GuestAgentOSInfo(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("OSInfo: want unsupported, got %v", err)
	}
	if _, err := e.adp.GuestAgentFSInfo(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("FSInfo: want unsupported, got %v", err)
	}

	series, err := e.adp.GuestMetrics(ctx, vmExt, "hour")
	if err != nil {
		t.Fatalf("GuestMetrics hour: %v", err)
	}
	if _, ok := series.([]performance.EntityMetric); !ok {
		t.Errorf("metrics type = %T, want []performance.EntityMetric", series)
	}
	if _, err := e.adp.GuestMetrics(ctx, vmExt, "day"); err != nil {
		t.Errorf("GuestMetrics day: %v", err)
	}
}

func TestSyncCatalogShapesInventory(t *testing.T) {
	e := newEnv(t)
	tmplExt := e.makeTemplate(t)
	_ = tmplExt

	typesOut, templates, locs, err := e.adp.SyncCatalog(context.Background())
	if err != nil {
		t.Fatalf("SyncCatalog: %v", err)
	}

	foundCluster, foundHost := false, false
	for _, l := range locs {
		switch l.Code {
		case "DC0_C0":
			foundCluster = true
		case "DC0_C0_H0":
			foundHost = true
		}
	}
	if !foundCluster || !foundHost {
		t.Errorf("locations should include cluster + host codes: %+v", locs)
	}

	foundTmpl := false
	for _, tpl := range templates {
		if tpl.ExternalID == "DC0_C0_RP0_VM0" && tpl.Family == "other" {
			foundTmpl = true
		}
	}
	if !foundTmpl {
		t.Errorf("converted template missing from catalog: %+v", templates)
	}

	sizes := map[string]bool{}
	for _, it := range typesOut {
		sizes[it.Code] = true
	}
	for _, want := range []string{"small", "medium", "large"} {
		if !sizes[want] {
			t.Errorf("instance type %q missing", want)
		}
	}
}

func TestMoveVolumeStorageVMotion(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()

	if err := e.adp.MoveVolume(ctx, vmExt, "disk1", "LocalDS_0"); err != nil {
		t.Fatalf("MoveVolume same-ds relocate: %v", err)
	}
	if err := e.adp.MoveVolume(ctx, vmExt, "disk1", ""); err == nil {
		t.Error("empty target datastore must fail validation")
	}
}

// ---- unsupported families ----

func TestUnsupportedOperationsReturn501(t *testing.T) {
	e := newEnv(t)
	vmExt := e.vmExt(t, "DC0_C0_RP0_VM1")
	ctx := context.Background()

	checkErr := func(name string, err error) {
		t.Helper()
		var ae *apperrors.AppError
		if !errors.As(err, &ae) {
			t.Errorf("%s: want AppError, got %v", name, err)
			return
		}
		if ae.Code != apperrors.CodeUnsupported || ae.HTTPStatus != 501 {
			t.Errorf("%s: want PROVIDER_UNSUPPORTED(501), got %s(%d)", name, ae.Code, ae.HTTPStatus)
		}
	}

	// Console family (WebMKS protocol note).
	_, _, cerr := e.adp.VNCSession(ctx, vmExt)
	checkErr("VNCSession", cerr)
	_, _, cerr = e.adp.SerialConsole(ctx, vmExt)
	checkErr("SerialConsole", cerr)

	// Hibernate (suspend only in vSphere).
	checkErr("HibernateVM", e.adp.HibernateVM(ctx, vmExt))
	// Cloud-init regeneration (customization specs domain).
	checkErr("CloudInitRegenerate", e.adp.CloudInitRegenerate(ctx, vmExt))

	// Firewall family (DFW-level, not per-VM).
	if _, err := e.adp.FirewallRulesList(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("FirewallRulesList: %v", err)
	}
	checkErr("CreateFirewallRule", e.adp.CreateFirewallRule(ctx, vmExt, provider.ProviderFirewallRule{}))
	checkErr("DeleteFirewallRule", e.adp.DeleteFirewallRule(ctx, vmExt, 0))
	if _, err := e.adp.FirewallOptionsMap(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("FirewallOptionsMap: %v", err)
	}
	checkErr("SetFirewallOptionsMap", e.adp.SetFirewallOptionsMap(ctx, vmExt, nil))
	if _, err := e.adp.FirewallIPSetsList(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("FirewallIPSetsList: %v", err)
	}
	checkErr("CreateFirewallIPSet", e.adp.CreateFirewallIPSet(ctx, vmExt, "x", ""))
	checkErr("DeleteFirewallIPSet", e.adp.DeleteFirewallIPSet(ctx, vmExt, "x", false))
	if _, err := e.adp.FirewallIPSetEntriesList(ctx, vmExt, "x"); !apperrorsIsUnsupported(err) {
		t.Errorf("FirewallIPSetEntriesList: %v", err)
	}
	checkErr("AddFirewallIPSetEntry", e.adp.AddFirewallIPSetEntry(ctx, vmExt, "x", "1.2.3.4", ""))
	checkErr("UpdateFirewallIPSetEntry", e.adp.UpdateFirewallIPSetEntry(ctx, vmExt, "x", "1.2.3.4", "1.2.3.5", ""))
	checkErr("RemoveFirewallIPSetEntry", e.adp.RemoveFirewallIPSetEntry(ctx, vmExt, "x", "1.2.3.4"))

	// Container family.
	checkErr("ProvisionContainer", e.adp.ProvisionContainer(ctx, provider.InstanceSpec{}))
	checkErr("StartContainer", e.adp.StartContainer(ctx, vmExt))
	checkErr("StopContainer", e.adp.StopContainer(ctx, vmExt, true))
	checkErr("RebootContainer", e.adp.RebootContainer(ctx, vmExt))
	checkErr("DestroyContainer", e.adp.DestroyContainer(ctx, vmExt))
	checkErr("MigrateContainer", e.adp.MigrateContainer(ctx, vmExt, "h"))
	_, _, cerr = e.adp.ContainerSerialConsole(ctx, vmExt)
	checkErr("ContainerSerialConsole", cerr)
	_, cerr = e.adp.ContainerSnapshotCreate(ctx, vmExt, "s", "")
	checkErr("ContainerSnapshotCreate", cerr)
	if _, err := e.adp.ContainerSnapshotsList(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("ContainerSnapshotsList: %v", err)
	}
	checkErr("ContainerSnapshotDelete", e.adp.ContainerSnapshotDelete(ctx, "ct100/s"))
	checkErr("ContainerSnapshotRollback", e.adp.ContainerSnapshotRollback(ctx, vmExt, "ct100/s"))
	cmOut, cmErr := e.adp.ContainerMetrics(ctx, vmExt, "hour")
	_ = cmOut
	checkErr("ContainerMetrics", cmErr)

	// SSH keys / scripts / measured boot (guest customization domain).
	if _, err := e.adp.EnsureSSHKey(ctx, "team", "k", "ssh-ed25519 AAA"); !apperrorsIsUnsupported(err) {
		t.Errorf("EnsureSSHKey: %v", err)
	}
	checkErr("UpdateSSHKey", e.adp.UpdateSSHKey(ctx, "k", "team", "k", "ssh-ed25519 AAA"))
	checkErr("DeleteSSHKey", e.adp.DeleteSSHKey(ctx, "k", "team"))
	if _, err := e.adp.EnsureStartupScript(ctx, "team", "s", "#!/bin/sh"); !apperrorsIsUnsupported(err) {
		t.Errorf("EnsureStartupScript: %v", err)
	}
	checkErr("UpdateStartupScript", e.adp.UpdateStartupScript(ctx, "s", "team", "s", "#!/bin/sh"))
	checkErr("DeleteStartupScript", e.adp.DeleteStartupScript(ctx, "s", "team"))
	if _, err := e.adp.UploadMeasuredBootImage(ctx, "team", "f", "d", nil, 0); !apperrorsIsUnsupported(err) {
		t.Errorf("UploadMeasuredBootImage: %v", err)
	}
	if _, err := e.adp.ListMeasuredBootImages(ctx, "team"); !apperrorsIsUnsupported(err) {
		t.Errorf("ListMeasuredBootImages: %v", err)
	}
	checkErr("DeleteMeasuredBootImage", e.adp.DeleteMeasuredBootImage(ctx, "img"))
	checkErr("AttachMeasuredBoot", e.adp.AttachMeasuredBoot(ctx, vmExt, "img"))
	checkErr("DetachMeasuredBoot", e.adp.DetachMeasuredBoot(ctx, vmExt))

	// ISO uploads deferred.
	if _, err := e.adp.ListISOs(ctx, "team"); !apperrorsIsUnsupported(err) {
		t.Errorf("ListISOs: %v", err)
	}
	checkErr("CreateISOByURL", e.adp.CreateISOByURL(ctx, "team", "https://example.com/x.iso"))
	checkErr("DeleteISO", e.adp.DeleteISO(ctx, "iso"))

	// Platform network products stay Onidel/proxmox-shaped.
	if _, err := e.adp.ListReservedIPs(ctx, "team"); !apperrorsIsUnsupported(err) {
		t.Errorf("ListReservedIPs: %v", err)
	}
	if _, _, err := e.adp.CreateReservedIP(ctx, "t", "loc", "n", "v4"); !apperrorsIsUnsupported(err) {
		t.Errorf("CreateReservedIP: %v", err)
	}
	if _, err := e.adp.ConvertPrimaryIP(ctx, "t", "1.2.3.4", "n"); !apperrorsIsUnsupported(err) {
		t.Errorf("ConvertPrimaryIP: %v", err)
	}
	checkErr("DeleteReservedIP", e.adp.DeleteReservedIP(ctx, "rip", "t"))
	checkErr("PatchReservedIP", e.adp.PatchReservedIP(ctx, "rip", "t", "n", ""))
	if _, err := e.adp.ListStorageServices(ctx, "t"); !apperrorsIsUnsupported(err) {
		t.Errorf("ListStorageServices: %v", err)
	}
	if _, err := e.adp.CreateBucket(ctx, "svc", "t", "b", false, false); !apperrorsIsUnsupported(err) {
		t.Errorf("CreateBucket: %v", err)
	}
	if _, err := e.adp.BucketAccessKeys(ctx, "svc", "b", "t"); !apperrorsIsUnsupported(err) {
		t.Errorf("BucketAccessKeys: %v", err)
	}
	checkErr("SetReverseDNS", e.adp.SetReverseDNS(ctx, vmExt, "1.2.3.4", "x.example"))
	checkErr("DeleteReverseDNS", e.adp.DeleteReverseDNS(ctx, vmExt, "1.2.3.4"))
	if _, err := e.adp.ListReverseDNS(ctx, vmExt); !apperrorsIsUnsupported(err) {
		t.Errorf("ListReverseDNS: %v", err)
	}
	checkErr("EnableBGP", e.adp.EnableBGP(ctx, vmExt))
	checkErr("DisableBGP", e.adp.DisableBGP(ctx, vmExt))

	// Backup plumbing (VADP territory).
	checkErr("RestoreFromBackup", e.adp.RestoreFromBackup(ctx, vmExt, "bk"))
	if _, err := e.adp.SnapshotDownloadURL(ctx, "s"); !apperrorsIsUnsupported(err) {
		t.Errorf("SnapshotDownloadURL: %v", err)
	}
	if _, err := e.adp.BackupDownloadURL(ctx, "bk"); !apperrorsIsUnsupported(err) {
		t.Errorf("BackupDownloadURL: %v", err)
	}
	// While the backup listing itself is an honest empty inventory.
	backups, err := e.adp.VMBackups(ctx, vmExt)
	if err != nil || len(backups) != 0 {
		t.Errorf("VMBackups = %v, %v; want empty, nil", backups, err)
	}
}

func apperrorsIsUnsupported(err error) bool {
	var ae *apperrors.AppError
	return errors.As(err, &ae) && ae.Code == apperrors.CodeUnsupported
}
