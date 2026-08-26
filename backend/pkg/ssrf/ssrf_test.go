package ssrf

import (
	"net"
	"testing"
)

func TestIsBlockedIP(t *testing.T) {
	tests := []struct {
		name    string
		ip      string
		blocked bool
	}{
		// Loopback.
		{"ipv4 loopback", "127.0.0.1", true},
		{"ipv4 loopback high", "127.255.0.9", true},
		{"ipv6 loopback", "::1", true},
		// Unspecified.
		{"ipv4 unspecified", "0.0.0.0", true},
		{"ipv6 unspecified", "::", true},
		// RFC1918.
		{"rfc1918 10/8", "10.1.2.3", true},
		{"rfc1918 172.16/12 low", "172.16.0.1", true},
		{"rfc1918 172.16/12 high", "172.31.255.254", true},
		{"public just outside 172.16/12", "172.32.0.1", false},
		{"rfc1918 192.168/16", "192.168.50.50", true},
		{"public looks-like-1918", "192.169.0.1", false},
		// CGNAT.
		{"cgnat low edge", "100.64.0.1", true},
		{"cgnat high edge", "100.127.255.254", true},
		{"public just above cgnat", "100.128.0.1", false},
		{"public just below cgnat", "100.63.255.254", false},
		// Link-local + cloud metadata.
		{"cloud metadata endpoint", "169.254.169.254", true},
		{"link-local generic", "169.254.10.20", true},
		{"ipv6 link-local", "fe80::1", true},
		// Multicast.
		{"ipv4 multicast", "224.0.0.1", true},
		{"ipv6 multicast", "ff02::1", true},
		// IPv6 unique-local fc00::/7.
		{"unique-local fd00::", "fd00::1234", true},
		{"unique-local fc00::", "fc00::abcd", true},
		{"global ipv6", "2606:4700:4700::1111", false},
		// Public addresses allowed.
		{"public anycast dns", "1.1.1.1", false},
		{"public google dns", "8.8.8.8", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsBlockedIP(net.ParseIP(tc.ip)); got != tc.blocked {
				t.Errorf("IsBlockedIP(%s) = %v, want %v", tc.ip, got, tc.blocked)
			}
		})
	}

	if !IsBlockedIP(nil) {
		t.Error("IsBlockedIP(nil) = false, want true")
	}
}

func TestValidateRejects(t *testing.T) {
	tests := []struct {
		name   string
		rawURL string
	}{
		{"metadata endpoint", "http://169.254.169.254/latest/meta-data/"},
		{"loopback", "http://127.0.0.1:3000/admin"},
		{"private 10/8", "http://10.0.0.1/"},
		{"private 192.168/16", "https://192.168.1.1/router"},
		{"private 172.16/12", "http://172.16.5.4/"},
		{"cgnat", "http://100.64.0.7/"},
		{"ipv6 loopback literal", "http://[::1]:8080/"},
		{"ipv6 unique-local literal", "http://[fd00::99]/"},
		{"ipv6 link-local literal", "http://[fe80::1]/"},
		{"unspecified", "http://0.0.0.0/"},
		{"bare localhost", "http://localhost/secret"},
		{"subdomain localhost", "http://api.localhost/"},
		{"internal host", "http://db.internal/"},
		{"ftp scheme", "ftp://1.1.1.1/file"},
		{"file scheme", "file:///etc/passwd"},
		{"no scheme treated as invalid", "1.1.1.1"},
		{"empty host", "http:///path"},
		{"unparsable", "http://[bad-ipv6]/"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			u, err := Validate(tc.rawURL)
			if err == nil {
				t.Errorf("Validate(%q) = %v, want error", tc.rawURL, u)
			}
		})
	}
}

func TestValidateAcceptsPublicURLs(t *testing.T) {
	// IP-literal public hosts are validated without touching DNS.
	urls := []string{
		"https://1.1.1.1/dns-query",
		"http://8.8.8.8:53/",
		"https://[2606:4700:4700::1111]/",
	}
	for _, raw := range urls {
		u, err := Validate(raw)
		if err != nil {
			t.Errorf("Validate(%q) returned error: %v", raw, err)
			continue
		}
		if u.Hostname() == "" {
			t.Errorf("Validate(%q) returned URL without host", raw)
		}
	}
}
