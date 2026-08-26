// Package main is the API server entry point.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"kilat.cloud/backend/internal/api"
	"kilat.cloud/backend/internal/platform/config"
	"kilat.cloud/backend/internal/platform/logger"
	"kilat.cloud/backend/internal/platform/postgres"
	redisclient "kilat.cloud/backend/internal/platform/redis"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	log := logger.New(cfg.AppEnv)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := postgres.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres init failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	defer db.Close()

	rdb, err := redisclient.New(ctx, cfg.RedisURL)
	if err != nil {
		log.Error("redis init failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
	defer rdb.Close()

	srv, err := api.NewServer(cfg, log, db, rdb)
	if err != nil {
		log.Error("server init failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		cancel()
		srv.App().Shutdown()
	}()

	log.Info("api listening", map[string]any{"port": cfg.AppPort})
	if err := srv.Listen(); err != nil {
		log.Error("listen failed", map[string]any{"error": err.Error()})
		os.Exit(1)
	}
}
