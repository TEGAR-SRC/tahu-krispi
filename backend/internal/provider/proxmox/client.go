// Package proxmox implements the provider.ComputeProvider interface against a
// self-hosted Proxmox VE cluster (PVE 7/8+) using the
// github.com/luthermonson/go-proxmox SDK.
//
// client.go is a thin typed wrapper over the SDK covering only what the
// adapter needs. Every SDK symbol used here was verified against the module
// source of go-proxmox v0.8.1; raw HTTP calls go through the SDK's exported
// request primitives (Get/Post/Put/DeleteWithParams) for the few endpoints the
// SDK does not wrap natively (forced reboot, snapshot description, qmrestore).
package proxmox

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	goproxmox "github.com/luthermonson/go-proxmox"

	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	// apiPath is PVE's JSON API prefix; all SDK paths are relative to it.
	apiPath = "/api2/json"

	// taskPollInterval is how often WaitForTask re-polls the task status
	// endpoint. PVE tasks are seconds-scale; 200ms keeps provisioning snappy
	// without hammering pveproxy.
	taskPollInterval = 200 * time.Millisecond

	// recentTaskLimit bounds the page size of Client.RecentTasks so a busy
	// cluster cannot flood an observability caller.
	recentTaskLimit = 50
)

// Client wraps the go-proxmox SDK client and normalizes error handling,
// task waiting, and URL building for the adapter.
type Client struct {
	sdk     *goproxmox.Client
	apiRoot string // normalized "<scheme>://<host>[:port]/api2/json"
	host    string // "<scheme>://<host>[:port]" — root for user-facing URLs

	// authToken is "<tokenUser>=<tokenSecret>", the exact value the SDK
	// places behind its "Authorization: PVEAPIToken=" header. Kept so raw
	// HTTP calls the SDK does not wrap (storage content downloads)
	// authenticate identically to every other method.
	authToken string
	// downloadHTTP streams large bodies (multi-GB backup archives) and so has
	// no whole-request Timeout — ctx cancellation bounds it instead. It shares
	// the SDK client's Transport so both ride one connection pool.
	downloadHTTP *http.Client
}

// NewClient builds a Proxmox API client authenticated with an API token.
// tokenUser uses PVE's "user@realm!tokenid" format (e.g. "kilat@pam!cloud")
// and tokenSecret is the token UUID secret. baseURL may point at the host
// root or directly at the /api2/json prefix; both are normalized.
func NewClient(baseURL, tokenUser, tokenSecret string) (*Client, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "proxmox: baseURL is required")
	}
	if tokenUser == "" || tokenSecret == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "proxmox: token credentials are required")
	}
	// PVE API tokens are "user@realm!tokenid"; enforce the shape early so a
	// misconfigured credential fails at wiring time instead of as opaque 401s.
	if !strings.Contains(tokenUser, "@") || !strings.Contains(tokenUser, "!") {
		return nil, apperrors.Newf(apperrors.CodeValidation,
			"proxmox: tokenUser must be in \"user@realm!tokenid\" format, got %q", tokenUser)
	}

	root, host, err := normalizeAPIRoot(baseURL)
	if err != nil {
		return nil, err
	}

	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		MaxIdleConns:        50,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}
	sdk := goproxmox.NewClient(root,
		goproxmox.WithAPIToken(tokenUser, tokenSecret),
		goproxmox.WithHTTPClient(&http.Client{
			Timeout:   60 * time.Second,
			Transport: transport,
		}),
	)
	return &Client{
		sdk:          sdk,
		apiRoot:      root,
		host:         host,
		authToken:    tokenUser + "=" + tokenSecret,
		downloadHTTP: &http.Client{Transport: transport},
	}, nil
}

// normalizeAPIRoot trims the endpoint down to the /api2/json prefix PVE's
// SDK expects and returns the bare scheme://host for URL building.
func normalizeAPIRoot(baseURL string) (root, host string, err error) {
	raw := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.Contains(raw, "://") {
		// Self-hosted clusters almost always serve HTTPS on :8006.
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "", apperrors.Newf(apperrors.CodeValidation, "proxmox: invalid baseURL %q", baseURL)
	}
	if idx := strings.Index(u.Path, apiPath); idx >= 0 {
		u.Path = u.Path[:idx]
	}
	host = u.Scheme + "://" + u.Host
	u.Path += apiPath
	return u.String(), host, nil
}

// wrapErr maps SDK sentinel errors onto Kilat Cloud app errors.
func wrapErr(op string, err error) error {
	if err == nil {
		return nil
	}
	switch {
	case goproxmox.IsNotFound(err):
		return apperrors.Newf(apperrors.CodeNotFound, "proxmox %s: %v", op, err)
	case goproxmox.IsTimeout(err):
		return apperrors.Newf(apperrors.CodeProviderUnavailable, "proxmox %s timed out: %v", op, err)
	default:
		return apperrors.Newf(apperrors.CodeProviderUnavailable, "proxmox %s: %v", op, err)
	}
}

// Version reports the PVE version — used by health checks and fixtures tests.
func (c *Client) Version(ctx context.Context) (*goproxmox.Version, error) {
	v, err := c.sdk.Version(ctx)
	return v, wrapErr("version", err)
}

// Nodes lists cluster nodes with their online/offline status.
func (c *Client) Nodes(ctx context.Context) (goproxmox.NodeStatuses, error) {
	ns, err := c.sdk.Nodes(ctx)
	return ns, wrapErr("nodes", err)
}

// ClusterResources queries /cluster/resources with optional filters
// (e.g. "vm"). One call covers every guest across all nodes.
func (c *Client) ClusterResources(ctx context.Context, filters ...string) (goproxmox.ClusterResources, error) {
	rs, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	resources, err := rs.Resources(ctx, filters...)
	return resources, wrapErr("cluster resources", err)
}

// NextVMID asks the cluster for the next free VMID.
func (c *Client) NextVMID(ctx context.Context) (int, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return 0, wrapErr("cluster", err)
	}
	id, err := cl.NextID(ctx)
	return id, wrapErr("next vmid", err)
}

// NodeStorages lists storages visible from a node.
func (c *Client) NodeStorages(ctx context.Context, node string) (goproxmox.Storages, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	storages, err := n.Storages(ctx)
	return storages, wrapErr("storages", err)
}

// StorageContentList returns every volume on one storage (unfiltered;
// callers narrow by content type client-side).
func (c *Client) StorageContentList(ctx context.Context, node, storage string) ([]*goproxmox.StorageContent, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	content, err := st.GetContent(ctx)
	return content, wrapErr("storage content", err)
}

// StorageContentDownload opens the raw byte stream of one storage volume
// (GET .../nodes/{node}/storage/{storage}/content/{volume}). PVE answers only
// with secret token auth on this endpoint, so it cannot ride the SDK's JSON
// decoders: the response body is returned unread for streaming (backup
// archives reach multi-GB sizes). size carries Content-Length when PVE
// advertises it and -1 otherwise; the caller owns closing the reader.
func (c *Client) StorageContentDownload(ctx context.Context, node, storage, volume string) (io.ReadCloser, int64, error) {
	if node == "" || storage == "" || volume == "" {
		return nil, 0, apperrors.New(apperrors.CodeValidation,
			"proxmox storage content download: node, storage and volume are required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/nodes/%s/storage/%s/content/%s", c.apiRoot, node, storage, volume), nil)
	if err != nil {
		return nil, 0, wrapErr("storage content download", err)
	}
	// Same credential the SDK attaches to every other call (see its authHeaders).
	req.Header.Set("Authorization", "PVEAPIToken="+c.authToken)

	resp, err := c.downloadHTTP.Do(req)
	if err != nil {
		return nil, 0, wrapErr("storage content download", err)
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		return nil, 0, apperrors.Newf(apperrors.CodeNotFound,
			"proxmox storage content download: volume %q not found on node %q storage %q", volume, node, storage)
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		return nil, 0, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"proxmox storage content download: unexpected status %s %q", resp.Status, strings.TrimSpace(string(snippet)))
	}
	size := int64(-1)
	if resp.ContentLength > 0 {
		size = resp.ContentLength
	}
	return resp.Body, size, nil
}

// NodeVM loads a full VM view (status/current + config) from its node.
func (c *Client) NodeVM(ctx context.Context, node string, vmid int) (*goproxmox.VirtualMachine, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	vm, err := n.VirtualMachine(ctx, vmid)
	return vm, wrapErr("vm status", err)
}

// QEMUCreate creates a QEMU VM from flattened options and returns its task.
func (c *Client) QEMUCreate(ctx context.Context, node string, vmid int, opts []goproxmox.VirtualMachineOption) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	task, err := n.NewVirtualMachine(ctx, vmid, opts...)
	return task, wrapErr("create qemu", err)
}

// QEMUConfigSet applies config options via POST .../qemu/{vmid}/config
// (the async variant the SDK routes hotplug-capable changes through).
func (c *Client) QEMUConfigSet(ctx context.Context, node string, vmid int, opts ...goproxmox.VirtualMachineOption) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Config(ctx, opts...)
	return task, wrapErr("set config", err)
}

// QEMUConfigGet returns the raw QEMU config map (GET /nodes/{node}/qemu/{vmid}/config).
// The SDK's typed VirtualMachineConfig is flattened by PVE; decoding into a
// loose map preserves every key (cores, memory, net0, scsi0, …) without
// needing the caller to know the full schema up front.
func (c *Client) QEMUConfigGet(ctx context.Context, node string, vmid int) (map[string]any, error) {
	var out map[string]any
	if err := c.sdk.Get(ctx, fmt.Sprintf("/nodes/%s/qemu/%d/config", node, vmid), &out); err != nil {
		return nil, wrapErr("qemu config get", err)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

// QEMUConfigUpdate applies a raw key/value config patch via the synchronous
// PUT /nodes/{node}/qemu/{vmid}/config endpoint. PVE validates keys
// server-side; an empty patch is a no-op so callers can safely forward a
// user-edited map after trimming unchanged entries.
func (c *Client) QEMUConfigUpdate(ctx context.Context, node string, vmid int, data map[string]any) error {
	if len(data) == 0 {
		return apperrors.New(apperrors.CodeValidation, "proxmox: qemu config update payload is empty")
	}
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	opts := make([]goproxmox.VirtualMachineOption, 0, len(data))
	for k, v := range data {
		opts = append(opts, goproxmox.VirtualMachineOption{Name: k, Value: v})
	}
	return wrapErr("qemu config update", vm.ConfigSync(ctx, opts...))
}

// QEMUResizeDisk grows disk to size (PVE accepts absolute "Nn" units or
// "+N" increments on PUT .../qemu/{vmid}/resize).
func (c *Client) QEMUResizeDisk(ctx context.Context, node string, vmid int, disk, size string) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.ResizeDisk(ctx, disk, size)
	return task, wrapErr("resize disk", err)
}

func (c *Client) QEMUStart(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Start(ctx)
	return task, wrapErr("start", err)
}

// QEMUStop maps graceful→shutdown (ACPI), force→stop (hard power-off).
func (c *Client) QEMUStop(ctx context.Context, node string, vmid int, force bool) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	var task *goproxmox.Task
	if force {
		task, err = vm.Stop(ctx)
	} else {
		task, err = vm.Shutdown(ctx)
	}
	return task, wrapErr("stop", err)
}

// QEMUReboot maps graceful→reboot (clean guest reboot via agent/ACPI),
// force→reboot with force-stop=1 so a hung guest is killed instead of
// blocking the task. The forced variant goes through the SDK's Post
// primitive because v0.8.1's typed Reboot() takes no parameters.
func (c *Client) QEMUReboot(ctx context.Context, node string, vmid int, force bool) (*goproxmox.Task, error) {
	path := fmt.Sprintf("/nodes/%s/qemu/%d/status/reboot", node, vmid)
	var data any
	if force {
		data = map[string]int{"force-stop": 1}
	}
	return c.postTask(ctx, path, data, "reboot")
}

// QEMUMigrate migrates the VM to targetNode via POST .../qemu/{vmid}/migrate.
// Online/offline is decided by PVE itself (running guests migrate live);
// BWLimit stays nil so the datacenter migrate bandwidth limit applies — a
// plain zero would suppress all rate-limiting (SDK types.go documents this).
func (c *Client) QEMUMigrate(ctx context.Context, node string, vmid int, targetNode string) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Migrate(ctx, &goproxmox.VirtualMachineMigrateOptions{Target: targetNode})
	return task, wrapErr("migrate", err)
}

// QEMUMigratePreconditions fetches PVE's dry-run summary
// (GET .../qemu/{vmid}/migrate?target=...) listing allowed nodes and local
// disks. Callers use it for preflight logging; it is advisory only.
func (c *Client) QEMUMigratePreconditions(ctx context.Context, node string, vmid int, targetNode string) (*goproxmox.VirtualMachineMigratePreconditions, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	pre, err := vm.MigratePreconditions(ctx, targetNode)
	return pre, wrapErr("migrate preconditions", err)
}

// QEMUDestroy deletes the VM purging all disks; skipLock forces past a
// running lock (admin override). Uses DeleteWithParams because PVE destroy
// takes its flags as query parameters.
func (c *Client) QEMUDestroy(ctx context.Context, node string, vmid int, skipLock bool) (*goproxmox.Task, error) {
	params := &struct {
		Purge    int `json:"purge,omitempty"`
		SkipLock int `json:"skiplock,omitempty"`
	}{Purge: 1}
	if skipLock {
		params.SkipLock = 1
	}
	var upid goproxmox.UPID
	err := c.sdk.DeleteWithParams(ctx, fmt.Sprintf("/nodes/%s/qemu/%d", node, vmid), params, &upid)
	if err != nil {
		return nil, wrapErr("destroy", err)
	}
	return goproxmox.NewTask(upid, c.sdk), nil
}

// VNCProxyTicket opens a noVNC session ticket for the VM.
func (c *Client) VNCProxyTicket(ctx context.Context, node string, vmid int) (*goproxmox.VNC, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	vnc, err := vm.VNCProxy(ctx, &goproxmox.VNCConfig{})
	return vnc, wrapErr("vncproxy", err)
}

// SnapshotCreate wraps POST .../snapshot adding the optional description,
// which v0.8.1's typed NewSnapshot(name) cannot carry.
func (c *Client) SnapshotCreate(ctx context.Context, node string, vmid int, name, desc string) (*goproxmox.Task, error) {
	data := map[string]any{"snapname": name}
	if desc != "" {
		data["description"] = desc
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%d/snapshot", node, vmid)
	return c.postTask(ctx, path, data, "create snapshot")
}

func (c *Client) SnapshotsList(ctx context.Context, node string, vmid int) ([]*goproxmox.VirtualMachineSnapshot, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	snaps, err := vm.Snapshots(ctx)
	return snaps, wrapErr("list snapshots", err)
}

func (c *Client) SnapshotDelete(ctx context.Context, node string, vmid int, snapname string) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Snapshot(snapname).Delete(ctx)
	return task, wrapErr("delete snapshot", err)
}

func (c *Client) SnapshotRollback(ctx context.Context, node string, vmid int, snapname string) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Snapshot(snapname).Rollback(ctx)
	return task, wrapErr("rollback snapshot", err)
}

// ISOCreateByURL downloads url onto storage as content type "iso" using
// PVE's native download-url endpoint (server-side fetch, no SSH needed).
func (c *Client) ISOCreateByURL(ctx context.Context, node, storage, filename, rawURL string) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	task, err := st.DownloadURL(ctx, "iso", filename, rawURL)
	return task, wrapErr("download iso", err)
}

// ISODelete removes an ISO volume from storage.
func (c *Client) ISODelete(ctx context.Context, node, storage, filename string) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	iso, err := st.ISO(ctx, filename)
	if err != nil {
		return nil, wrapErr("iso lookup", err)
	}
	task, err := iso.Delete(ctx)
	return task, wrapErr("delete iso", err)
}

// BackupRestore runs qmrestore: POST .../qemu with restore=1 rebuilds a VM
// from a vzdump archive volume. v0.8.1 has no typed wrapper, so this goes
// through the SDK's verified Post primitive against the documented endpoint.
func (c *Client) BackupRestore(ctx context.Context, node, archive, storage string, vmid int) (*goproxmox.Task, error) {
	data := map[string]any{
		"vmid":    vmid,
		"restore": 1,
		"archive": archive,
		"storage": storage,
		"force":   1, // overwrite the existing VMID
	}
	path := fmt.Sprintf("/nodes/%s/qemu", node)
	return c.postTask(ctx, path, data, "restore backup")
}

// AgentNetworkInterfaces fetches guest interfaces through the QEMU guest
// agent; fails when the agent is not installed/running.
func (c *Client) AgentNetworkInterfaces(ctx context.Context, node string, vmid int) ([]*goproxmox.AgentNetworkIface, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	ifaces, err := vm.AgentGetNetworkIFaces(ctx)
	return ifaces, wrapErr("agent network", err)
}

// RecentTasks lists recent tasks on one node via GET /nodes/{node}/tasks
// (SDK (*Node).Tasks, verified in v0.8.1 nodes_admin.go). Source "all" merges
// archived finished tasks with the ones still running so monitoring sees
// both; Limit bounds the page.
func (c *Client) RecentTasks(ctx context.Context, node string) ([]*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	tasks, err := n.Tasks(ctx, &goproxmox.NodeTasksOptions{Limit: recentTaskLimit, Source: "all"})
	return tasks, wrapErr("recent tasks", err)
}

// WaitForTask polls a task until completion (or ctx/max deadline) and
// verifies the exit status. A nil task is a no-op: the SDK returns nil when
// PVE answered synchronously without a UPID.
func (c *Client) WaitForTask(ctx context.Context, t *goproxmox.Task, op string, max time.Duration) error {
	if t == nil {
		return nil
	}
	if err := t.Wait(ctx, taskPollInterval, max); err != nil {
		return wrapErr(op+" wait", err)
	}
	if t.Status != "stopped" || !t.IsSuccessful {
		return apperrors.Newf(apperrors.CodeProviderUnavailable,
			"proxmox %s failed: exitstatus=%s", op, t.ExitStatus)
	}
	return nil
}

// postTask issues a POST that returns a UPID and wraps it in a Task handle.
func (c *Client) postTask(ctx context.Context, path string, data any, op string) (*goproxmox.Task, error) {
	var upid goproxmox.UPID
	if err := c.sdk.Post(ctx, path, data, &upid); err != nil {
		return nil, wrapErr(op, err)
	}
	return goproxmox.NewTask(upid, c.sdk), nil
}

// nodeHandle returns a fully loaded VirtualMachine (status/current + config)
// bound to its client so instance methods (Config/Start/Snapshot/...) work.
func (c *Client) nodeHandle(ctx context.Context, node string, vmid int) (*goproxmox.VirtualMachine, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	vm, err := n.VirtualMachine(ctx, vmid)
	return vm, wrapErr("vm status", err)
}

// ---------------------------------------------------------------------------
// Extended surface: everything below wraps additional verified SDK v0.8.1
// capability so the platform can operate the full breadth of a PVE cluster.
// ---------------------------------------------------------------------------

const (
	cloneTimeout = 30 * time.Minute
	moveTimeout  = 30 * time.Minute
)

// ---- VM power extras ----

// QEMUPause / QEMUResume / QEMUHibernate / QEMUReset map 1:1 to PVE's
// suspend/resume/suspend-to-disk/reset machine operations.
func (c *Client) QEMUPause(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Pause(ctx)
	return task, wrapErr("pause", err)
}

func (c *Client) QEMUResume(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Resume(ctx)
	return task, wrapErr("resume", err)
}

func (c *Client) QEMUHibernate(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Hibernate(ctx)
	return task, wrapErr("hibernate", err)
}

func (c *Client) QEMUReset(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.Reset(ctx)
	return task, wrapErr("reset", err)
}

// ---- VM config: notes, tags ----

// VMConfigGet returns the fully loaded VM handle; its Description and Tags
// fields carry the notes/tags the adapter exposes.
func (c *Client) VMConfigGet(ctx context.Context, node string, vmid int) (*goproxmox.VirtualMachine, error) {
	return c.nodeHandle(ctx, node, vmid)
}

// VMTagsSet rewrites the tag list wholesale (PVE stores tags as one
// semicolon-separated string on the config).
func (c *Client) VMTagsSet(ctx context.Context, node string, vmid int, tags []string) (*goproxmox.Task, error) {
	task, err := c.QEMUConfigSet(ctx, node, vmid,
		goproxmox.VirtualMachineOption{Name: "tags", Value: strings.Join(tags, ";")})
	return task, wrapErr("set tags", err)
}

// ---- Serial console (xterm.js) ----

// SerialTermProxy opens an xterm.js terminal ticket for the VM. Browsers then
// upgrade through the same vncwebsocket endpoint VNC uses, but with the term
// ticket — mirror of VNCProxyTicket for serial consoles.
func (c *Client) SerialTermProxy(ctx context.Context, node string, vmid int) (*goproxmox.Term, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	term, err := vm.TermProxy(ctx)
	return term, wrapErr("serial termproxy", err)
}

// ---- Clone / template / move disk ----

// QEMUClone clones a VM (linked clone when full=false and a template source,
// otherwise a full copy). targetNode "" keeps the source node.
func (c *Client) QEMUClone(ctx context.Context, node string, vmid int, newID int, name, targetNode, targetStorage string, full bool) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	opts := &goproxmox.VirtualMachineCloneOptions{
		NewID:   newID,
		Name:    name,
		Target:  targetNode,
		Storage: targetStorage,
	}
	if full || targetStorage != "" {
		// Linked clones require shared storage; a storage override forces a
		// full copy regardless, so make intent explicit.
		opts.Full = true
	}
	newID, task, err := vm.Clone(ctx, opts)
	if err != nil {
		return nil, wrapErr("clone", err)
	}
	_ = newID
	return task, nil
}

// QEMUConvertToTemplate turns the VM into a PVE template (irreversible).
func (c *Client) QEMUConvertToTemplate(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.ConvertToTemplate(ctx)
	return task, wrapErr("convert to template", err)
}

// QEMUMoveDisk moves a volume to another storage (online for running guests).
func (c *Client) QEMUMoveDisk(ctx context.Context, node string, vmid int, disk, targetStorage string) (*goproxmox.Task, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := vm.MoveDisk(ctx, disk, &goproxmox.VirtualMachineMoveDiskOptions{
		Disk: disk, Storage: targetStorage, Delete: true,
	})
	return task, wrapErr("move disk", err)
}

// ---- Cloud-init ----

func (c *Client) CloudInitRegenerate(ctx context.Context, node string, vmid int) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("cloudinit regenerate", vm.CloudInitRegenerate(ctx))
}

func (c *Client) CloudInitPending(ctx context.Context, node string, vmid int) ([]*goproxmox.VirtualMachineCloudInitPending, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	pending, err := vm.CloudInitPending(ctx)
	return pending, wrapErr("cloudinit pending", err)
}

// ---- Guest agent ----

func (c *Client) AgentPing(ctx context.Context, node string, vmid int) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("agent ping", vm.AgentPing(ctx))
}

func (c *Client) AgentOsInfo(ctx context.Context, node string, vmid int) (*goproxmox.AgentOsInfo, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	info, err := vm.AgentOsInfo(ctx)
	return info, wrapErr("agent osinfo", err)
}

func (c *Client) AgentFsInfo(ctx context.Context, node string, vmid int) ([]*goproxmox.AgentFsInfo, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	fs, err := vm.AgentGetFsInfo(ctx)
	return fs, wrapErr("agent fsinfo", err)
}

func (c *Client) AgentInfo(ctx context.Context, node string, vmid int) (*goproxmox.AgentInfo, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	info, err := vm.AgentGetInfo(ctx)
	return info, wrapErr("agent info", err)
}

// AgentPassthrough proxies arbitrary GET/POST requests to /nodes/{node}/qemu/{vmid}/agent/*.
// subPath is the tail after /agent (may be empty for the index, or e.g. "get-time", "ping", "network-get-interfaces").
// For GET with a non-empty subPath and query params, they are forwarded verbatim.
// For POST, body is forwarded as JSON. Response is returned as raw decoded JSON (map/slice/primitive).
func (c *Client) AgentPassthrough(ctx context.Context, node string, vmid int, method string, subPath string, query url.Values, body any) (any, error) {
	base := fmt.Sprintf("/nodes/%s/qemu/%d/agent", node, vmid)
	path := base
	if strings.TrimSpace(subPath) != "" {
		path = strings.TrimRight(base, "/") + "/" + strings.Trim(strings.TrimSpace(subPath), "/")
	}
	if method == http.MethodGet && len(query) > 0 {
		path = path + "?" + query.Encode()
	}
	var out any
	var err error
	switch method {
	case http.MethodGet:
		err = c.sdk.Get(ctx, path, &out)
	case http.MethodPost:
		err = c.sdk.Post(ctx, path, body, &out)
	default:
		return nil, apperrors.Newf(apperrors.CodeValidation, "unsupported agent passthrough method %q", method)
	}
	if err != nil {
		return nil, wrapErr("agent "+strings.TrimSpace(subPath), err)
	}
	return out, nil
}

// VMRRDData pulls round-robin metrics (CPU/mem/net/disk series) for charts.
func (c *Client) VMRRDData(ctx context.Context, node string, vmid int, timeframe string, cf string) ([]*goproxmox.RRDData, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	data, err := vm.RRDData(ctx, goproxmox.Timeframe(timeframe), goproxmox.ConsolidationFunction(cf))
	return data, wrapErr("rrd data", err)
}

// ---- Per-VM firewall (PVE-native) ----

func (c *Client) VMFirewallRules(ctx context.Context, node string, vmid int) ([]*goproxmox.FirewallRule, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	rules, err := vm.FirewallRules(ctx)
	return rules, wrapErr("firewall rules", err)
}

func (c *Client) VMFirewallRuleCreate(ctx context.Context, node string, vmid int, rule *goproxmox.FirewallRule) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("firewall rule create", vm.NewFirewallRule(ctx, rule))
}

// VMFirewallRuleAt returns the rule handle at pos so callers can Get/Update/
// Delete it (SDK pattern: the handle is bound to its path).
func (c *Client) VMFirewallRuleAt(ctx context.Context, node string, vmid, pos int) (*goproxmox.FirewallRule, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	rule := vm.FirewallRule(pos)
	if rule == nil {
		return nil, apperrors.Newf(apperrors.CodeNotFound, "proxmox firewall rule pos %d not found", pos)
	}
	if err := rule.Get(ctx); err != nil {
		return nil, wrapErr("firewall rule get", err)
	}
	return rule, nil
}

func (c *Client) VMFirewallOptionGet(ctx context.Context, node string, vmid int) (*goproxmox.FirewallVirtualMachineOption, error) {
	opt := &goproxmox.FirewallVirtualMachineOption{}
	// Raw GET instead of the typed getter: v0.8.1's FirewallOptionGet passes
	// a nil target so the response is dropped and it always returns nil.
	if err := c.sdk.Get(ctx, fmt.Sprintf("/nodes/%s/qemu/%d/firewall/options", node, vmid), opt); err != nil {
		return nil, wrapErr("firewall options get", err)
	}
	return opt, nil
}

func (c *Client) VMFirewallOptionSet(ctx context.Context, node string, vmid int, opt *goproxmox.FirewallVirtualMachineOption) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("firewall options set", vm.FirewallOptionSet(ctx, opt))
}

// ---- Node operations ----

// NodeStatusDetail loads the node summary (uptime/load/kvm/pve versions).
func (c *Client) NodeStatusDetail(ctx context.Context, node string) (*goproxmox.Node, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	if err := n.Status(ctx); err != nil {
		return nil, wrapErr("node status", err)
	}
	return n, nil
}

// NodeReport returns the full text report (like `pveversion -v` bundle).
func (c *Client) NodeReport(ctx context.Context, node string) (string, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return "", wrapErr("node "+node, err)
	}
	report, err := n.Report(ctx)
	return report, wrapErr("node report", err)
}

// NodeVirtualMachines lists every QEMU guest on the node with live status.
func (c *Client) NodeVirtualMachines(ctx context.Context, node string) (goproxmox.VirtualMachines, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	vms, err := n.VirtualMachines(ctx)
	return vms, wrapErr("node vms", err)
}

// NodeDisks inventories physical disks (SMART details skipped by default).
func (c *Client) NodeDisks(ctx context.Context, node string) ([]*goproxmox.Disk, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	disks, err := n.Disks(ctx, false, true, "")
	return disks, wrapErr("node disks", err)
}

// NodeQEMUCapabilities indexes what this node's QEMU binary supports.
func (c *Client) NodeQEMUCapabilities(ctx context.Context, node string) ([]string, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	caps, err := n.QEMUCapabilitiesIndex(ctx)
	return caps, wrapErr("node capabilities", err)
}

// NodeTermProxy opens a host-shell termproxy ticket on the node (xterm.js).
// GET /admin/proxmox/:id/nodes/:node/serial-proxy — proxmox murni (Node.TermProxy),
// mirrors SerialTermProxy/ContainerTermProxy but for the PVE host itself.
func (c *Client) NodeTermProxy(ctx context.Context, node string) (*goproxmox.Term, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	term, err := n.TermProxy(ctx)
	return term, wrapErr("node termproxy", err)
}

// NodeCertificates lists custom TLS certificates installed on the node.
func (c *Client) NodeCertificates(ctx context.Context, node string) (*goproxmox.NodeCertificates, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	certs, err := n.GetCustomCertificates(ctx)
	return certs, wrapErr("node certificates", err)
}

// NodeCertificateUpload installs a custom TLS certificate chain + key on the node.
// It wraps the SDK's POST /nodes/{node}/certificates/custom endpoint.
func (c *Client) NodeCertificateUpload(ctx context.Context, node string, cert *goproxmox.CustomCertificate) error {
	if cert == nil {
		return apperrors.New(apperrors.CodeValidation, "proxmox: certificate payload is required")
	}
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return wrapErr("node "+node, err)
	}
	if err := n.UploadCustomCertificate(ctx, cert); err != nil {
		return wrapErr("node certificates upload", err)
	}
	return nil
}

// NodeCertificateDelete removes the custom certificate from the node.
// It wraps the SDK's DELETE /nodes/{node}/certificates/custom endpoint.
func (c *Client) NodeCertificateDelete(ctx context.Context, node string) error {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return wrapErr("node "+node, err)
	}
	if err := n.DeleteCustomCertificate(ctx); err != nil {
		return wrapErr("node certificates delete", err)
	}
	return nil
}

// NodeCommand issues reboot/shutdown against POST /nodes/{node}/status.
// Gating to platform admins happens at the API layer; this is deliberately
// raw because v0.8.1 has no typed wrapper for it.
func (c *Client) NodeCommand(ctx context.Context, node, command string) (*goproxmox.Task, error) {
	if command != "reboot" && command != "shutdown" && command != "wakeonlan" {
		return nil, apperrors.Newf(apperrors.CodeValidation, "proxmox: unsupported node command %q", command)
	}
	var upid goproxmox.UPID
	if err := c.sdk.Post(ctx, fmt.Sprintf("/nodes/%s/status", node),
		map[string]string{"command": command}, &upid); err != nil {
		return nil, wrapErr("node "+command, err)
	}
	return goproxmox.NewTask(upid, c.sdk), nil
}

// VzdumpBackup runs an ad-hoc vzdump backup for one guest (the manual twin of
// scheduled cluster backup jobs).
func (c *Client) VzdumpBackup(ctx context.Context, node string, vmid int, storage, mode string) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	if mode == "" {
		mode = "snapshot"
	}
	task, err := n.Vzdump(ctx, &goproxmox.VirtualMachineBackupOptions{
		Storage:  storage,
		Mode:     mode,
		Compress: "zstd",
		VMID:     uint64(vmid),
	})
	return task, wrapErr("vzdump backup", err)
}

// DeleteStorageContent removes a storage volume (pruning old backups/ISOs).
func (c *Client) DeleteStorageContent(ctx context.Context, node, storage, volume string) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	task, err := st.DeleteContent(ctx, volume)
	return task, wrapErr("delete content", err)
}

// PruneBackupsPreview lists which backups WOULD be removed by the keep policy.
func (c *Client) PruneBackupsPreview(ctx context.Context, node, storage string, opts *goproxmox.StoragePruneBackupsOptions) ([]*goproxmox.PruneBackupItem, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	entries, err := st.PreviewPruneBackups(ctx, opts)
	return entries, wrapErr("prune preview", err)
}

// PruneBackups runs the keep-policy prune for real.
func (c *Client) PruneBackups(ctx context.Context, node, storage string, opts *goproxmox.StoragePruneBackupsOptions) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	task, err := st.PruneBackups(ctx, opts)
	return task, wrapErr("prune backups", err)
}

// ---- Cluster-wide operations ----

// ClusterStatusRaw loads quorum/node membership into the Cluster receiver.
func (c *Client) ClusterStatusRaw(ctx context.Context) (*goproxmox.Cluster, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	if err := cl.Status(ctx); err != nil {
		return nil, wrapErr("cluster status", err)
	}
	return cl, nil
}

// ClusterNextID allocates the next free VMID from PVE itself.
func (c *Client) ClusterNextID(ctx context.Context) (int, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return 0, wrapErr("cluster", err)
	}
	id, err := cl.NextID(ctx)
	return id, wrapErr("next id", err)
}

// ClusterLogEntries tails the cluster task log.
func (c *Client) ClusterLogEntries(ctx context.Context, max int) ([]*goproxmox.ClusterLogEntry, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	if max <= 0 || max > 500 {
		max = 100
	}
	entries, err := cl.Log(ctx, max)
	return entries, wrapErr("cluster log", err)
}

// ClusterTaskList enumerates every task across the cluster.
func (c *Client) ClusterTaskList(ctx context.Context) (goproxmox.Tasks, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	tasks, err := cl.Tasks(ctx)
	return tasks, wrapErr("cluster tasks", err)
}

// ---- HA ----

func (c *Client) HAResourcesList(ctx context.Context, typ string) ([]*goproxmox.HAResource, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	res, err := cl.HAResources(ctx, typ)
	return res, wrapErr("ha resources", err)
}

func (c *Client) HAResourceCreate(ctx context.Context, opts *goproxmox.HAResourceCreateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha resource create", cl.NewHAResource(ctx, opts))
}

func (c *Client) HAResourceUpdate(ctx context.Context, sid string, opts *goproxmox.HAResourceUpdateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha resource update", cl.HAResourceUpdate(ctx, sid, opts))
}

func (c *Client) HAResourceDelete(ctx context.Context, sid string, purge bool) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha resource delete", cl.HAResourceDelete(ctx, sid, purge))
}

func (c *Client) HAResourceMigrateRelocate(ctx context.Context, sid, node string, relocate bool) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	if relocate {
		return wrapErr("ha relocate", cl.HAResourceRelocate(ctx, sid, node))
	}
	return wrapErr("ha migrate", cl.HAResourceMigrate(ctx, sid, node))
}

func (c *Client) HAStatus(ctx context.Context) ([]*goproxmox.HAStatusEntry, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	status, err := cl.HAStatus(ctx)
	return status, wrapErr("ha status", err)
}

func (c *Client) HAGroupsList(ctx context.Context) ([]*goproxmox.HAGroup, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	groups, err := cl.HAGroups(ctx)
	return groups, wrapErr("ha groups", err)
}

func (c *Client) HAGroupCreate(ctx context.Context, opts *goproxmox.HAGroupCreateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha group create", cl.NewHAGroup(ctx, opts))
}

func (c *Client) HAGroupUpdate(ctx context.Context, group string, opts *goproxmox.HAGroupUpdateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha group update", cl.HAGroupUpdate(ctx, group, opts))
}

func (c *Client) HAGroupDelete(ctx context.Context, group string) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha group delete", cl.HAGroupDelete(ctx, group))
}

func (c *Client) HARulesList(ctx context.Context) ([]*goproxmox.HARule, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	rules, err := cl.HARules(ctx, "", "")
	return rules, wrapErr("ha rules", err)
}

func (c *Client) HARuleCreate(ctx context.Context, opts *goproxmox.HARuleCreateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha rule create", cl.NewHARule(ctx, opts))
}

func (c *Client) HARuleUpdate(ctx context.Context, rule string, opts *goproxmox.HARuleUpdateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha rule update", cl.HARuleUpdate(ctx, rule, opts))
}

func (c *Client) HARuleDelete(ctx context.Context, rule string) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("ha rule delete", cl.HARuleDelete(ctx, rule))
}

// ---- Scheduled backup jobs (vzdump) ----

func (c *Client) BackupJobsList(ctx context.Context) (goproxmox.ClusterBackups, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	jobs, err := cl.Backups(ctx)
	return jobs, wrapErr("backup jobs", err)
}

func (c *Client) BackupJobGet(ctx context.Context, id string) (*goproxmox.ClusterBackup, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	job, err := cl.Backup(ctx, id)
	return job, wrapErr("backup job get", err)
}

func (c *Client) BackupJobCreate(ctx context.Context, opts *goproxmox.ClusterBackupOptions) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("backup job create", cl.NewBackup(ctx, opts))
}

func (c *Client) BackupJobUpdate(ctx context.Context, id string, opts *goproxmox.ClusterBackupOptions) error {
	job, err := c.BackupJobGet(ctx, id)
	if err != nil {
		return err
	}
	return wrapErr("backup job update", job.Update(ctx, opts))
}

func (c *Client) BackupJobDelete(ctx context.Context, id string) error {
	job, err := c.BackupJobGet(ctx, id)
	if err != nil {
		return err
	}
	return wrapErr("backup job delete", job.Delete(ctx))
}

// ---- Replication ----

func (c *Client) ReplicationJobsList(ctx context.Context) ([]*goproxmox.ReplicationJob, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	jobs, err := cl.ReplicationJobs(ctx)
	return jobs, wrapErr("replication jobs", err)
}

func (c *Client) ReplicationJobCreate(ctx context.Context, opts *goproxmox.ReplicationJobOptions) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("replication job create", cl.NewReplicationJob(ctx, opts))
}

func (c *Client) ReplicationJobDelete(ctx context.Context, id string, force, keep bool) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("replication job delete", cl.ReplicationJobDelete(ctx, id, force, keep))
}

// ---- Firewall: security groups + cluster level ----

func (c *Client) FWGroupsList(ctx context.Context) ([]*goproxmox.FirewallSecurityGroup, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	groups, err := cl.FWGroups(ctx)
	return groups, wrapErr("fw groups", err)
}

func (c *Client) FWGroupCreate(ctx context.Context, group *goproxmox.FirewallSecurityGroup) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("fw group create", cl.NewFWGroup(ctx, group))
}

func (c *Client) FWGroupDelete(ctx context.Context, name string) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	g, err := cl.FWGroup(ctx, name)
	if err != nil {
		return wrapErr("fw group get", err)
	}
	return wrapErr("fw group delete", g.Delete(ctx))
}

func (c *Client) FWGroupRulesList(ctx context.Context, name string) ([]*goproxmox.FirewallRule, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	g, err := cl.FWGroup(ctx, name)
	if err != nil {
		return nil, wrapErr("fw group get", err)
	}
	rules, err := g.GetRules(ctx)
	return rules, wrapErr("fw group rules", err)
}

func (c *Client) FWGroupRuleCreate(ctx context.Context, name string, rule *goproxmox.FirewallRule) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	g, err := cl.FWGroup(ctx, name)
	if err != nil {
		return wrapErr("fw group get", err)
	}
	return wrapErr("fw group rule create", g.RuleCreate(ctx, rule))
}

func (c *Client) FWGroupRuleDelete(ctx context.Context, name string, pos int) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	g, err := cl.FWGroup(ctx, name)
	if err != nil {
		return wrapErr("fw group get", err)
	}
	return wrapErr("fw group rule delete", g.RuleDelete(ctx, pos))
}

func (c *Client) ClusterFirewallRules(ctx context.Context) ([]*goproxmox.FirewallRule, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	rules, err := cl.FirewallRules(ctx)
	return rules, wrapErr("cluster fw rules", err)
}

func (c *Client) ClusterFirewallRuleCreate(ctx context.Context, rule *goproxmox.FirewallRule) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("cluster fw rule create", cl.NewFirewallRule(ctx, rule))
}

func (c *Client) ClusterFirewallRuleDelete(ctx context.Context, pos int) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("cluster fw rule delete", cl.FirewallRuleDelete(ctx, pos))
}

func (c *Client) FirewallAliases(ctx context.Context) ([]*goproxmox.FirewallAlias, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	aliases, err := cl.FirewallAliases(ctx)
	return aliases, wrapErr("fw aliases", err)
}

func (c *Client) FirewallAliasCreate(ctx context.Context, alias *goproxmox.FirewallAliasCreateOption) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("fw alias create", cl.NewFirewallAlias(ctx, alias))
}

func (c *Client) FirewallAliasDelete(ctx context.Context, name string) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return err
	}
	return wrapErr("fw alias delete", cl.FirewallAliasDelete(ctx, name))
}

// ---- Pools ----

func (c *Client) PoolsList(ctx context.Context) (goproxmox.Pools, error) {
	pools, err := c.sdk.Pools(ctx)
	return pools, wrapErr("pools", err)
}

func (c *Client) PoolGet(ctx context.Context, poolid string) (*goproxmox.Pool, error) {
	pool, err := c.sdk.Pool(ctx, poolid)
	return pool, wrapErr("pool get", err)
}

func (c *Client) PoolCreate(ctx context.Context, poolid, comment string) error {
	return wrapErr("pool create", c.sdk.NewPool(ctx, poolid, comment))
}

func (c *Client) PoolUpdate(ctx context.Context, poolid, comment string) error {
	pool, err := c.sdk.Pool(ctx, poolid)
	if err != nil {
		return wrapErr("pool get", err)
	}
	return wrapErr("pool update", pool.Update(ctx, &goproxmox.PoolUpdateOption{Comment: comment}))
}

func (c *Client) PoolDelete(ctx context.Context, poolid string) error {
	pool, err := c.sdk.Pool(ctx, poolid)
	if err != nil {
		return wrapErr("pool get", err)
	}
	return wrapErr("pool delete", pool.Delete(ctx))
}

// ---- Ceph & SDN (read-only) ----

func (c *Client) CephStatus(ctx context.Context) (*goproxmox.ClusterCephStatus, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	ce, err := cl.Ceph(ctx)
	if err != nil {
		return nil, wrapErr("ceph", err)
	}
	st, err := ce.Status(ctx)
	return st, wrapErr("ceph status", err)
}

// CephPoolStatus returns the current configuration and optionally utilization
// for one Ceph pool on the given node. Set verbose=true to include the
// Statistics map (bytes_used, percent_used, pg_num history). Endpoint:
// GET /nodes/{node}/ceph/pool/{pool}/status — proxmox murni, node is required
// by PVE; callers that expose a node-free route should resolve the node first.
func (c *Client) CephPoolStatus(ctx context.Context, node, pool string, verbose bool) (*goproxmox.CephPoolStatus, error) {
	if strings.TrimSpace(node) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "proxmox: node is required for ceph pool status")
	}
	if strings.TrimSpace(pool) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "proxmox: ceph pool name is required")
	}
	n, err := c.sdk.Node(ctx, strings.TrimSpace(node))
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	status, err := n.CephPool(strings.TrimSpace(pool)).Status(ctx, verbose)
	return status, wrapErr("ceph pool status", err)
}

func (c *Client) SDNZones(ctx context.Context) ([]*goproxmox.SDNZone, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	zones, err := cl.SDNZones(ctx)
	return zones, wrapErr("sdn zones", err)
}

func (c *Client) SDNVNets(ctx context.Context) ([]*goproxmox.VNet, error) {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return nil, wrapErr("cluster", err)
	}
	vnets, err := cl.SDNVNets(ctx)
	return vnets, wrapErr("sdn vnets", err)
}

// ---------------------------------------------------------------------------
// Extended surface II: VM firewall ipsets, backup-job run-now, HA arm/disarm,
// pool membership, file-restore browsing, cluster storages, node DNS/time and
// CPU models. Every SDK symbol below was verified against v0.8.1 sources;
// deviations from the typed wrappers are called out inline.
// ---------------------------------------------------------------------------

// VMFirewallIPSets lists the VM firewall ipsets (typed (*VirtualMachine).
// GetFirewallIPSet, virtual_machine.go: GET .../qemu/{vmid}/firewall/ipset).
func (c *Client) VMFirewallIPSets(ctx context.Context, node string, vmid int) ([]*goproxmox.FirewallIPSet, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	sets, err := vm.GetFirewallIPSet(ctx)
	return sets, wrapErr("firewall ipsets", err)
}

// VMFirewallIPSetCreate adds a named ipset (typed (*VirtualMachine).
// NewFirewallIPSet; POST body name/comment per FirewallIPSetCreationOption).
func (c *Client) VMFirewallIPSetCreate(ctx context.Context, node string, vmid int, name, comment string) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("firewall ipset create",
		vm.NewFirewallIPSet(ctx, goproxmox.FirewallIPSetCreationOption{Name: name, Comment: comment}))
}

// VMFirewallIPSetDelete removes an ipset; force strips firewall rules that
// still reference it instead of failing. Raw DeleteWithParams on purpose:
// v0.8.1's typed DeleteFirewallIPSet passes its options map as the RESPONSE
// decoder of Client.Delete (which takes no request payload), so "force" would
// silently never reach PVE. DeleteWithParams serializes options into the query
// string exactly like the existing QEMUDestroy purge/skiplock pattern.
func (c *Client) VMFirewallIPSetDelete(ctx context.Context, node string, vmid int, name string, force bool) error {
	forceFlag := 0
	if force {
		forceFlag = 1
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%d/firewall/ipset/%s", node, vmid, name)
	return wrapErr("firewall ipset delete",
		c.sdk.DeleteWithParams(ctx, path, map[string]int{"force": forceFlag}, nil))
}

// VMFirewallIPSetEntries lists the CIDR rows of one ipset (typed
// (*VirtualMachine).GetFirewallIPSetEntries).
func (c *Client) VMFirewallIPSetEntries(ctx context.Context, node string, vmid int, name string) ([]*goproxmox.FirewallIPSetEntry, error) {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	entries, err := vm.GetFirewallIPSetEntries(ctx, name)
	return entries, wrapErr("firewall ipset entries", err)
}

// VMFirewallIPSetEntryAdd appends a CIDR row (typed
// (*VirtualMachine).NewFirewallIPSetEntry; CIDR is required by PVE).
func (c *Client) VMFirewallIPSetEntryAdd(ctx context.Context, node string, vmid int, name, cidr, comment string) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("firewall ipset entry add",
		vm.NewFirewallIPSetEntry(ctx, name, goproxmox.FirewallIPSetEntryCreationOption{CIDR: cidr, Comment: comment}))
}

// VMFirewallIPSetEntryUpdate edits one row's comment and optionally renames
// its CIDR. Renaming goes through a raw PUT because PVE carries the new CIDR
// in the "rename" parameter of PUT .../ipset/{name}/{cidr} while v0.8.1's
// FirewallIPSetEntryUpdateOption only models comment/digest/nomatch.
func (c *Client) VMFirewallIPSetEntryUpdate(ctx context.Context, node string, vmid int, name, cidr, newCIDR, comment string) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	if newCIDR != "" && newCIDR != cidr {
		body := map[string]string{"rename": newCIDR}
		if comment != "" {
			body["comment"] = comment
		}
		path := fmt.Sprintf("/nodes/%s/qemu/%d/firewall/ipset/%s/%s", node, vmid, name, cidr)
		return wrapErr("firewall ipset entry update", c.sdk.Put(ctx, path, body, nil))
	}
	return wrapErr("firewall ipset entry update",
		vm.UpdateFirewallIPSetEntry(ctx, name, cidr, &goproxmox.FirewallIPSetEntryUpdateOption{Comment: comment}))
}

// VMFirewallIPSetEntryRemove deletes one CIDR row (typed
// (*VirtualMachine).DeleteFirewallIPSetEntry). The optional digest
// optimistic-lock check stays unused — the adapter contract carries no digest.
func (c *Client) VMFirewallIPSetEntryRemove(ctx context.Context, node string, vmid int, name, cidr string) error {
	vm, err := c.nodeHandle(ctx, node, vmid)
	if err != nil {
		return err
	}
	return wrapErr("firewall ipset entry remove", vm.DeleteFirewallIPSetEntry(ctx, name, cidr, ""))
}

// BackupJobRunNow triggers an immediate run of scheduled backup job id.
// v0.8.1 has no typed wrapper for this endpoint; the base path mirrors
// cluster.go's verified "/cluster/backup/{id}" routes (Backup/NewBackup/
// Update/Delete), so run-now resolves to POST /cluster/backup/{id}/run.
func (c *Client) BackupJobRunNow(ctx context.Context, id string) (*goproxmox.Task, error) {
	if strings.TrimSpace(id) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "proxmox: backup job id is required")
	}
	path := fmt.Sprintf("/cluster/backup/%s/run", id)
	return c.postTask(ctx, path, nil, "backup job run-now")
}

// ---- HA stack arm / disarm ----

// HAArm re-arms the HA stack (typed (*Cluster).HAArm,
// POST /cluster/ha/status/arm-ha — requires Sys.Console on /).
func (c *Client) HAArm(ctx context.Context) error {
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return wrapErr("cluster", err)
	}
	return wrapErr("ha arm", cl.HAArm(ctx))
}

// haDisarmModes are the resource-mode values PVE accepts for disarm-ha (SDK
// cluster_ha.go: "freeze" keeps HA-tracking state but holds commands,
// "ignore" removes resources from HA tracking entirely).
var haDisarmModes = map[string]struct{}{"freeze": {}, "ignore": {}}

// HADisarm disarms the HA stack and releases watchdogs cluster-wide (typed
// (*Cluster).HADisarm, POST /cluster/ha/status/disarm-ha). resourceMode is
// mandatory upstream; anything besides freeze/ignore is rejected locally so
// invalid values fail before dialing.
func (c *Client) HADisarm(ctx context.Context, resourceMode string) error {
	if _, ok := haDisarmModes[resourceMode]; !ok {
		return apperrors.Newf(apperrors.CodeValidation,
			"proxmox: ha disarm resource-mode must be \"freeze\" or \"ignore\", got %q", resourceMode)
	}
	cl, err := c.sdk.Cluster(ctx)
	if err != nil {
		return wrapErr("cluster", err)
	}
	return wrapErr("ha disarm", cl.HADisarm(ctx, resourceMode))
}

// ---- Pool membership ----

// PoolUpdateMembers rewrites pool membership in one call: vmsCSV/storagesCSV
// are comma-separated id lists added to the pool, or removed from it when
// delete is true (PoolUpdateOption.VirtualMachines/.Storage serialize as
// "vms"/"storage"). The pre-existing PoolUpdate (comment-only) is kept —
// admin handlers still call it.
func (c *Client) PoolUpdateMembers(ctx context.Context, poolid, comment string, vmsCSV, storagesCSV string, delete bool) error {
	pool, err := c.sdk.Pool(ctx, poolid)
	if err != nil {
		return wrapErr("pool get", err)
	}
	opt := &goproxmox.PoolUpdateOption{
		VirtualMachines: vmsCSV,
		Storage:         storagesCSV,
		Delete:          goproxmox.IntOrBool(delete),
	}
	if comment != "" {
		opt.Comment = comment
	}
	return wrapErr("pool update members", pool.Update(ctx, opt))
}

// ---- File-restore browsing ----

// BackupFileRestoreList lists files inside a PBS/vzdump backup volume at
// filepath ("/" for the root). Typed ((*Storage).FileRestoreList); the SDK
// base64-encodes filepath exactly as PVE requires. PBS-only upstream — plain
// vzdump storages answer 501 which surfaces as PROVIDER_UNAVAILABLE.
func (c *Client) BackupFileRestoreList(ctx context.Context, node, storage, volume, filepath string) ([]*goproxmox.StorageFileRestoreEntry, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	st, err := n.Storage(ctx, storage)
	if err != nil {
		return nil, wrapErr("storage "+storage, err)
	}
	entries, err := st.FileRestoreList(ctx, volume, filepath)
	return entries, wrapErr("file restore list", err)
}

// ---- Cluster-wide storage CRUD ----

// ClusterStoragesList enumerates every storage defined on the cluster
// (GET /storage, typed Client.ClusterStorages).
func (c *Client) ClusterStoragesList(ctx context.Context) (goproxmox.ClusterStorages, error) {
	storages, err := c.sdk.ClusterStorages(ctx)
	return storages, wrapErr("cluster storages", err)
}

// ClusterStorageGet loads one cluster storage definition by name
// (GET /storage/{name}, typed Client.ClusterStorage).
func (c *Client) ClusterStorageGet(ctx context.Context, name string) (*goproxmox.ClusterStorage, error) {
	st, err := c.sdk.ClusterStorage(ctx, name)
	return st, wrapErr("cluster storage get", err)
}

// ClusterStorageCreate defines a new cluster storage from flattened options
// (POST /storage, typed Client.NewClusterStorage; e.g. {storage,type,content}).
func (c *Client) ClusterStorageCreate(ctx context.Context, opts []goproxmox.ClusterStorageOptions) (*goproxmox.Task, error) {
	task, err := c.sdk.NewClusterStorage(ctx, opts...)
	return task, wrapErr("cluster storage create", err)
}

// ClusterStorageUpdate patches one cluster storage definition
// (PUT /storage/{name}, typed Client.UpdateClusterStorage).
func (c *Client) ClusterStorageUpdate(ctx context.Context, name string, opts []goproxmox.ClusterStorageOptions) (*goproxmox.Task, error) {
	task, err := c.sdk.UpdateClusterStorage(ctx, name, opts...)
	return task, wrapErr("cluster storage update", err)
}

// ClusterStorageDelete removes a cluster storage definition
// (DELETE /storage/{name}, typed Client.DeleteClusterStorage).
func (c *Client) ClusterStorageDelete(ctx context.Context, name string) (*goproxmox.Task, error) {
	task, err := c.sdk.DeleteClusterStorage(ctx, name)
	return task, wrapErr("cluster storage delete", err)
}

// ---- Node DNS / time ----

// NodeDNSGet returns the node resolver configuration decoded loosely into a
// map. PVE shape (api-viewer #/nodes/{node}/dns): the {"data":...} envelope
// unwraps to {"search": str, "dns1"|"dns2"|"dns3": str, ...}; any slot may be
// absent when unset. Deliberately raw despite v0.8.1 shipping typed
// (*Node).DNS/UpdateDNS: this surface pins a flexible map decode for callers
// that forward node settings verbatim.
func (c *Client) NodeDNSGet(ctx context.Context, node string) (map[string]any, error) {
	var out map[string]any
	if err := c.sdk.Get(ctx, fmt.Sprintf("/nodes/%s/dns", node), &out); err != nil {
		return nil, wrapErr("node dns get", err)
	}
	return out, nil
}

// NodeDNSSet rewrites the resolver configuration (PUT /nodes/{node}/dns).
// search is required by PVE; the three slots are supplied together and empty
// strings clear them server-side.
func (c *Client) NodeDNSSet(ctx context.Context, node, search, dns1, dns2, dns3 string) error {
	if search == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: node dns search domain is required")
	}
	body := map[string]string{"search": search, "dns1": dns1, "dns2": dns2, "dns3": dns3}
	return wrapErr("node dns set", c.sdk.Put(ctx, fmt.Sprintf("/nodes/%s/dns", node), body, nil))
}

// NodeTimeGet returns the node clock state decoded loosely into a map. PVE
// shape (api-viewer #/nodes/{node}/time): {"timezone": str, "localtime":
// unix-epoch seconds}. Raw like NodeDNSGet; typed (*Node).Time exists should
// callers prefer structs later.
func (c *Client) NodeTimeGet(ctx context.Context, node string) (map[string]any, error) {
	var out map[string]any
	if err := c.sdk.Get(ctx, fmt.Sprintf("/nodes/%s/time", node), &out); err != nil {
		return nil, wrapErr("node time get", err)
	}
	return out, nil
}

// NodeTimeSet updates the node timezone (PUT /nodes/{node}/time).
// timezone must be a valid IANA zone from /usr/share/zoneinfo/zone.tab.
func (c *Client) NodeTimeSet(ctx context.Context, node, timezone string) error {
	if strings.TrimSpace(timezone) == "" {
		return apperrors.New(apperrors.CodeValidation, "proxmox: timezone is required")
	}
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return wrapErr("node "+node, err)
	}
	return wrapErr("node time set", n.SetTimezone(ctx, strings.TrimSpace(timezone)))
}

// ---- CPU models ----

// NodeQEMUCPUModels lists built-in plus custom CPU models visible from a node
// (typed (*Node).QEMUCPUModels, nodes_capabilities.go). arch is "" (host
// default), "x86_64" or "aarch64".
func (c *Client) NodeQEMUCPUModels(ctx context.Context, node, arch string) ([]*goproxmox.QEMUCPUModel, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	models, err := n.QEMUCPUModels(ctx, arch)
	return models, wrapErr("node cpu models", err)
}

// ---------------------------------------------------------------------------
// Containers (LXC): every method takes an explicit node — PVE hosts containers
// per node exactly like VMs. All SDK symbols verified against v0.8.1
// containers.go/nodes.go/types.go; creation goes through the flat
// ContainerOption list of (*Node).NewContainer (v0.8.1 ships no
// ContainerCreationOptions struct and no ostype constants).
// ---------------------------------------------------------------------------

// containerShutdownTimeout bounds graceful lxc shutdown requests (seconds);
// PVE's own default for POST .../status/shutdown is 60.
const containerShutdownTimeout = 60

// containerHandle returns a fully loaded Container (status/current + config)
// bound to its client so instance methods (Start/Snapshot/AddTag/...) work —
// the lxc twin of nodeHandle.
func (c *Client) containerHandle(ctx context.Context, node string, vmid int) (*goproxmox.Container, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	ct, err := n.Container(ctx, vmid)
	return ct, wrapErr("container status", err)
}

// ContainerGet loads the full container view (status/current + config).
func (c *Client) ContainerGet(ctx context.Context, node string, vmid int) (*goproxmox.Container, error) {
	return c.containerHandle(ctx, node, vmid)
}

// ContainersList lists every LXC guest on one node with live status
// (typed (*Node).Containers).
func (c *Client) ContainersList(ctx context.Context, node string) ([]*goproxmox.Container, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	cts, err := n.Containers(ctx)
	return cts, wrapErr("containers", err)
}

// ContainerCreate creates an LXC container from flattened options and returns
// its task (typed (*Node).NewContainer).
func (c *Client) ContainerCreate(ctx context.Context, node string, vmid int, opts []goproxmox.ContainerOption) (*goproxmox.Task, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	task, err := n.NewContainer(ctx, vmid, opts...)
	return task, wrapErr("create lxc", err)
}

func (c *Client) ContainerStart(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Start(ctx)
	return task, wrapErr("start", err)
}

// ContainerStop maps force→stop (hard kill) and graceful→shutdown with PVE's
// 60s default timeout (typed (*Container).Stop / (*Container).Shutdown).
func (c *Client) ContainerStop(ctx context.Context, node string, vmid int, force bool) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	var task *goproxmox.Task
	if force {
		task, err = ct.Stop(ctx)
	} else {
		task, err = ct.Shutdown(ctx, false, containerShutdownTimeout)
	}
	return task, wrapErr("stop", err)
}

func (c *Client) ContainerReboot(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Reboot(ctx)
	return task, wrapErr("reboot", err)
}

func (c *Client) ContainerSuspend(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Suspend(ctx)
	return task, wrapErr("suspend", err)
}

func (c *Client) ContainerResume(ctx context.Context, node string, vmid int) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Resume(ctx)
	return task, wrapErr("resume", err)
}

// ContainerDelete removes the container purging it from related configs
// (backup/replication/HA jobs); destroyUnreferencedDisks additionally wipes
// orphaned volumes matching the VMID across enabled storages.
func (c *Client) ContainerDelete(ctx context.Context, node string, vmid int, purge, destroyUnreferencedDisks bool) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Delete(ctx, &goproxmox.ContainerDeleteOptions{
		Purge:                    goproxmox.IntOrBool(purge),
		DestroyUnreferencedDisks: goproxmox.IntOrBool(destroyUnreferencedDisks),
	})
	return task, wrapErr("destroy", err)
}

// ContainerClone clones a container; targetNode "" keeps the source node.
func (c *Client) ContainerClone(ctx context.Context, node string, vmid int, opts *goproxmox.ContainerCloneOptions) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	newID, task, err := ct.Clone(ctx, opts)
	if err != nil {
		return nil, wrapErr("clone", err)
	}
	_ = newID // Clone allocates one via NextID when opts.NewID <= 0
	return task, nil
}

// ContainerMigrate migrates the container to targetNode via
// POST .../lxc/{vmid}/migrate. Online/restart mode is decided by PVE itself;
// BWLimit stays nil so the datacenter limit applies.
func (c *Client) ContainerMigrate(ctx context.Context, node string, vmid int, targetNode string) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Migrate(ctx, &goproxmox.ContainerMigrateOptions{Target: targetNode})
	return task, wrapErr("migrate", err)
}

// ContainerMigratePreconditions fetches PVE's dry-run summary
// (GET .../lxc/{vmid}/migrate?target=...); advisory only.
func (c *Client) ContainerMigratePreconditions(ctx context.Context, node string, vmid int, targetNode string) (*goproxmox.ContainerMigratePreconditions, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	pre, err := ct.MigratePreconditions(ctx, targetNode)
	return pre, wrapErr("migrate preconditions", err)
}

// ContainerTermProxy opens an xterm.js terminal ticket for the container.
func (c *Client) ContainerTermProxy(ctx context.Context, node string, vmid int) (*goproxmox.Term, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	term, err := ct.TermProxy(ctx)
	return term, wrapErr("container termproxy", err)
}

// ContainerSnapshotCreate wraps POST .../snapshot adding the optional
// description, which v0.8.1's typed NewSnapshot(name) cannot carry — same raw
// shape as the VM-side SnapshotCreate.
func (c *Client) ContainerSnapshotCreate(ctx context.Context, node string, vmid int, name, desc string) (*goproxmox.Task, error) {
	data := map[string]any{"snapname": name}
	if desc != "" {
		data["description"] = desc
	}
	path := fmt.Sprintf("/nodes/%s/lxc/%d/snapshot", node, vmid)
	return c.postTask(ctx, path, data, "create snapshot")
}

func (c *Client) ContainerSnapshotsList(ctx context.Context, node string, vmid int) ([]*goproxmox.ContainerSnapshot, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	snaps, err := ct.Snapshots(ctx)
	return snaps, wrapErr("list snapshots", err)
}

func (c *Client) ContainerSnapshotDelete(ctx context.Context, node string, vmid int, snapname string) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Snapshot(snapname).Delete(ctx)
	return task, wrapErr("delete snapshot", err)
}

// ContainerSnapshotRollback rolls the container back to snapname; start=true
// boots it again right after the rollback completes ((*ContainerSnapshot).
// Rollback carries the flag natively in v0.8.1).
func (c *Client) ContainerSnapshotRollback(ctx context.Context, node string, vmid int, snapname string, start bool) (*goproxmox.Task, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	task, err := ct.Snapshot(snapname).Rollback(ctx, start)
	return task, wrapErr("rollback snapshot", err)
}

// NodeRRDData pulls round-robin metrics for a node (GET /nodes/{node}/rrddata).
func (c *Client) NodeRRDData(ctx context.Context, node string, timeframe string, cf string) ([]*goproxmox.RRDData, error) {
	n, err := c.sdk.Node(ctx, node)
	if err != nil {
		return nil, wrapErr("node "+node, err)
	}
	data, err := n.RRDData(ctx, goproxmox.Timeframe(timeframe), goproxmox.ConsolidationFunction(cf))
	return data, wrapErr("rrd data", err)
}

// ContainerRRDData pulls round-robin metrics (CPU/mem/net/disk series).
func (c *Client) ContainerRRDData(ctx context.Context, node string, vmid int, timeframe string, cf string) ([]*goproxmox.RRDData, error) {
	ct, err := c.containerHandle(ctx, node, vmid)
	if err != nil {
		return nil, err
	}
	data, err := ct.RRDData(ctx, goproxmox.Timeframe(timeframe), goproxmox.ConsolidationFunction(cf))
	return data, wrapErr("rrd data", err)
}

// ---- Access: users / groups / roles (GET /access/*) ----

func (c *Client) AccessUsers(ctx context.Context) (goproxmox.Users, error) {
	users, err := c.sdk.Users(ctx)
	return users, wrapErr("access users", err)
}

func (c *Client) AccessUserCreate(ctx context.Context, user *goproxmox.NewUser) error {
	return wrapErr("access user create", c.sdk.NewUser(ctx, user))
}

func (c *Client) AccessUserUpdate(ctx context.Context, userid string, opts goproxmox.UserOptions) error {
	u, err := c.sdk.User(ctx, userid)
	if err != nil {
		return wrapErr("access user get", err)
	}
	return wrapErr("access user update", u.Update(ctx, opts))
}

func (c *Client) AccessUserDelete(ctx context.Context, userid string) error {
	u, err := c.sdk.User(ctx, userid)
	if err != nil {
		return wrapErr("access user get", err)
	}
	return wrapErr("access user delete", u.Delete(ctx))
}

func (c *Client) AccessGroups(ctx context.Context) (goproxmox.Groups, error) {
	groups, err := c.sdk.Groups(ctx)
	return groups, wrapErr("access groups", err)
}

func (c *Client) AccessRoles(ctx context.Context) (goproxmox.Roles, error) {
	roles, err := c.sdk.Roles(ctx)
	return roles, wrapErr("access roles", err)
}

func (c *Client) AccessACL(ctx context.Context) (goproxmox.ACLs, error) {
	acls, err := c.sdk.ACL(ctx)
	return acls, wrapErr("access acl", err)
}
