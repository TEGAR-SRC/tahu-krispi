// Package main is the migration entry point: applies the base schema then
// versioned migrations from migrations/*.sql, tracked in schema_migrations.
package main

import (
	"context"
	"embed"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"kilat.cloud/backend/internal/platform/config"
)

//go:embed schema.sql
var schemaSQL string

//go:embed all:migrations
var migrationsFS embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close(ctx)

	// All Kilat Cloud objects live in the app schema; align with the pool config.
	if _, err := conn.Exec(ctx, `SET search_path TO app, public`); err != nil {
		fmt.Fprintf(os.Stderr, "set search_path: %v\n", err)
		os.Exit(1)
	}

	if err := run(ctx, conn); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("migrations applied successfully")
}

func run(ctx context.Context, conn *pgx.Conn) error {
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
