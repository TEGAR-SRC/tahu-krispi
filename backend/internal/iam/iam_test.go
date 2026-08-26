package iam

import "testing"

func TestCanMatrix(t *testing.T) {
	tests := []struct {
		name string
		role Role
		perm string
		want bool
	}{
		// Owner: wildcard.
		{"owner grants everything", RoleOwner, "billing.write", true},
		{"owner grants members", RoleOwner, "members.write", true},
		{"unknown role grants nothing", Role("intern"), "instances.read", false},

		// Admin: resource wildcards + members + read billing + wallet.
		{"admin instances.delete", RoleAdmin, "instances.delete", true},
		{"admin snapshots.create", RoleAdmin, "snapshots.create", true},
		{"admin api_keys.write", RoleAdmin, "api_keys.write", true},
		{"admin members.read", RoleAdmin, "members.read", true},
		{"admin billing.read", RoleAdmin, "billing.read", true},
		{"admin wallet.topup", RoleAdmin, "wallet.topup", true},
		{"admin cannot billing.write", RoleAdmin, "billing.write", false},
		{"admin prefix must match resource boundary", RoleAdmin, "instanceX.read", false},

		// Billing: read-only resources, owns billing/wallet.
		{"billing billing.write", RoleBilling, "billing.write", true},
		{"billing wallet.topup", RoleBilling, "wallet.topup", true},
		{"billing instances.read", RoleBilling, "instances.read", true},
		{"billing cannot instances.create", RoleBilling, "instances.create", false},
		{"billing cannot members.read", RoleBilling, "members.read", false},
		{"billing cannot api_keys.read", RoleBilling, "api_keys.read", false},

		// Operator: resource ops, no members/api_keys/billing.
		{"operator instances.delete", RoleOperator, "instances.delete", true},
		{"operator firewalls.write", RoleOperator, "firewalls.write", true},
		{"operator backups.restore", RoleOperator, "backups.restore", true},
		{"operator cannot members.read", RoleOperator, "members.read", false},
		{"operator cannot api_keys.read", RoleOperator, "api_keys.read", false},
		{"operator cannot billing.read", RoleOperator, "billing.read", false},
		{"operator cannot billing.write", RoleOperator, "billing.write", false},

		// Developer: create/update workloads + ssh keys + api keys.
		{"developer instances.create", RoleDeveloper, "instances.create", true},
		{"developer instances.update", RoleDeveloper, "instances.update", true},
		{"developer firewalls.write", RoleDeveloper, "firewalls.write", true},
		{"developer ssh_keys.write", RoleDeveloper, "ssh_keys.write", true},
		{"developer api_keys.write", RoleDeveloper, "api_keys.write", true},
		{"developer snapshots.delete allowed", RoleDeveloper, "snapshots.delete", true},
		{"developer cannot instances.delete", RoleDeveloper, "instances.delete", false},
		{"developer cannot members.read", RoleDeveloper, "members.read", false},
		{"developer cannot billing.read", RoleDeveloper, "billing.read", false},
		{"developer cannot networks.write", RoleDeveloper, "networks.write", false},

		// Viewer: read-only everywhere.
		{"viewer instances.read", RoleViewer, "instances.read", true},
		{"viewer billing.read", RoleViewer, "billing.read", true},
		{"viewer cannot instances.update", RoleViewer, "instances.update", false},
		{"viewer cannot storage.write", RoleViewer, "storage.write", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Can(tc.role, tc.perm); got != tc.want {
				t.Errorf("Can(%q, %q) = %v, want %v", tc.role, tc.perm, got, tc.want)
			}
		})
	}
}

func TestPermissionsFor(t *testing.T) {
	if got := PermissionsFor(RoleOwner); len(got) != 1 || got[0] != "*" {
		t.Errorf("PermissionsFor(owner) = %v, want [ * ]", got)
	}
	admin := PermissionsFor(RoleAdmin)
	if len(admin) == 0 {
		t.Fatal("admin must have permissions")
	}
	admin[0] = "tampered"
	if PermissionsFor(RoleAdmin)[0] == "tampered" {
		t.Error("PermissionsFor must return a copy, callers may not mutate the matrix")
	}
	if len(PermissionsFor(Role("ghost"))) != 0 {
		t.Error("unknown role must have no permissions")
	}
}

func TestScopesAllow(t *testing.T) {
	tests := []struct {
		name   string
		scopes []string
		perm   string
		want   bool
	}{
		{"empty scopes allow nothing", nil, "instances.read", false},
		{"exact match", []string{"profile.read", "instances.read"}, "instances.read", true},
		{"missing exact", []string{"instances.read"}, "instances.delete", false},
		{"global wildcard", []string{"*"}, "billing.write", true},
		{"resource wildcard", []string{"instances.*"}, "instances.delete", true},
		{"resource wildcard does not cross resources", []string{"instances.*"}, "snapshots.read", false},
		{"resource wildcard boundary", []string{"instances.*"}, "instanceX.read", false},
		{"wildcard among many", []string{"profile.read", "firewalls.*", "billing.read"}, "firewalls.write", true},
		{"invalid scope never matches", []string{"instances_admin"}, "instances.read", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ScopesAllow(tc.scopes, tc.perm); got != tc.want {
				t.Errorf("ScopesAllow(%v, %q) = %v, want %v", tc.scopes, tc.perm, got, tc.want)
			}
		})
	}
}

func TestValidScopes(t *testing.T) {
	want := map[string]bool{
		"profile.read":     true,
		"instances.read":   true,
		"instances.create": true,
		"instances.update": true,
		"instances.delete": true,
		"snapshots.read":   true,
		"snapshots.create": true,
		"snapshots.delete": true,
		"backups.read":     true,
		"backups.restore":  true,
		"networks.read":    true,
		"networks.write":   true,
		"firewalls.read":   true,
		"firewalls.write":  true,
		"ssh_keys.read":    true,
		"ssh_keys.write":   true,
		"storage.read":     true,
		"storage.write":    true,
		"billing.read":     true,
		"api_keys.read":    true,
		"api_keys.write":   true,
	}
	got := ValidScopes()
	if len(got) != len(want) {
		t.Errorf("ValidScopes has %d entries, want %d: %v", len(got), len(want), got)
	}
	for _, s := range got {
		if !want[s] {
			t.Errorf("unexpected scope %q in ValidScopes", s)
		}
		if !IsValidScope(s) {
			t.Errorf("IsValidScope(%q) = false, want true", s)
		}
		// Every valid scope must grant its own permission through ScopesAllow.
		if !ScopesAllow([]string{s}, s) {
			t.Errorf("ScopesAllow([%q], %q) = false, want true", s, s)
		}
	}
	if IsValidScope("wallet.topup") {
		t.Error("wallet.topup is not a valid API-key scope per Master Prompt §19")
	}
	if IsValidScope("*") {
		t.Error("* is not a listed valid API-key scope")
	}
}
