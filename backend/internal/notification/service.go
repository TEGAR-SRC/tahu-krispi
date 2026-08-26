// Package notification implements in-app notification preferences and queue.
package notification

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Preferences struct {
	EmailEnabled    bool `json:"email_enabled"`
	WebEnabled      bool `json:"web_enabled"`
	SmsEnabled      bool `json:"sms_enabled"`
	BillingEvents   bool `json:"billing_events"`
	SecurityEvents  bool `json:"security_events"`
	ProductEvents   bool `json:"product_events"`
	MarketingEvents bool `json:"marketing_events"`
}

func (s *Service) GetPreferences(ctx context.Context, userID uuid.UUID) (*Preferences, error) {
	row := s.db.QueryRow(ctx, `
SELECT email_enabled, web_enabled, sms_enabled, billing_events, security_events, product_events, marketing_events
FROM notification_preferences WHERE user_id=$1`, userID)
	var p Preferences
	err := row.Scan(&p.EmailEnabled, &p.WebEnabled, &p.SmsEnabled, &p.BillingEvents,
		&p.SecurityEvents, &p.ProductEvents, &p.MarketingEvents)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) UpdatePreferences(ctx context.Context, userID uuid.UUID, p *Preferences) error {
	_, err := s.db.Exec(ctx, `
INSERT INTO notification_preferences(user_id, email_enabled, web_enabled, sms_enabled,
                                    billing_events, security_events, product_events, marketing_events)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (user_id) DO UPDATE SET
  email_enabled=EXCLUDED.email_enabled, web_enabled=EXCLUDED.web_enabled,
  sms_enabled=EXCLUDED.sms_enabled, billing_events=EXCLUDED.billing_events,
  security_events=EXCLUDED.security_events, product_events=EXCLUDED.product_events,
  marketing_events=EXCLUDED.marketing_events, updated_at=now()`,
		userID, p.EmailEnabled, p.WebEnabled, p.SmsEnabled,
		p.BillingEvents, p.SecurityEvents, p.ProductEvents, p.MarketingEvents)
	return err
}

type Notification struct {
	ID        uuid.UUID `json:"id"`
	Channel   string    `json:"channel"`
	EventType string    `json:"event_type"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	Status    string    `json:"status"`
	ReadAt    string    `json:"read_at"`
	CreatedAt string    `json:"created_at"`
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID) ([]Notification, error) {
	rows, err := s.db.Query(ctx, `
SELECT id, channel::text, event_type, COALESCE(subject,''), COALESCE(body,''), status,
       COALESCE(read_at::text,''), created_at::text
FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Channel, &n.EventType, &n.Subject, &n.Body,
			&n.Status, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// Create inserts an in-app notification.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, eventType, subject, body string) error {
	_, err := s.db.Exec(ctx, `
INSERT INTO notifications(user_id, channel, event_type, subject, body, status)
VALUES ($1,'web',$2,NULLIF($3,''),NULLIF($4,''),'sent')`, userID, eventType, subject, body)
	return err
}

// MarkRead marks a single notification as read.
func (s *Service) MarkRead(ctx context.Context, userID, notificationID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `
UPDATE notifications SET read_at=now(), status='read'
WHERE id=$2 AND user_id=$1 AND read_at IS NULL`, userID, notificationID)
	return err
}

// MarkAllRead marks all unread notifications as read for a user.
func (s *Service) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `
UPDATE notifications SET read_at=now(), status='read'
WHERE user_id=$1 AND read_at IS NULL`, userID)
	return err
}
