// Package main is the migration CLI entry point: applies the base schema then
// versioned migrations from migrations/*.sql, tracked in schema_migrations.
package main

import (
	"context"
	"fmt"
	"os"

	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/migrate"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	ctx := context.Background()
	if err := migrate.Run(ctx, cfg.DatabaseURL); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("migrations applied successfully")
}
