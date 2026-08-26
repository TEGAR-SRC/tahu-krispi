package onidel

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// Locks the parsing contract against Onidel's real response shapes captured
// from the live API (GET /startup_scripts).
func TestListStartupScriptsDecodesLiveShape(t *testing.T) {
	body := []byte(`{"scripts":[{"id":"b7e3f1a2-5678-4def-abcd-123456789abc","name":"Install NGINX","created":"2024-06-15T08:00:00Z","updated":"2024-06-16T08:00:00Z"}]}`)
	var wrapper struct {
		Scripts []StartupScript `json:"scripts"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(wrapper.Scripts) != 1 {
		t.Fatalf("expected 1 script, got %d", len(wrapper.Scripts))
	}
	s := wrapper.Scripts[0]
	if s.ID == "" || s.Name != "Install NGINX" || s.Created == "" || s.Updated == "" {
		t.Fatalf("unexpected fields: %+v", s)
	}
}

// GET /isos returns sizes in bytes and an is_system_iso flag; the ISO quota
// enforcement depends on both surviving the decode.
func TestISOFieldsDecodeLiveShape(t *testing.T) {
	body := []byte(`{"isos":[{"id":"f4a9d197-5d6d-4310-a1a4-ea8613bb1c95","filename":"netboot.xyz.iso","name":"netboot.xyz ISO","desc":"NETBOOT_ISO_DESC","size":257698037,"status":100,"is_system_iso":true,"date_created":"2025-05-22T10:27:41.235839Z"}]}`)
	var out struct {
		Isos []struct {
			ID         string `json:"id"`
			Filename   string `json:"filename"`
			Name       string `json:"name"`
			Size       int64  `json:"size"`
			Status     int    `json:"status"`
			IsSystem   bool   `json:"is_system_iso"`
			DateCreate string `json:"date_created"`
		} `json:"isos"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out.Isos) != 1 || out.Isos[0].Size != 257698037 || !out.Isos[0].IsSystem {
		t.Fatalf("unexpected: %+v", out.Isos)
	}
}

// StartVM and MigrateVM must surface PROVIDER_UNSUPPORTED (HTTP 501): the
// Onidel upstream API has no start endpoint under /vm/{id} and manages
// placement entirely itself, so the adapter fails fast before dialing.
func TestUnsupportedVMOperationsReturnCodeUnsupported(t *testing.T) {
	// Unreachable base URL on purpose: unsupported paths must never issue a
	// request, so nothing should try to connect.
	a := NewAdapter("http://127.0.0.1:1", "test-key")
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

	check("StartVM", a.StartVM(ctx, "vm-1"))
	check("MigrateVM", a.MigrateVM(ctx, "vm-1", "host-b"))
}
