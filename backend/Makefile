# Kilat Cloud Backend
SHELL := /bin/bash
DOCKER_COMPOSE := docker compose -f docker-compose.dev.yml

.PHONY: help env up down migrate api worker test vet fmt smoke rbac build clean

help:
	@echo "make env      - generate .env for local development"
	@echo "make up       - start postgres+redis dev containers"
	@echo "make down     - stop dev containers"
	@echo "make migrate  - apply base schema + versioned migrations"
	@echo "make api      - run API server on :8080"
	@echo "make worker   - run job worker"
	@echo "make build    - go build ./..."
	@echo "make test     - go test ./..."
	@echo "make vet      - go vet ./..."
	@echo "make fmt      - gofmt -w ."
	@echo "make smoke    - run end-to-end endpoint smoke test"
	@echo "make rbac     - run staff-role (admin/finance/noc) matrix test"

env:
	@bash scripts/gen-env.sh

up:
	$(DOCKER_COMPOSE) up -d
	@until $(DOCKER_COMPOSE) ps | grep -q healthy; do sleep 1; done 2>/dev/null || true

down:
	$(DOCKER_COMPOSE) down

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
