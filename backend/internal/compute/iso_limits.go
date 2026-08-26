// iso_limits.go enforces the product limits for user-uploaded custom ISOs on
// the Onidel provider: a per-file size cap, a per-user count cap, and a
// per-user total storage quota counted across every organization the user owns.
package compute

import (
	"context"
	"fmt"
	"net/http"
	"time"

	apperrors "kilat.cloud/backend/pkg/errors"
	ssrfpkg "kilat.cloud/backend/pkg/ssrf"
)

const (
	// MaxISOSizeBytes caps a single custom ISO file at 15 GiB.
	MaxISOSizeBytes int64 = 15 << 30
	// MaxISOCountPerUser caps how many custom ISOs one user may own at once.
	MaxISOCountPerUser = 10
	// MaxISOTotalQuotaBytes caps the summed size of all custom ISOs owned by
	// one user (across their organizations) at 50 GiB. Filling the quota
	// exactly is allowed; exceeding it is rejected.
	MaxISOTotalQuotaBytes int64 = 50 << 30
)

// ISOUsage is a user's current custom-ISO footprint across their organizations.
type ISOUsage struct {
	Count      int
	TotalBytes int64
}

// CheckISOQuota validates registering one more ISO of newSizeBytes on top of
// existing usage against the custom ISO limits, in the order the API enforces
// them: non-positive size, per-user count cap, per-user total quota, then the
// per-file size cap.
func CheckISOQuota(existingCount int, existingTotalBytes, newSizeBytes int64) error {
	if newSizeBytes <= 0 {
		return apperrors.New(apperrors.CodeValidation, "iso size must be a positive number of bytes")
	}
	if existingCount+1 > MaxISOCountPerUser {
		return apperrors.Newf(apperrors.CodeLimitExceeded,
			"custom ISO limit reached: at most %d ISOs per user", MaxISOCountPerUser)
	}
	if existingTotalBytes+newSizeBytes > MaxISOTotalQuotaBytes {
		return apperrors.Newf(apperrors.CodeLimitExceeded,
			"custom ISO quota exceeded: at most %d GiB of ISO storage per user", MaxISOTotalQuotaBytes>>30)
	}
	if newSizeBytes > MaxISOSizeBytes {
		return apperrors.Newf(apperrors.CodeValidation,
			"iso file exceeds the maximum size of %d GiB", MaxISOSizeBytes>>30)
	}
	return nil
}

// isoHTTPClient is the default client for ISO URL size probes: requests are
// time-bounded and redirects are followed only through hosts that pass SSRF
// validation. Callers must have validated the entry URL themselves (the ISO
// handlers do via ssrf.Validate before probing).
func isoHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("stopped after 5 redirects")
			}
			if _, err := ssrfpkg.Validate(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

// ProbeURLSize issues a HEAD request to rawURL and returns the file size from
// the response's Content-Length. An error is returned when the request fails
// or the size is absent or undeterminable. hc may be nil to use the SSRF-safe
// default; tests inject their own client.
func ProbeURLSize(ctx context.Context, hc *http.Client, rawURL string) (int64, error) {
	if hc == nil {
		hc = isoHTTPClient()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, rawURL, nil)
	if err != nil {
		return 0, fmt.Errorf("probe iso url: %w", err)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, fmt.Errorf("probe iso url: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("probe iso url: unexpected status %d", resp.StatusCode)
	}
	size := resp.ContentLength // -1 when the header is absent
	if size <= 0 {
		return 0, fmt.Errorf("probe iso url: Content-Length missing or undeterminable")
	}
	return size, nil
}
