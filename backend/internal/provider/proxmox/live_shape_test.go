// live_shape_test.go exercises the adapter against captured-shape PVE JSON
// fixtures served by an httptest server — no real Proxmox cluster needed.
// The fixtures mirror the wire shapes of go-proxmox v0.8.1 decoders
// ({"data": ...} envelopes, the guest-agent's extra {"result": ...} layer,
// UPID strings whose fields Task.UnmarshalJSON round-trips wholesale,
// storage content rows, cluster resources rows).
package proxmox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	goproxmox "github.com/luthermonson/go-proxmox"

	"kilat.cloud/backend/internal/provider"
	apperrors "kilat.cloud/backend/pkg/errors"
)

const (
	upidStart   = "UPID:pve01:00003F2C:00000000:66F0A100:qmstart:201:root@pam:"
	upidStop    = "UPID:pve01:00003F2D:00000000:66F0A100:qmstop:201:root@pam:"
	upidGeneric = "UPID:pve01:00003F2E:00000000:66F0A100:qmtask:201:root@pam:"
)

// recorder captures every request so tests can assert on method+path,
// query parameters, and decode JSON bodies of mutating calls.
type recorder struct {
	mu       sync.Mutex
	requests []recorded
}

type recorded struct {
	Method string
	Path   string
	Query  string
	Body   []byte
	Auth   string // Authorization header value (PVEAPIToken proof)
}

func (r *recorder) add(rec recorded) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, rec)
}

func (r *recorder) count(method, suffix string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, req := range r.requests {
		if req.Method == method && strings.HasSuffix(req.Path, suffix) {
			n++
		}
	}
	return n
}

func (r *recorder) lastBody(method, suffix string) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.requests) - 1; i >= 0; i-- {
		req := r.requests[i]
		if req.Method == method && strings.HasSuffix(req.Path, suffix) {
			var body map[string]any
			_ = json.Unmarshal(req.Body, &body)
			return body
		}
	}
	return nil
}

// last returns the most recent request matching method+suffix, or nil.
func (r *recorder) last(method, suffix string) *recorded {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.requests) - 1; i >= 0; i-- {
		req := r.requests[i]
		if req.Method == method && strings.HasSuffix(req.Path, suffix) {
			cp := req
			return &cp
		}
	}
	return nil
}

// hasQueryParam reports whether any request matching method+suffix carried
// key=value in its query string (how the SDK sends DELETE flags).
func (r *recorder) hasQueryParam(method, suffix, key, val string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, req := range r.requests {
		if req.Method != method || !strings.HasSuffix(req.Path, suffix) {
			continue
		}
		for _, kv := range strings.Split(req.Query, "&") {
			if kv == key+"="+url.QueryEscape(val) || kv == key+"="+val {
				return true
			}
		}
	}
	return false
}

// newFixtureServer serves captured-shape PVE responses. When disableAgent is
// true the guest-agent route answers 404 so GetVM falls back to ipconfig0.
func newFixtureServer(t *testing.T, disableAgent bool) (*httptest.Server, *recorder) {
	t.Helper()
	rec := &recorder{}

	mux := http.NewServeMux()
	handle := func(pattern string, fn http.HandlerFunc) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			rec.add(recorded{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery,
				Body: body, Auth: r.Header.Get("Authorization")})
			fn(w, r)
		})
	}
	data := func(w http.ResponseWriter, payload string) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		rec.add(recorded{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery})
		http.NotFound(w, r)
	})

	handle("/api2/json/version", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{"release":"8.2","repoid":"a1b2c3d4e5f6","version":"8.2.4"}}`)
	})

	handle("/api2/json/nodes", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"node":"pve01","status":"online","maxcpu":32,"maxmem":68719476736},
			{"node":"pve02","status":"online","maxcpu":16,"maxmem":34359738368}
		]}`)
	})

	handle("/api2/json/cluster/nextid", func(w http.ResponseWriter, _ *http.Request) {
		// SDK NextID() decodes {"data":"<id>"} into a string then Atoi's it.
		data(w, `{"data":"201"}`)
	})

	// The SDK's Client.Cluster() fetches this before every Resources()/NextID()
	// call; its UnmarshalJSON walks the raw array entries by "type".
	handle("/api2/json/cluster/status", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"type":"cluster","name":"kilat-pve","id":"c1","nodes":2,"quorate":1,"version":5},
			{"type":"node","node":"pve01","status":"online","id":"node/pve01",
			 "name":"pve01","ip":"10.0.0.11","online":1,"local":1,"nodeid":1},
			{"type":"node","node":"pve02","status":"online","id":"node/pve02",
			 "name":"pve02","ip":"10.0.0.12","online":1,"local":0,"nodeid":2}
		]}`)
	})

	// Captured shape of GET /cluster/resources?type=vm rows.
	handle("/api2/json/cluster/resources", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"id":"qemu/101","type":"qemu","node":"pve01","vmid":101,"name":"web-01",
			 "status":"running","tags":"kilat","pool":"","template":0,
			 "maxcpu":4,"maxmem":8589934592,"maxdisk":68719476736,"uptime":3600},
			{"id":"qemu/102","type":"qemu","node":"pve02","vmid":102,"name":"other-vm",
			 "status":"stopped","tags":"","pool":"team-pool-x","template":0,
			 "maxcpu":2,"maxmem":2147483648,"maxdisk":21474836480},
			{"id":"lxc/103","type":"lxc","node":"pve01","vmid":103,"name":"ct-01",
			 "status":"running","tags":"kilat","template":0,
			 "maxcpu":1,"maxmem":1073741824,"maxdisk":8589934592},
			{"id":"lxc/102","type":"lxc","node":"pve01","vmid":102,"name":"ct-app",
			 "status":"running","tags":"kilat","template":0,
			 "maxcpu":2,"maxmem":2147483648,"maxdisk":10737418240},
			{"id":"qemu/104","type":"qemu","node":"pve01","vmid":104,"name":"tmpl-01",
			 "status":"stopped","tags":"kilat","pool":"","template":1,
			 "maxcpu":2,"maxmem":2147483648,"maxdisk":10737418240}
		]}`)
	})

	statusCurrent := func(vmid int) string {
		if vmid == 101 {
			return `{"data":{"status":"running","name":"web-01","cpus":4,"vmid":101,
				"maxmem":8589934592,"mem":4294967296,"maxdisk":68719476736,
				"qmpstatus":"running","agent":1,"uptime":3600}}`
		}
		return fmt.Sprintf(`{"data":{"status":"stopped","name":"guest-%d","cpus":2,"vmid":%d,
			"maxmem":2147483648,"maxdisk":21474836480}}`, vmid, vmid)
	}
	configFor := func(vmid int) string {
		if vmid == 101 {
			return `{"data":{
				"name":"web-01","digest":"aa11bb22cc33",
				"description":"primary web node","tags":"prod;tier-1",
				"cores":4,"memory":8192,"ostype":"l26","agent":"1",
				"boot":"order=scsi0","scsihw":"virtio-scsi-pci",
				"scsi0":"local-lvm:vm-101-disk-0,size=64G",
				"net0":"virtio=BC:24:11:2E:57:C3,bridge=vmbr0",
				"ipconfig0":"ip=203.0.113.10/24,gw=203.0.113.1",
				"sshkeys":"c3NoLWVkMjU1MTkgQUFBQiB0ZXN0QGtpbGF0LmNsb3Vk"
			}}`
		}
		return fmt.Sprintf(`{"data":{"name":"guest-%d","digest":"dd44ee55ff66","cores":2,"memory":2048}}`, vmid)
	}

	// POST create-QEMU / qmrestore; GET node-level qemu list.
	handle("/api2/json/nodes/pve01/qemu", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		default:
			data(w, `{"data":[{"vmid":101,"name":"web-01","status":"running","maxmem":8589934592,"maxdisk":68719476736,"cpus":4,"template":0}]}`)
		}
	})

	// One dispatcher per node serves every per-guest endpoint; exact-path
	// registrations elsewhere win over these subtrees where present.
	guestSubtree := func(node string) {
		prefix := "/api2/json/nodes/" + node + "/qemu/"
		handle(prefix, func(w http.ResponseWriter, r *http.Request) {
			rest := strings.TrimPrefix(r.URL.Path, prefix)
			parts := strings.Split(rest, "/")
			vmid, err := strconv.Atoi(parts[0])
			if err != nil {
				http.NotFound(w, r)
				return
			}
			tail := strings.Join(parts[1:], "/")
			switch {
			case tail == "" && r.Method == http.MethodDelete: // destroy vmid
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
			case tail == "status/current":
				data(w, statusCurrent(vmid))
			case tail == "config":
				switch r.Method {
				case http.MethodPost, http.MethodPut: // config set (AddTag/PatchVM)
					data(w, fmt.Sprintf(`{"data":%q}`, upidStop))
				default:
					data(w, configFor(vmid))
				}
			case tail == "status/start", tail == "status/reboot":
				data(w, fmt.Sprintf(`{"data":%q}`, upidStart))
			case tail == "status/suspend", tail == "status/resume":
				data(w, fmt.Sprintf(`{"data":%q}`, upidStop))
			case tail == "status/stop", tail == "status/shutdown":
				data(w, fmt.Sprintf(`{"data":%q}`, upidStop))
			case tail == "resize":
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
			case tail == "migrate":
				if r.Method == http.MethodGet { // advisory preconditions dry-run
					data(w, `{"data":{"running":true,"allowed_nodes":["pve02"],
						"local_disks":[{"volid":"local-lvm:vm-101-disk-0","size":68719476736,"cdrom":false}]}}`)
					return
				}
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric)) // POST starts the migration
			case tail == "vncproxy":
				data(w, `{"data":{"port":"5900","ticket":"vnc-ticket-abc123","upid":"UPID:pve01:00003F30:00000000:66F0A100:vncproxy:101:root@pam:","user":"root@pam"}}`)
			case tail == "snapshot":
				switch r.Method {
				case http.MethodGet:
					if vmid == 101 {
						data(w, `{"data":[
							{"name":"current","digest":"ff00"},
							{"name":"snap1","description":"daily backup","snaptime":1768435200,"vmstate":1,"parent":"current"}
						]}`)
						return
					}
					data(w, `{"data":[]}`) // other guests carry no snapshots
				default: // create/delete
					data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
				}
			case tail == "snapshot/snap1/rollback":
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
			case tail == "snapshot/snap1":
				if r.Method == http.MethodDelete {
					data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
					return
				}
				http.NotFound(w, r)
			case tail == "agent/network-get-interfaces":
				if disableAgent || vmid != 101 {
					http.NotFound(w, r)
					return
				}
				// QGA wraps its payload in {"result": ...} inside {"data": ...}.
				data(w, `{"data":{"result":[
					{"name":"lo","hardware-address":"00:00:00:00:00:00","ip-addresses":[
						{"ip-address-type":"ipv4","ip-address":"127.0.0.1","prefix":8}]},
					{"name":"eth0","hardware-address":"bc:24:11:2e:57:c3","ip-addresses":[
						{"ip-address-type":"ipv4","ip-address":"203.0.113.10","prefix":24},
						{"ip-address-type":"ipv6","ip-address":"2001:db8::1","prefix":64}]}
				]}}`)
			case strings.HasPrefix(tail, "firewall/ipset"):
				rest := strings.TrimPrefix(tail, "firewall/ipset")
				switch {
				case rest == "" && r.Method == http.MethodGet:
					data(w, `{"data":[
						{"name":"kilat-blocklist","comment":"blocked subnets","digest":"aa11"},
						{"name":"empty-set","digest":"bb22"}
					]}`)
				case rest == "" && r.Method == http.MethodPost:
					data(w, `{"data":null}`)
				case rest == "/kilat-blocklist" && r.Method == http.MethodGet:
					data(w, `{"data":[
						{"cidr":"203.0.113.0/24","comment":"bad subnet"},
						{"cidr":"198.51.100.7/32"}
					]}`)
				case rest == "/kilat-blocklist" && r.Method == http.MethodDelete:
					data(w, `{"data":null}`)
				case rest == "/kilat-blocklist/203.0.113.0/24" &&
					(r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete):
					data(w, `{"data":null}`)
				default:
					http.NotFound(w, r)
				}
			default:
				http.NotFound(w, r)
			}
		})
	}
	guestSubtree("pve01")
	guestSubtree("pve02")

	// LXC subtree: node-level list/create on the exact path plus a
	// dispatcher for container 102 on pve01 covering status, power,
	// migrate, termproxy, snapshots, rrddata and clone — the wire twins of
	// the qemu routes above.
	handle("/api2/json/nodes/pve01/lxc", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		default:
			data(w, `{"data":[{"vmid":102,"name":"ct-app","status":"running","template":0,
				"cpus":2,"maxmem":2147483648,"maxdisk":10737418240}]}`)
		}
	})
	lxcPrefix := "/api2/json/nodes/pve01/lxc/"
	handle(lxcPrefix, func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, lxcPrefix)
		parts := strings.Split(rest, "/")
		vmid, err := strconv.Atoi(parts[0])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		tail := strings.Join(parts[1:], "/")
		switch {
		case tail == "" && r.Method == http.MethodDelete: // destroy ct vmid
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		case tail == "status/current":
			data(w, fmt.Sprintf(`{"data":{"status":"running","name":"ct-app","cpus":2,"vmid":%d,
				"maxmem":2147483648,"mem":1073741824,"maxdisk":10737418240,"uptime":7200}}`, vmid))
		case tail == "config":
			switch r.Method {
			case http.MethodPost, http.MethodPut: // config set (AddTag)
				data(w, fmt.Sprintf(`{"data":%q}`, upidStop))
			default:
				data(w, fmt.Sprintf(`{"data":{"hostname":"ct-app","digest":"bb22cc33dd44",
					"cores":2,"memory":512,"ostype":"debian","unprivileged":1,
					"features":"nesting=1","rootfs":"local-lvm:vm-%d-disk-0,size=10G"}}`, vmid))
			}
		case tail == "status/start", tail == "status/reboot":
			data(w, fmt.Sprintf(`{"data":%q}`, upidStart))
		case tail == "status/stop", tail == "status/shutdown", tail == "status/suspend", tail == "status/resume":
			data(w, fmt.Sprintf(`{"data":%q}`, upidStop))
		case tail == "migrate":
			if r.Method == http.MethodGet { // advisory preconditions dry-run
				data(w, `{"data":{"running":true,"allowed_nodes":["pve02"],
					"local_disks":[{"volid":"local-lvm:vm-102-disk-0","size":10737418240}]}}`)
				return
			}
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric)) // POST starts the migration
		case tail == "termproxy":
			data(w, `{"data":{"port":"5900","ticket":"ct-term-ticket-abc",
				"upid":"UPID:pve01:00004110:00000000:66F0B210:termproxy:102:root@pam:"}}`)
		case tail == "rrddata":
			data(w, `{"data":[{"time":1768435200,"cpu":0.05,"maxmem":2147483648},{"time":1768435260,"cpu":0.06,"maxmem":2147483648}]}`)
		case tail == "clone":
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		case tail == "snapshot":
			if r.Method == http.MethodGet {
				data(w, `{"data":[
					{"name":"current","digest":"ff11"},
					{"name":"ctsnap1","description":"daily backup","snaptime":1768435200,"parent":"current"}
				]}`)
				return
			}
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric)) // create snapshot
		case tail == "snapshot/ctsnap1/rollback":
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		case tail == "snapshot/ctsnap1":
			if r.Method == http.MethodDelete {
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	// pve02 hosts guest 102 only; its storages are empty but must exist for
	// the storage walk over online nodes.
	handle("/api2/json/nodes/pve02/storage", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[]}`)
	})

	// Node status — fetched by Client.Node() for every handle lookup.
	for _, node := range []string{"pve01", "pve02"} {
		handle("/api2/json/nodes/"+node+"/status", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
				return
			}
			data(w, `{"data":{
				"uptime":987654,"pveversion":"pve-manager/8.2.4",
				"kversion":"Linux version 6.8","cpu":0.05,"wait":0.01,
				"loadavg":["0.10","0.15","0.20"],
				"cpuinfo":{"cores":32,"cpus":64,"model":"EPYC"},
				"memory":{"total":68719476736,"used":34359738368},
				"swap":{"total":8589934592,"used":0},
				"rootfs":{"total":100000000000,"used":50000000000,"avail":50000000000}
			}}`)
		})
	}

	// Storage inventory plus per-storage status (fetched by Node.Storage()).
	handle("/api2/json/nodes/pve01/storage", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"storage":"local-lvm","type":"lvmthin","content":"images,rootdir","enabled":1,"active":1,"used_fraction":0.42},
			{"storage":"backup-store","type":"nfs","content":"backup","enabled":1,"active":1,"used_fraction":0.1},
			{"storage":"iso-store","type":"dir","content":"iso","enabled":1,"active":1,"used_fraction":0.05},
			{"storage":"dead-store","type":"rbd","content":"backup","enabled":0,"active":0,"used_fraction":0}
		]}`)
	})
	handle("/api2/json/nodes/pve01/storage/", func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/api2/json/nodes/pve01/storage/")
		parts := strings.Split(rest, "/")
		name := parts[0]
		tail := strings.Join(parts[1:], "/")
		switch {
		case tail == "status":
			data(w, fmt.Sprintf(`{"data":{"storage":%q,"type":"dir","content":"images,iso,backup","enabled":1,"active":1,"used_fraction":0.1}}`, name))
		case tail == "download-url":
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		case tail == "file-restore/list":
			// GET .../storage/{name}/file-restore/list?volume=...&filepath=<base64>.
			// The SDK base64-encodes filepath; the fixture answers the decoded
			// row shapes of (*Storage).FileRestoreList (storage_content.go).
			data(w, `{"data":[
				{"filepath":"/etc","type":"d","text":"etc","leaf":0},
				{"filepath":"/etc/hostname","type":"f","text":"hostname","size":13,"mtime":1768435200,"leaf":1}
			]}`)
		case tail == "content" && len(parts) == 2:
			if r.Method == http.MethodDelete {
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
				return
			}
			data(w, storageContentFor(name))
		case len(parts) >= 3 && parts[1] == "content":
			// Single-volume paths: GET .../content/<volid> (ISO lookup and
			// raw backup streaming) and DELETE .../content/<volid>.
			if r.Method == http.MethodDelete {
				data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
				return
			}
			if r.Method == http.MethodGet {
				// The vzdump archive downloads as a raw byte stream with a
				// Content-Length, exactly what StorageContentDownload expects
				// from PVE's content endpoint.
				if parts[0] == "backup-store" &&
					strings.Join(parts[2:], "/") == "backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst" {
					w.Header().Set("Content-Type", "application/octet-stream")
					w.Header().Set("Content-Length", strconv.Itoa(len(backupDownloadPayload)))
					_, _ = w.Write(backupDownloadPayload)
					return
				}
				data(w, `{"data":{"format":"iso","size":7811891200,"ctime":1767000100}}`)
				return
			}
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	})

	// Every task finishes successfully on first poll. The payload must echo
	// upid/node/type/user/id: Task.UnmarshalJSON copies the decoded struct
	// over the live task wholesale, so missing fields would wipe its identity
	// and break the next poll cycle.
	handle("/api2/json/nodes/pve01/tasks/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/status") {
			http.NotFound(w, r)
			return
		}
		parts := strings.Split(r.URL.Path, "/") // .../tasks/<UPID>/status
		upid := parts[len(parts)-2]
		data(w, fmt.Sprintf(`{"data":{"upid":%q,"node":"pve01","type":"qmtask",
			"user":"root@pam","id":"201","status":"stopped","exitstatus":"OK",
			"starttime":1768435200,"endtime":1768435206}}`, upid))
	})

	// Node-level recent-task index (GET /nodes/{node}/tasks). Registered as
	// exact paths: ServeMux would 301 the bare path onto the trailing-slash
	// subtree above instead of serving it.
	handle("/api2/json/nodes/pve01/tasks", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"upid":"UPID:pve01:00003F41:00000000:66F0A100:vzdump:101:root@pam:",
			 "node":"pve01","type":"vzdump","user":"root@pam","id":"101",
			 "status":"OK","starttime":1768435200,"endtime":1768435800},
			{"upid":"UPID:pve01:00003F42:00000000:66F0A100:qmstart:102:root@pam:",
			 "node":"pve01","type":"qmstart","user":"root@pam","id":"102",
			 "status":"running","starttime":1768435900}
		]}`)
	})
	handle("/api2/json/nodes/pve02/tasks", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[]}`)
	})

	// ---- extended capability fixtures ----

	handle("/api2/json/nodes/pve01/qemu/101/termproxy", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{"port":"5900","ticket":"term-ticket-abc",
			"upid":"UPID:pve01:00004100:00000000:66F0B200:termproxy:101:root@pam:"}}`)
	})
	for _, op := range []string{"pause", "resume", "reset"} {
		handle("/api2/json/nodes/pve01/qemu/101/status/"+op, func(w http.ResponseWriter, _ *http.Request) {
			data(w, `{"data":"UPID:pve01:00004101:00000000:66F0B201:vzdump:101:root@pam:"}`)
		})
	}
	handle("/api2/json/nodes/pve01/qemu/101/clone", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":"UPID:pve01:00004102:00000000:66F0B202:vzdump:101:root@pam:"}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/template", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":"UPID:pve01:00004103:00000000:66F0B203:vzdump:101:root@pam:"}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/move_disk", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":"UPID:pve01:00004104:00000000:66F0B204:vzdump:101:root@pam:"}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/agent/ping", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{}}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/agent/get-osinfo", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{"result":{"name":"Ubuntu","kernel":"Linux 6.8","version":"24.04"}}}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/rrddata", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[{"time":1768435200,"cpu":0.02,"maxmem":2147483648},{"time":1768435260,"cpu":0.03,"maxmem":2147483648}]}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/firewall/rules", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			data(w, `{"data":null}`)
			return
		}
		data(w, `{"data":[
			{"pos":0,"type":"in","action":"ACCEPT","enable":1,"source":"10.0.0.0/8","dport":"22","proto":"tcp","comment":"ssh"},
			{"pos":1,"type":"in","action":"DROP","enable":0,"comment":"block rest"}
		]}`)
	})
	handle("/api2/json/nodes/pve01/qemu/101/firewall/rules/", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			data(w, `{"data":{"pos":0,"type":"in","action":"ACCEPT","enable":1}}`)
		case http.MethodPut:
			data(w, `{"data":null}`)
		case http.MethodDelete:
			data(w, `{"data":null}`)
		default:
			http.NotFound(w, r)
		}
	})
	handle("/api2/json/nodes/pve01/qemu/101/firewall/options", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			data(w, `{"data":{"enable":1,"input":"ACCEPT","log_level_in":"nolog"}}`)
			return
		}
		data(w, `{"data":null}`)
	})
	handle("/api2/json/nodes/pve01/disks/list", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"devpath":"/dev/sda","model":"QEMU HARDDISK","size":107374182400,"used":"LVM","type":"ssd","wearout":"100"},
			{"devpath":"/dev/sdb","model":"QEMU HARDDISK","size":107374182400,"used":"no","type":"ssd","wearout":"98"}
		]}`)
	})
	handle("/api2/json/nodes/pve01/certificates/info", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[]}`)
	})
	handle("/api2/json/cluster/log", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[{"user":"root@pam","time":1768435200,"sev":4,"msg":"starting task UPID"}]}`)
	})
	handle("/api2/json/cluster/tasks", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[]}`)
	})
	handle("/api2/json/cluster/ha/resources", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			data(w, `{"data":null}`)
			return
		}
		data(w, `{"data":[{"sid":"vm:101","state":"started","node":"pve01","type":"vm"}]}`)
	})
	handle("/api2/json/pools", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut: // create / update-membership
			data(w, `{"data":null}`)
		default:
			data(w, `{"data":[{"poolid":"tenant-a","comment":"customer A"}]}`)
		}
	})
	handle("/api2/json/pools/", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[{"poolid":"tenant-a","comment":"customer A","members":[]}]}`)
	})
	handle("/api2/json/cluster/ceph/status", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{"health":{"status":"HEALTH_OK"},"quorum_names":["pve01","pve02"]}}`)
	})
	handle("/api2/json/cluster/sdn/zones", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[{"zone":"lab","type":"simple","state":"ok"}]}`)
	})
	handle("/api2/json/cluster/sdn/vnets", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[{"vnet":"vnlab","zone":"lab","state":"ok"}]}`)
	})

	// Backup job run-now: POST /cluster/backup/{id}/run (no typed SDK wrapper;
	// base path mirrors cluster.go's verified /cluster/backup/{id} routes).
	handle("/api2/json/cluster/backup/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/run") {
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
			return
		}
		http.NotFound(w, r)
	})

	// HA stack arm/disarm (POST /cluster/ha/status/{arm-ha,disarm-ha}).
	handle("/api2/json/cluster/ha/status/arm-ha", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":null}`)
	})
	handle("/api2/json/cluster/ha/status/disarm-ha", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":null}`)
	})

	// Cluster-wide storage definitions: GET/POST /storage and
	// GET/PUT/DELETE /storage/{name}.
	handle("/api2/json/storage", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
			return
		}
		data(w, `{"data":[
			{"storage":"local-lvm","type":"lvmthin","content":"images,rootdir","digest":"st01","shared":0},
			{"storage":"backup-store","type":"nfs","content":"backup","digest":"st02","shared":1,"nodes":"pve01 pve02"}
		]}`)
	})
	handle("/api2/json/storage/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api2/json/storage/")
		if name == "" || strings.Contains(name, "/") {
			http.NotFound(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet:
			data(w, fmt.Sprintf(`{"data":{"storage":%q,"type":"nfs","content":"backup","digest":"st02","shared":1}}`, name))
		case http.MethodPut, http.MethodDelete:
			data(w, fmt.Sprintf(`{"data":%q}`, upidGeneric))
		default:
			http.NotFound(w, r)
		}
	})

	// Node resolver config: GET returns search + dns1/dns2 (dns3 absent =
	// unset slot), PUT acknowledges with a null payload.
	handle("/api2/json/nodes/pve01/dns", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			data(w, `{"data":null}`)
			return
		}
		data(w, `{"data":{"search":"kilat.internal","dns1":"10.0.0.1","dns2":"10.0.0.2"}}`)
	})

	// Node clock: PVE shape is {"timezone": str, "localtime": unix-epoch}.
	handle("/api2/json/nodes/pve01/time", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":{"timezone":"Asia/Jakarta","localtime":1768435200}}`)
	})

	// QEMU CPU models; the arch query parameter is echoed by the test.
	handle("/api2/json/nodes/pve01/capabilities/qemu/cpu", func(w http.ResponseWriter, _ *http.Request) {
		data(w, `{"data":[
			{"name":"host","vendor":"unknown","custom":false},
			{"name":"custom-epyc","vendor":"AMD","custom":true}
		]}`)
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, rec
}

// storageContentFor returns captured-shape content rows per storage name
// (the adapter lists unfiltered and narrows by content type itself).
func storageContentFor(storage string) string {
	switch storage {
	case "local-lvm":
		return `{"data":[
			{"volid":"local-lvm:vm-101-disk-0","format":"raw","size":68719476736,"vmid":101,"ctime":1700000000}
		]}`
	case "backup-store":
		return `{"data":[
			{"volid":"backup-store:backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst","format":"vma.zst","size":21474836480,"vmid":101,"ctime":1768435201},
			{"volid":"backup-store:backup/vzdump-qemu-999-2026_01_15-03_00_02.vma.zst","format":"vma.zst","size":10737418240,"vmid":999,"ctime":1768435202}
		]}`
	case "iso-store":
		return `{"data":[
			{"volid":"iso-store:iso/ubuntu-24.04.iso","format":"iso","size":6212993024,"ctime":1767000000},
			{"volid":"iso-store:iso/debian-12.iso","format":"iso","size":7811891200,"ctime":1767000100}
		]}`
	default:
		return `{"data":[]}`
	}
}

// backupDownloadPayload is the small stand-in body served for
// GET .../storage/backup-store/content/backup/vzdump-qemu-101-….vma.zst — a
// real archive reaches multi-GB sizes, so only its wire shape is exercised.
var backupDownloadPayload = []byte("VZDUMP-FIXTURE-0123456789ABCDEF")

func newTestAdapter(t *testing.T, disableAgent bool) (*Adapter, *recorder) {
	t.Helper()
	srv, rec := newFixtureServer(t, disableAgent)
	a, err := NewAdapter(srv.URL, "kilat@pam!cloud", "11111111-2222-3333-4444-555555555555")
	if err != nil {
		t.Fatalf("NewAdapter: %v", err)
	}
	return a, rec
}

// ---- construction / client ----

func TestNewAdapterValidation(t *testing.T) {
	if _, err := NewAdapter("", "u@r!t", "s"); err == nil {
		t.Fatal("empty baseURL must fail")
	}
	srv, _ := newFixtureServer(t, false)
	defer srv.Close()
	if _, err := NewAdapter(srv.URL, "badtoken", "secret"); err == nil {
		t.Fatal("malformed tokenUser must fail")
	}
	a, err := NewAdapter(srv.URL+"/", "kilat@pam!cloud", "secret")
	if err != nil {
		t.Fatalf("NewAdapter: %v", err)
	}
	if a.c.apiRoot != srv.URL+"/api2/json" {
		t.Fatalf("apiRoot not normalized: %q", a.c.apiRoot)
	}
}

func TestVersionDecode(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	v, err := a.c.Version(context.Background())
	if err != nil {
		t.Fatalf("Version: %v", err)
	}
	if v.Version != "8.2.4" || v.Release != "8.2" {
		t.Fatalf("unexpected version %+v", v)
	}
}

// ---- BuildQemuOptions (pure function) ----

func optMap(opts []goproxmox.VirtualMachineOption) map[string]any {
	m := make(map[string]any, len(opts))
	for _, o := range opts {
		m[o.Name] = o.Value
	}
	return m
}

func TestBuildQemuOptionsWithISOAndKeys(t *testing.T) {
	spec := provider.InstanceSpec{
		Name:          "kilat-test",
		CPU:           2,
		RAM:           2048,
		Disk:          40,
		IsoExternalID: "iso-store:iso/ubuntu-24.04.iso",
		SSHKeyIDs:     []string{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterial test@kilat.cloud"},
	}
	opts := optMap(BuildQemuOptions(spec, "pve01", 201))

	want := map[string]any{
		"name":   "kilat-test",
		"cores":  2,
		"memory": 2048,
		"scsi0":  "local-lvm:size=40G",
		"scsihw": "virtio-scsi-pci",
		"net0":   "virtio,bridge=vmbr0",
		"ostype": "l26",
		"agent":  1,
		"ide2":   "iso-store:iso/ubuntu-24.04.iso,media=cdrom",
		"boot":   "order=ide2;local-lvm",
		"ciuser": "kubectl",
	}
	for k, v := range want {
		if opts[k] != v {
			t.Fatalf("option %q = %#v, want %#v", k, opts[k], v)
		}
	}
	keys, ok := opts["sshkeys"].(string)
	if !ok || !strings.Contains(keys, "ssh-ed25519%20") || strings.Contains(keys, "+") {
		t.Fatalf("sshkeys not PVE-encoded: %q", keys)
	}
	if !strings.HasSuffix(keys, "test%40kilat.cloud") {
		t.Fatalf("sshkeys lost key material tail: %q", keys)
	}
}

func TestBuildQemuOptionsDiskFirstNoKeys(t *testing.T) {
	spec := provider.InstanceSpec{Name: "plain", CPU: 4, RAM: 8192, Disk: 100}
	opts := optMap(BuildQemuOptions(spec, "pve01", 301))
	if opts["boot"] != "order=local-lvm" {
		t.Fatalf("boot order: %v", opts["boot"])
	}
	if _, ok := opts["ide2"]; ok {
		t.Fatal("ide2 set without ISO")
	}
	if _, ok := opts["ciuser"]; ok {
		t.Fatal("ciuser set without keys")
	}
	if _, ok := opts["sshkeys"]; ok {
		t.Fatal("sshkeys set without material")
	}
	// Opaque provider key ids (no material) must not leak into sshkeys.
	spec.SSHKeyIDs = []string{"pve-cloudinit"}
	opts = optMap(BuildQemuOptions(spec, "pve01", 301))
	if _, ok := opts["sshkeys"]; ok {
		t.Fatal("opaque key id injected as sshkey")
	}
}

// ---- provisioning flows through the fixture server ----

func TestProvisionVMWithISOStaysStopped(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	spec := provider.InstanceSpec{
		Location:      "pve01",
		Name:          "kilat-test",
		CPU:           2,
		RAM:           2048,
		Disk:          40,
		IsoExternalID: "iso-store:iso/ubuntu-24.04.iso",
		SSHKeyIDs:     []string{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterial test@kilat.cloud"},
	}
	if err := a.ProvisionVM(context.Background(), spec); err != nil {
		t.Fatalf("ProvisionVM: %v", err)
	}
	create := rec.lastBody(http.MethodPost, "/nodes/pve01/qemu")
	if create == nil {
		t.Fatal("create POST not recorded")
	}
	for key, want := range map[string]any{
		"cores":  float64(2),
		"memory": float64(2048),
		"scsi0":  "local-lvm:size=40G",
		"ide2":   "iso-store:iso/ubuntu-24.04.iso,media=cdrom",
		"boot":   "order=ide2;local-lvm",
		"ciuser": "kubectl",
		"ostype": "l26",
	} {
		if got := create[key]; got != want {
			t.Fatalf("created option %q = %#v, want %#v", key, got, want)
		}
	}
	if n := rec.count(http.MethodPost, "/status/start"); n != 0 {
		t.Fatalf("ISO install flow must stay stopped, got %d start calls", n)
	}
	if n := rec.count(http.MethodPost, "/qemu/201/config"); n < 1 {
		t.Fatal("best-effort kilat tag was never applied")
	}
}

func TestProvisionVMWithoutISOStarts(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	spec := provider.InstanceSpec{Location: "pve01", Name: "plain-vm", CPU: 1, RAM: 512, Disk: 20}
	if err := a.ProvisionVM(context.Background(), spec); err != nil {
		t.Fatalf("ProvisionVM: %v", err)
	}
	if n := rec.count(http.MethodPost, "/status/start"); n != 1 {
		t.Fatalf("expected exactly one start call, got %d", n)
	}
	create := rec.lastBody(http.MethodPost, "/nodes/pve01/qemu")
	if create["boot"] != "order=local-lvm" {
		t.Fatalf("boot = %#v", create["boot"])
	}
	if _, ok := create["ide2"]; ok {
		t.Fatal("ide2 set without ISO")
	}
}

// ---- GetVM / ListVMs / PatchVM / ResizePolicy ----

func TestGetVMPrefersAgentIPs(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	vm, err := a.GetVM(context.Background(), "101")
	if err != nil {
		t.Fatalf("GetVM: %v", err)
	}
	if vm.Status != "active" || vm.PowerStatus != "running" {
		t.Fatalf("status mapping wrong: %+v", vm)
	}
	if vm.MainIPv4 != "203.0.113.10" || vm.MainIPv6 != "2001:db8::1" {
		t.Fatalf("agent IPs not picked: %q %q", vm.MainIPv4, vm.MainIPv6)
	}
	if vm.VCPU != 4 || vm.RAM != 8192 || vm.Disk != 64 {
		t.Fatalf("spec fields wrong: vcpu=%d ram=%d disk=%d", vm.VCPU, vm.RAM, vm.Disk)
	}
}

func TestGetVMConfigFallbackWhenAgentMissing(t *testing.T) {
	a, _ := newTestAdapter(t, true /* disableAgent */)
	vm, err := a.GetVM(context.Background(), "101")
	if err != nil {
		t.Fatalf("GetVM: %v", err)
	}
	if vm.MainIPv4 != "203.0.113.10" { // from ipconfig0
		t.Fatalf("ipconfig0 fallback failed: %q", vm.MainIPv4)
	}
	if vm.MainIPv6 != "" {
		t.Fatalf("unexpected ipv6 %q", vm.MainIPv6)
	}
}

func TestListVMsFiltersTagAndPool(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()

	vms, err := a.ListVMs(ctx, "")
	if err != nil {
		t.Fatalf("ListVMs: %v", err)
	}
	// Only qemu + tag kilat + non-template survives: web-01 (lxc and the
	// template row are dropped).
	if len(vms) != 1 || vms[0].ExternalID != "101" {
		t.Fatalf("tag filter broken: %+v", vms)
	}
	if vms[0].VCPU != 4 || vms[0].RAM != 8192 || vms[0].Disk != 64 {
		t.Fatalf("resource-derived specs wrong: %+v", vms[0])
	}

	vms, err = a.ListVMs(ctx, "team-pool-x")
	if err != nil {
		t.Fatalf("ListVMs pool: %v", err)
	}
	if len(vms) != 2 {
		t.Fatalf("pool filter broken: %+v", vms)
	}
	var sawOther bool
	for _, vm := range vms {
		if vm.ExternalID == "102" {
			sawOther = true
			if vm.Status != "stopped" {
				t.Fatalf("pool row status: %+v", vm)
			}
		}
	}
	if !sawOther {
		t.Fatal("pool member missing")
	}
}

func TestPatchVMResizeRules(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	err := a.PatchVM(ctx, "101", map[string]any{"disk": int64(32)})
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeInvalidState {
		t.Fatalf("shrink must be rejected with INSTANCE_INVALID_STATE, got %v", err)
	}

	if err := a.PatchVM(ctx, "101", map[string]any{"cpu": 8, "ram": 16384}); err != nil {
		t.Fatalf("PatchVM cpu/ram: %v", err)
	}
	body := rec.lastBody(http.MethodPost, "/qemu/101/config")
	if body["cores"] != float64(8) || body["memory"] != float64(16384) {
		t.Fatalf("config patch body: %#v", body)
	}

	if err := a.PatchVM(ctx, "101", map[string]any{"disk": int64(96)}); err != nil {
		t.Fatalf("PatchVM grow: %v", err)
	}
	resize := rec.lastBody(http.MethodPut, "/qemu/101/resize")
	if resize == nil {
		t.Fatal("resize call missing")
	}
	if resize["disk"] != "scsi0" || resize["size"] != "+32G" {
		t.Fatalf("resize params: %#v", resize)
	}
}

func TestResizePolicy(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	if !a.ResizePolicy().AllowDowngrade {
		t.Fatal("proxmox must allow both resize directions; upgrade-only is an Onidel-only rule")
	}
}

// ---- snapshots / backups ----

func TestSnapshotLifecycle(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	extID, err := a.CreateSnapshot(ctx, "101", "snap1", "daily backup")
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	if extID != "101/snap1" {
		t.Fatalf("ext id %q", extID)
	}
	body := rec.lastBody(http.MethodPost, "/qemu/101/snapshot")
	if body["snapname"] != "snap1" || body["description"] != "daily backup" {
		t.Fatalf("snapshot body: %#v", body)
	}

	snaps, err := a.ListSnapshots(ctx)
	if err != nil {
		t.Fatalf("ListSnapshots: %v", err)
	}
	// web-01 (tag kilat) contributes snap1; "current" pseudo-snapshots skipped;
	// template/lxc rows excluded.
	if len(snaps) != 1 {
		t.Fatalf("want 1 snapshot, got %+v", snaps)
	}
	s := snaps[0]
	if s.ExternalID != "101/snap1" || s.Desc != "daily backup" ||
		s.CreatedAt != time.Unix(1768435200, 0).UTC().Format(time.RFC3339) ||
		s.Status != "available" {
		t.Fatalf("snapshot mapping: %+v", s)
	}

	if err := a.RestoreFromSnapshot(ctx, "101", "101/snap1"); err != nil {
		t.Fatalf("RestoreFromSnapshot: %v", err)
	}
	if rec.count(http.MethodPost, "/snapshot/snap1/rollback") != 1 {
		t.Fatal("rollback not called")
	}
	if rec.count(http.MethodPost, "/qemu/101/status/start") != 1 {
		t.Fatal("restore must start the VM after rollback")
	}

	if err := a.DeleteSnapshot(ctx, "101/snap1"); err != nil {
		t.Fatalf("DeleteSnapshot: %v", err)
	}
	if rec.count(http.MethodDelete, "/qemu/101/snapshot/snap1") != 1 {
		t.Fatal("delete snapshot endpoint not hit")
	}
}

func TestBackupsListAndRestore(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	backups, err := a.VMBackups(ctx, "101")
	if err != nil {
		t.Fatalf("VMBackups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("want exactly the vm-101 vzdump, got %+v", backups)
	}
	b := backups[0]
	wantCreated := time.Unix(1768435201, 0).UTC().Format(time.RFC3339)
	if b.ExternalID != "backup-store:backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst" ||
		b.Size != 21474836480 || b.CreatedAt != wantCreated ||
		b.InstanceExternalID != "101" || b.Status != "available" {
		t.Fatalf("backup mapping: %+v (created want %q)", b, wantCreated)
	}

	const volid = "backup-store:backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst"
	if err := a.RestoreFromBackup(ctx, "101", volid); err != nil {
		t.Fatalf("RestoreFromBackup: %v", err)
	}
	body := rec.lastBody(http.MethodPost, "/nodes/pve01/qemu")
	if body["archive"] != volid || body["restore"] != float64(1) ||
		body["force"] != float64(1) || body["storage"] != "local-lvm" ||
		body["vmid"] != float64(101) {
		t.Fatalf("qmrestore body: %#v", body)
	}
}

// ---- backup content streaming (the backend download proxy) ----

func TestOpenBackupContentStreamsRawVolume(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	const volid = "backup-store:backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst"
	rc, size, err := a.OpenBackupContent(ctx, volid)
	if err != nil {
		t.Fatalf("OpenBackupContent: %v", err)
	}
	defer rc.Close()

	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if string(got) != string(backupDownloadPayload) {
		t.Fatalf("stream payload = %q, want %q", got, backupDownloadPayload)
	}
	if size != int64(len(backupDownloadPayload)) {
		t.Fatalf("size = %d, want %d (Content-Length)", size, len(backupDownloadPayload))
	}

	dl := rec.last(http.MethodGet,
		"/storage/backup-store/content/backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst")
	if dl == nil {
		t.Fatal("content download request not recorded")
	}
	// The whole point of the proxy: the secret PVEAPIToken header must ride
	// server-side on this request.
	wantAuth := "PVEAPIToken=kilat@pam!cloud=11111111-2222-3333-4444-555555555555"
	if dl.Auth != wantAuth {
		t.Fatalf("Authorization header = %q, want %q", dl.Auth, wantAuth)
	}
}

func TestOpenBackupContentRejectsInvalidExtIDs(t *testing.T) {
	a, _ := newTestAdapter(t, false)

	for _, bad := range []string{
		"",
		"garbage",
		"backup-store:vzdump-qemu-101.vma.zst", // missing :backup/ segment
		"local-lvm:vm-101-disk-0",              // a disk volid, not a backup
		"iso-store:iso/ubuntu-24.04.iso",       // wrong content type
		"backup-store:backup/a/b.vma.zst",      // extra slash in filename
	} {
		_, _, err := a.OpenBackupContent(context.Background(), bad)
		var appErr *apperrors.AppError
		if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
			t.Fatalf("ext id %q must yield VALIDATION_ERROR, got %v", bad, err)
		}
	}
}

func TestOpenBackupContentUnknownVolumeNotFound(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	_, _, err := a.OpenBackupContent(context.Background(),
		"backup-store:backup/vzdump-qemu-404-2026_01_15-03_00_00.vma.zst")
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown volume must yield RESOURCE_NOT_FOUND, got %v", err)
	}
}

// ---- ISO ----

func TestISOListCreateByURLAndDelete(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	isos, err := a.ListISOs(ctx, "team")
	if err != nil {
		t.Fatalf("ListISOs: %v", err)
	}
	if len(isos) != 2 {
		t.Fatalf("want 2 isos, got %+v", isos)
	}
	first := isos[0]
	if first.Filename != "ubuntu-24.04.iso" || first.Size != 6212993024 ||
		first.IsSystem || first.ProgressPercent != 100 ||
		first.ExternalID != "iso-store:iso/ubuntu-24.04.iso" {
		t.Fatalf("iso mapping: %+v", first)
	}

	if err := a.CreateISOByURL(ctx, "team", "https://mirror.example.org/isos/tinycore.iso"); err != nil {
		t.Fatalf("CreateISOByURL: %v", err)
	}
	dl := rec.lastBody(http.MethodPost, "/storage/iso-store/download-url")
	if dl == nil || dl["content"] != "iso" || dl["filename"] != "tinycore.iso" ||
		dl["url"] != "https://mirror.example.org/isos/tinycore.iso" {
		t.Fatalf("download-url body: %#v", dl)
	}

	if err := a.CreateISOByURL(ctx, "team", "ftp://bad/example.iso"); err == nil {
		t.Fatal("non-http iso url must be rejected")
	}

	if err := a.DeleteISO(ctx, "iso-store:iso/debian-12.iso"); err != nil {
		t.Fatalf("DeleteISO: %v", err)
	}
	if rec.count(http.MethodDelete, "/storage/iso-store/content/iso-store:iso/debian-12.iso") != 1 {
		t.Fatal("iso delete endpoint not hit")
	}
}

// ---- VNC ----

func TestVNCSessionTicket(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	vncURL, expire, err := a.VNCSession(context.Background(), "101")
	if err != nil {
		t.Fatalf("VNCSession: %v", err)
	}
	if !strings.HasPrefix(vncURL, "ws://") ||
		!strings.Contains(vncURL, "/api2/json/nodes/pve01/qemu/101/vncwebsocket?") {
		t.Fatalf("vnc url malformed: %q", vncURL)
	}
	if !strings.Contains(vncURL, "port=5900&vncticket=vnc-ticket-abc123") {
		t.Fatalf("ticket params missing: %q", vncURL)
	}
	if expire <= time.Now().Unix() {
		t.Fatalf("expiry in the past: %d", expire)
	}
}

// ---- unsupported surface ----

func TestUnsupportedOpsReturnCodeUnsupported(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()

	check := func(name string, err error) {
		t.Helper()
		var appErr *apperrors.AppError
		if !errors.As(err, &appErr) {
			t.Fatalf("%s: expected AppError, got %#v", name, err)
		}
		if appErr.Code != apperrors.CodeUnsupported || appErr.HTTPStatus != 501 {
			t.Fatalf("%s: code=%s status=%d", name, appErr.Code, appErr.HTTPStatus)
		}
	}

	_, err := a.EnsureStartupScript(ctx, "t", "n", "c")
	check("EnsureStartupScript", err)
	check("UpdateStartupScript", a.UpdateStartupScript(ctx, "x", "t", "n", "c"))
	check("DeleteStartupScript", a.DeleteStartupScript(ctx, "x", "t"))

	_, err = a.UploadMeasuredBootImage(ctx, "t", "f.uki", "d", strings.NewReader("x"), 1)
	check("UploadMeasuredBootImage", err)
	_, err = a.ListMeasuredBootImages(ctx, "t")
	check("ListMeasuredBootImages", err)
	check("DeleteMeasuredBootImage", a.DeleteMeasuredBootImage(ctx, "x"))
	check("AttachMeasuredBoot", a.AttachMeasuredBoot(ctx, "101", "img"))
	check("DetachMeasuredBoot", a.DetachMeasuredBoot(ctx, "101"))

	_, err = a.ListReservedIPs(ctx, "t")
	check("ListReservedIPs", err)
	_, _, err = a.CreateReservedIP(ctx, "t", "pve01", "n", "v4")
	check("CreateReservedIP", err)
	_, err = a.ConvertPrimaryIP(ctx, "t", "1.2.3.4", "n")
	check("ConvertPrimaryIP", err)
	check("DeleteReservedIP", a.DeleteReservedIP(ctx, "x", "t"))
	check("PatchReservedIP", a.PatchReservedIP(ctx, "x", "t", "n", ""))

	_, err = a.ListStorageServices(ctx, "t")
	check("ListStorageServices", err)
	_, err = a.CreateBucket(ctx, "svc", "t", "bucket", false, false)
	check("CreateBucket", err)
	_, err = a.BucketAccessKeys(ctx, "svc", "bucket", "t")
	check("BucketAccessKeys", err)

	check("SetReverseDNS", a.SetReverseDNS(ctx, "101", "1.2.3.4", "host.example"))
	check("DeleteReverseDNS", a.DeleteReverseDNS(ctx, "101", "1.2.3.4"))
	_, err = a.ListReverseDNS(ctx, "101")
	check("ListReverseDNS", err)

	check("EnableBGP", a.EnableBGP(ctx, "101"))
	check("DisableBGP", a.DisableBGP(ctx, "101"))

	_, err = a.SnapshotDownloadURL(ctx, "101/snap1")
	check("SnapshotDownloadURL", err)
	_, err = a.BackupDownloadURL(ctx, "backup-store:vzdump")
	check("BackupDownloadURL", err)

	check("UpdateSSHKey", a.UpdateSSHKey(ctx, "pve-cloudinit", "t", "n", "key"))
	check("DeleteSSHKey", a.DeleteSSHKey(ctx, "pve-cloudinit", "t"))
}

func TestEnsureSSHKeyDeterministicPlaceholder(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	key, err := a.EnsureSSHKey(context.Background(), "team", "laptop", "ssh-ed25519 AAAA test")
	if err != nil {
		t.Fatalf("EnsureSSHKey: %v", err)
	}
	if key.ExternalID != "pve-cloudinit" || key.Name != "laptop" {
		t.Fatalf("placeholder wrong: %+v", key)
	}
}

// ---- catalog sync ----

func TestSyncCatalogNodesAsLocationsOnly(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	types, templates, locs, err := a.SyncCatalog(context.Background())
	if err != nil {
		t.Fatalf("SyncCatalog: %v", err)
	}
	if len(types) != 0 || len(templates) != 0 {
		t.Fatalf("seeded catalog must not be touched, got types=%d templates=%d",
			len(types), len(templates))
	}
	want := []provider.CatalogLocation{
		{Code: "pve01", Name: "pve01"},
		{Code: "pve02", Name: "pve02"},
	}
	if !reflect.DeepEqual(locs, want) {
		t.Fatalf("locations = %+v, want %+v", locs, want)
	}
}

// ---- power / destroy ----

func TestPowerControlsAndDestroy(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.StopVM(ctx, "101", false); err != nil { // graceful → shutdown
		t.Fatalf("StopVM graceful: %v", err)
	}
	if rec.count(http.MethodPost, "/qemu/101/status/shutdown") != 1 {
		t.Fatal("graceful stop did not hit shutdown")
	}

	if err := a.StopVM(ctx, "101", true); err != nil { // force → hard stop
		t.Fatalf("StopVM force: %v", err)
	}
	if rec.count(http.MethodPost, "/qemu/101/status/stop") != 1 {
		t.Fatal("forced stop did not hit stop")
	}

	if err := a.RebootVM(ctx, "101", false); err != nil {
		t.Fatalf("RebootVM: %v", err)
	}
	graceful := rec.lastBody(http.MethodPost, "/qemu/101/status/reboot")
	if graceful != nil {
		t.Fatalf("graceful reboot must send no force-stop: %#v", graceful)
	}
	if err := a.RebootVM(ctx, "101", true); err != nil {
		t.Fatalf("RebootVM force: %v", err)
	}
	forced := rec.lastBody(http.MethodPost, "/qemu/101/status/reboot")
	if forced["force-stop"] != float64(1) {
		t.Fatalf("forced reboot missing force-stop: %#v", forced)
	}

	if err := a.DestroyVM(ctx, "101"); err != nil {
		t.Fatalf("DestroyVM: %v", err)
	}
	if !rec.hasQueryParam(http.MethodDelete, "/qemu/101", "purge", "1") {
		t.Fatal("destroy must send purge=1")
	}
}

func TestLocateVMUnknownIDNotFound(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	_, err := a.locateVM(context.Background(), "404")
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown vm must yield RESOURCE_NOT_FOUND, got %v", err)
	}
}

// ---- start / migrate ----

func TestStartVMPowerOn(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	// Guest 102 lives on pve02: proves StartVM routes through locateVM to the
	// hosting node instead of assuming a fixed one.
	if err := a.StartVM(ctx, "102"); err != nil {
		t.Fatalf("StartVM: %v", err)
	}
	if n := rec.count(http.MethodPost, "/qemu/102/status/start"); n != 1 {
		t.Fatalf("expected exactly one start call, got %d", n)
	}
	if body := rec.lastBody(http.MethodPost, "/qemu/102/status/start"); body != nil {
		t.Fatalf("start must send no payload: %#v", body)
	}

	var appErr *apperrors.AppError
	err := a.StartVM(ctx, "404")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown vm must yield RESOURCE_NOT_FOUND, got %v", err)
	}
}

func TestMigrateVMToTargetNode(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.MigrateVM(ctx, "101", "pve02"); err != nil {
		t.Fatalf("MigrateVM: %v", err)
	}
	if !rec.hasQueryParam(http.MethodGet, "/qemu/101/migrate", "target", "pve02") {
		t.Fatal("advisory preconditions preflight was not issued")
	}
	body := rec.lastBody(http.MethodPost, "/qemu/101/migrate")
	if body["target"] != "pve02" {
		t.Fatalf("migrate POST missing target: %#v", body)
	}

	var appErr *apperrors.AppError
	err := a.MigrateVM(ctx, "101", "")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("empty target must be VALIDATION_ERROR, got %v", err)
	}
	err = a.MigrateVM(ctx, "101", "pve01")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("same-node migrate must be VALIDATION_ERROR, got %v", err)
	}
	err = a.MigrateVM(ctx, "404", "pve02")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown vm must yield RESOURCE_NOT_FOUND, got %v", err)
	}
}

// ---- observability helpers (*Adapter only, outside ComputeProvider) ----

func TestObservabilityHelpers(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()

	nodes, err := a.Nodes(ctx)
	if err != nil || len(nodes) != 2 {
		t.Fatalf("Nodes: n=%d err=%v", len(nodes), err)
	}

	resources, err := a.ClusterResources(ctx, "vm")
	if err != nil {
		t.Fatalf("ClusterResources: %v", err)
	}
	sawGuest := false
	for _, r := range resources {
		if r.Type == "qemu" && r.VMID == 101 {
			sawGuest = true
		}
	}
	if !sawGuest {
		t.Fatalf("cluster resources missing guest 101: %+v", resources)
	}

	storages, err := a.NodeStorages(ctx, "pve01")
	if err != nil || len(storages) != 4 {
		t.Fatalf("NodeStorages: n=%d err=%v", len(storages), err)
	}

	tasks, err := a.RecentTasks(ctx, "pve01")
	if err != nil || len(tasks) != 2 {
		t.Fatalf("RecentTasks: n=%d err=%v", len(tasks), err)
	}
	if tasks[0].Type != "vzdump" || tasks[0].User != "root@pam" {
		t.Fatalf("task row decode wrong: type=%q user=%q", tasks[0].Type, tasks[0].User)
	}

	empty, err := a.RecentTasks(ctx, "pve02")
	if err != nil || len(empty) != 0 {
		t.Fatalf("RecentTasks pve02: n=%d err=%v", len(empty), err)
	}
}

// unit-level guards for the size parser used by disk resize logic
func TestParseSizeToGB(t *testing.T) {
	cases := map[string]int64{
		"64G":    64,
		"32GiB":  32,
		"512M":   0,
		"2T":     2048,
		"100K":   0,
		"":       0,
		"bogus":  0,
		"plain7": 0,
	}
	for in, want := range cases {
		if got := parseSizeToGB(in); got != want {
			t.Fatalf("parseSizeToGB(%q) = %d, want %d", in, got, want)
		}
	}
}

// ---- extended capability tests ----

func TestSerialConsoleTicket(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	urlStr, exp, err := a.SerialConsole(context.Background(), "101")
	if err != nil {
		t.Fatalf("SerialConsole: %v", err)
	}
	if !strings.Contains(urlStr, "/vncwebsocket?port=5900&vncticket=") || exp <= 0 {
		t.Fatalf("unexpected term url %q exp %d", urlStr, exp)
	}
	last := rec.last("POST", "/termproxy")
	if last == nil {
		t.Fatal("termproxy not called")
	}
}

func TestVMPowerExtras(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	for name, fn := range map[string]func() error{
		"pause":     func() error { return a.PauseVM(ctx, "101") },
		"resume":    func() error { return a.ResumeVM(ctx, "101") },
		"hibernate": func() error { return a.HibernateVM(ctx, "101") },
		"reset":     func() error { return a.ResetVM(ctx, "101") },
	} {
		if err := fn(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

func TestCloneVMFullCopyBody(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	if err := a.CloneVM(context.Background(), "101", "clone-of-101"); err != nil {
		t.Fatalf("CloneVM: %v", err)
	}
	clone := rec.last("POST", "/clone")
	if clone == nil {
		t.Fatal("clone endpoint not hit")
	}
	body := string(clone.Body)
	for _, want := range []string{"newid", `"full":1`} {
		if !strings.Contains(body, want) {
			t.Fatalf("clone body missing %s: %s", want, body)
		}
	}
}

func TestConvertToTemplateAndMoveVolume(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()
	if err := a.ConvertToTemplate(ctx, "101"); err != nil {
		t.Fatalf("ConvertToTemplate: %v", err)
	}
	if err := a.MoveVolume(ctx, "101", "scsi0", "local-lvm"); err != nil {
		t.Fatalf("MoveVolume: %v", err)
	}
	if rec.last("POST", "/template") == nil {
		t.Fatal("template endpoint not hit")
	}
	if rec.last("POST", "/move_disk") == nil {
		t.Fatal("movedisk endpoint not hit")
	}
}

func TestVMNotesTagsRoundtrip(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	notes, err := a.VMNotes(ctx, "101")
	if err != nil || notes == "" {
		t.Fatalf("VMNotes: %q %v", notes, err)
	}
	tags, err := a.VMTags(ctx, "101")
	if err != nil || len(tags) == 0 {
		t.Fatalf("VMTags: %v %v", tags, err)
	}
	if err := a.SetVMTags(ctx, "101", []string{"prod", "tier-1"}); err != nil {
		t.Fatalf("SetVMTags: %v", err)
	}
	if err := a.SetVMNotes(ctx, "101", "hello"); err != nil {
		t.Fatalf("SetVMNotes: %v", err)
	}
}

func TestCloudInitAndAgent(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	if err := a.CloudInitRegenerate(ctx, "101"); err != nil {
		t.Fatalf("CloudInitRegenerate: %v", err)
	}
	if err := a.GuestAgentPing(ctx, "101"); err != nil {
		t.Fatalf("GuestAgentPing: %v", err)
	}
	osInfo, err := a.GuestAgentOSInfo(ctx, "101")
	if err != nil || osInfo == nil {
		t.Fatalf("GuestAgentOSInfo: %v %v", osInfo, err)
	}
	metrics, err := a.GuestMetrics(ctx, "101", "hour")
	if err != nil {
		t.Fatalf("GuestMetrics: %v", err)
	}
	if metrics == nil {
		t.Fatal("metrics nil")
	}
}

func TestVMFirewallRulesNormalized(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	rules, err := a.FirewallRulesList(ctx, "101")
	if err != nil || len(rules) != 2 {
		t.Fatalf("rules: %+v %v", rules, err)
	}
	if rules[0].Enabled != true || rules[0].DestPort != "22" || rules[0].Action != "ACCEPT" {
		t.Fatalf("rule0 not normalized: %+v", rules[0])
	}
	if rules[1].Enabled != false {
		t.Fatalf("rule1 should be disabled: %+v", rules[1])
	}
	err = a.CreateFirewallRule(ctx, "101", provider.ProviderFirewallRule{
		Type: "in", Action: "DROP", Source: "0.0.0.0/0", Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateFirewallRule: %v", err)
	}
	if err := a.DeleteFirewallRule(ctx, "101", 0); err != nil {
		t.Fatalf("DeleteFirewallRule: %v", err)
	}
	opts, err := a.FirewallOptionsMap(ctx, "101")
	if err != nil || opts["enable"] != float64(1) {
		t.Fatalf("options map: %v %v", opts, err)
	}
	if err := a.SetFirewallOptionsMap(ctx, "101", map[string]any{"enable": 1, "input": "DROP"}); err != nil {
		t.Fatalf("SetFirewallOptionsMap: %v", err)
	}
}

func TestNodeDetailDisksCertCommand(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	n, err := a.c.NodeStatusDetail(ctx, "pve01")
	if err != nil || n.PVEVersion == "" || n.Uptime == 0 {
		t.Fatalf("node status: %+v %v", n, err)
	}
	disks, err := a.c.NodeDisks(ctx, "pve01")
	if err != nil || len(disks) != 2 {
		t.Fatalf("disks: %v %v", disks, err)
	}
	if _, err := a.c.NodeCertificates(ctx, "pve01"); err != nil {
		t.Fatalf("certificates: %v", err)
	}
	if _, err := a.c.NodeCommand(ctx, "pve01", "format-everything"); err == nil {
		t.Fatal("bogus node command must be rejected client-side")
	}
	if _, err := a.c.NodeCommand(ctx, "pve01", "reboot"); err != nil {
		t.Fatalf("node reboot: %v", err)
	}
}

func TestClusterObservabilityAndHA(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	cl, err := a.c.ClusterStatusRaw(ctx)
	if err != nil {
		t.Fatalf("cluster status: %v", err)
	}
	if len(cl.Nodes) < 2 {
		t.Fatalf("expected 2 cluster node entries, got %d", len(cl.Nodes))
	}
	res, err := a.c.HAResourcesList(ctx, "")
	if err != nil || len(res) != 1 || res[0].SID != "vm:101" {
		t.Fatalf("ha resources: %+v %v", res, err)
	}
	if err := a.c.HAResourceCreate(ctx, &goproxmox.HAResourceCreateOption{SID: "vm:102"}); err != nil {
		t.Fatalf("ha create: %v", err)
	}
	logEntries, err := a.c.ClusterLogEntries(ctx, 50)
	if err != nil || len(logEntries) == 0 {
		t.Fatalf("cluster log: %v %v", logEntries, err)
	}
}

func TestPoolsLifecycle(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	pools, err := a.c.PoolsList(ctx)
	if err != nil || len(pools) != 1 || pools[0].PoolID != "tenant-a" {
		t.Fatalf("pools: %+v %v", pools, err)
	}
	pool, err := a.c.PoolGet(ctx, "tenant-a")
	if err != nil || pool.PoolID != "tenant-a" {
		t.Fatalf("pool get: %+v %v", pool, err)
	}
	if err := a.c.PoolCreate(ctx, "tenant-b", "second tenant"); err != nil {
		t.Fatalf("pool create: %v", err)
	}
}

func TestCephSDNReadOnly(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	ctx := context.Background()
	ceph, err := a.c.CephStatus(ctx)
	if err != nil || ceph.Health.Status != "HEALTH_OK" {
		t.Fatalf("ceph: %+v %v", ceph, err)
	}
	zones, err := a.c.SDNZones(ctx)
	if err != nil || len(zones) != 1 || zones[0].Name != "lab" {
		t.Fatalf("sdn zones: %+v %v", zones, err)
	}
	vnets, err := a.c.SDNVNets(ctx)
	if err != nil || len(vnets) != 1 || vnets[0].Name != "vnlab" {
		t.Fatalf("sdn vnets: %+v %v", vnets, err)
	}
}

// ---- extended capability surface II ----

// Full ipset roundtrip: list → create → entries → add → comment-only update →
// rename update → remove entry → delete set with force.
func TestVMFirewallIPSetRoundtrip(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	sets, err := a.FirewallIPSetsList(ctx, "101")
	if err != nil || len(sets) != 2 {
		t.Fatalf("ipsets: %+v %v", sets, err)
	}
	if sets[0].Name != "kilat-blocklist" || sets[0].Comment != "blocked subnets" {
		t.Fatalf("ipset mapping: %+v", sets[0])
	}

	if err := a.CreateFirewallIPSet(ctx, "101", "kilat-blocklist", "blocked subnets"); err != nil {
		t.Fatalf("CreateFirewallIPSet: %v", err)
	}
	body := rec.lastBody(http.MethodPost, "/qemu/101/firewall/ipset")
	if body["name"] != "kilat-blocklist" || body["comment"] != "blocked subnets" {
		t.Fatalf("create body: %#v", body)
	}

	entries, err := a.FirewallIPSetEntriesList(ctx, "101", "kilat-blocklist")
	if err != nil || len(entries) != 2 {
		t.Fatalf("entries: %+v %v", entries, err)
	}
	if entries[0].CIDR != "203.0.113.0/24" || entries[0].Comment != "bad subnet" {
		t.Fatalf("entry mapping: %+v", entries[0])
	}

	if err := a.AddFirewallIPSetEntry(ctx, "101", "kilat-blocklist", "203.0.113.0/24", "bad subnet"); err != nil {
		t.Fatalf("AddFirewallIPSetEntry: %v", err)
	}
	body = rec.lastBody(http.MethodPost, "/qemu/101/firewall/ipset/kilat-blocklist")
	if body["cidr"] != "203.0.113.0/24" || body["comment"] != "bad subnet" {
		t.Fatalf("add entry body: %#v", body)
	}

	// Same CIDR ⇒ typed update path carries only the comment.
	if err := a.UpdateFirewallIPSetEntry(ctx, "101", "kilat-blocklist",
		"203.0.113.0/24", "203.0.113.0/24", "renamed comment"); err != nil {
		t.Fatalf("UpdateFirewallIPSetEntry (comment): %v", err)
	}
	body = rec.lastBody(http.MethodPut, "/qemu/101/firewall/ipset/kilat-blocklist/203.0.113.0/24")
	if body["comment"] != "renamed comment" {
		t.Fatalf("comment-only update body: %#v", body)
	}

	// Different CIDR ⇒ raw rename PUT (SDK option struct has no rename field).
	if err := a.UpdateFirewallIPSetEntry(ctx, "101", "kilat-blocklist",
		"203.0.113.0/24", "198.51.100.0/25", "moved range"); err != nil {
		t.Fatalf("UpdateFirewallIPSetEntry (rename): %v", err)
	}
	body = rec.lastBody(http.MethodPut, "/qemu/101/firewall/ipset/kilat-blocklist/203.0.113.0/24")
	if body["rename"] != "198.51.100.0/25" || body["comment"] != "moved range" {
		t.Fatalf("rename update body: %#v", body)
	}

	if err := a.RemoveFirewallIPSetEntry(ctx, "101", "kilat-blocklist", "203.0.113.0/24"); err != nil {
		t.Fatalf("RemoveFirewallIPSetEntry: %v", err)
	}
	if rec.count(http.MethodDelete, "/qemu/101/firewall/ipset/kilat-blocklist/203.0.113.0/24") != 1 {
		t.Fatal("entry remove endpoint not hit")
	}

	// force rides as a query param — v0.8.1's typed delete drops its options
	// map on the floor, so this proves the DeleteWithParams workaround.
	if err := a.DeleteFirewallIPSet(ctx, "101", "kilat-blocklist", true); err != nil {
		t.Fatalf("DeleteFirewallIPSet: %v", err)
	}
	if !rec.hasQueryParam(http.MethodDelete, "/qemu/101/firewall/ipset/kilat-blocklist", "force", "1") {
		t.Fatal("force=1 missing from ipset delete query")
	}
}

func TestBackupJobRunNowHitsRunEndpoint(t *testing.T) {
	a, rec := newTestAdapter(t, false)

	task, err := a.BackupJobRunNow(context.Background(), "nightly-01")
	if err != nil || task == nil {
		t.Fatalf("BackupJobRunNow: task=%v err=%v", task, err)
	}
	last := rec.last(http.MethodPost, "/cluster/backup/nightly-01/run")
	if last == nil {
		t.Fatal("run-now POST not recorded")
	}
	if last.Auth == "" {
		t.Fatal("run-now request lost the PVEAPIToken header")
	}

	var appErr *apperrors.AppError
	if _, err := a.BackupJobRunNow(context.Background(), "   "); !errors.As(err, &appErr) ||
		appErr.Code != apperrors.CodeValidation {
		t.Fatalf("blank job id must be VALIDATION_ERROR, got %v", err)
	}
}

func TestHAArmDisarmValidation(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.HAArm(ctx); err != nil {
		t.Fatalf("HAArm: %v", err)
	}
	if rec.count(http.MethodPost, "/cluster/ha/status/arm-ha") != 1 {
		t.Fatal("arm-ha endpoint not hit")
	}

	for _, mode := range []string{"freeze", "ignore"} {
		if err := a.HADisarm(ctx, mode); err != nil {
			t.Fatalf("HADisarm(%q): %v", mode, err)
		}
		body := rec.lastBody(http.MethodPost, "/cluster/ha/status/disarm-ha")
		if body["resource-mode"] != mode {
			t.Fatalf("disarm body resource-mode = %#v, want %q", body["resource-mode"], mode)
		}
	}

	var appErr *apperrors.AppError
	for _, bad := range []string{"quit", ""} {
		err := a.HADisarm(ctx, bad)
		if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
			t.Fatalf("resource-mode %q must be VALIDATION_ERROR, got %v", bad, err)
		}
	}
	if n := rec.count(http.MethodPost, "/cluster/ha/status/disarm-ha"); n != 2 {
		t.Fatalf("invalid modes must not dial PVE, disarm calls recorded: %d", n)
	}
}

func TestPoolUpdateMembersBody(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.PoolUpdateMembers(ctx, "tenant-a", "updated note", "101,102", "backup-store,local-lvm", false); err != nil {
		t.Fatalf("PoolUpdateMembers add: %v", err)
	}
	body := rec.lastBody(http.MethodPut, "/pools")
	if body["poolid"] != "tenant-a" || body["vms"] != "101,102" ||
		body["storage"] != "backup-store,local-lvm" || body["comment"] != "updated note" {
		t.Fatalf("membership body: %#v", body)
	}
	if _, present := body["delete"]; present {
		t.Fatalf("delete=false must stay off the wire: %#v", body)
	}

	if err := a.PoolUpdateMembers(ctx, "tenant-a", "", "103", "", true); err != nil {
		t.Fatalf("PoolUpdateMembers delete: %v", err)
	}
	body = rec.lastBody(http.MethodPut, "/pools")
	if body["vms"] != "103" || body["delete"] != float64(1) {
		t.Fatalf("removal body: %#v", body)
	}

	// Legacy comment-only wrapper must remain untouched for admin handlers.
	if err := a.c.PoolUpdate(ctx, "tenant-a", "only comment"); err != nil {
		t.Fatalf("legacy PoolUpdate: %v", err)
	}
	body = rec.lastBody(http.MethodPut, "/pools")
	if _, present := body["vms"]; present {
		t.Fatalf("legacy PoolUpdate grew membership fields: %#v", body)
	}
}

func TestBackupFileRestoreListDecode(t *testing.T) {
	a, rec := newTestAdapter(t, false)

	const vol = "backup-store:backup/vzdump-qemu-101-2026_01_15-03_00_01.vma.zst"
	entries, err := a.BackupFileRestoreList(context.Background(), "pve01", "backup-store", vol, "/")
	if err != nil {
		t.Fatalf("BackupFileRestoreList: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("want 2 rows, got %+v", entries)
	}
	if entries[0].Filepath != "/etc" || entries[0].Type != "d" {
		t.Fatalf("directory row mapping: %+v", entries[0])
	}
	if entries[1].Filepath != "/etc/hostname" || entries[1].Size != 13 || !bool(entries[1].Leaf) {
		t.Fatalf("file row mapping: %+v", entries[1])
	}

	last := rec.last(http.MethodGet, "file-restore/list")
	if last == nil {
		t.Fatal("file-restore request not recorded")
	}
	if !strings.Contains(last.Query, "filepath=Lw%3D%3D") { // base64("/") per PVE
		t.Fatalf("filepath not base64-encoded on the wire: %q", last.Query)
	}
	if !strings.Contains(last.Query, "volume="+url.QueryEscape(vol)) {
		t.Fatalf("volume param missing: %q", last.Query)
	}
}

func TestClusterStoragesCRUDList(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	storages, err := a.ClusterStoragesList(ctx)
	if err != nil || len(storages) != 2 {
		t.Fatalf("list: n=%d err=%v", len(storages), err)
	}
	if storages[0].Storage != "local-lvm" || storages[1].Shared != 1 {
		t.Fatalf("row decode: %+v %+v", storages[0], storages[1])
	}

	got, err := a.ClusterStorageGet(ctx, "backup-store")
	if err != nil || got.Type != "nfs" {
		t.Fatalf("get: %+v %v", got, err)
	}

	opts := []goproxmox.ClusterStorageOptions{
		{Name: "storage", Value: "newstore"},
		{Name: "type", Value: "nfs"},
		{Name: "content", Value: "backup"},
		{Name: "server", Value: "10.0.0.9"},
		{Name: "export", Value: "/srv/backup"},
	}
	task, err := a.ClusterStorageCreate(ctx, opts)
	if err != nil || task == nil {
		t.Fatalf("create: task=%v err=%v", task, err)
	}
	body := rec.lastBody(http.MethodPost, "/api2/json/storage")
	if body["storage"] != "newstore" || body["type"] != "nfs" ||
		body["content"] != "backup" || body["server"] != "10.0.0.9" {
		t.Fatalf("create body: %#v", body)
	}

	task, err = a.ClusterStorageUpdate(ctx, "newstore",
		[]goproxmox.ClusterStorageOptions{{Name: "content", Value: "backup,iso"}})
	if err != nil || task == nil {
		t.Fatalf("update: task=%v err=%v", task, err)
	}
	if body = rec.lastBody(http.MethodPut, "/storage/newstore"); body["content"] != "backup,iso" {
		t.Fatalf("update body: %#v", body)
	}

	task, err = a.ClusterStorageDelete(ctx, "newstore")
	if err != nil || task == nil {
		t.Fatalf("delete: task=%v err=%v", task, err)
	}
	if rec.count(http.MethodDelete, "/storage/newstore") != 1 {
		t.Fatal("delete endpoint not hit")
	}
}

func TestNodeDNSAndTimeRawShapes(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	dns, err := a.NodeDNSGet(ctx, "pve01")
	if err != nil {
		t.Fatalf("NodeDNSGet: %v", err)
	}
	if dns["search"] != "kilat.internal" || dns["dns1"] != "10.0.0.1" || dns["dns2"] != "10.0.0.2" {
		t.Fatalf("dns map: %#v", dns)
	}
	if _, unset := dns["dns3"]; unset {
		t.Fatal("unset slot must stay absent from the decoded map")
	}

	if err := a.NodeDNSSet(ctx, "pve01", "kilat.internal", "10.0.0.1", "10.0.0.2", "10.0.0.3"); err != nil {
		t.Fatalf("NodeDNSSet: %v", err)
	}
	body := rec.lastBody(http.MethodPut, "/nodes/pve01/dns")
	for key, want := range map[string]any{
		"search": "kilat.internal", "dns1": "10.0.0.1", "dns2": "10.0.0.2", "dns3": "10.0.0.3",
	} {
		if body[key] != want {
			t.Fatalf("dns set body[%q] = %#v, want %#v", key, body[key], want)
		}
	}

	var appErr *apperrors.AppError
	err = a.NodeDNSSet(ctx, "pve01", "", "", "", "")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("empty search must be VALIDATION_ERROR, got %v", err)
	}

	clock, err := a.NodeTimeGet(ctx, "pve01")
	if err != nil {
		t.Fatalf("NodeTimeGet: %v", err)
	}
	if clock["timezone"] != "Asia/Jakarta" || clock["localtime"] != float64(1768435200) {
		t.Fatalf("time map: %#v", clock)
	}
}

func TestNodeQEMUCPUModelsArchQuery(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	models, err := a.NodeQEMUCPUModels(ctx, "pve01", "x86_64")
	if err != nil || len(models) != 2 {
		t.Fatalf("models: n=%d err=%v", len(models), err)
	}
	if models[0].Name != "host" || models[0].Custom {
		t.Fatalf("builtin row mapping: %+v", models[0])
	}
	if models[1].Name != "custom-epyc" || models[1].Vendor != "AMD" || !models[1].Custom {
		t.Fatalf("custom row mapping: %+v", models[1])
	}
	last := rec.last(http.MethodGet, "/capabilities/qemu/cpu")
	if last == nil || !strings.Contains(last.Query, "arch=x86_64") {
		t.Fatalf("arch query missing: %+v", last)
	}

	if _, err := a.NodeQEMUCPUModels(ctx, "pve01", ""); err != nil {
		t.Fatalf("default arch call: %v", err)
	}
	last = rec.last(http.MethodGet, "/capabilities/qemu/cpu")
	if strings.Contains(last.Query, "arch=") {
		t.Fatalf("empty arch must omit the query param: %q", last.Query)
	}
}

// ---- containers (LXC) ----

func containerOptMap(opts []goproxmox.ContainerOption) map[string]any {
	m := make(map[string]any, len(opts))
	for _, o := range opts {
		m[o.Name] = o.Value
	}
	return m
}

func TestBuildContainerOptions(t *testing.T) {
	spec := provider.InstanceSpec{
		Name:      "ct-web",
		CPU:       2,
		RAM:       1024,
		Disk:      10,
		SSHKeyIDs: []string{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterial test@kilat.cloud"},
	}
	opts := containerOptMap(BuildContainerOptions(spec, ""))
	want := map[string]any{
		"hostname":     "ct-web",
		"ostype":       "debian",
		"cores":        2,
		"memory":       1024,
		"rootfs":       "local-lvm:size=10G",
		"net0":         "name=eth0,bridge=vmbr0,ip=dhcp",
		"unprivileged": 1,
		"features":     "nesting=1",
	}
	for k, v := range want {
		if opts[k] != v {
			t.Fatalf("option %q = %#v, want %#v", k, opts[k], v)
		}
	}
	keys, ok := opts["sshkeys"].(string)
	if !ok || !strings.Contains(keys, "ssh-ed25519%20") || strings.Contains(keys, "+") {
		t.Fatalf("sshkeys not PVE-encoded: %q", keys)
	}
	if _, ok := opts["password"]; ok {
		t.Fatal("password set despite key material")
	}

	// No usable key material ⇒ the pre-generated root password rides instead.
	opts = containerOptMap(BuildContainerOptions(provider.InstanceSpec{Name: "ct", CPU: 1, RAM: 512, Disk: 5}, "s3cret-pw"))
	if opts["password"] != "s3cret-pw" {
		t.Fatalf("password option = %#v", opts["password"])
	}
	if _, ok := opts["sshkeys"]; ok {
		t.Fatal("sshkeys set without material")
	}
	// Opaque provider key ids (no material) must not leak into sshkeys.
	opts = containerOptMap(BuildContainerOptions(provider.InstanceSpec{SSHKeyIDs: []string{"pve-cloudinit"}}, ""))
	if _, ok := opts["sshkeys"]; ok {
		t.Fatal("opaque key id injected as sshkey")
	}
	if _, ok := opts["password"]; ok {
		t.Fatal("opaque key id must still yield a password")
	}
}

func TestProvisionContainer(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	spec := provider.InstanceSpec{Location: "pve01", Name: "ct-app", CPU: 2, RAM: 512, Disk: 10}
	if err := a.ProvisionContainer(context.Background(), spec); err != nil {
		t.Fatalf("ProvisionContainer: %v", err)
	}
	create := rec.lastBody(http.MethodPost, "/nodes/pve01/lxc")
	if create == nil {
		t.Fatal("create POST not recorded")
	}
	for key, want := range map[string]any{
		"hostname":     "ct-app",
		"ostype":       "debian",
		"cores":        float64(2),
		"memory":       float64(512),
		"rootfs":       "local-lvm:size=10G",
		"unprivileged": float64(1),
		"features":     "nesting=1",
	} {
		if got := create[key]; got != want {
			t.Fatalf("created option %q = %#v, want %#v", key, got, want)
		}
	}
	pw, ok := create["password"].(string)
	if !ok || len(pw) < 16 {
		t.Fatalf("keyless provisioning must embed a random root password, got %#v", create["password"])
	}
	if _, ok := create["sshkeys"]; ok {
		t.Fatal("sshkeys set without material")
	}
	// start-after-create is awaited, and the best-effort kilat tag applied.
	if n := rec.count(http.MethodPost, "/lxc/201/status/start"); n != 1 {
		t.Fatalf("expected exactly one start call, got %d", n)
	}
	if n := rec.count(http.MethodPut, "/lxc/201/config"); n < 1 {
		t.Fatal("best-effort kilat tag was never applied")
	}
}

func TestContainerLifecycle(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.StartContainer(ctx, "ct102"); err != nil {
		t.Fatalf("StartContainer: %v", err)
	}
	if rec.count(http.MethodPost, "/lxc/102/status/start") != 1 {
		t.Fatal("start endpoint not hit")
	}

	if err := a.StopContainer(ctx, "ct102", false); err != nil { // graceful → shutdown
		t.Fatalf("StopContainer graceful: %v", err)
	}
	if rec.count(http.MethodPost, "/lxc/102/status/shutdown") != 1 {
		t.Fatal("graceful stop did not hit shutdown")
	}
	if err := a.StopContainer(ctx, "ct102", true); err != nil { // force → hard stop
		t.Fatalf("StopContainer force: %v", err)
	}
	if rec.count(http.MethodPost, "/lxc/102/status/stop") != 1 {
		t.Fatal("forced stop did not hit stop")
	}

	if err := a.RebootContainer(ctx, "ct102"); err != nil {
		t.Fatalf("RebootContainer: %v", err)
	}
	if rec.count(http.MethodPost, "/lxc/102/status/reboot") != 1 {
		t.Fatal("reboot endpoint not hit")
	}

	if err := a.DestroyContainer(ctx, "ct102"); err != nil {
		t.Fatalf("DestroyContainer: %v", err)
	}
	if !rec.hasQueryParam(http.MethodDelete, "/lxc/102", "purge", "1") ||
		!rec.hasQueryParam(http.MethodDelete, "/lxc/102", "destroy-unreferenced-disks", "1") {
		t.Fatal("destroy must send purge=1 and destroy-unreferenced-disks=1")
	}

	var appErr *apperrors.AppError
	err := a.StartContainer(ctx, "ct404")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown container must yield RESOURCE_NOT_FOUND, got %v", err)
	}
	err = a.StartContainer(ctx, "101") // missing ct prefix
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("non-ct external id must be VALIDATION_ERROR, got %v", err)
	}
	err = a.StartContainer(ctx, "ctabc")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("non-numeric vmid must be VALIDATION_ERROR, got %v", err)
	}
}

func TestContainerMigrateAndPreconditions(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	if err := a.MigrateContainer(ctx, "ct102", "pve02"); err != nil {
		t.Fatalf("MigrateContainer: %v", err)
	}
	if !rec.hasQueryParam(http.MethodGet, "/lxc/102/migrate", "target", "pve02") {
		t.Fatal("advisory preconditions preflight was not issued")
	}
	body := rec.lastBody(http.MethodPost, "/lxc/102/migrate")
	if body["target"] != "pve02" {
		t.Fatalf("migrate POST missing target: %#v", body)
	}

	var appErr *apperrors.AppError
	err := a.MigrateContainer(ctx, "ct102", "")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("empty target must be VALIDATION_ERROR, got %v", err)
	}
	err = a.MigrateContainer(ctx, "ct102", "pve01")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("same-node migrate must be VALIDATION_ERROR, got %v", err)
	}
	err = a.MigrateContainer(ctx, "ct404", "pve02")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("unknown container must yield RESOURCE_NOT_FOUND, got %v", err)
	}
}

func TestContainerSerialConsoleTicket(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	urlStr, exp, err := a.ContainerSerialConsole(context.Background(), "ct102")
	if err != nil {
		t.Fatalf("ContainerSerialConsole: %v", err)
	}
	want := "/api2/json/nodes/pve01/lxc/102/vncwebsocket?port=5900&vncticket=ct-term-ticket-abc"
	if !strings.Contains(urlStr, want) {
		t.Fatalf("term url malformed: %q", urlStr)
	}
	if exp <= time.Now().Unix() {
		t.Fatalf("expiry in the past: %d", exp)
	}
	if last := rec.last(http.MethodPost, "/lxc/102/termproxy"); last == nil {
		t.Fatal("container termproxy not called")
	}
}

func TestContainerSnapshotsRoundtrip(t *testing.T) {
	a, rec := newTestAdapter(t, false)
	ctx := context.Background()

	extID, err := a.ContainerSnapshotCreate(ctx, "ct102", "ctsnap1", "daily backup")
	if err != nil {
		t.Fatalf("ContainerSnapshotCreate: %v", err)
	}
	if extID != "ct102/ctsnap1" {
		t.Fatalf("ext id %q", extID)
	}
	body := rec.lastBody(http.MethodPost, "/lxc/102/snapshot")
	if body["snapname"] != "ctsnap1" || body["description"] != "daily backup" {
		t.Fatalf("snapshot body: %#v", body)
	}

	snaps, err := a.ContainerSnapshotsList(ctx, "ct102")
	if err != nil {
		t.Fatalf("ContainerSnapshotsList: %v", err)
	}
	if len(snaps) != 1 { // "current" pseudo-snapshot skipped
		t.Fatalf("want 1 snapshot, got %+v", snaps)
	}
	s := snaps[0]
	if s.ExternalID != "ct102/ctsnap1" || s.Desc != "daily backup" ||
		s.CreatedAt != time.Unix(1768435200, 0).UTC().Format(time.RFC3339) ||
		s.Status != "available" {
		t.Fatalf("snapshot mapping: %+v", s)
	}

	if err := a.ContainerSnapshotRollback(ctx, "ct102", "ct102/ctsnap1"); err != nil {
		t.Fatalf("ContainerSnapshotRollback: %v", err)
	}
	if rec.count(http.MethodPost, "/lxc/102/snapshot/ctsnap1/rollback") != 1 {
		t.Fatal("rollback not called")
	}
	if rec.count(http.MethodPost, "/lxc/102/status/start") != 1 {
		t.Fatal("rollback must start the container again")
	}

	if err := a.ContainerSnapshotDelete(ctx, "ct102/ctsnap1"); err != nil {
		t.Fatalf("ContainerSnapshotDelete: %v", err)
	}
	if rec.count(http.MethodDelete, "/lxc/102/snapshot/ctsnap1") != 1 {
		t.Fatal("delete snapshot endpoint not hit")
	}

	var appErr *apperrors.AppError
	err = a.ContainerSnapshotDelete(ctx, "101/snap1") // VM-style id, no ct prefix
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("non-ct snapshot id must be VALIDATION_ERROR, got %v", err)
	}
	err = a.ContainerSnapshotRollback(ctx, "ct102", "bogus")
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("malformed snapshot id must be VALIDATION_ERROR, got %v", err)
	}
}

func TestContainersListAllMapping(t *testing.T) {
	a, _ := newTestAdapter(t, false)
	cts, err := a.ContainersListAll(context.Background())
	if err != nil {
		t.Fatalf("ContainersListAll: %v", err)
	}
	if len(cts) != 2 { // lxc rows 102 + 103; qemu/template rows dropped
		t.Fatalf("want 2 containers, got %+v", cts)
	}
	byExt := map[string]provider.VMState{}
	for _, c := range cts {
		byExt[c.ExternalID] = c
	}
	app := byExt["ct102"]
	if app.Name != "ct-app" || app.Status != "active" || app.PowerStatus != "running" ||
		app.VCPU != 2 || app.RAM != 2048 || app.Disk != 10 {
		t.Fatalf("ct102 mapping wrong: %+v", app)
	}
	old := byExt["ct103"]
	if old.Name != "ct-01" || old.Status != "active" || old.VCPU != 1 || old.RAM != 1024 || old.Disk != 8 {
		t.Fatalf("ct103 mapping wrong: %+v", old)
	}
}
