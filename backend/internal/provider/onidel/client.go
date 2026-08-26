// Package onidel implements the ComputeProvider interface against the Onidel Cloud API.
package onidel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        50,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("onidel: status=%d body=%s", e.StatusCode, e.Body)
}

// do performs an HTTP request with retries on safe operations.
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var payload []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = b
	}
	maxAttempts := 1
	if method == http.MethodGet || method == http.MethodDelete {
		maxAttempts = 3
	}
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * 200 * time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Token "+c.apiKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("onidel request: %w", err)
			continue
		}
		defer resp.Body.Close()
		respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if resp.StatusCode >= 400 {
			return &APIError{StatusCode: resp.StatusCode, Body: string(respBytes)}
		}
		if out != nil && len(respBytes) > 0 {
			if err := json.Unmarshal(respBytes, out); err != nil {
				return fmt.Errorf("decode response: %w", err)
			}
		}
		return nil
	}
	return lastErr
}

// ---- Teams ----

type Team struct {
	ID   uuidStr `json:"id"`
	Name string  `json:"name"`
	Role string  `json:"role"`
}

type uuidStr = string

func (c *Client) ListTeams(ctx context.Context) ([]Team, error) {
	var out []Team
	err := c.do(ctx, http.MethodGet, "/teams", nil, &out)
	return out, err
}

// ---- SSH Keys ----

type SSHKey struct {
	ID      string `json:"id"`
	Created string `json:"created"`
	Name    string `json:"name"`
	SSHKey  string `json:"ssh_key"`
}

func (c *Client) ListSSHKeys(ctx context.Context, teamID string) ([]SSHKey, error) {
	q := ""
	if teamID != "" {
		q = "?team_id=" + teamID
	}
	var wrapper struct {
		SSHKeys []SSHKey `json:"ssh_keys"`
	}
	err := c.do(ctx, http.MethodGet, "/ssh_keys"+q, nil, &wrapper)
	return wrapper.SSHKeys, err
}

func (c *Client) CreateSSHKey(ctx context.Context, teamID, name, publicKey string) (*SSHKey, error) {
	var wrapper struct {
		SSHKey SSHKey `json:"ssh_key"`
	}
	body := map[string]string{"team_id": teamID, "name": name, "ssh_key": publicKey}
	err := c.do(ctx, http.MethodPost, "/ssh_keys", body, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.SSHKey, nil
}

func (c *Client) DeleteSSHKey(ctx context.Context, sshKeyID, teamID string) error {
	path := "/ssh_keys/" + sshKeyID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- VMs ----

type VM struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Vcpu            int64   `json:"vcpu"`
	Ram             int64   `json:"ram"`
	Disk            int64   `json:"disk"`
	BwUsed          float64 `json:"bw_used"`
	MainIPv4        string  `json:"main_ipv4"`
	MainIPv6        string  `json:"main_ipv6"`
	Template        string  `json:"template"`
	FirewallGroupID *string `json:"firewall_group_id"`
	CreatedAt       string  `json:"created_at"`
	RenewedAt       string  `json:"renewed_at"`
	DueDate         string  `json:"due_date"`
	RecurringAmount float64 `json:"recurring_amount"`
	PaymentCurrency string  `json:"payment_currency"`
	BillingCycle    int64   `json:"billing_cycle"`
	Status          string  `json:"status"`
}

type NewVMRequest struct {
	Name               string   `json:"name,omitempty"`
	PaymentCycle       string   `json:"payment_cycle,omitempty"`
	InstanceType       string   `json:"instance_type,omitempty"`
	Location           string   `json:"location,omitempty"`
	CPU                int64    `json:"cpu,omitempty"`
	RAM                int64    `json:"ram,omitempty"`
	Disk               int64    `json:"disk,omitempty"`
	OS                 *int64   `json:"os,omitempty"`
	SnapshotID         string   `json:"snapshot_id,omitempty"`
	IsoID              string   `json:"iso_id,omitempty"`
	TeamID             string   `json:"team_id,omitempty"`
	SSHKeys            []string `json:"ssh_keys,omitempty"`
	VPCs               []string `json:"vpcs,omitempty"`
	FirewallGroupID    string   `json:"firewall_group_id,omitempty"`
	IPv6               bool     `json:"ipv6,omitempty"`
	DisableSSHBlocking bool     `json:"disable_ssh_blocking,omitempty"`
	StartupScriptID    string   `json:"startup_script_id,omitempty"`
}

func (c *Client) ProvisionVM(ctx context.Context, req NewVMRequest) error {
	return c.do(ctx, http.MethodPost, "/vm", req, nil)
}

func (c *Client) GetVM(ctx context.Context, vmID string) (*VM, error) {
	var vm VM
	err := c.do(ctx, http.MethodGet, "/vm/"+vmID, nil, &vm)
	if err != nil {
		return nil, err
	}
	return &vm, nil
}

func (c *Client) ListVMs(ctx context.Context, teamID string) ([]VM, error) {
	q := ""
	if teamID != "" {
		q = "?team_id=" + teamID
	}
	var vms []VM
	err := c.do(ctx, http.MethodGet, "/vm"+q, nil, &vms)
	return vms, err
}

func (c *Client) PatchVM(ctx context.Context, vmID string, patch map[string]any) error {
	return c.do(ctx, http.MethodPatch, "/vm/"+vmID, patch, nil)
}

func (c *Client) DestroyVM(ctx context.Context, vmID string) error {
	return c.do(ctx, http.MethodDelete, "/vm/"+vmID, nil, nil)
}

func (c *Client) StopVM(ctx context.Context, vmID, teamID string, force bool) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/stop",
		map[string]any{"team_id": teamID, "force_stop": force}, nil)
}

func (c *Client) RebootVM(ctx context.Context, vmID, teamID string, force bool) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/reboot",
		map[string]any{"team_id": teamID, "force_stop": force}, nil)
}

func (c *Client) CreateVNCSession(ctx context.Context, vmID, teamID string) (url string, expireAt int64, err error) {
	var out struct {
		VNCURL   string `json:"vnc_url"`
		ExpireAt int64  `json:"expire_at"`
	}
	err = c.do(ctx, http.MethodPost, "/vm/"+vmID+"/vnc", map[string]any{"team_id": teamID}, &out)
	return out.VNCURL, out.ExpireAt, err
}

// ---- Snapshots / Backups ----

type Snapshot struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	Size      int64  `json:"size"`
	Status    string `json:"status"`
}

func (c *Client) TakeSnapshot(ctx context.Context, vmID, teamID, name, desc string) (snapshotID string, err error) {
	var out struct {
		SnapshotID string `json:"snapshot_id"`
	}
	body := map[string]any{"team_id": teamID, "name": name, "desc": desc}
	err = c.do(ctx, http.MethodPost, "/vm/"+vmID+"/snapshot", body, &out)
	return out.SnapshotID, err
}

func (c *Client) ListSnapshots(ctx context.Context) ([]Snapshot, error) {
	var snaps []Snapshot
	err := c.do(ctx, http.MethodGet, "/snapshots", nil, &snaps)
	return snaps, err
}

func (c *Client) DeleteSnapshot(ctx context.Context, snapshotID, teamID string) error {
	path := "/snapshots/" + snapshotID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) RestoreFromSnapshot(ctx context.Context, vmID, teamID, snapshotID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/restore-snapshot",
		map[string]any{"team_id": teamID, "snapshot_id": snapshotID}, nil)
}

func (c *Client) RestoreFromBackup(ctx context.Context, vmID, teamID, backupID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/restore-backup",
		map[string]any{"team_id": teamID, "backup_id": backupID}, nil)
}

type Backup struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
	Size      int64  `json:"size"`
	Instance  string `json:"instance"`
	Status    string `json:"status"`
}

func (c *Client) ListBackups(ctx context.Context) ([]Backup, error) {
	var backups []Backup
	err := c.do(ctx, http.MethodGet, "/backups", nil, &backups)
	return backups, err
}

func (c *Client) GenSnapshotDownloadURL(ctx context.Context, snapshotID string) (string, error) {
	var out struct {
		URL string `json:"url"`
	}
	err := c.do(ctx, http.MethodPost, "/snapshots/"+snapshotID, nil, &out)
	return out.URL, err
}

func (c *Client) GenBackupDownloadURL(ctx context.Context, backupID string) (string, error) {
	var out struct {
		URL string `json:"url"`
	}
	err := c.do(ctx, http.MethodPost, "/backups/"+backupID, nil, &out)
	return out.URL, err
}

// ---- VPC ----

type VPC struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Description      string  `json:"description"`
	DateCreated      string  `json:"date_created"`
	Status           string  `json:"status"`
	Location         string  `json:"location"`
	V4Subnet         string  `json:"v4_subnet"`
	V4SubnetMask     string  `json:"v4_subnet_mask"`
	AttachedVMsCount int     `json:"attached_vms_count"`
	OwnerTeam        VPCTeam `json:"owner_team"`
}

type VPCTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (c *Client) ListVPCs(ctx context.Context, teamID string) ([]VPC, error) {
	q := ""
	if teamID != "" {
		q = "?team_id=" + teamID
	}
	var wrapper struct {
		VPCs []VPC `json:"vpcs"`
	}
	err := c.do(ctx, http.MethodGet, "/network/vpcs"+q, nil, &wrapper)
	return wrapper.VPCs, err
}

func (c *Client) CreateVPC(ctx context.Context, teamID, location, name, desc, v4Subnet, v4Mask string) error {
	body := map[string]any{
		"team_id": teamID, "location": location, "name": name,
		"description": desc, "v4_subnet": v4Subnet, "v4_subnet_mask": v4Mask,
	}
	return c.do(ctx, http.MethodPost, "/network/vpcs", body, nil)
}

func (c *Client) UpdateVPC(ctx context.Context, vpcID, teamID, name, desc string) error {
	return c.do(ctx, http.MethodPatch, "/network/vpcs/"+vpcID,
		map[string]any{"team_id": teamID, "name": name, "description": desc}, nil)
}

func (c *Client) DeleteVPC(ctx context.Context, vpcID, teamID string) error {
	path := "/network/vpcs/" + vpcID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- Firewall ----

type FirewallGroup struct {
	ID            string `json:"id"`
	Description   string `json:"description"`
	Created       string `json:"created"`
	Updated       string `json:"updated"`
	InstanceCount int    `json:"instance_count"`
	RuleCount     int    `json:"rule_count"`
}

func (c *Client) ListFirewalls(ctx context.Context, teamID string) ([]FirewallGroup, error) {
	q := ""
	if teamID != "" {
		q = "?team_id=" + teamID
	}
	var wrapper struct {
		FirewallGroups []FirewallGroup `json:"firewall_groups"`
	}
	err := c.do(ctx, http.MethodGet, "/network/firewalls"+q, nil, &wrapper)
	return wrapper.FirewallGroups, err
}

func (c *Client) CreateFirewall(ctx context.Context, teamID, description string) (*FirewallGroup, error) {
	var wrapper struct {
		FirewallGroup FirewallGroup `json:"firewall_group"`
	}
	body := map[string]any{"team_id": teamID, "description": description}
	err := c.do(ctx, http.MethodPost, "/network/firewalls", body, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.FirewallGroup, nil
}

func (c *Client) UpdateFirewall(ctx context.Context, fwID, teamID, description string) error {
	return c.do(ctx, http.MethodPut, "/network/firewalls/"+fwID,
		map[string]any{"team_id": teamID, "description": description}, nil)
}

func (c *Client) DeleteFirewall(ctx context.Context, fwID, teamID string) error {
	path := "/network/firewalls/" + fwID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

type FirewallRule struct {
	ID         string `json:"id"`
	Group      string `json:"group"`
	IPType     string `json:"ip_type"`
	Action     string `json:"action"`
	Protocol   string `json:"protocol"`
	Port       string `json:"port"`
	Subnet     string `json:"subnet"`
	SubnetSize int    `json:"subnet_size"`
	Desc       string `json:"desc"`
}

func (c *Client) ListFirewallRules(ctx context.Context, firewallID, teamID string) ([]FirewallRule, error) {
	path := "/network/firewalls/" + firewallID + "/rules"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		FirewallRules []FirewallRule `json:"firewall_rules"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.FirewallRules, err
}

func (c *Client) CreateFirewallRule(ctx context.Context, firewallID, teamID, protocol, port, subnet string, subnetSize int, desc string) (*FirewallRule, error) {
	var wrapper struct {
		FirewallRule FirewallRule `json:"firewall_rule"`
	}
	body := map[string]any{
		"team_id": teamID, "protocol": protocol, "port": port,
		"subnet": subnet, "subnet_size": subnetSize, "desc": desc,
	}
	err := c.do(ctx, http.MethodPost, "/network/firewalls/"+firewallID+"/rules", body, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.FirewallRule, nil
}

func (c *Client) UpdateFirewallRule(ctx context.Context, firewallID, ruleID, teamID, desc string) error {
	return c.do(ctx, http.MethodPatch, "/network/firewalls/"+firewallID+"/rules/"+ruleID,
		map[string]any{"team_id": teamID, "desc": desc}, nil)
}

func (c *Client) DeleteFirewallRule(ctx context.Context, firewallID, ruleID, teamID string) error {
	path := "/network/firewalls/" + firewallID + "/rules/" + ruleID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- IP Lists ----

type IPListEntry struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
}

type IPListSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	EntryCount  int    `json:"entry_count"`
	UsedByCount int    `json:"used_by_count"`
	CreatedAt   string `json:"created_at"`
}

func (c *Client) ListIPLists(ctx context.Context, teamID string) ([]IPListSummary, int, int, error) {
	path := "/network/ip_lists"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		IPLists          []IPListSummary `json:"ip_lists"`
		IPListLimit      int             `json:"ip_list_limit"`
		IPListEntryLimit int             `json:"ip_list_entry_limit"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.IPLists, wrapper.IPListLimit, wrapper.IPListEntryLimit, err
}

func (c *Client) CreateIPList(ctx context.Context, teamID, name, description string) (*IPListSummary, error) {
	var wrapper struct {
		IPList IPListSummary `json:"ip_list"`
	}
	body := map[string]any{"team_id": teamID, "name": name, "description": description}
	err := c.do(ctx, http.MethodPost, "/network/ip_lists", body, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.IPList, nil
}

func (c *Client) UpdateIPList(ctx context.Context, listID, teamID, name, description string) error {
	return c.do(ctx, http.MethodPatch, "/network/ip_lists/"+listID,
		map[string]any{"team_id": teamID, "name": name, "description": description}, nil)
}

func (c *Client) DeleteIPList(ctx context.Context, listID, teamID string) error {
	path := "/network/ip_lists/" + listID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) AddIPListEntry(ctx context.Context, listID, teamID, ipOrCIDR string) (*IPListEntry, error) {
	var entry IPListEntry
	body := map[string]any{}
	if teamID != "" {
		body["team_id"] = teamID
	}
	body["value"] = ipOrCIDR
	err := c.do(ctx, http.MethodPost, "/network/ip_lists/"+listID+"/entries", body, &entry)
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func (c *Client) DeleteIPListEntry(ctx context.Context, listID, entryID, teamID string) error {
	path := "/network/ip_lists/" + listID + "/entries/" + entryID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- Catalog: OS templates, Instance types, Price ----

type OSTemplate struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Family string `json:"family"`
}

func (c *Client) ListOSTemplates(ctx context.Context) ([]OSTemplate, error) {
	var out []OSTemplate
	err := c.do(ctx, http.MethodGet, "/os_templates", nil, &out)
	return out, err
}

type InstanceType struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	CPU         string   `json:"cpu"`
	MaxVCPU     int64    `json:"max_vcpu"`
	MaxRAM      int64    `json:"max_ram"`
	MaxDisk     int64    `json:"max_disk"`
	NetworkRate float64  `json:"network_rate"`
	Locations   []string `json:"locations"`
}

func (c *Client) ListInstanceTypes(ctx context.Context) ([]InstanceType, error) {
	var out []InstanceType
	err := c.do(ctx, http.MethodGet, "/instance_types", nil, &out)
	return out, err
}

type VMPrice struct {
	InstanceType       string  `json:"instance_type"`
	VCPU               int     `json:"vcpu"`
	Ram                int     `json:"ram"`
	Disk               int     `json:"disk"`
	BW                 int     `json:"bw"`
	NetRate            int     `json:"net_rate"`
	PricePerMonth      float64 `json:"price_per_month"`
	PricePerQuarter    float64 `json:"price_per_quarter"`
	PricePerSemiannual float64 `json:"price_per_semiannual"`
	PricePerAnnual     float64 `json:"price_per_annual"`
	Currency           string  `json:"currency"`
}

func (c *Client) GetVMPrice(ctx context.Context, instanceTypeUUID string, vcpu, ram, disk int, location, currency string) (*VMPrice, error) {
	q := fmt.Sprintf("?instance_type=%s&vcpu=%d&ram=%d&disk=%d&location=%s",
		instanceTypeUUID, vcpu, ram, disk, location)
	if currency != "" {
		q += "&currency=" + currency
	}
	var p VMPrice
	err := c.do(ctx, http.MethodGet, "/instance_price"+q, nil, &p)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ---- Reserved IPs ----

type ReservedIP struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Location   string `json:"location"`
	Status     string `json:"status"`
	Attachment *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"attachment"`
	BillingCycle     int     `json:"billing_cycle"`
	RenewalDate      string  `json:"renewal_date"`
	LastRenewal      string  `json:"last_renewal"`
	RecurringAmount  float64 `json:"recurring_amount"`
	Currency         string  `json:"currency"`
	TotalBilled      float64 `json:"total_billed"`
	IPAddr           string  `json:"ip_addr"`
	SuspensionReason string  `json:"suspension_reason"`
}

func (c *Client) ListReservedIPs(ctx context.Context, teamID string) ([]ReservedIP, error) {
	path := "/network/reserved_ips"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		ReservedIPs []ReservedIP `json:"reserved_ips"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.ReservedIPs, err
}

func (c *Client) CreateReservedIP(ctx context.Context, teamID, location, name, ipType string) (ripID, ipAddr string, err error) {
	var out struct {
		RipID  string `json:"rip_id"`
		IPAddr string `json:"ip_addr"`
	}
	body := map[string]any{"team_id": teamID, "location": location}
	if name != "" {
		body["name"] = name
	}
	if ipType != "" {
		body["ip_type"] = ipType
	}
	err = c.do(ctx, http.MethodPost, "/network/reserved_ips", body, &out)
	return out.RipID, out.IPAddr, err
}

func (c *Client) ConvertPrimaryIP(ctx context.Context, teamID, ipAddress, name string) (*ReservedIP, error) {
	var out ReservedIP
	body := map[string]any{"team_id": teamID, "ip_address": ipAddress}
	if name != "" {
		body["name"] = name
	}
	var wrapper struct {
		ReservedIP ReservedIP `json:"reserved_ip"`
	}
	if err := c.do(ctx, http.MethodPost, "/network/reserved_ips/convert", body, &wrapper); err != nil {
		return nil, err
	}
	out = wrapper.ReservedIP
	return &out, nil
}

func (c *Client) DeleteReservedIP(ctx context.Context, ripID, teamID string) error {
	path := "/network/reserved_ips/" + ripID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) PatchReservedIP(ctx context.Context, ripID, teamID, name, anchorIP string) error {
	body := map[string]any{}
	if name != "" {
		body["name"] = name
	}
	if anchorIP != "" {
		body["anchor_ip"] = anchorIP
	} else {
		body["anchor_ip"] = nil // detach
	}
	return c.do(ctx, http.MethodPatch, "/network/reserved_ips/"+ripID, body, nil)
}

// ---- Startup Scripts ----

// StartupScript mirrors Onidel's StartupScriptSummary/Detail: listing omits
// content (use GetStartupScript), timestamps use created/updated.
type StartupScript struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content,omitempty"`
	Created string `json:"created"`
	Updated string `json:"updated"`
}

func (c *Client) ListStartupScripts(ctx context.Context, teamID string) ([]StartupScript, error) {
	path := "/startup_scripts"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		Scripts []StartupScript `json:"scripts"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.Scripts, err
}

// GetStartupScript fetches the full detail (including content) of a script.
func (c *Client) GetStartupScript(ctx context.Context, scriptID string) (*StartupScript, error) {
	var wrapper struct {
		Script StartupScript `json:"script"`
	}
	err := c.do(ctx, http.MethodGet, "/startup_scripts/"+scriptID, nil, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.Script, nil
}

func (c *Client) CreateStartupScript(ctx context.Context, teamID, name, content string) (*StartupScript, error) {
	var wrapper struct {
		Script StartupScript `json:"startup_script"`
	}
	body := map[string]any{"team_id": teamID, "name": name, "content": content}
	err := c.do(ctx, http.MethodPost, "/startup_scripts", body, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.Script, nil
}

func (c *Client) UpdateStartupScript(ctx context.Context, scriptID, teamID, name, content string) error {
	return c.do(ctx, http.MethodPatch, "/startup_scripts/"+scriptID,
		map[string]any{"team_id": teamID, "name": name, "content": content}, nil)
}

func (c *Client) DeleteStartupScript(ctx context.Context, scriptID, teamID string) error {
	path := "/startup_scripts/" + scriptID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- Custom ISO ----

type CustomISO struct {
	ID          string `json:"id"`
	DateCreated string `json:"date_created"`
	Filename    string `json:"filename"`
	Name        string `json:"name"`
	Desc        string `json:"desc"`
	Size        int64  `json:"size"`
	Status      int    `json:"status"`
	IsSystemISO bool   `json:"is_system_iso"`
}

func (c *Client) ListISOs(ctx context.Context, teamID string) ([]CustomISO, error) {
	path := "/isos"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		Isos []CustomISO `json:"isos"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.Isos, err
}

func (c *Client) CreateISO(ctx context.Context, teamID, url string) error {
	return c.do(ctx, http.MethodPost, "/isos", map[string]any{"team_id": teamID, "url": url}, nil)
}

func (c *Client) DeleteISO(ctx context.Context, isoID, teamID string) error {
	path := "/isos/" + isoID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- Measured Boot Images ----

type MeasuredBootImage struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	Description string `json:"description"`
	Size        int64  `json:"size"`
	Created     string `json:"created"`
}

func (c *Client) ListMeasuredBootImages(ctx context.Context, teamID string) ([]MeasuredBootImage, error) {
	path := "/measured-boot-images"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		Files []MeasuredBootImage `json:"files"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.Files, err
}

func (c *Client) DeleteMeasuredBootImage(ctx context.Context, imageID, teamID string) error {
	path := "/measured-boot-images/" + imageID
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

// ---- Object Storage ----

type ObjectStorageService struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Location       string `json:"location"`
	Region         string `json:"region"`
	Endpoint       string `json:"endpoint"`
	CapacityKB     int64  `json:"capacity"`
	UsedCapacityKB int64  `json:"used_capacity"`
	Status         string `json:"status"`
	CreatedAt      string `json:"created_at"`
	RenewalDate    string `json:"renewal_date"`
}

func (c *Client) ListObjectStorageServices(ctx context.Context, teamID string) ([]ObjectStorageService, error) {
	path := "/object-storage"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		Services []ObjectStorageService `json:"services"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.Services, err
}

func (c *Client) CreateBucket(ctx context.Context, serviceID, teamID, bucketName string, versioning, objectLock bool) (accessKeys []struct {
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
}, err error) {
	body := map[string]any{
		"team_id": teamID, "bucket_name": bucketName,
		"versioning": versioning, "object_lock": objectLock,
	}
	var out struct {
		Keys []struct {
			AccessKey string `json:"access_key"`
			SecretKey string `json:"secret_key"`
		} `json:"keys"`
	}
	err = c.do(ctx, http.MethodPost, "/object-storage/"+serviceID+"/buckets", body, &out)
	return out.Keys, err
}

func (c *Client) ListBucketAccessKeys(ctx context.Context, serviceID, bucketName, teamID string) ([]struct {
	AccessKey string `json:"access_key"`
	SecretKey string `json:"secret_key"`
}, error) {
	path := "/object-storage/" + serviceID + "/buckets/" + bucketName + "/access_keys"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var out struct {
		Keys []struct {
			AccessKey string `json:"access_key"`
			SecretKey string `json:"secret_key"`
		} `json:"keys"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &out)
	return out.Keys, err
}

// ---- rDNS / BGP / measured boot attach ----

type RDNSRecord struct {
	IP     string `json:"ip"`
	Domain string `json:"domain"`
}

func (c *Client) ListReverseDNS(ctx context.Context, vmID, teamID string) ([]RDNSRecord, error) {
	path := "/vm/" + vmID + "/rdns"
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	var wrapper struct {
		Rdns []RDNSRecord `json:"rdns"`
	}
	err := c.do(ctx, http.MethodGet, path, nil, &wrapper)
	return wrapper.Rdns, err
}

func (c *Client) SetReverseDNS(ctx context.Context, vmID, teamID, ipAddr, domain string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/rdns",
		map[string]any{"team_id": teamID, "ip_addr": ipAddr, "domain": domain}, nil)
}

func (c *Client) DeleteReverseDNS(ctx context.Context, vmID, teamID, ipAddr string) error {
	path := "/vm/" + vmID + "/rdns/" + ipAddr
	if teamID != "" {
		path += "?team_id=" + teamID
	}
	return c.do(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) EnableBGP(ctx context.Context, vmID, teamID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/enable-bgp", map[string]any{"team_id": teamID}, nil)
}

func (c *Client) DisableBGP(ctx context.Context, vmID, teamID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/disable-bgp", map[string]any{"team_id": teamID}, nil)
}

func (c *Client) AttachMeasuredBoot(ctx context.Context, vmID, teamID, ukiImageID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/attach-measured-boot",
		map[string]any{"team_id": teamID, "uki_image_id": ukiImageID}, nil)
}

func (c *Client) DetachMeasuredBoot(ctx context.Context, vmID, teamID string) error {
	return c.do(ctx, http.MethodPost, "/vm/"+vmID+"/detach-measured-boot",
		map[string]any{"team_id": teamID}, nil)
}
