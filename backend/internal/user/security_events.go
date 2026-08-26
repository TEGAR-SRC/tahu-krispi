// security_events.go writes and reads the auth_events audit trail.
package user

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthEvent is one entry of a user's security activity log.
type AuthEvent struct {
	ID        int64     `json:"id"`
	EventType string    `json:"event_type"`
	Success   bool      `json:"success"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

// LogAuthEvent appends an auth_events row. A zero UUID (unknown user) is
// stored as NULL because auth_events.user_id is a nullable FK.
func LogAuthEvent(db *pgxpool.Pool, ctx context.Context, userID uuid.UUID, eventType string, success bool, ip, userAgent string) error {
	userIDStr := ""
	if userID != uuid.Nil {
		userIDStr = userID.String()
	}
	_, err := db.Exec(ctx, `
INSERT INTO auth_events(user_id, event_type, success, ip, user_agent)
VALUES (NULLIF($1,'')::uuid, $2, $3, NULLIF($4,'')::inet, NULLIF($5,''))`,
		userIDStr, eventType, success, ip, userAgent)
	return err
}

// ListAuthEvents returns the user's most recent auth events, newest first.
// Non-positive limits fall back to 50; limits above 500 are clamped to 500.
func ListAuthEvents(db *pgxpool.Pool, ctx context.Context, userID uuid.UUID, limit int) ([]AuthEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := db.Query(ctx, `
SELECT id, event_type, success, COALESCE(host(ip), ''), COALESCE(user_agent, ''), created_at
FROM auth_events
WHERE user_id=$1
ORDER BY created_at DESC
LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]AuthEvent, 0, limit)
	for rows.Next() {
		var e AuthEvent
		if err := rows.Scan(&e.ID, &e.EventType, &e.Success, &e.IP, &e.UserAgent, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
