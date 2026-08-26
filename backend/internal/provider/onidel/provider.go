// provider.go implements the provider.ComputeProvider interface against the
// Onidel Cloud API by delegating to the low-level Client.
package onidel

import (
	"context"
	"encoding/json"
	"io"
	"sort"
	"strconv"
	"strings"

	gossh "golang.org/x/crypto/ssh"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

// Adapter adapts the Onidel HTTP API to the ComputeProvider interface.
type Adapter struct {
	c *Client
}

// Compile-time proof that Adapter satisfies the full interface.
var _ provider.ComputeProvider = (*Adapter)(nil)

func NewAdapter(baseURL, apiKey string) *Adapter {
	return &Adapter{c: NewClient(baseURL, apiKey)}
}

// Client exposes the underlying Onidel HTTP client for callers that need
// operations outside the ComputeProvider surface.
func (a *Adapter) Client() *Client { return a.c }

func (a *Adapter) Code() string { return "onidel" }

// ResizePolicy reports Onidel's upgrade-only constraint: once a VM spec
// dimension is increased it can never be lowered again.
func (a *Adapter) ResizePolicy() provider.ResizePolicy {
	return provider.ResizePolicy{AllowDowngrade: false}
}

// mapOnidelStatus converts an Onidel VM status into the Kilat Cloud status.
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

// ---- VM lifecycle ----

func (a *Adapter) ProvisionVM(ctx context.Context, spec provider.InstanceSpec) error {
	req := NewVMRequest{
		Name:               spec.Name,
		PaymentCycle:       spec.PaymentCycle,
		InstanceType:       spec.InstanceTypeExternalID,
		Location:           spec.Location,
		CPU:                spec.CPU,
		RAM:                spec.RAM,
		Disk:               spec.Disk,
		OS:                 spec.OSExternalID,
		SnapshotID:         spec.SnapshotExternalID,
		IsoID:              spec.IsoExternalID,
		TeamID:             spec.ExternalTeamID,
		SSHKeys:            spec.SSHKeyIDs,
		VPCs:               spec.VPCIDs,
		FirewallGroupID:    spec.FirewallGroupID,
		IPv6:               spec.IPv6,
		DisableSSHBlocking: spec.DisableSSHBlocking,
		StartupScriptID:    spec.StartupScriptID,
	}
	return a.c.ProvisionVM(ctx, req)
}

func mapVM(vm *VM) *provider.VMState {
	return &provider.VMState{
		ExternalID:      vm.ID,
		Name:            vm.Name,
		Status:          mapOnidelStatus(vm.Status),
		PowerStatus:     "", // Onidel GET /vm/{id} does not report power state
		MainIPv4:        vm.MainIPv4,
		MainIPv6:        vm.MainIPv6,
		Template:        vm.Template,
		VCPU:            vm.Vcpu,
		RAM:             vm.Ram,
		Disk:            vm.Disk,
		BWUsed:          vm.BwUsed,
		RecurringAmount: vm.RecurringAmount,
		Currency:        vm.PaymentCurrency,
	}
}

func (a *Adapter) GetVM(ctx context.Context, externalID string) (*provider.VMState, error) {
	vm, err := a.c.GetVM(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return mapVM(vm), nil
}

func (a *Adapter) ListVMs(ctx context.Context, teamExternalID string) ([]provider.VMState, error) {
	vms, err := a.c.ListVMs(ctx, teamExternalID)
	if err != nil {
		return nil, err
	}
	out := make([]provider.VMState, 0, len(vms))
	for i := range vms {
		out = append(out, *mapVM(&vms[i]))
	}
	return out, nil
}

func (a *Adapter) PatchVM(ctx context.Context, externalID string, fields map[string]any) error {
	return a.c.PatchVM(ctx, externalID, fields)
}

func (a *Adapter) DestroyVM(ctx context.Context, externalID string) error {
	return a.c.DestroyVM(ctx, externalID)
}

func (a *Adapter) StopVM(ctx context.Context, externalID string, force bool) error {
	return a.c.StopVM(ctx, externalID, "", force)
}

func (a *Adapter) RebootVM(ctx context.Context, externalID string, force bool) error {
	return a.c.RebootVM(ctx, externalID, "", force)
}

// StartVM is unsupported: the Onidel upstream API only exposes stop and
// reboot under /vm/{vm_id} (see docs/openapi contract); there is no start
// endpoint to delegate to, so this fails fast instead of faking success.
func (a *Adapter) StartVM(_ context.Context, _ string) error {
	return unsupported("vm start")
}

// MigrateVM is unsupported: instance placement across Onidel's fleet is
// managed entirely by the Onidel platform — there is no migrate endpoint and
// customers cannot choose a target host.
func (a *Adapter) MigrateVM(_ context.Context, _, _ string) error {
	return unsupported("migration")
}

// unsupported builds the PROVIDER_UNSUPPORTED (HTTP 501) error used by every
// capability family the Onidel platform does not expose.
func unsupported(op string) error {
	return apperrors.Newf(apperrors.CodeUnsupported, "%s is not supported by the onidel provider", op)
}

func (a *Adapter) VNCSession(ctx context.Context, vmExternalID string) (url string, expireUnix int64, err error) {
	return a.c.CreateVNCSession(ctx, vmExternalID, "")
}

// ---- Snapshots / backups ----

func (a *Adapter) CreateSnapshot(ctx context.Context, vmExternalID, name, desc string) (string, error) {
	return a.c.TakeSnapshot(ctx, vmExternalID, "", name, desc)
}

func (a *Adapter) ListSnapshots(ctx context.Context) ([]provider.ProviderSnapshot, error) {
	snaps, err := a.c.ListSnapshots(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderSnapshot, 0, len(snaps))
	for _, s := range snaps {
		out = append(out, provider.ProviderSnapshot{
			ExternalID: s.ID,
			Name:       s.Name,
			Desc:       s.Desc,
			CreatedAt:  s.CreatedAt,
			Status:     s.Status,
			Size:       s.Size,
		})
	}
	return out, nil
}

func (a *Adapter) DeleteSnapshot(ctx context.Context, snapshotExtID string) error {
	return a.c.DeleteSnapshot(ctx, snapshotExtID, "")
}

func (a *Adapter) RestoreFromSnapshot(ctx context.Context, vmExternalID, snapshotExtID string) error {
	return a.c.RestoreFromSnapshot(ctx, vmExternalID, "", snapshotExtID)
}

func (a *Adapter) RestoreFromBackup(ctx context.Context, vmExternalID, backupExtID string) error {
	return a.c.RestoreFromBackup(ctx, vmExternalID, "", backupExtID)
}

func (a *Adapter) VMBackups(ctx context.Context, vmExternalID string) ([]provider.ProviderBackup, error) {
	backups, err := a.c.GetVMBackups(ctx, vmExternalID, "")
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderBackup, 0, len(backups))
	for _, b := range backups {
		out = append(out, provider.ProviderBackup{
			ExternalID:         b.ID,
			CreatedAt:          b.CreatedAt,
			InstanceExternalID: b.Instance,
			Status:             b.Status,
			Size:               b.Size,
		})
	}
	return out, nil
}

func (a *Adapter) SnapshotDownloadURL(ctx context.Context, snapshotExtID string) (string, error) {
	return a.c.GenSnapshotDownloadURL(ctx, snapshotExtID)
}

func (a *Adapter) BackupDownloadURL(ctx context.Context, backupExtID string) (string, error) {
	return a.c.GenBackupDownloadURL(ctx, backupExtID)
}

// ---- SSH keys ----

// sshFingerprint returns the SHA-256 fingerprint of an OpenSSH authorized key,
// or "" when the material cannot be parsed.
func sshFingerprint(publicKey string) string {
	pk, _, _, _, err := gossh.ParseAuthorizedKey([]byte(publicKey))
	if err != nil {
		return ""
	}
	return gossh.FingerprintSHA256(pk)
}

func (a *Adapter) EnsureSSHKey(ctx context.Context, teamID, name, publicKey string) (provider.ProviderSSHKey, error) {
	fingerprint := sshFingerprint(publicKey)
	keys, err := a.c.ListSSHKeys(ctx, teamID)
	if err == nil && fingerprint != "" {
		for _, k := range keys {
			if k.SSHKey != "" && sshFingerprint(k.SSHKey) == fingerprint {
				return provider.ProviderSSHKey{ExternalID: k.ID, Name: k.Name, PublicKey: k.SSHKey}, nil
			}
		}
	}
	created, err := a.c.CreateSSHKey(ctx, teamID, name, publicKey)
	if err != nil {
		return provider.ProviderSSHKey{}, err
	}
	return provider.ProviderSSHKey{ExternalID: created.ID, Name: created.Name, PublicKey: created.SSHKey}, nil
}

func (a *Adapter) UpdateSSHKey(ctx context.Context, keyExtID, teamID, name, publicKey string) error {
	return a.c.UpdateSSHKey(ctx, keyExtID, teamID, name, publicKey)
}

func (a *Adapter) DeleteSSHKey(ctx context.Context, keyExtID, teamID string) error {
	return a.c.DeleteSSHKey(ctx, keyExtID, teamID)
}

// ---- Startup scripts ----

func (a *Adapter) EnsureStartupScript(ctx context.Context, teamID, name, content string) (provider.ProviderScript, error) {
	scripts, err := a.c.ListStartupScripts(ctx, teamID)
	if err == nil {
		for _, s := range scripts {
			if s.Name != name {
				continue
			}
			// Listing omits content; fetch the detail before deciding.
			detail, derr := a.c.GetStartupScript(ctx, s.ID)
			if derr != nil {
				return provider.ProviderScript{}, derr
			}
			if detail.Content != content {
				if err := a.c.UpdateStartupScript(ctx, s.ID, teamID, name, content); err != nil {
					return provider.ProviderScript{}, err
				}
				detail.Content = content
			}
			return provider.ProviderScript{ExternalID: detail.ID, Name: detail.Name, Content: detail.Content}, nil
		}
	}
	created, err := a.c.CreateStartupScript(ctx, teamID, name, content)
	if err != nil {
		return provider.ProviderScript{}, err
	}
	return provider.ProviderScript{ExternalID: created.ID, Name: created.Name, Content: created.Content}, nil
}

func (a *Adapter) UpdateStartupScript(ctx context.Context, scriptExtID, teamID, name, content string) error {
	return a.c.UpdateStartupScript(ctx, scriptExtID, teamID, name, content)
}

func (a *Adapter) DeleteStartupScript(ctx context.Context, scriptExtID, teamID string) error {
	return a.c.DeleteStartupScript(ctx, scriptExtID, teamID)
}

// ---- Measured boot images ----

func (a *Adapter) UploadMeasuredBootImage(ctx context.Context, teamID, filename, description string, data io.Reader, size int64) (provider.MeasuredBootImage, error) {
	img, err := a.c.UploadMeasuredBootImage(ctx, teamID, filename, description, data, size)
	if err != nil {
		return provider.MeasuredBootImage{}, err
	}
	return provider.MeasuredBootImage{
		ExternalID:  img.ID,
		Filename:    img.Filename,
		Description: img.Description,
		Size:        img.Size,
	}, nil
}

func (a *Adapter) ListMeasuredBootImages(ctx context.Context, teamID string) ([]provider.MeasuredBootImage, error) {
	images, err := a.c.ListMeasuredBootImages(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]provider.MeasuredBootImage, 0, len(images))
	for _, img := range images {
		out = append(out, provider.MeasuredBootImage{
			ExternalID:  img.ID,
			Filename:    img.Filename,
			Description: img.Description,
			Size:        img.Size,
		})
	}
	return out, nil
}

func (a *Adapter) DeleteMeasuredBootImage(ctx context.Context, imageExtID string) error {
	return a.c.DeleteMeasuredBootImage(ctx, imageExtID, "")
}

func (a *Adapter) AttachMeasuredBoot(ctx context.Context, vmExternalID, imageExtID string) error {
	return a.c.AttachMeasuredBoot(ctx, vmExternalID, "", imageExtID)
}

func (a *Adapter) DetachMeasuredBoot(ctx context.Context, vmExternalID string) error {
	return a.c.DetachMeasuredBoot(ctx, vmExternalID, "")
}

// ---- Custom ISO ----

func (a *Adapter) ListISOs(ctx context.Context, teamID string) ([]provider.ISOImage, error) {
	isos, err := a.c.ListISOs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ISOImage, 0, len(isos))
	for _, iso := range isos {
		out = append(out, provider.ISOImage{
			ExternalID:      iso.ID,
			Filename:        iso.Filename,
			Name:            iso.Name,
			Desc:            iso.Desc,
			Size:            iso.Size,
			ProgressPercent: iso.Status, // Onidel encodes ISO processing progress in `status`
			IsSystem:        iso.IsSystemISO,
		})
	}
	return out, nil
}

func (a *Adapter) CreateISOByURL(ctx context.Context, teamID, url string) error {
	return a.c.CreateISO(ctx, teamID, url)
}

func (a *Adapter) DeleteISO(ctx context.Context, isoExtID string) error {
	return a.c.DeleteISO(ctx, isoExtID, "")
}

// ---- Reserved IPs ----

func (a *Adapter) ListReservedIPs(ctx context.Context, teamID string) ([]provider.ProviderReservedIP, error) {
	rips, err := a.c.ListReservedIPs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]provider.ProviderReservedIP, 0, len(rips))
	for _, r := range rips {
		entry := provider.ProviderReservedIP{
			ExternalID:      r.ID,
			Name:            r.Name,
			Location:        r.Location,
			Status:          r.Status,
			Address:         r.IPAddr,
			RecurringAmount: r.RecurringAmount,
			Currency:        r.Currency,
		}
		if r.Attachment != nil {
			entry.AttachedVMExternalID = r.Attachment.ID
		}
		out = append(out, entry)
	}
	return out, nil
}

func (a *Adapter) CreateReservedIP(ctx context.Context, teamID, location, name, ipType string) (string, string, error) {
	return a.c.CreateReservedIP(ctx, teamID, location, name, ipType)
}

func (a *Adapter) ConvertPrimaryIP(ctx context.Context, teamID, ipAddress, name string) (map[string]any, error) {
	rip, err := a.c.ConvertPrimaryIP(ctx, teamID, ipAddress, name)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(rip)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (a *Adapter) DeleteReservedIP(ctx context.Context, ripExtID, teamID string) error {
	return a.c.DeleteReservedIP(ctx, ripExtID, teamID)
}

func (a *Adapter) PatchReservedIP(ctx context.Context, ripExtID, teamID, name, anchorIP string) error {
	return a.c.PatchReservedIP(ctx, ripExtID, teamID, name, anchorIP)
}

// ---- Object storage ----

func (a *Adapter) ListStorageServices(ctx context.Context, teamID string) ([]provider.StorageServiceInfo, error) {
	services, err := a.c.ListObjectStorageServices(ctx, teamID)
	if err != nil {
		return nil, err
	}
	out := make([]provider.StorageServiceInfo, 0, len(services))
	for _, s := range services {
		out = append(out, provider.StorageServiceInfo{
			ExternalID: s.ID,
			Name:       s.Name,
			Endpoint:   s.Endpoint,
			Status:     s.Status,
			CapacityKB: s.CapacityKB,
			UsedKB:     s.UsedCapacityKB,
		})
	}
	return out, nil
}

func (a *Adapter) CreateBucket(ctx context.Context, serviceExtID, teamID, bucketName string, versioning, objectLock bool) ([]provider.BucketKey, error) {
	keys, err := a.c.CreateBucket(ctx, serviceExtID, teamID, bucketName, versioning, objectLock)
	if err != nil {
		return nil, err
	}
	return toBucketKeys(keys), nil
}

func (a *Adapter) BucketAccessKeys(ctx context.Context, serviceExtID, bucketName, teamID string) ([]provider.BucketKey, error) {
	keys, err := a.c.ListBucketAccessKeys(ctx, serviceExtID, bucketName, teamID)
	if err != nil {
		return nil, err
	}
	return toBucketKeys(keys), nil
}

type rawBucketKey = struct {
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
}

func toBucketKeys(keys []rawBucketKey) []provider.BucketKey {
	out := make([]provider.BucketKey, 0, len(keys))
	for _, k := range keys {
		out = append(out, provider.BucketKey{AccessKey: k.AccessKey, SecretKey: k.SecretKey})
	}
	return out
}

// ---- Reverse DNS / BGP ----

func (a *Adapter) SetReverseDNS(ctx context.Context, vmExternalID, ipAddr, domain string) error {
	return a.c.SetReverseDNS(ctx, vmExternalID, "", ipAddr, domain)
}

func (a *Adapter) DeleteReverseDNS(ctx context.Context, vmExternalID, ipAddr string) error {
	return a.c.DeleteReverseDNS(ctx, vmExternalID, "", ipAddr)
}

func (a *Adapter) ListReverseDNS(ctx context.Context, vmExternalID string) ([]provider.RDNSRecord, error) {
	records, err := a.c.ListReverseDNS(ctx, vmExternalID, "")
	if err != nil {
		return nil, err
	}
	out := make([]provider.RDNSRecord, 0, len(records))
	for _, r := range records {
		out = append(out, provider.RDNSRecord{IP: r.IP, Domain: r.Domain})
	}
	return out, nil
}

func (a *Adapter) EnableBGP(ctx context.Context, vmExternalID string) error {
	return a.c.EnableBGP(ctx, vmExternalID, "")
}

func (a *Adapter) DisableBGP(ctx context.Context, vmExternalID string) error {
	return a.c.DisableBGP(ctx, vmExternalID, "")
}

// ---- Catalog sync ----

// locationCode derives a stable region code from an Onidel location display
// name, e.g. "Sydney" -> "sydney", "Los Angeles" -> "los-angeles".
func locationCode(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), "-"))
}

func (a *Adapter) SyncCatalog(ctx context.Context) ([]provider.CatalogInstanceType, []provider.CatalogOSTemplate, []provider.CatalogLocation, error) {
	instanceTypes, err := a.c.ListInstanceTypes(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	osTemplates, err := a.c.ListOSTemplates(ctx)
	if err != nil {
		return nil, nil, nil, err
	}

	catalogTypes := make([]provider.CatalogInstanceType, 0, len(instanceTypes))
	locationNames := map[string]struct{}{}
	for _, it := range instanceTypes {
		locations := make([]string, 0, len(it.Locations))
		for _, l := range it.Locations {
			name := strings.TrimSpace(l)
			if name == "" {
				continue
			}
			locations = append(locations, name)
			locationNames[name] = struct{}{}
		}
		sort.Strings(locations)
		catalogTypes = append(catalogTypes, provider.CatalogInstanceType{
			ExternalID:  it.ID,
			Code:        it.Type,
			Name:        it.Type,
			Category:    it.CPU,
			MaxVCPU:     it.MaxVCPU,
			MaxRAM:      it.MaxRAM,
			MaxDisk:     it.MaxDisk,
			NetworkRate: it.NetworkRate,
			Locations:   locations,
		})
	}

	catalogOS := make([]provider.CatalogOSTemplate, 0, len(osTemplates))
	for _, t := range osTemplates {
		catalogOS = append(catalogOS, provider.CatalogOSTemplate{
			ExternalID: strconv.FormatInt(t.ID, 10),
			Name:       t.Name,
			Family:     t.Family,
		})
	}

	names := make([]string, 0, len(locationNames))
	for name := range locationNames {
		names = append(names, name)
	}
	sort.Strings(names)
	catalogLocations := make([]provider.CatalogLocation, 0, len(names))
	for _, name := range names {
		catalogLocations = append(catalogLocations, provider.CatalogLocation{Name: name, Code: locationCode(name)})
	}

	return catalogTypes, catalogOS, catalogLocations, nil
}

// ---- Extended capability surface: Onidel does not expose these upstream ----
// Each rejection names what is missing so the API can surface an honest 501
// instead of a silent behavior gap.

func onidelUnsupported(op string) error {
	return apperrors.Newf(apperrors.CodeUnsupported, "%s is not supported by the onidel provider", op)
}

func (a *Adapter) ResetVM(ctx context.Context, externalID string) error {
	return onidelUnsupported("vm reset")
}

func (a *Adapter) PauseVM(ctx context.Context, externalID string) error {
	return onidelUnsupported("vm pause")
}

func (a *Adapter) ResumeVM(ctx context.Context, externalID string) error {
	return onidelUnsupported("vm resume")
}

func (a *Adapter) HibernateVM(ctx context.Context, externalID string) error {
	return onidelUnsupported("vm hibernate")
}

func (a *Adapter) SerialConsole(ctx context.Context, vmExternalID string) (string, int64, error) {
	return "", 0, onidelUnsupported("serial console")
}

func (a *Adapter) CloneVM(ctx context.Context, externalID, newName string) error {
	return onidelUnsupported("vm clone")
}

func (a *Adapter) ConvertToTemplate(ctx context.Context, externalID string) error {
	return onidelUnsupported("convert to template")
}

func (a *Adapter) MoveVolume(ctx context.Context, externalID, volume, targetStorage string) error {
	return onidelUnsupported("move volume")
}

func (a *Adapter) VMNotes(ctx context.Context, externalID string) (string, error) {
	return "", onidelUnsupported("vm notes")
}

func (a *Adapter) SetVMNotes(ctx context.Context, externalID, notes string) error {
	return onidelUnsupported("vm notes update")
}

func (a *Adapter) VMTags(ctx context.Context, externalID string) ([]string, error) {
	return nil, onidelUnsupported("vm tags")
}

func (a *Adapter) SetVMTags(ctx context.Context, externalID string, tags []string) error {
	return onidelUnsupported("vm tags update")
}

func (a *Adapter) CloudInitRegenerate(ctx context.Context, externalID string) error {
	return onidelUnsupported("cloudinit regenerate")
}

func (a *Adapter) GuestMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	return nil, onidelUnsupported("guest metrics")
}

func (a *Adapter) GuestAgentPing(ctx context.Context, externalID string) error {
	return onidelUnsupported("guest agent ping")
}

func (a *Adapter) GuestAgentOSInfo(ctx context.Context, externalID string) (any, error) {
	return nil, onidelUnsupported("guest agent osinfo")
}

func (a *Adapter) GuestAgentFSInfo(ctx context.Context, externalID string) (any, error) {
	return nil, onidelUnsupported("guest agent fsinfo")
}

func (a *Adapter) GuestAgentInfo(ctx context.Context, externalID string) (any, error) {
	return nil, onidelUnsupported("guest agent info")
}

func (a *Adapter) FirewallRulesList(ctx context.Context, externalID string) ([]provider.ProviderFirewallRule, error) {
	return nil, onidelUnsupported("vm firewall rules")
}

func (a *Adapter) CreateFirewallRule(ctx context.Context, externalID string, rule provider.ProviderFirewallRule) error {
	return onidelUnsupported("vm firewall rule create")
}

func (a *Adapter) DeleteFirewallRule(ctx context.Context, externalID string, pos int) error {
	return onidelUnsupported("vm firewall rule delete")
}

func (a *Adapter) FirewallOptionsMap(ctx context.Context, externalID string) (map[string]any, error) {
	return nil, onidelUnsupported("vm firewall options")
}

func (a *Adapter) SetFirewallOptionsMap(ctx context.Context, externalID string, opts map[string]any) error {
	return onidelUnsupported("vm firewall options set")
}

func (a *Adapter) FirewallIPSetsList(ctx context.Context, externalID string) ([]provider.ProviderIPSet, error) {
	return nil, onidelUnsupported("vm firewall ipsets")
}

func (a *Adapter) CreateFirewallIPSet(ctx context.Context, externalID, name, comment string) error {
	return onidelUnsupported("vm firewall ipset create")
}

func (a *Adapter) DeleteFirewallIPSet(ctx context.Context, externalID, name string, force bool) error {
	return onidelUnsupported("vm firewall ipset delete")
}

func (a *Adapter) FirewallIPSetEntriesList(ctx context.Context, externalID, name string) ([]provider.ProviderIPSetEntry, error) {
	return nil, onidelUnsupported("vm firewall ipset entries")
}

func (a *Adapter) AddFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, comment string) error {
	return onidelUnsupported("vm firewall ipset entry add")
}

func (a *Adapter) UpdateFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, newCIDR, comment string) error {
	return onidelUnsupported("vm firewall ipset entry update")
}

func (a *Adapter) RemoveFirewallIPSetEntry(ctx context.Context, externalID, name, cidr string) error {
	return onidelUnsupported("vm firewall ipset entry remove")
}

// ---- Containers (LXC): Onidel does not sell LXC containers upstream ----

func (a *Adapter) ProvisionContainer(ctx context.Context, spec provider.InstanceSpec) error {
	return onidelUnsupported("container provisioning")
}

func (a *Adapter) StartContainer(ctx context.Context, externalID string) error {
	return onidelUnsupported("container start")
}

func (a *Adapter) StopContainer(ctx context.Context, externalID string, force bool) error {
	return onidelUnsupported("container stop")
}

func (a *Adapter) RebootContainer(ctx context.Context, externalID string) error {
	return onidelUnsupported("container reboot")
}

func (a *Adapter) DestroyContainer(ctx context.Context, externalID string) error {
	return onidelUnsupported("container destroy")
}

func (a *Adapter) MigrateContainer(ctx context.Context, externalID, targetNode string) error {
	return onidelUnsupported("container migration")
}

func (a *Adapter) ContainerSerialConsole(ctx context.Context, externalID string) (string, int64, error) {
	return "", 0, onidelUnsupported("container serial console")
}

func (a *Adapter) ContainerSnapshotCreate(ctx context.Context, externalID, name, desc string) (string, error) {
	return "", onidelUnsupported("container snapshot create")
}

func (a *Adapter) ContainerSnapshotsList(ctx context.Context, externalID string) ([]provider.ProviderSnapshot, error) {
	return nil, onidelUnsupported("container snapshots list")
}

func (a *Adapter) ContainerSnapshotDelete(ctx context.Context, snapshotExtID string) error {
	return onidelUnsupported("container snapshot delete")
}

func (a *Adapter) ContainerSnapshotRollback(ctx context.Context, externalID, snapshotExtID string) error {
	return onidelUnsupported("container snapshot rollback")
}

func (a *Adapter) ContainerMetrics(ctx context.Context, externalID, timeframe string) (any, error) {
	return nil, onidelUnsupported("container metrics")
}
