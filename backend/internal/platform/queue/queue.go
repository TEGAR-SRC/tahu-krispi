// Package queue implements a PostgreSQL-backed durable job queue with a Redis-free dispatcher.
package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Job struct {
	ID          uuid.UUID       `json:"id"`
	Queue       string          `json:"queue"`
	JobType     string          `json:"job_type"`
	ResourceID  *uuid.UUID      `json:"resource_id"`
	Payload     json.RawMessage `json:"payload"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
}

type Handler func(ctx context.Context, job Job) error

type Worker struct {
	db           *pgxpool.Pool
	handlers     map[string]Handler
	pollInterval time.Duration
	workerName   string
}

func NewWorker(db *pgxpool.Pool, name string) *Worker {
	return &Worker{
		db:           db,
		handlers:     map[string]Handler{},
		pollInterval: 5 * time.Second,
		workerName:   name,
	}
}

func (w *Worker) Register(jobType string, h Handler) { w.handlers[jobType] = h }

// Run polls the jobs table until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			w.pollAndProcess(ctx)
		}
	}
}

func (w *Worker) pollAndProcess(ctx context.Context) {
	for i := 0; i < 10; i++ {
		var job Job
		var payload []byte
		err := w.db.QueryRow(ctx, `
UPDATE jobs SET status='running', locked_by=$1, locked_at=now(), attempts=attempts+1, updated_at=now()
WHERE id = (
  -- No queue filter: every queue (provisioning, sync, webhook, email,
  -- maintenance, ...) is polled; dispatch is keyed by job_type only.
  SELECT id FROM jobs WHERE status IN ('queued','retry') AND run_after <= now()
  ORDER BY run_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING id, queue, job_type, resource_id, payload, attempts, max_attempts`,
			w.workerName).Scan(&job.ID, &job.Queue, &job.JobType, &job.ResourceID, &payload, &job.Attempts, &job.MaxAttempts)
		if err != nil {
			return // no more jobs or transient error
		}
		job.Payload = payload
		h, ok := w.handlers[job.JobType]
		if !ok {
			w.fail(ctx, job, "no handler registered for "+job.JobType)
			continue
		}
		jobCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		err = h(jobCtx, job)
		cancel()
		if err != nil {
			w.fail(ctx, job, err.Error())
			continue
		}
		w.db.Exec(ctx, `
UPDATE jobs SET status='success', completed_at=now(), last_error=NULL, updated_at=now() WHERE id=$1`, job.ID)
	}
}

func (w *Worker) fail(ctx context.Context, job Job, errMsg string) {
	if job.Attempts >= job.MaxAttempts {
		w.db.Exec(ctx, `
UPDATE jobs SET status='failed', last_error=NULLIF($2,''), updated_at=now() WHERE id=$1`, job.ID, errMsg)
		return
	}
	backoff := time.Duration(1<<uint(minInt(job.Attempts, 6))) * 30 * time.Second
	w.db.Exec(ctx, `
UPDATE jobs SET status='retry', last_error=NULLIF($2,''), run_after=now()+$3::interval, locked_by=NULL, locked_at=NULL, updated_at=now()
WHERE id=$1`, job.ID, errMsg, humanDuration(backoff))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func humanDuration(d time.Duration) string {
	return d.String()
}
