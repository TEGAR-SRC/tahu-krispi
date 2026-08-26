// Package mail implements a minimal SMTP sender and pure transactional
// email template builders for Kilat Cloud.
package mail

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// ErrNotConfigured is returned by Send when the SMTP host has not been set.
var ErrNotConfigured = errors.New("mail: smtp sender is not configured")

const dialTimeout = 15 * time.Second

// mailBoundary is a random MIME boundary shared by every message built in this
// process. crypto/rand.Read never fails on Go >= 1.24.
var mailBoundary = func() string {
	b := make([]byte, 12)
	rand.Read(b)
	return "kilat-" + hex.EncodeToString(b)
}()

// Sender sends transactional emails over SMTP using STARTTLS when available.
type Sender struct {
	host string
	port int
	user string
	pass string
	from string
}

// NewSender creates a Sender. An empty host makes Send return ErrNotConfigured.
func NewSender(host string, port int, user, pass, from string) *Sender {
	return &Sender{host: host, port: port, user: user, pass: pass, from: from}
}

// Send delivers one message containing a text/plain and a text/html
// alternative part to a single recipient.
func (s *Sender) Send(ctx context.Context, to, subject, textBody, htmlBody string) error {
	if s.host == "" {
		return ErrNotConfigured
	}
	if s.from == "" {
		return errors.New("mail: sender address (from) is not configured")
	}
	if to == "" {
		return errors.New("mail: recipient address is required")
	}

	dialer := &net.Dialer{Timeout: dialTimeout}
	if deadline, ok := ctx.Deadline(); ok {
		dialer.Deadline = deadline
	}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(s.host, strconv.Itoa(s.port)))
	if err != nil {
		return fmt.Errorf("mail: dial %s:%d: %w", s.host, s.port, err)
	}

	cl, err := smtp.NewClient(conn, s.host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("mail: smtp handshake: %w", err)
	}
	defer cl.Close()

	// STARTTLS whenever the server advertises it; net/smtp enforces that
	// PLAIN credentials are only sent over TLS or localhost.
	if ok, _ := cl.Extension("STARTTLS"); ok {
		if err = cl.StartTLS(&tls.Config{ServerName: s.host}); err != nil {
			return fmt.Errorf("mail: starttls: %w", err)
		}
	}
	if s.user != "" {
		if err = cl.Auth(smtp.PlainAuth("", s.user, s.pass, s.host)); err != nil {
			return fmt.Errorf("mail: auth: %w", err)
		}
	}

	if err = cl.Mail(s.from); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err = cl.Rcpt(to); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := cl.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err = w.Write(buildMessage(s.from, to, subject, textBody, htmlBody)); err != nil {
		w.Close()
		return fmt.Errorf("mail: write message: %w", err)
	}
	if err = w.Close(); err != nil {
		return fmt.Errorf("mail: end of data: %w", err)
	}
	return cl.Quit()
}

// buildMessage renders RFC 5322 headers plus a multipart/alternative body
// holding the text and HTML versions.
func buildMessage(from, to, subject, textBody, htmlBody string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", mailBoundary)

	writePart(&b, "text/plain; charset=utf-8", textBody)
	writePart(&b, "text/html; charset=utf-8", htmlBody)
	fmt.Fprintf(&b, "--%s--\r\n", mailBoundary)
	return []byte(b.String())
}

func writePart(b *strings.Builder, contentType, body string) {
	fmt.Fprintf(b, "--%s\r\n", mailBoundary)
	fmt.Fprintf(b, "Content-Type: %s\r\n", contentType)
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(normalizeCRLF(body))
	b.WriteString("\r\n")
}

// normalizeCRLF converts bare \n or lone \r into CRLF as required by SMTP.
func normalizeCRLF(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.ReplaceAll(s, "\n", "\r\n")
}
