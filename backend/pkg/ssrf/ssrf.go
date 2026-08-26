// Package ssrf validates outbound URLs against SSRF (server-side request forgery)
// targets such as loopback, private, link-local, and cloud metadata addresses.
package ssrf

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// blockedIPv4CIDRs lists IPv4 ranges that must never be reached from server-side fetches.
var blockedIPv4CIDRs = []*net.IPNet{
	mustParseCIDR("10.0.0.0/8"),     // RFC1918 private
	mustParseCIDR("172.16.0.0/12"),  // RFC1918 private
	mustParseCIDR("192.168.0.0/16"), // RFC1918 private
	mustParseCIDR("100.64.0.0/10"),  // CGNAT shared address space
	mustParseCIDR("169.254.0.0/16"), // IPv4 link-local incl. cloud metadata endpoint
}

func mustParseCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(fmt.Sprintf("ssrf: invalid built-in CIDR %s: %v", s, err))
	}
	return n
}

// Validate parses rawURL and rejects anything that is not a plain http/https
// URL pointing at a public host. The host's IPs are all resolved via
// net.LookupIP and every resolved address must pass IsBlockedIP; IP-literal
// hosts are checked without DNS. Returns the parsed URL on success.
func Validate(rawURL string) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("ssrf: invalid URL: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("ssrf: scheme %q not allowed, only http/https", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return nil, errors.New("ssrf: URL has no host")
	}
	name := strings.ToLower(host)
	if name == "localhost" || strings.HasSuffix(name, ".localhost") || strings.HasSuffix(name, ".internal") {
		return nil, fmt.Errorf("ssrf: host %q is not allowed", host)
	}
	var ips []net.IP
	if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		ips, err = net.LookupIP(host)
		if err != nil {
			return nil, fmt.Errorf("ssrf: resolve host %q: %w", host, err)
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("ssrf: host %q did not resolve to any address", host)
		}
	}
	for _, ip := range ips {
		if IsBlockedIP(ip) {
			return nil, fmt.Errorf("ssrf: host %q resolves to blocked address %s", host, ip)
		}
	}
	return u, nil
}

// IsBlockedIP reports whether ip points at infrastructure an outbound request
// must not reach: loopback, unspecified, RFC1918, CGNAT 100.64/10, IPv4
// link-local 169.254/16 (including cloud metadata 169.254.169.254), multicast,
// IPv6 unique-local fc00::/7, IPv6 link-local fe80::/10, and interface-local /
// link-local multicast ranges.
func IsBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		for _, n := range blockedIPv4CIDRs {
			if n.Contains(v4) {
				return true
			}
		}
		return false
	}
	// IPv6 unique-local fc00::/7: first byte has the low bit free, high 7 bits 1111 110x.
	return len(ip) == net.IPv6len && ip[0]&0xfe == 0xfc
}
