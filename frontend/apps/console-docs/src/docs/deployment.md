# Deployment Guide

How to deploy the Kilat Cloud frontend projects.

## Project structure

The frontend is split into **four** independent apps managed by npm workspaces:

| App               | Purpose                          |
| ----------------- | -------------------------------- |
| `console-admin`   | Admin, NOC, Finance console      |
| `console-user`    | Customer console                 |
| `console-landing` | Public marketing landing page    |
| `console-docs`    | This documentation site          |

## Build each app

```bash
cd frontend

# admin console
npm run build -w apps/console-admin

# user console
npm run build -w apps/console-user

# landing page
npm run build -w apps/console-landing

# docs site
npm run build -w apps/console-docs
```

## Env configuration

Each app reads its own `.env` (gitignored). Set these in your hosting dashboard:

```ini
VITE_API_BASE_URL=https://api.kilat-cloud.com
VITE_APP_TITLE=Kilat Cloud
```

## Syntax highlighting

Code blocks in this documentation are highlighted automatically. For example, a
Docker snippet:

```dockerfile
FROM golang:1.22 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api
```

Or TypeScript:

```typescript
interface Section {
  id: string
  title: string
  published: boolean
}
```
