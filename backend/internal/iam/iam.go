// Package iam is the single source of truth for organization RBAC:
// roles, permission grants, and the valid API-key scopes.
package iam

import "strings"

// Role is an organization member role.
type Role string

const (
	RoleOwner     Role = "owner"
	RoleAdmin     Role = "admin"
	RoleBilling   Role = "billing"
	RoleOperator  Role = "operator"
	RoleDeveloper Role = "developer"
	RoleViewer    Role = "viewer"
)

// rolePermissions maps each role to its permission grants. A grant may be an
// exact permission ("members.read"), a resource wildcard ("instances.*"), or
// the global wildcard ("*"). Owner holds "*" and can do everything; admin
// manages all resources plus members and API keys but cannot spend money;
// billing is read-only on resources and owns billing/wallet; operator runs
// resource operations without members, API keys, or billing; developer can
// create and update workloads but not delete instances, manage members, or
// touch billing; viewer is read-only.
var rolePermissions = map[Role][]string{
	RoleOwner: {"*"},
	RoleAdmin: {
		"instances.*", "snapshots.*", "backups.*",
		"networks.*", "firewalls.*", "ssh_keys.*", "storage.*", "api_keys.*",
		"members.read", "members.write",
		"billing.read", "wallet.read", "wallet.topup",
	},
	RoleBilling: {
		"instances.read", "snapshots.read", "backups.read", "storage.read",
		"billing.read", "billing.write", "wallet.read", "wallet.topup",
	},
	RoleOperator: {
		"instances.read", "instances.update", "instances.delete",
		"snapshots.read", "snapshots.create", "snapshots.delete",
		"backups.read", "backups.restore",
		"networks.read", "networks.write",
		"firewalls.read", "firewalls.write",
		"ssh_keys.read", "ssh_keys.write",
		"storage.read", "storage.write",
	},
	RoleDeveloper: {
		"instances.read", "instances.create", "instances.update",
		"snapshots.read", "snapshots.create", "snapshots.delete",
		"backups.read", "backups.restore",
		"networks.read",
		"firewalls.read", "firewalls.write",
		"ssh_keys.read", "ssh_keys.write",
		"api_keys.read", "api_keys.write",
	},
	RoleViewer: {
		"instances.read", "snapshots.read", "backups.read",
		"networks.read", "firewalls.read", "storage.read",
		"ssh_keys.read", "billing.read",
	},
}

// validScopes lists every scope an API key may carry (Master Prompt §19).
var validScopes = []string{
	"profile.read",

	"instances.read",
	"instances.create",
	"instances.update",
	"instances.delete",

	"snapshots.read",
	"snapshots.create",
	"snapshots.delete",

	"backups.read",
	"backups.restore",

	"networks.read",
	"networks.write",

	"firewalls.read",
	"firewalls.write",

	"ssh_keys.read",
	"ssh_keys.write",

	"storage.read",
	"storage.write",

	"billing.read",

	"api_keys.read",
	"api_keys.write",
}

// Can reports whether role r grants perm. Unknown roles grant nothing.
func Can(r Role, perm string) bool {
	for _, g := range rolePermissions[r] {
		if grantMatches(g, perm) {
			return true
		}
	}
	return false
}

// PermissionsFor returns a copy of the grants held by role r.
func PermissionsFor(r Role) []string {
	grants := rolePermissions[r]
	out := make([]string, len(grants))
	copy(out, grants)
	return out
}

// ScopesAllow reports whether any of scopes grants perm. Supports "*",
// exact scopes ("instances.read"), and resource wildcards ("instances.*").
func ScopesAllow(scopes []string, perm string) bool {
	for _, s := range scopes {
		if grantMatches(s, perm) {
			return true
		}
	}
	return false
}

// ValidScopes returns a copy of every valid API-key scope (Master Prompt §19).
func ValidScopes() []string {
	out := make([]string, len(validScopes))
	copy(out, validScopes)
	return out
}

// IsValidScope reports whether s is a valid API-key scope.
func IsValidScope(s string) bool {
	for _, v := range validScopes {
		if v == s {
			return true
		}
	}
	return false
}

// grantMatches checks a single grant/scope against a permission.
func grantMatches(grant, perm string) bool {
	if grant == "" || perm == "" {
		return false
	}
	if grant == "*" || grant == perm {
		return true
	}
	if strings.HasSuffix(grant, ".*") {
		// Keep the trailing dot so "instanceX.read" never matches "instances.*".
		return strings.HasPrefix(perm, grant[:len(grant)-1])
	}
	return false
}

// ---- Platform staff roles (admin console) ----

// StaffRole is the platform-side role of a user. 'none' means ordinary
// customer; platform_admin is the superuser; finance and noc are scoped
// staff roles enforced on /v1/admin/* routes via StaffCan.
type StaffRole string

const (
	StaffNone          StaffRole = "none"
	StaffPlatformAdmin StaffRole = "platform_admin"
	StaffFinance       StaffRole = "finance"
	StaffNOC           StaffRole = "noc"
)

// staffAreas lists the admin-console areas a staff role may touch:
//
//	billing   — orders, invoices, payments, wallets, coupons, products,
//	            plans/prices/custom-rates, regions, affiliate earnings
//	infra     — instances, jobs, orphans, security incidents, blocked
//	            networks, providers (+sync), provider accounts, storage backends.
//	            Per-provider surface stays provider-prefixed (no universal infra
//	            code/slug) but still maps to the generic "infra" area so NOC keeps
//	            provider-scoped reads without leaking to finance:
//	              infra:proxmox — Proxmox VE clusters/nodes/storages/tasks/perf
//	              infra:onidel  — Onidel catalog/sync
//	              infra:vmware  — VMware vSphere inventory/perf
//	              infra:dokploy — Dokploy PaaS mirror/proxy (admin-only today,
//	                              tagged per-provider for future NOC reads)
//	            All four remain provider-coded: kode/id/slug must stay prefixed
//	            by provider (proxmox-*, onidel-*, vmware-*, dokploy-*).
//	tickets   — staff ticket queue (reply/assign/close/attachments)
//	users     — customer accounts (suspend/activate/limits); read is "users.read"
//	marketing — landing / marketing content (hero, features, pricing, faq, blog)
//	settings  — feature flags, app settings, audit logs, grant-admin (platform_admin only)
//	affiliate — affiliate settings/earnings; routed as "billing" in staffAreaFor but
//	            kept as distinct grant so finance nav can gate affiliate separately.
//
// Platform matrix (single source of truth — do not drift):
//   - platform_admin = "*" (all areas, all methods)
//   - noc            = infra + tickets + users.read + marketing
//                     (GET infra allowed, POST/DELETE on infra stays platform_admin via staffAreaFor)
//   - finance        = billing + affiliate + users.read
//                     (billing read-only view; no infra — never grant infra/infra:* to finance)
//   - user (org roles owner/admin/billing/operator/developer/viewer) is unchanged;
//     paket selection stays via region (no provider_id), auto-resolved.
var staffPermissions = map[StaffRole][]string{
	StaffPlatformAdmin: {"*"},
	StaffFinance:       {"billing", "affiliate", "users.read"},
	StaffNOC:           {"infra", "tickets", "users.read", "marketing"},
}

// StaffCan reports whether the staff role grants the admin area.
//
// Special mapping kept for backward/future compat without leaking finance:
//   - grant "infra" covers generic "infra" and any per-provider tag
//     "infra:<provider>" (proxmox/onidel/vmware/dokploy). This lets NOC keep
//     provider-scoped GETs while finance — which never holds "infra"/"infra:*"
//     — cannot read any provider infra. The reverse does not hold: a provider-
//     specific grant "infra:proxmox" would not grant generic "infra".
//   - grant "users.read" covers area "users" (admin /users list endpoint uses
//     "users" while the staff matrix stores the read slice as "users.read").
//   - grant "billing" also covers area "affiliate" (affiliate routes are
//     currently gated as "billing"; the distinct "affiliate" grant is kept for
//     future per-area routing without duplicating finance grants).
func StaffCan(r StaffRole, area string) bool {
	grants, ok := staffPermissions[r]
	if !ok {
		return false
	}
	for _, g := range grants {
		if g == "*" || g == area {
			return true
		}
		if g == "infra" && (area == "infra" || strings.HasPrefix(area, "infra:")) {
			return true
		}
		if g == "users.read" && area == "users" {
			return true
		}
		if g == "billing" && area == "affiliate" {
			return true
		}
	}
	return false
}
