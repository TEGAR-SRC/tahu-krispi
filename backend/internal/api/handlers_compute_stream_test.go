package api

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v3"
)

// fakeBackupReader is a controllable io.ReadCloser standing in for the raw
// PVE volume stream handed back by OpenBackupContent.
type fakeBackupReader struct {
	mu     sync.Mutex
	r      *strings.Reader
	closed bool
}

func (f *fakeBackupReader) Read(p []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.r.Read(p)
}

func (f *fakeBackupReader) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

func (f *fakeBackupReader) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// failingBackupReader yields prefix bytes then always fails with its err.
type failingBackupReader struct {
	prefix string
	err    error
	mu     sync.Mutex
	closed bool
}

func (f *failingBackupReader) Read(p []byte) (int, error) {
	if f.prefix != "" {
		n := copy(p, f.prefix)
		f.prefix = f.prefix[n:]
		if n > 0 {
			return n, nil
		}
	}
	f.err = io.ErrUnexpectedEOF
	return 0, f.err
}

func (f *failingBackupReader) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

func (f *failingBackupReader) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// streamHandler mounts the same SetBodyStream wiring handleGenBackupURL uses
// for proxmox backups onto a bare fiber app.
func streamHandler(rc io.ReadCloser, size int64, onErr func(error)) fiber.Handler {
	return func(c fiber.Ctx) error {
		resp := c.Response()
		bodyLen := -1
		if size >= 0 {
			bodyLen = int(size)
		}
		resp.SetBodyStream(&loggingBackupStream{ReadCloser: rc, onErr: onErr}, bodyLen)
		resp.Header.SetContentType("application/octet-stream")
		resp.Header.Set("Content-Disposition", `attachment; filename="vzdump-qemu-100.vma.zst"`)
		return nil
	}
}

func TestBackupStreamDeliversBodyHeadersAndClosesAfterDrain(t *testing.T) {
	body := "hello"
	rc := &fakeBackupReader{r: strings.NewReader(body)}
	app := fiber.New()
	app.Get("/", streamHandler(rc, int64(len(body)), func(error) {
		t.Error("onErr must not fire on a clean stream")
	}))

	res, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); cd != `attachment; filename="vzdump-qemu-100.vma.zst"` {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if cl := res.Header.Get("Content-Length"); cl != "5" {
		t.Errorf("Content-Length = %q, want advertised size", cl)
	}
	got, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if string(got) != body {
		t.Errorf("body = %q, want %q", got, body)
	}
	if !rc.isClosed() {
		t.Error("reader must be closed after the response drained")
	}
}

func TestBackupStreamLogsInterruptionAndStillCloses(t *testing.T) {
	rc := &failingBackupReader{prefix: "ok"}
	app := fiber.New()
	var (
		mu     sync.Mutex
		logged error
	)
	app.Get("/", streamHandler(rc, -1, func(err error) { // unknown size -> chunked
		mu.Lock()
		logged = err
		mu.Unlock()
	}))

	res, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	// A mid-stream read failure kills the connection while the body is being
	// drained; fiber's test transport surfaces that as an unexpected EOF.
	// The status line was already sent, which is exactly the contract being
	// exercised here.
	if err != nil && !strings.Contains(err.Error(), "unexpected EOF") {
		t.Fatalf("app.Test: %v", err)
	}
	if res != nil {
		res.Body.Close()
	}

	mu.Lock()
	defer mu.Unlock()
	if !errors.Is(logged, io.ErrUnexpectedEOF) {
		t.Errorf("mid-stream failure not logged as injected error, got %v", logged)
	}
	if !rc.isClosed() {
		t.Error("reader must be closed even when the stream fails midway")
	}
}
