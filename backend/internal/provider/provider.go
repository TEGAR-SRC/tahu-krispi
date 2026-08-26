// Package provider defines the ComputeProvider abstraction that decouples
// Kilat Cloud business logic from concrete cloud providers such as Onidel.
//
// Business logic must depend on this package only; provider-specific HTTP
// details stay inside the per-provider adapters (internal/provider/onidel, ...).
package provider

import (
	"context"
	"io"
	"sync"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// InstanceSpec describes a VM to provision on the underlying provider.
type InstanceSpec struct {
	ExternalTeamID         string
	Name                   string
	PaymentCycle           string
	Location               string
	InstanceTypeExternalID string
	CPU                    int64
	RAM                    int64
	Disk                   int64
	OSExternalID           *int64
	SnapshotExternalID     string
	IsoExternalID          string
	SSHKeyIDs              []string
	VPCIDs                 []string
	FirewallGroupID        string
	StartupScriptID        string
	IPv6                   bool
	DisableSSHBlocking     bool
}

// VMState is the normalized view of a provider virtual machine.
type VMState struct {
	ExternalID      string
	Name            string
	Status          string // Kilat Cloud status (provisioning/active/suspended/pending/deleting)
	PowerStatus     string // empty when the provider does not report it
	MainIPv4        string
	MainIPv6        string
	Template        string
	VCPU            int64
	RAM             int64 // MB
	Disk            int64 // GB
	BWUsed          float64
	RecurringAmount float64
	Currency        string
}

// ProviderSnapshot is a normalized VM snapshot.
type ProviderSnapshot struct {
	ExternalID string
	Name       string
	Desc       string
	CreatedAt  string
	Status     string
	Size       int64
}

// ProviderBackup is a normalized automatic VM backup.
type ProviderBackup struct {
	ExternalID         string
	CreatedAt          string
	InstanceExternalID string
	Status             string
	Size               int64
}

// ProviderSSHKey is a normalized SSH public key registered with the provider.
type ProviderSSHKey struct {
	ExternalID string
	Name       string
	PublicKey  string
}

// ProviderScript is a normalized startup script registered with the provider.
type ProviderScript struct {
	ExternalID string
	Name       string
	Content    string
}

// ISOImage is a normalized custom ISO image.
type ISOImage struct {
	ExternalID      string
	Filename        string
	Name            string
	Desc            string
	Size            int64
	ProgressPercent int
	IsSystem        bool
}

// MeasuredBootImage is a normalized UKI image used for SEV-SNP measured boot.
type MeasuredBootImage struct {
	ExternalID  string
	Filename    string
	Description string
	Size        int64
}

// StorageServiceInfo is a normalized object storage service.
type StorageServiceInfo struct {
	ExternalID string
	Name       string
	Endpoint   string
	Status     string
	CapacityKB int64
	UsedKB     int64
}

// BucketKey is an S3-compatible access key pair for one bucket.
type BucketKey struct {
	AccessKey string
	SecretKey string
}

// RDNSRecord is a reverse DNS entry attached to a VM address.
type RDNSRecord struct {
	IP     string
	Domain string
}

// ProviderReservedIP is a normalized reserved (floating) IP.
type ProviderReservedIP struct {
	ExternalID           string
	Name                 string
	Location             string
	Status               string
	Address              string
	AttachedVMExternalID string
	RecurringAmount      float64
	Currency             string
}

// CatalogInstanceType is a provider instance type used to upsert instance_types.
type CatalogInstanceType struct {
	ExternalID  string
	Code        string // e.g. "vhp"
	Name        string
	Category    string // CPU family, e.g. "amd"
	MaxVCPU     int64
	MaxRAM      int64   // MB
	MaxDisk     int64   // GB
	NetworkRate float64 // Mbps (Onidel sends e.g. 128.0)
	Locations   []string
}

// CatalogOSTemplate is a provider OS template used to upsert os_templates.
type CatalogOSTemplate struct {
	ExternalID string
	Name       string
	Family     string
}

// CatalogLocation is a provider location used to upsert regions.
type CatalogLocation struct {
	Code string
	Name string
}

// ProviderFirewallRule is the normalized form of one provider-level VM
// firewall rule. Pos is the provider position used for delete ordering.
type ProviderFirewallRule struct {
	Pos         int
	Enabled     bool
	Type        string // "in" | "out"
	Action      string // ACCEPT | DROP | REJECT
	Source      string
	Destination string
	Proto       string
	DestPort    string
	SourcePort  string
	Comment     string
}

// ProviderIPSet is one named address group of the PVE-native VM firewall
// (GET/POST/DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset).
type ProviderIPSet struct {
	Name    string
	Comment string
}

// ProviderIPSetEntry is one CIDR row inside a ProviderIPSet.
type ProviderIPSetEntry struct {
	CIDR    string
	Comment string
}

// ResizePolicy declares what spec changes a provider permits on an existing
// VM. Onidel forbids downgrades; other providers may allow free up/downgrades,
// so the policy is queried per provider instead of hardcoded in business logic.
type ResizePolicy struct {
	AllowDowngrade bool
}

// ComputeProvider is the capability surface Kilat Cloud expects from any
// infrastructure provider. All external IDs are provider-scoped identifiers.
type ComputeProvider interface {
	Code() string

	ResizePolicy() ResizePolicy

	ProvisionVM(ctx context.Context, spec InstanceSpec) error
	GetVM(ctx context.Context, externalID string) (*VMState, error)
	ListVMs(ctx context.Context, teamExternalID string) ([]VMState, error)
	PatchVM(ctx context.Context, externalID string, fields map[string]any) error
	DestroyVM(ctx context.Context, externalID string) error
	StopVM(ctx context.Context, externalID string, force bool) error
	RebootVM(ctx context.Context, externalID string, force bool) error

	// StartVM powers a stopped VM back on. Providers whose upstream API has
	// no start endpoint (Onidel exposes only stop/reboot under /vm/{id})
	// reject with PROVIDER_UNSUPPORTED instead of faking success.
	StartVM(ctx context.Context, externalID string) error

	// MigrateVM moves a VM to targetNode — for self-hosted clusters such as
	// Proxmox this is the destination node name within the same cluster.
	// Providers that own placement entirely themselves (Onidel) reject with
	// PROVIDER_UNSUPPORTED because customers cannot choose a target host.
	MigrateVM(ctx context.Context, externalID, targetNode string) error
	ResetVM(ctx context.Context, externalID string) error
	PauseVM(ctx context.Context, externalID string) error
	ResumeVM(ctx context.Context, externalID string) error
	HibernateVM(ctx context.Context, externalID string) error

	SerialConsole(ctx context.Context, vmExternalID string) (url string, expireUnix int64, err error)

	CloneVM(ctx context.Context, externalID, newName string) error
	ConvertToTemplate(ctx context.Context, externalID string) error
	MoveVolume(ctx context.Context, externalID, volume, targetStorage string) error

	// ---- Containers (LXC) ----
	// Same lifecycle shape as VMs but scoped to container external IDs
	// ("ct<vmid>" for Proxmox). Providers that cannot sell LXC containers
	// reject with PROVIDER_UNSUPPORTED instead of faking success.
	ProvisionContainer(ctx context.Context, spec InstanceSpec) error
	StartContainer(ctx context.Context, externalID string) error
	StopContainer(ctx context.Context, externalID string, force bool) error
	RebootContainer(ctx context.Context, externalID string) error
	DestroyContainer(ctx context.Context, externalID string) error

	// MigrateContainer moves a container to targetNode within the same
	// cluster; placement-managed providers reject with PROVIDER_UNSUPPORTED.
	MigrateContainer(ctx context.Context, externalID, targetNode string) error

	ContainerSerialConsole(ctx context.Context, externalID string) (url string, expireUnix int64, err error)

	// Container snapshot ext IDs follow "<containerExtID>/<snapname>".
	ContainerSnapshotCreate(ctx context.Context, externalID, name, desc string) (snapshotExtID string, err error)
	ContainerSnapshotsList(ctx context.Context, externalID string) ([]ProviderSnapshot, error)
	ContainerSnapshotDelete(ctx context.Context, snapshotExtID string) error
	ContainerSnapshotRollback(ctx context.Context, externalID, snapshotExtID string) error

	// ContainerMetrics returns round-robin metric series for charts;
	// timeframe is provider-scoped like GuestMetrics.
	ContainerMetrics(ctx context.Context, externalID, timeframe string) (any, error)

	VMNotes(ctx context.Context, externalID string) (string, error)
	SetVMNotes(ctx context.Context, externalID, notes string) error
	VMTags(ctx context.Context, externalID string) ([]string, error)
	SetVMTags(ctx context.Context, externalID string, tags []string) error

	CloudInitRegenerate(ctx context.Context, externalID string) error

	// GuestMetrics returns round-robin metric series for charts; timeframe is
	// provider-scoped ("hour"/"day"/... for PVE).
	GuestMetrics(ctx context.Context, externalID, timeframe string) (any, error)
	GuestAgentPing(ctx context.Context, externalID string) error
	GuestAgentOSInfo(ctx context.Context, externalID string) (any, error)
	GuestAgentFSInfo(ctx context.Context, externalID string) (any, error)
	GuestAgentInfo(ctx context.Context, externalID string) (any, error)

	// Per-VM firewall normalized CRUD (PVE-native firewall).
	FirewallRulesList(ctx context.Context, externalID string) ([]ProviderFirewallRule, error)
	CreateFirewallRule(ctx context.Context, externalID string, rule ProviderFirewallRule) error
	DeleteFirewallRule(ctx context.Context, externalID string, pos int) error
	FirewallOptionsMap(ctx context.Context, externalID string) (map[string]any, error)
	SetFirewallOptionsMap(ctx context.Context, externalID string, opts map[string]any) error

	// Per-VM firewall ipset CRUD (named CIDR groups referenced by firewall
	// rules via +ipset/<name>). force on delete strips rules that still
	// reference the set instead of failing.
	FirewallIPSetsList(ctx context.Context, externalID string) ([]ProviderIPSet, error)
	CreateFirewallIPSet(ctx context.Context, externalID, name, comment string) error
	DeleteFirewallIPSet(ctx context.Context, externalID, name string, force bool) error
	FirewallIPSetEntriesList(ctx context.Context, externalID, name string) ([]ProviderIPSetEntry, error)
	AddFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, comment string) error
	UpdateFirewallIPSetEntry(ctx context.Context, externalID, name, cidr, newCIDR, comment string) error
	RemoveFirewallIPSetEntry(ctx context.Context, externalID, name, cidr string) error

	VNCSession(ctx context.Context, vmExternalID string) (url string, expireUnix int64, err error)

	CreateSnapshot(ctx context.Context, vmExternalID, name, desc string) (snapshotExtID string, err error)
	ListSnapshots(ctx context.Context) ([]ProviderSnapshot, error)
	DeleteSnapshot(ctx context.Context, snapshotExtID string) error
	RestoreFromSnapshot(ctx context.Context, vmExternalID, snapshotExtID string) error
	RestoreFromBackup(ctx context.Context, vmExternalID, backupExtID string) error
	VMBackups(ctx context.Context, vmExternalID string) ([]ProviderBackup, error)
	SnapshotDownloadURL(ctx context.Context, snapshotExtID string) (string, error)
	BackupDownloadURL(ctx context.Context, backupExtID string) (string, error)

	// EnsureSSHKey creates the key when its fingerprint is not yet known to
	// the provider and returns the existing key otherwise.
	EnsureSSHKey(ctx context.Context, teamID, name, publicKey string) (ProviderSSHKey, error)
	UpdateSSHKey(ctx context.Context, keyExtID, teamID, name, publicKey string) error
	DeleteSSHKey(ctx context.Context, keyExtID, teamID string) error

	// EnsureStartupScript returns the existing script with the given name
	// (updating its content when outdated), or creates it.
	EnsureStartupScript(ctx context.Context, teamID, name, content string) (ProviderScript, error)
	UpdateStartupScript(ctx context.Context, scriptExtID, teamID, name, content string) error
	DeleteStartupScript(ctx context.Context, scriptExtID, teamID string) error

	UploadMeasuredBootImage(ctx context.Context, teamID, filename, description string, data io.Reader, size int64) (MeasuredBootImage, error)
	ListMeasuredBootImages(ctx context.Context, teamID string) ([]MeasuredBootImage, error)
	DeleteMeasuredBootImage(ctx context.Context, imageExtID string) error
	AttachMeasuredBoot(ctx context.Context, vmExternalID, imageExtID string) error
	DetachMeasuredBoot(ctx context.Context, vmExternalID string) error

	ListISOs(ctx context.Context, teamID string) ([]ISOImage, error)
	CreateISOByURL(ctx context.Context, teamID, url string) error
	DeleteISO(ctx context.Context, isoExtID string) error

	ListReservedIPs(ctx context.Context, teamID string) ([]ProviderReservedIP, error)
	CreateReservedIP(ctx context.Context, teamID, location, name, ipType string) (extID, address string, err error)
	ConvertPrimaryIP(ctx context.Context, teamID, ipAddress, name string) (map[string]any, error)
	DeleteReservedIP(ctx context.Context, ripExtID, teamID string) error
	// PatchReservedIP renames the IP when name != "" and re-anchors it to
	// anchorIP; an empty anchorIP detaches the anchor.
	PatchReservedIP(ctx context.Context, ripExtID, teamID, name, anchorIP string) error

	ListStorageServices(ctx context.Context, teamID string) ([]StorageServiceInfo, error)
	CreateBucket(ctx context.Context, serviceExtID, teamID, bucketName string, versioning, objectLock bool) ([]BucketKey, error)
	BucketAccessKeys(ctx context.Context, serviceExtID, bucketName, teamID string) ([]BucketKey, error)

	SetReverseDNS(ctx context.Context, vmExternalID, ipAddr, domain string) error
	DeleteReverseDNS(ctx context.Context, vmExternalID, ipAddr string) error
	ListReverseDNS(ctx context.Context, vmExternalID string) ([]RDNSRecord, error)

	EnableBGP(ctx context.Context, vmExternalID string) error
	DisableBGP(ctx context.Context, vmExternalID string) error

	SyncCatalog(ctx context.Context) (instanceTypes []CatalogInstanceType, osTemplates []CatalogOSTemplate, locations []CatalogLocation, err error)
}

// BackupContentOpener is an optional capability of ComputeProvider
// implementations that can serve the raw contents of a stored backup for
// this backend to stream onward. Providers whose upstream has no presigned
// download URLs — e.g. Proxmox, whose content endpoints authenticate with a
// secret token header — implement it so handlers can pump the byte stream
// through the backend while credentials stay server-side.
type BackupContentOpener interface {
	OpenBackupContent(ctx context.Context, backupExtID string) (io.ReadCloser, int64, error)
}

var (
	mu        sync.RWMutex
	registry  = map[string]ComputeProvider{}
	factories = map[string]func() (ComputeProvider, error){}
)

// Register adds an already-constructed provider keyed by its Code().
func Register(p ComputeProvider) {
	if p == nil {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	registry[p.Code()] = p
}

// RegisterFactory registers a lazy constructor for a provider code. The first
// Lookup(code) invokes it and caches the resulting instance.
func RegisterFactory(code string, factory func() (ComputeProvider, error)) {
	if factory == nil {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	factories[code] = factory
}

// Lookup resolves a provider by code, building it through its registered
// factory when needed.
func Lookup(code string) (ComputeProvider, error) {
	mu.RLock()
	p, ok := registry[code]
	mu.RUnlock()
	if ok {
		return p, nil
	}
	mu.RLock()
	factory, ok := factories[code]
	mu.RUnlock()
	if !ok {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable, "provider %q is not registered", code)
	}
	p, err := factory()
	if err != nil {
		return nil, err
	}
	mu.Lock()
	registry[code] = p
	mu.Unlock()
	return p, nil
}
