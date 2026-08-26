package mail

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTemplatesContainKeyFragments(t *testing.T) {
	when := time.Date(2026, 3, 5, 10, 30, 0, 0, time.UTC)
	cases := []struct {
		name string
		got  func() (string, string, string)
		want []string
	}{
		{"welcome_verification", func() (string, string, string) {
			return WelcomeVerification("user@example.com", "https://app.example.com/verify?t=abc")
		}, []string{"Verify your email", "user@example.com", "https://app.example.com/verify?t=abc"}},
		{"reset_password", func() (string, string, string) {
			return ResetPassword("https://app.example.com/reset?t=xyz")
		}, []string{"Reset your password", "https://app.example.com/reset?t=xyz"}},
		{"new_login", func() (string, string, string) {
			return NewLogin("user@example.com", "203.0.113.7", "Mozilla/5.0 TestAgent", when)
		}, []string{"New login", "user@example.com", "203.0.113.7", "Mozilla/5.0 TestAgent"}},
		{"password_changed", func() (string, string, string) {
			return PasswordChanged("198.51.100.9", when)
		}, []string{"password was changed", "198.51.100.9"}},
		{"email_changed", func() (string, string, string) {
			return EmailChanged("old@example.com", "new@example.com")
		}, []string{"Old email", "old@example.com", "New email", "new@example.com"}},
		{"phone_changed", func() (string, string, string) {
			return PhoneChanged("+628123456789")
		}, []string{"+628123456789"}},
		{"api_key_created", func() (string, string, string) {
			return APIKeyCreated("ci-deploy-key")
		}, []string{"ci-deploy-key", "created"}},
		{"api_key_revoked", func() (string, string, string) {
			return APIKeyRevoked("ci-deploy-key")
		}, []string{"ci-deploy-key", "revoked"}},
		{"instance_provisioned", func() (string, string, string) {
			return InstanceProvisioned("web-01", "inst_8f2a", "10.0.0.5")
		}, []string{"web-01", "inst_8f2a", "10.0.0.5"}},
		{"instance_suspended", func() (string, string, string) {
			return InstanceSuspended("web-01", "unpaid invoice INV-001")
		}, []string{"web-01", "unpaid invoice INV-001", "suspended"}},
		{"invoice_issued", func() (string, string, string) {
			return InvoiceIssued("INV-2026-0001", "150000.00", "IDR", "2026-04-01", "https://pay.example.com/inv/abc")
		}, []string{"INV-2026-0001", "150000.00", "IDR", "2026-04-01", "https://pay.example.com/inv/abc"}},
		{"payment_received", func() (string, string, string) {
			return PaymentReceived("150000.00", "IDR", "INV-2026-0001")
		}, []string{"150000.00", "IDR", "INV-2026-0001"}},
		{"backup_failed", func() (string, string, string) {
			return BackupFailed("db-primary")
		}, []string{"Backup failed", "db-primary"}},
		{"security_alert", func() (string, string, string) {
			return SecurityAlert("Password reset requested from unknown device")
		}, []string{"Security alert", "Password reset requested from unknown device"}},
		{"org_invitation", func() (string, string, string) {
			return OrgInvitation("Acme Corp", "member", "https://app.example.com/invite/tok")
		}, []string{"Acme Corp", "member", "https://app.example.com/invite/tok"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			subject, textBody, htmlBody := tc.got()
			if subject == "" || textBody == "" || htmlBody == "" {
				t.Fatalf("empty output: subject=%q text=%d bytes html=%d bytes",
					subject, len(textBody), len(htmlBody))
			}
			if !strings.Contains(strings.ToLower(htmlBody), "<html") {
				t.Errorf("html body is not an HTML document: %q", htmlBody[:min(60, len(htmlBody))])
			}
			all := subject + "\n" + textBody + "\n" + htmlBody
			for _, w := range tc.want {
				if !strings.Contains(all, w) {
					t.Errorf("output does not contain %q", w)
				}
			}
		})
	}
}

func TestSendWithoutHostReturnsErrNotConfigured(t *testing.T) {
	s := NewSender("", 587, "user", "pass", "from@example.com")
	err := s.Send(t.Context(), "to@example.com", "subject", "text", "<p>html</p>")
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

func TestBuildMessageStructure(t *testing.T) {
	msg := string(buildMessage("noreply@example.com", "to@example.com", "Hello & welcome", "plain text", "<b>html</b>"))
	for _, want := range []string{
		"From: noreply@example.com\r\n",
		"To: to@example.com\r\n",
		"MIME-Version: 1.0\r\n",
		"Content-Type: multipart/alternative; boundary=",
		"--" + mailBoundary + "\r\n",
		"Content-Type: text/plain; charset=utf-8\r\n",
		"Content-Type: text/html; charset=utf-8\r\n",
		"plain text\r\n",
		"<b>html</b>\r\n",
		"--" + mailBoundary + "--\r\n",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("message missing %q", want)
		}
	}
	if strings.Count(msg, mailBoundary) < 3 {
		t.Errorf("boundary used fewer than three times in message")
	}
}

func TestNormalizeCRLF(t *testing.T) {
	got := normalizeCRLF("a\r\nb\rc\nd")
	if got != "a\r\nb\r\nc\r\nd" {
		t.Errorf("normalizeCRLF = %q, want %q", got, "a\r\nb\r\nc\r\nd")
	}
}
