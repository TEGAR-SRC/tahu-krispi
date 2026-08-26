package organization

import "testing"

func TestHasPermission(t *testing.T) {
	if !HasPermission(RoleOwner, "anything.at.all") {
		t.Error("owner must have wildcard permission")
	}
	if !HasPermission(RoleAdmin, "instances.create") {
		t.Error("admin must create instances")
	}
	if HasPermission(RoleViewer, "instances.delete") {
		t.Error("viewer must not delete instances")
	}
	if !HasPermission(RoleBilling, "billing.write") {
		t.Error("billing role must write billing")
	}
	if HasPermission(RoleBilling, "instances.delete") {
		t.Error("billing role must not delete instances")
	}
	if HasPermission(RoleDeveloper, "members.write") {
		t.Error("developer must not manage members")
	}
}

func TestPermissionsForUnknownRole(t *testing.T) {
	if perms := PermissionsFor("nonexistent"); len(perms) != 0 {
		t.Errorf("unknown role should have no permissions, got %v", perms)
	}
}
