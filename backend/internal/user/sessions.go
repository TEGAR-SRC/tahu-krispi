// sessions.go provides device/session listing over user_sessions.
package user

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionInfo is one row of a user's session/device list.
type SessionInfo struct {
	ID         uuid.UUID  `json:"id"`
	DeviceName string     `json:"device_name"`
	IP         string     `json:"ip"`
	UserAgent  string     `json:"user_agent"`
	CreatedAt  time.Time  `json:"created_at"`
	LastSeenAt *time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	IsCurrent  bool       `json:"is_current"`
	Revoked    bool       `json:"revoked"`
}

// ListSessions returns all of a user's sessions, newest first, marking which
// one matches currentSessionID.
func ListSessions(db *pgxpool.Pool, ctx context.Context, userID, currentSessionID uuid.UUID) ([]SessionInfo, error) {
	rows, err := db.Query(ctx, `
SELECT id, COALESCE(device_name,''), COALESCE(host(ip),''), COALESCE(user_agent,''),
       created_at, last_seen_at, expires_at,
       (id = $2), (revoked_at IS NOT NULL)
FROM user_sessions
WHERE user_id=$1
ORDER BY created_at DESC`, userID, currentSessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]SessionInfo, 0)
	for rows.Next() {
		var s SessionInfo
		if err := rows.Scan(&s.ID, &s.DeviceName, &s.IP, &s.UserAgent,
			&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt, &s.IsCurrent, &s.Revoked); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// CountActiveSessions counts live sessions: not revoked and not expired.
func CountActiveSessions(db *pgxpool.Pool, ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := db.QueryRow(ctx, `
SELECT count(*) FROM user_sessions
WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()`, userID).Scan(&n)
	return n, err
}
