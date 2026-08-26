package mail

import (
	"fmt"
	"html"
	"strings"
	"time"
)

const brandName = "Kilat Cloud"

// htmlShell is the shared inline-styled wrapper; {{BODY}} is replaced per email.
const htmlShell = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;padding:32px;">
        <tr><td style="font-size:20px;font-weight:bold;color:#111827;padding-bottom:20px;">` + brandName + `</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#374151;">{{BODY}}</td></tr>
        <tr><td style="padding-top:28px;font-size:12px;color:#9ca3af;">This is an automated message from ` + brandName + `. If you did not expect it, please contact support immediately.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

// renderHTML wraps body fragments in the shared branded shell.
func renderHTML(body string) string {
	return strings.ReplaceAll(htmlShell, "{{BODY}}", body)
}

// p renders one escaped paragraph.
func p(text string) string {
	return `<p style="margin:0 0 14px;">` + html.EscapeString(text) + `</p>`
}

// button renders a call-to-action link.
func button(url, label string) string {
	return `<p style="margin:20px 0;"><a href="` + html.EscapeString(url) +
		`" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:bold;">` +
		html.EscapeString(label) + `</a></p>`
}

// field renders a label/value line for structured notifications.
func field(label, value string) string {
	return `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">` + html.EscapeString(label) +
		`</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:bold;">` + html.EscapeString(value) + `</td></tr>`
}

// fieldTable wraps field rows in a simple table.
func fieldTable(rows ...string) string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0;background:#f9fafb;border-radius:6px;">` +
		strings.Join(rows, "") + `</table>`
}

// linkLine renders a raw clickable URL as fallback under buttons.
func linkLine(url string) string {
	return `<p style="word-break:break-all;font-size:12px;color:#6b7280;">Or paste this link into your browser:<br>` +
		html.EscapeString(url) + `</p>`
}

// WelcomeVerification builds the address-verification email sent after signup.
func WelcomeVerification(recipient, verifyLink string) (subject, textBody, htmlBody string) {
	subject = "Verify your email address"
	text := fmt.Sprintf("Hi %s,\n\nWelcome to %s! Please verify your email address by opening the link below:\n\n%s\n\n"+
		"The link expires in 24 hours. If you did not create an account, you can ignore this email.\n\n%s Team",
		recipient, brandName, verifyLink, brandName)
	body := p(fmt.Sprintf("Hi %s,", recipient)) +
		p(fmt.Sprintf("Welcome to %s! Please confirm this email address so you can start using your account.", brandName)) +
		button(verifyLink, "Verify Email") +
		linkLine(verifyLink)
	return subject, text, renderHTML(body)
}

// ResetPassword builds the password-reset email carrying a one-time link.
func ResetPassword(link string) (subject, textBody, htmlBody string) {
	subject = "Reset your password"
	text := fmt.Sprintf("We received a request to reset your %s password.\n\nOpen the link below to choose a new one:\n\n%s\n\n"+
		"The link expires in 1 hour. If you did not request this, no action is needed and your password stays unchanged.\n\n%s Team",
		brandName, link, brandName)
	body := p(fmt.Sprintf("We received a request to reset your %s password.", brandName)) +
		button(link, "Reset Password") +
		linkLine(link) +
		p("If you did not request this, you can safely ignore this email.")
	return subject, text, renderHTML(body)
}

// NewLogin notifies a user about a successful sign-in from a new context.
func NewLogin(email, ip, userAgent string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "New login to your account"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A new login to your account (%s) was detected.\n\nTime: %s\nIP address: %s\nDevice / browser: %s\n\n"+
		"If this was not you, change your password immediately.\n\n%s Team", email, whenStr, ip, userAgent, brandName)
	body := p("We noticed a new login to your account ("+html.EscapeString(email)+").") +
		fieldTable(
			field("Time", whenStr),
			field("IP address", ip),
			field("Device / browser", userAgent),
		) +
		p("If this was not you, reset your password right away.")
	return subject, text, renderHTML(body)
}

// PasswordChanged confirms that a password change completed.
func PasswordChanged(ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Your password was changed"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your %s password was changed successfully.\n\nTime: %s\nIP address: %s\n\n"+
		"If you did not make this change, contact support immediately.\n\n%s Team", brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("Your %s password was changed successfully.", brandName)) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not make this change, contact support immediately.")
	return subject, text, renderHTML(body)
}

// EmailChanged notifies both addresses that the account email was updated.
func EmailChanged(old, new string) (subject, textBody, htmlBody string) {
	subject = "Your email address was changed"
	text := fmt.Sprintf("The email address on your %s account was changed.\n\nOld email: %s\nNew email: %s\n\n"+
		"If you did not request this, contact support immediately.\n\n%s Team", brandName, old, new, brandName)
	body := p(fmt.Sprintf("The email address on your %s account was changed.", brandName)) +
		fieldTable(field("Old email", old), field("New email", new)) +
		p("Sign-in now requires the new address. If you did not request this, contact support immediately.")
	return subject, text, renderHTML(body)
}

// PhoneChanged confirms that the phone number on file was updated.
func PhoneChanged(newPhone string) (subject, textBody, htmlBody string) {
	subject = "Your phone number was changed"
	text := fmt.Sprintf("The phone number on your %s account was updated.\n\nNew phone number: %s\n\n"+
		"If you did not request this, contact support immediately.\n\n%s Team", brandName, newPhone, brandName)
	body := p(fmt.Sprintf("The phone number on your %s account was updated.", brandName)) +
		fieldTable(field("New phone number", newPhone)) +
		p("If you did not request this, contact support immediately.")
	return subject, text, renderHTML(body)
}

// APIKeyCreated announces that a new API key was generated.
func APIKeyCreated(name string) (subject, textBody, htmlBody string) {
	subject = "A new API key was created"
	text := fmt.Sprintf("A new API key named %q was created on your %s account.\n\n"+
		"If you did not create it, revoke it from the dashboard and contact support.\n\n%s Team", name, brandName, brandName)
	body := p(fmt.Sprintf("A new API key named %q was created on your %s account.", name, brandName)) +
		p("If you did not create it, revoke it from the dashboard and contact support.")
	return subject, text, renderHTML(body)
}

// APIKeyRevoked confirms that an API key was revoked.
func APIKeyRevoked(name string) (subject, textBody, htmlBody string) {
	subject = "An API key was revoked"
	text := fmt.Sprintf("The API key named %q was revoked on your %s account.\n\n"+
		"Applications using it will stop authenticating immediately.\n\n%s Team", name, brandName, brandName)
	body := p(fmt.Sprintf("The API key named %q was revoked on your %s account.", name, brandName)) +
		p("Applications using it will stop authenticating immediately.")
	return subject, text, renderHTML(body)
}

// InstanceProvisioned reports a newly created compute instance.
func InstanceProvisioned(name, publicID, ipv4 string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Instance %s is ready", name)
	text := fmt.Sprintf("Your instance has been provisioned successfully.\n\nInstance: %s\nPublic ID: %s\nIPv4: %s\n\n"+
		"You can manage it from the dashboard.\n\n%s Team", name, publicID, ipv4, brandName)
	body := p(fmt.Sprintf("Your instance %q has been provisioned successfully.", name)) +
		fieldTable(
			field("Public ID", publicID),
			field("IPv4", ipv4),
		) +
		p("You can manage it from the dashboard.")
	return subject, text, renderHTML(body)
}

// InstanceSuspended explains why an instance was suspended.
func InstanceSuspended(name, reason string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Instance %s has been suspended", name)
	text := fmt.Sprintf("Your instance %q has been suspended.\n\nReason: %s\n\n"+
		"Please resolve the issue or contact support to restore it.\n\n%s Team", name, reason, brandName)
	body := p(fmt.Sprintf("Your instance %q has been suspended.", name)) +
		fieldTable(field("Reason", reason)) +
		p("Please resolve the issue or contact support to restore it.")
	return subject, text, renderHTML(body)
}

// InvoiceIssued delivers an invoice notification with its payment link.
func InvoiceIssued(number, total, currency, dueDate, payLink string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Invoice %s issued", number)
	text := fmt.Sprintf("A new invoice has been issued on your %s account.\n\nInvoice number: %s\nAmount due: %s %s\nDue date: %s\n\n"+
		"Pay online at:\n%s\n\n%s Team", brandName, number, total, currency, dueDate, payLink, brandName)
	body := p("A new invoice has been issued on your account.") +
		fieldTable(
			field("Invoice number", number),
			field("Amount due", total+" "+currency),
			field("Due date", dueDate),
		) +
		button(payLink, "Pay Invoice") +
		linkLine(payLink)
	return subject, text, renderHTML(body)
}

// PaymentReceived confirms that an invoice payment settled.
func PaymentReceived(amount, currency, invoiceNumber string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Payment received for invoice %s", invoiceNumber)
	text := fmt.Sprintf("Thank you! Your payment has been received.\n\nInvoice number: %s\nAmount paid: %s %s\n\n"+
		"No further action is required.\n\n%s Team", invoiceNumber, amount, currency, brandName)
	body := p("Thank you! Your payment has been received.") +
		fieldTable(
			field("Invoice number", invoiceNumber),
			field("Amount paid", amount+" "+currency),
		) +
		p("No further action is required.")
	return subject, text, renderHTML(body)
}

// BackupFailed alerts about a failed scheduled backup.
func BackupFailed(instanceName string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Backup failed for instance %s", instanceName)
	text := fmt.Sprintf("A scheduled backup for your instance %q failed.\n\n"+
		"Backups will be retried automatically, but please check the dashboard for details.\n\n%s Team",
		instanceName, brandName)
	body := p(fmt.Sprintf("A scheduled backup for your instance %q failed.", instanceName)) +
		p("Backups will be retried automatically, but please check the dashboard for details.")
	return subject, text, renderHTML(body)
}

// SecurityAlert forwards an arbitrary security-relevant notice.
func SecurityAlert(detail string) (subject, textBody, htmlBody string) {
	subject = "Security alert on your account"
	text := fmt.Sprintf("%s\n\nIf you do not recognize this activity, secure your account immediately by changing your password.\n\n%s Team",
		detail, brandName)
	body := p(detail) +
		p("If you do not recognize this activity, secure your account immediately by changing your password.")
	return subject, text, renderHTML(body)
}

// OrgInvitation invites a user to join an organization with a given role.
func OrgInvitation(orgName, role, acceptLink string) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("You are invited to join %s", orgName)
	text := fmt.Sprintf("You have been invited to join the organization %q on %s as %s.\n\nAccept the invitation here:\n\n%s\n\n"+
		"The invitation expires in 7 days.\n\n%s Team", orgName, brandName, role, acceptLink, brandName)
	body := p(fmt.Sprintf("You have been invited to join the organization %q on %s as %s.", orgName, brandName, role)) +
		button(acceptLink, "Accept Invitation") +
		linkLine(acceptLink) +
		p("The invitation expires in 7 days.")
	return subject, text, renderHTML(body)
}
