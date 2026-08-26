package network

import (
	"errors"
	"net"
	"strings"

	"github.com/google/uuid"

	apperrors "kilat.cloud/backend/pkg/errors"
)

func parseUUID(s string) uuid.UUID {
	id, _ := uuid.Parse(s)
	return id
}

// parseCIDR parses either a CIDR or bare IP into a *net.IPNet.
func parseCIDR(s string) (*net.IPNet, error) {
	if strings.Contains(s, "/") {
		if strings.HasSuffix(s, "/0") {
			return nil, errors.New("the /0 prefix is not allowed")
		}
		_, ipnet, err := net.ParseCIDR(s)
		return ipnet, err
	}
	ip := net.ParseIP(s)
	if ip == nil {
		return nil, errors.New("invalid IP")
	}
	bits := 32
	if ip.To4() == nil {
		bits = 128
	}
	return &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)}, nil
}

// validateCIDR checks a CIDR or bare address and rejects the /0 prefix.
func validateCIDR(s string) error {
	_, err := parseCIDR(s)
	return err
}

func isUnique(err error, constraint string) bool {
	if err == nil || constraint == "" {
		return false
	}
	s := err.Error()
	n := len(constraint)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == constraint {
			return true
		}
	}
	return false
}

func parseIP(s string) net.IP { return net.ParseIP(s) }

func parseUUIDPtr(s string) *uuid.UUID {
	if s == "" {
		return nil
	}
	u := parseUUID(s)
	return &u
}

func notFoundErr(msg string) error {
	return apperrors.New(apperrors.CodeNotFound, msg)
}

func conflictErr(msg string) error {
	return apperrors.New(apperrors.CodeConflict, msg)
}

func forbiddenErr(msg string) error {
	return apperrors.New(apperrors.CodeForbidden, msg)
}

func invalidField(field, msg string) error {
	return apperrors.WithFields(
		apperrors.New(apperrors.CodeValidation, msg),
		map[string]string{field: msg})
}
