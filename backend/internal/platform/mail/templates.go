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

// ---------------------------------------------------------------------------
// Additional templates — covering every audit event / action so no event is
// without a corresponding email template. Each function follows the same
// branded shell and provides subject + text + html.
// ---------------------------------------------------------------------------

// EmailVerificationResent is the follow-up verification email sent when the
// user requests a resend or when login auto-resends for a pending account.
func EmailVerificationResent(recipient, verifyLink string) (subject, textBody, htmlBody string) {
	subject = "Verify your email address (resent)"
	text := fmt.Sprintf("Hi %s,\n\nWe noticed your email is still unverified. Please verify by opening the link below:\n\n%s\n\n"+
		"The link expires in 24 hours. If you already verified, you can ignore this email.\n\n%s Team",
		recipient, verifyLink, brandName)
	body := p(fmt.Sprintf("Hi %s,", recipient)) +
		p("Your email address is still unverified. Please confirm it to activate your account.") +
		button(verifyLink, "Verify Email") +
		linkLine(verifyLink)
	return subject, text, renderHTML(body)
}

// AccountLocked notifies that the account was temporarily locked after repeated failures.
func AccountLocked(email, ip string, until, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Your account was temporarily locked"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	untilStr := until.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your %s account (%s) was temporarily locked due to multiple failed attempts.\n\nTime: %s\nIP: %s\nLocked until: %s\n\n"+
		"If this was you, wait until the lockout expires or reset your password. If not, secure your account immediately.\n\n%s Team",
		brandName, email, whenStr, ip, untilStr, brandName)
	body := p(fmt.Sprintf("Your account %q was temporarily locked.", email)) +
		fieldTable(field("Time", whenStr), field("IP address", ip), field("Locked until", untilStr)) +
		p("If this was not you, reset your password right away.")
	return subject, text, renderHTML(body)
}

// MFAEnabled confirms that two-factor authentication was enabled.
func MFAEnabled(method, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Two-factor authentication enabled"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Two-factor authentication (%s) was enabled on your %s account.\n\nTime: %s\nIP: %s\n\n"+
		"If you did not do this, disable it immediately and change your password.\n\n%s Team", method, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("Two-factor authentication (%s) was enabled.", html.EscapeString(method))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not enable this, disable it immediately.")
	return subject, text, renderHTML(body)
}

// MFADisabled confirms that 2FA was disabled.
func MFADisabled(ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Two-factor authentication disabled"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Two-factor authentication was disabled on your %s account.\n\nTime: %s\nIP: %s\n\n"+
		"If you did not do this, enable it again and change your password.\n\n%s Team", brandName, whenStr, ip, brandName)
	body := p("Two-factor authentication was disabled on your account.") +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not do this, secure your account immediately.")
	return subject, text, renderHTML(body)
}

// RecoveryCodesRegenerated notifies that recovery codes were regenerated.
func RecoveryCodesRegenerated(ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Recovery codes regenerated"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your %s recovery codes were regenerated.\n\nTime: %s\nIP: %s\n\nOld codes are now invalid. Store the new ones securely.\n\n%s Team",
		brandName, whenStr, ip, brandName)
	body := p("Your recovery codes were regenerated. Old codes are now invalid.") +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("Store the new codes securely.")
	return subject, text, renderHTML(body)
}

// PasskeyRegistered confirms a new passkey was added.
func PasskeyRegistered(name, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "A new passkey was registered"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A new passkey %q was registered on your %s account.\n\nTime: %s\nIP: %s\n\nIf you did not do this, remove it immediately.\n\n%s Team",
		name, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("A new passkey %q was registered.", html.EscapeString(name))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not register this, remove it immediately.")
	return subject, text, renderHTML(body)
}

// PasskeyRemoved confirms a passkey was removed.
func PasskeyRemoved(name, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "A passkey was removed"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("The passkey %q was removed from your %s account.\n\nTime: %s\nIP: %s\n\nIf you did not do this, register a new passkey and review your security.\n\n%s Team",
		name, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("The passkey %q was removed.", html.EscapeString(name))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not do this, secure your account.")
	return subject, text, renderHTML(body)
}

// ContactChangeRequested notifies that an email/phone change was requested (OTP pending).
func ContactChangeRequested(kind, newValue, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Confirm your new %s", kind)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A request to change your %s to %q was made on your %s account.\n\nTime: %s\nIP: %s\n\nIf you requested this, confirm with the OTP sent to the new %s. If not, ignore this email and contact support.\n\n%s Team",
		kind, newValue, brandName, whenStr, ip, kind, brandName)
	body := p(fmt.Sprintf("A request to change your %s to %q was made.", html.EscapeString(kind), html.EscapeString(newValue))) +
		fieldTable(field("Time", whenStr), field("IP address", ip), field("New "+kind, newValue)) +
		p("If you requested this, confirm with the OTP. If not, contact support.")
	return subject, text, renderHTML(body)
}

// ContactChangeConfirmed confirms the contact was updated.
func ContactChangeConfirmed(kind, oldValue, newValue string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Your %s was updated", kind)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your %s on your %s account was updated.\n\nOld: %s\nNew: %s\nTime: %s\n\nIf you did not request this, contact support immediately.\n\n%s Team",
		kind, brandName, oldValue, newValue, whenStr, brandName)
	body := p(fmt.Sprintf("Your %s was updated.", html.EscapeString(kind))) +
		fieldTable(field("Old "+kind, oldValue), field("New "+kind, newValue), field("Time", whenStr)) +
		p("If you did not request this, contact support immediately.")
	return subject, text, renderHTML(body)
}

// PhoneOTPRequested notifies that a phone OTP was requested.
func PhoneOTPRequested(phone, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Phone verification code requested"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A verification code was requested for your phone %s on your %s account.\n\nTime: %s\nIP: %s\n\nIf you did not request this, ignore the SMS and secure your account.\n\n%s Team",
		phone, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("A verification code was requested for %s.", html.EscapeString(phone))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not request this, ignore it and secure your account.")
	return subject, text, renderHTML(body)
}

// PhoneVerified confirms phone verification succeeded.
func PhoneVerified(phone string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Your phone number was verified"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your phone number %s was verified on your %s account.\n\nTime: %s\n\nIf you did not do this, contact support.\n\n%s Team",
		phone, brandName, whenStr, brandName)
	body := p(fmt.Sprintf("Your phone number %s was verified.", html.EscapeString(phone))) +
		fieldTable(field("Time", whenStr)) +
		p("If you did not do this, contact support.")
	return subject, text, renderHTML(body)
}

// SessionRevoked notifies that a session was revoked.
func SessionRevoked(device, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "A session was revoked"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A session (%s) on your %s account was revoked.\n\nTime: %s\nIP: %s\n\nIf you did not do this, change your password.\n\n%s Team",
		device, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("A session (%s) was revoked.", html.EscapeString(device))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not do this, change your password.")
	return subject, text, renderHTML(body)
}

// OAuthLogin notifies about an OAuth sign-in.
func OAuthLogin(provider, email, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Signed in with %s", provider)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("You signed in to your %s account (%s) via %s.\n\nTime: %s\nIP: %s\n\nIf this was not you, secure your account.\n\n%s Team",
		brandName, email, provider, whenStr, ip, brandName)
	body := p(fmt.Sprintf("You signed in via %s.", html.EscapeString(provider))) +
		fieldTable(field("Account", email), field("Time", whenStr), field("IP address", ip)) +
		p("If this was not you, secure your account.")
	return subject, text, renderHTML(body)
}

// AddressCreated confirms a new address was added.
func AddressCreated(label, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "New address added"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A new address %q was added to your %s account.\n\nTime: %s\nIP: %s\n\n%s Team", label, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("A new address %q was added.", html.EscapeString(label))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("If you did not add this, review your account.")
	return subject, text, renderHTML(body)
}

// AddressUpdated confirms an address was updated.
func AddressUpdated(label, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Address updated"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your address %q was updated on your %s account.\n\nTime: %s\nIP: %s\n\n%s Team", label, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("Your address %q was updated.", html.EscapeString(label))) +
		fieldTable(field("Time", whenStr), field("IP address", ip))
	return subject, text, renderHTML(body)
}

// AddressDeleted confirms an address was deleted.
func AddressDeleted(label, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Address deleted"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your address %q was deleted from your %s account.\n\nTime: %s\nIP: %s\n\n%s Team", label, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("Your address %q was deleted.", html.EscapeString(label))) +
		fieldTable(field("Time", whenStr), field("IP address", ip))
	return subject, text, renderHTML(body)
}

// AddressDefaultSet confirms the default address was changed.
func AddressDefaultSet(label string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Default address changed"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your default address was set to %q on your %s account.\n\nTime: %s\n\n%s Team", label, brandName, whenStr, brandName)
	body := p(fmt.Sprintf("Your default address was set to %q.", html.EscapeString(label))) +
		fieldTable(field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// APIKeyRotated notifies that an API key was rotated.
func APIKeyRotated(name, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "An API key was rotated"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("The API key %q was rotated on your %s account.\n\nTime: %s\nIP: %s\n\nOld credentials are now invalid.\n\n%s Team",
		name, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("The API key %q was rotated.", html.EscapeString(name))) +
		fieldTable(field("Time", whenStr), field("IP address", ip)) +
		p("Old credentials are now invalid.")
	return subject, text, renderHTML(body)
}

// APIKeyUpdated notifies that an API key metadata was updated.
func APIKeyUpdated(name, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "An API key was updated"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("The API key %q was updated on your %s account.\n\nTime: %s\nIP: %s\n\n%s Team", name, brandName, whenStr, ip, brandName)
	body := p(fmt.Sprintf("The API key %q was updated.", html.EscapeString(name))) +
		fieldTable(field("Time", whenStr), field("IP address", ip))
	return subject, text, renderHTML(body)
}

// WalletTopupRequested confirms a wallet top-up was initiated.
func WalletTopupRequested(amount, currency, orderID string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Wallet top-up requested"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A wallet top-up of %s %s was requested.\n\nOrder: %s\nTime: %s\n\n%s Team", amount, currency, orderID, whenStr, brandName)
	body := p(fmt.Sprintf("A wallet top-up of %s %s was requested.", html.EscapeString(amount), html.EscapeString(currency))) +
		fieldTable(field("Order", orderID), field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// AffiliateSettingsUpdated confirms affiliate settings were changed.
func AffiliateSettingsUpdated(ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Affiliate settings updated"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Your %s affiliate settings were updated.\n\nTime: %s\nIP: %s\n\n%s Team", brandName, whenStr, ip, brandName)
	body := p("Your affiliate settings were updated.") +
		fieldTable(field("Time", whenStr), field("IP address", ip))
	return subject, text, renderHTML(body)
}

// SnapshotCreated confirms a snapshot was created.
func SnapshotCreated(instance, snapshotID string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Snapshot created for %s", instance)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("A snapshot %q was created for instance %q.\n\nTime: %s\n\n%s Team", snapshotID, instance, whenStr, brandName)
	body := p(fmt.Sprintf("A snapshot %q was created for instance %q.", html.EscapeString(snapshotID), html.EscapeString(instance))) +
		fieldTable(field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// SnapshotDeleted confirms a snapshot was deleted.
func SnapshotDeleted(snapshotID string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Snapshot deleted"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Snapshot %q was deleted.\n\nTime: %s\n\n%s Team", snapshotID, whenStr, brandName)
	body := p(fmt.Sprintf("Snapshot %q was deleted.", html.EscapeString(snapshotID))) +
		fieldTable(field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// InstanceResized confirms an instance was resized.
func InstanceResized(instance, oldSpec, newSpec string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Instance %s resized", instance)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Instance %q was resized.\n\nFrom: %s\nTo: %s\nTime: %s\n\n%s Team", instance, oldSpec, newSpec, whenStr, brandName)
	body := p(fmt.Sprintf("Instance %q was resized.", html.EscapeString(instance))) +
		fieldTable(field("From", oldSpec), field("To", newSpec), field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// OrderCancelled confirms an order was cancelled.
func OrderCancelled(orderID, reason string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("Order %s cancelled", orderID)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Order %q was cancelled.\n\nReason: %s\nTime: %s\n\n%s Team", orderID, reason, whenStr, brandName)
	body := p(fmt.Sprintf("Order %q was cancelled.", html.EscapeString(orderID))) +
		fieldTable(field("Reason", reason), field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// SubscriptionCancelled confirms a subscription was cancelled.
func SubscriptionCancelled(subID, reason string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Subscription cancelled"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Subscription %q was cancelled.\n\nReason: %s\nTime: %s\n\n%s Team", subID, reason, whenStr, brandName)
	body := p(fmt.Sprintf("Subscription %q was cancelled.", html.EscapeString(subID))) +
		fieldTable(field("Reason", reason), field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// AffiliateWithdrawRequested confirms an affiliate withdrawal was requested.
func AffiliateWithdrawRequested(amount, currency string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Affiliate withdrawal requested"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("An affiliate withdrawal of %s %s was requested.\n\nTime: %s\n\n%s Team", amount, currency, whenStr, brandName)
	body := p(fmt.Sprintf("An affiliate withdrawal of %s %s was requested.", html.EscapeString(amount), html.EscapeString(currency))) +
		fieldTable(field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// AffiliateEarningReversed notifies that an affiliate earning was reversed.
func AffiliateEarningReversed(amount, currency, reason string, when time.Time) (subject, textBody, htmlBody string) {
	subject = "Affiliate earning reversed"
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("An affiliate earning of %s %s was reversed.\n\nReason: %s\nTime: %s\n\n%s Team", amount, currency, reason, whenStr, brandName)
	body := p(fmt.Sprintf("An affiliate earning of %s %s was reversed.", html.EscapeString(amount), html.EscapeString(currency))) +
		fieldTable(field("Reason", reason), field("Time", whenStr))
	return subject, text, renderHTML(body)
}

// GenericEvent is a fallback for any audit action that does not have a dedicated template yet.
// It ensures every event can be rendered as an email if needed, satisfying the "all events must have a template" requirement.
func GenericEvent(action, detail, ip string, when time.Time) (subject, textBody, htmlBody string) {
	subject = fmt.Sprintf("[%s] %s", brandName, action)
	whenStr := when.UTC().Format("2 Jan 2006 15:04 MST")
	text := fmt.Sprintf("Event: %s\nDetail: %s\nTime: %s\nIP: %s\n\n%s Team", action, detail, whenStr, ip, brandName)
	body := p(fmt.Sprintf("Event: %s", html.EscapeString(action))) +
		fieldTable(field("Detail", detail), field("Time", whenStr), field("IP address", ip))
	return subject, text, renderHTML(body)
}
