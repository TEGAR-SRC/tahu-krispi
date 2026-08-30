# Backend build — multi-stage, static binary, no cgo.
# Build context is the repo ROOT (Dockerfile lives at backend/):
#   docker build -f backend/Dockerfile -t kilat-backend:latest .
# Run with docker-compose.yml (preferred, wires postgres/redis + env), or:
#   docker run --env-file <your-env> kilat-backend:latest        # api server (default)
#   docker run --env-file <your-env> kilat-backend:latest worker
#   docker run --env-file <your-env> kilat-backend:latest migrate

# ---- build stage ----
FROM golang:1.27-alpine AS build
WORKDIR /src

# Cache dependencies first.
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy the whole backend module (embed assets live under cmd/migrate & internal).
COPY backend/ ./

# Static build (no cgo) for a tiny runtime image.
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

# ---- runtime stage ----
FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S kilat && adduser -S kilat -G kilat
WORKDIR /app
COPY --from=build /out/ /usr/local/bin/
USER kilat

# Default: run the API server. Override CMD for worker/migrate:
#   CMD ["api"]
#   CMD ["worker"]
#   CMD ["migrate"]
CMD ["api"]
