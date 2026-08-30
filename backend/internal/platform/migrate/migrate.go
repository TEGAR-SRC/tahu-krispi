// Package migrate applies the base schema and versioned migrations to a
// PostgreSQL database. It is idempotent: the base schema is only applied when
// the users table is absent, and every versioned migration is tracked in
// schema_migrations so re-running is safe. Used by the migrate CLI and by the
// API server on startup to self-heal against a fresh database.
package migrate

import (
	"context"
	"embed"
	_ "embed"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

//go:embed schema.sql
var schemaSQL string

//go:embed all:migrations
var migrationsFS embed.FS

// Run connects to databaseURL, sets the app search path, and applies any
// pending schema and migrations. Safe to call repeatedly and concurrently-safe
// for a single API instance thanks to the schema_migrations guard.
func Run(ctx context.Context, databaseURL string) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)

	// All Kilat Cloud objects live in the app schema; align with the pool config.
	if _, err := conn.Exec(ctx, `SET search_path TO app, public`); err != nil {
		return fmt.Errorf("set search_path: %w", err)
	}

	if err := run(ctx, conn); err != nil {
		return err
	}
	return nil
}

func run(ctx context.Context, conn *pgx.Conn) error {
	// Serialize migrations across multiple API pods / migrate invocations so
	// two workers on a fresh DB can't both apply the (not fully idempotent)
	// base schema. Released when the connection closes.
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(7230217)`); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer conn.Exec(ctx, `SELECT pg_advisory_unlock(7230217)`)

	// Base schema: apply once (guarded; the file itself is not fully IF NOT EXISTS).
	var baseApplied bool
	err := conn.QueryRow(ctx, `SELECT to_regclass('app.users') IS NOT NULL`).Scan(&baseApplied)
	if err != nil {
		return fmt.Errorf("probe base schema: %w", err)
	}
	if !baseApplied {
		if _, err := conn.Exec(ctx, schemaSQL); err != nil {
			return fmt.Errorf("apply base schema: %w", err)
		}
		fmt.Println("base schema applied")
	} else {
		fmt.Println("base schema already present, skipping")
	}

	if _, err := conn.Exec(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`); err != nil {
		return fmt.Errorf("create tracking table: %w", err)
	}

	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var exists bool
		err := conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, name).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check version %s: %w", name, err)
		}
		if exists {
			continue
		}
		content, err := migrationsFS.ReadFile(filepath.Join("migrations", name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ($1)`, name); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
		fmt.Printf("applied %s\n", name)
	}
	return nil
}
