// Package vmware implements the provider.ComputeProvider interface against a
// self-hosted VMware vSphere deployment (vCenter managing ESXi hosts) using
// the github.com/vmware/govmomi SDK (v0.56.0).
//
// client.go is a thin typed wrapper over govmomi covering only what the
// adapter needs: lazy SOAP session establishment with login, a matching
// vAPI REST session for the tags service, and one-shot retry on expired
// sessions. Every SDK symbol used here was verified against the module
// source of govmomi v0.56.0 ($(go env GOMODCACHE)/github.com/vmware/
// govmomi@v0.56.0).
package vmware

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/vmware/govmomi/fault"
	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/performance"
	"github.com/vmware/govmomi/session"
	"github.com/vmware/govmomi/vapi/rest"
	"github.com/vmware/govmomi/vapi/tags"
	"github.com/vmware/govmomi/vim25"
	"github.com/vmware/govmomi/vim25/soap"
	"github.com/vmware/govmomi/vim25/types"

	apperrors "kilat.cloud/backend/pkg/errors"
)

// Client wraps a lazily-connected govmomi session pair (SOAP + REST) and
// normalizes error handling for the adapter. One Client maps to one
// vCenter endpoint and credential set; sessions are established on first
// use and re-established transparently when vCenter expires them.
type Client struct {
	u        *url.URL // parsed "<scheme>://<host>[:port]/sdk" endpoint
	user     *url.Userinfo
	insecure bool // skip TLS verification (self-signed lab certs)

	mu    sync.Mutex    // guards the cached sessions below
	vim   *vim25.Client // connected + logged-in SOAP session (nil = not connected)
	restC *rest.Client  // logged-in REST session used by the tags manager
}

// NewClient builds a vSphere client from DB-stored endpoint credentials.
// baseURL may point at the host root or directly at the /sdk endpoint;
// soap.ParseURL defaults scheme to https and path to /sdk. username uses
// vSphere "user@domain" format (e.g. "administrator@vsphere.local").
func NewClient(baseURL, username, password string, insecure bool) (*Client, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "vmware: baseURL is required")
	}
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "vmware: username and password are required")
	}
	u, err := soap.ParseURL(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeValidation, "vmware: invalid baseURL %q: %v", baseURL, err)
	}
	return &Client{
		u:        u,
		user:     url.UserPassword(username, password),
		insecure: insecure,
	}, nil
}

// vimSession returns the connected SOAP client, dialing and logging in on
// first use (or after invalidate). The mutex serializes establishment only;
// steady-state calls take the lock briefly with no I/O under it except
// right after a (re)connect decision.
func (c *Client) vimSession(ctx context.Context) (*vim25.Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.vim != nil {
		return c.vim, nil
	}
	rt := soap.NewClient(c.u, c.insecure)
	v, err := vim25.NewClient(ctx, rt)
	if err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: connect %s: %v", c.u.Host, err)
	}
	sm := session.NewManager(v)
	if err := sm.Login(ctx, c.user); err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: login %s: %v", c.u.Host, err)
	}
	c.vim = v
	return v, nil
}

// restSession returns the logged-in REST client used by the vAPI services.
func (c *Client) restSession(ctx context.Context) (*rest.Client, error) {
	c.mu.Lock()
	if c.restC != nil {
		rc := c.restC
		c.mu.Unlock()
		return rc, nil
	}
	c.mu.Unlock()

	v, err := c.vimSession(ctx)
	if err != nil {
		return nil, err
	}
	rc := rest.NewClient(v)
	if err := rc.Login(ctx, c.user); err != nil {
		return nil, apperrors.Newf(apperrors.CodeProviderUnavailable,
			"vmware: rest login %s: %v", c.u.Host, err)
	}
	c.mu.Lock()
	c.restC = rc
	c.mu.Unlock()
	return rc, nil
}

// invalidate drops both cached sessions so the next call re-logins. Called
// after NotAuthenticated (SOAP) / UNAUTHENTICATED (REST) errors.
func (c *Client) invalidate() {
	c.mu.Lock()
	c.vim = nil
	c.restC = nil
	c.mu.Unlock()
}

// isNotAuthenticated reports whether err is vCenter's session-expired fault.
func isNotAuthenticated(err error) bool {
	if err == nil {
		return false
	}
	return fault.Is(err, &types.NotAuthenticated{})
}

// isUnauthenticated reports whether err is the REST API's expired-session
// error.
func isUnauthenticated(err error) bool {
	return rest.IsStatusError(err, http.StatusUnauthorized)
}

// vimCall runs op against the connected SOAP session. When the call fails
// because vCenter expired the session, the session is re-established once
// and op retried — callers see at most one transparent renewal.
func vimCall[T any](ctx context.Context, c *Client, op func(v *vim25.Client) (T, error)) (T, error) {
	out, err := func() (T, error) {
		v, serr := c.vimSession(ctx)
		if serr != nil {
			var zero T
			return zero, serr
		}
		return op(v)
	}()
	if !isNotAuthenticated(err) {
		return out, err
	}
	c.invalidate()
	v, serr := c.vimSession(ctx)
	if serr != nil {
		var zero T
		return zero, serr
	}
	return op(v)
}

// restCall runs op against the logged-in REST session with the same
// one-shot renewal semantics as vimCall.
func restCall[T any](ctx context.Context, c *Client, op func(rc *rest.Client) (T, error)) (T, error) {
	out, err := func() (T, error) {
		rc, serr := c.restSession(ctx)
		if serr != nil {
			var zero T
			return zero, serr
		}
		return op(rc)
	}()
	if !isUnauthenticated(err) {
		return out, err
	}
	c.invalidate()
	rc, serr := c.restSession(ctx)
	if serr != nil {
		var zero T
		return zero, serr
	}
	return op(rc)
}

// finder builds a Finder over the current session, pinned to the default
// datacenter (single-DC deployment model); constructing it performs only
// that one lookup.
func finder(ctx context.Context, v *vim25.Client) *find.Finder {
	f := find.NewFinder(v, true)
	if dc, err := f.DefaultDatacenter(ctx); err == nil {
		f.SetDatacenter(dc)
	}
	return f
}

// perfManager builds a performance.Manager over the current session.
func perfManager(v *vim25.Client) *performance.Manager {
	return performance.NewManager(v)
}

// tagsManager wraps the REST client in the tags service manager.
func tagsManager(rc *rest.Client) *tags.Manager {
	return tags.NewManager(rc)
}
