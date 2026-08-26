// Package audit writes audit_logs entries for sensitive actions.
package audit

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

type Entry struct {
	OrganizationID *uuid.UUID
	ActorUserID    *uuid.UUID
	ActorAPIKeyID  *uuid.UUID
	Action         string
	ResourceType   string
	ResourceID     *uuid.UUID
	IP             string
	UserAgent      string
	RequestID      string
	BeforeData     map[string]any
	AfterData      map[string]any
	Metadata       map[string]any
}

// Log persists an audit entry. Never log secrets.
func (s *Service) Log(ctx context.Context, e Entry) {
	before, _ := json.Marshal(e.BeforeData)
	after, _ := json.Marshal(e.AfterData)
	meta, _ := json.Marshal(e.Metadata)
	var orgAny, userAny, apiKeyAny, resAny any
	if e.OrganizationID != nil {
		orgAny = *e.OrganizationID
	}
	if e.ActorUserID != nil {
		userAny = *e.ActorUserID
	}
	if e.ActorAPIKeyID != nil {
		apiKeyAny = *e.ActorAPIKeyID
	}
	if e.ResourceID != nil {
		resAny = *e.ResourceID
	}
	s.db.Exec(ctx, `
INSERT INTO audit_logs(organization_id, actor_user_id, actor_api_key_id, action,
                       resource_type, resource_id, ip, user_agent, request_id,
                       before_data, after_data, metadata)
VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,NULLIF($7,'')::inet,NULLIF($8,''),NULLIF($9,'')::uuid,$10::jsonb,$11::jsonb,$12::jsonb)`,
		orgAny, userAny, apiKeyAny, e.Action,
		e.ResourceType, resAny, e.IP, e.UserAgent, e.RequestID,
		nonEmptyJSON(before), nonEmptyJSON(after), meta)
}

func nonEmptyJSON(b []byte) []byte {
	if len(b) == 0 || string(b) == "null" || string(b) == "{}" {
		return []byte(`{}`)
	}
	return b
}

type AuditLogEntry struct {
	ID           int64  `json:"id"`
	ActorUserID  string `json:"actor_user_id"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	CreatedAt    string `json:"created_at"`
}

func (s *Service) List(ctx context.Context, orgID uuid.UUID, limit int) ([]AuditLogEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(ctx, `
SELECT id, COALESCE(actor_user_id::text,''), action, COALESCE(resource_type,''),
       COALESCE(resource_id::text,''), created_at::text
FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditLogEntry
	for rows.Next() {
		var a AuditLogEntry
		if err := rows.Scan(&a.ID, &a.ActorUserID, &a.Action, &a.ResourceType, &a.ResourceID, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
