# Kilat Cloud Backend
SHELL := /bin/bash
DOCKER_COMPOSE := docker compose -f docker-compose.yml
# Dev: run only infra dependencies (postgres, redis, rustfs) — the API/worker
# run via `go run`. For the full production stack (api + cloudflared) use:
#   make up:full
DEV_SERVICES := postgres redis rustfs_perms rustfs rustfs-init

.PHONY: help env up up-full down deps migrate api worker build test vet fmt smoke rbac clean

help:
	@echo "make env       - generate .env for local development"
	@echo "make up        - start dev infra (postgres+redis+rustfs)"
	@echo "make up:full   - start full stack (api + cloudflared + deps)"
	@echo "make down      - stop containers"
	@echo "make migrate   - apply base schema + versioned migrations"
	@echo "make api       - run API server on :8080"
	@echo "make worker    - run job worker"
	@echo "make build     - go build ./..."
	@echo "make test      - go test ./..."
	@echo "make vet       - go vet ./..."
	@echo "make fmt       - gofmt -w ."
	@echo "make smoke     - run end-to-end endpoint smoke test"
	@echo "make rbac      - run staff-role (admin/finance/noc) matrix test"

env:
	@bash scripts/gen-env.sh

up:
	$(DOCKER_COMPOSE) up -d $(DEV_SERVICES)
	@until $(DOCKER_COMPOSE) ps | grep -q healthy; do sleep 1; done 2>/dev/null || true

up-full:
	$(DOCKER_COMPOSE) up -d --build

down:
	$(DOCKER_COMPOSE) down

deps: up

migrate: 
	@set -a && . ./.env && set +a && go run ./cmd/migrate

api:
	@set -a && . ./.env && set +a && go run ./cmd/api

worker:
	@set -a && . ./.env && set +a && go run ./cmd/worker

build:
	go build ./...

test:
	go test ./...

vet:
	go vet ./...

fmt:
	gofmt -w .

smoke:
	@bash scripts/smoke.sh

rbac:
	@bash scripts/rbac_smoke.sh

clean:
	rm -rf bin
